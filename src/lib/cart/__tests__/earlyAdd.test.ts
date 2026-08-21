import { gzipSync } from "node:zlib";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  CART_STORAGE_KEY,
  EARLY_ADD_SCRIPT,
  PENDING_ADDS_KEY,
  type EarlyAddPayload,
  type PendingAdd,
} from "@/lib/cart/earlyAdd";
import { cartItemKey, snapQuantity } from "@/lib/cart/cartMath";
import type { CartItem } from "@/lib/cart/types";

/**
 * السكريبت المبكّر يكتب في نفس مفتاح التخزين الذي يقرأه CartProvider، فأي
 * انحراف بينهما يعني سلّة تتغيّر تحت يد الزبون عند الترطيب. هذه الاختبارات
 * تُثبت التطابق سلوكاً لا شكلاً: نفس منطق الدمج، نفس التقريب، نفس المفتاح.
 */

const PAYLOAD: EarlyAddPayload = {
  productId: 7,
  variantId: null,
  slug: "compresseur-x",
  sku: "TF-CP-001",
  name: "ضاغط",
  variantName: null,
  unitPrice: 120,
  minOrderQty: 5,
  qtyIncrement: 5,
  imageUrl: "/img/7/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
  quantity: 5,
};

function renderPage(payload: EarlyAddPayload = PAYLOAD) {
  document.body.innerHTML = `
    <span data-cart-count hidden>0</span>
    <button type="button" data-early-add='${JSON.stringify(payload)}'>
      <span data-add-label>أضف للسلة</span>
    </button>
  `;
  return {
    button: document.querySelector("button")!,
    label: document.querySelector("[data-add-label]")!,
    badge: document.querySelector("[data-cart-count]") as HTMLElement,
  };
}

const stored = (): CartItem[] => JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
const pending = (): PendingAdd[] => JSON.parse(localStorage.getItem(PENDING_ADDS_KEY) ?? "[]");

beforeAll(() => {
  // نُنفّذ السكريبت مرة واحدة تماماً كما يفعل المتصفح وقت تحليل الصفحة.
  new Function(EARLY_ADD_SCRIPT)();
});

beforeEach(() => {
  localStorage.clear();
  delete window.__tfCartLive;
});

describe("السكريبت المبكّر — الزر يعمل قبل وصول React", () => {
  test("ضغطة واحدة قبل الترطيب تكتب المنتج في نفس مفتاح تخزين السلة", () => {
    const { button } = renderPage();
    button.click();

    expect(stored()).toEqual([{ ...PAYLOAD, quantity: 5 }]);
  });

  test("ضغطتان على نفس المنتج تُدمجان في سطر واحد بنفس منطق addItem", () => {
    const { button } = renderPage();
    button.click();
    button.click();
    button.click();

    const items = stored();
    expect(items).toHaveLength(1);
    // نفس ما كان addItem سيُنتجه: تراكم ثم تقريب إلى مضاعف صالح.
    expect(items[0].quantity).toBe(
      snapQuantity(snapQuantity(snapQuantity(5, 5, 5) + 5, 5, 5) + 5, 5, 5)
    );
    expect(items[0].quantity).toBe(15);
  });

  test("منتجان مختلفان يبقيان سطرين، بنفس مفتاح cartItemKey", () => {
    const other = { ...PAYLOAD, productId: 9, sku: "TF-CP-002", name: "مكثف" };
    const { button } = renderPage();
    button.click();
    renderPage(other).button.click();

    const items = stored();
    expect(items.map((i) => cartItemKey(i.productId, i.variantId))).toEqual(["7:base", "9:base"]);
  });

  test("Variant مختلف لنفس المنتج سطر مستقل — لا يُدمج مع الأساسي", () => {
    renderPage().button.click();
    renderPage({ ...PAYLOAD, variantId: 3 }).button.click();

    expect(stored().map((i) => cartItemKey(i.productId, i.variantId))).toEqual(["7:base", "7:3"]);
  });

  test("التقريب مطابق لـsnapQuantity تماماً على كل الحالات المهمة", () => {
    const cases: Array<[number, number, number]> = [
      [1, 1, 1],
      [5, 5, 5],
      [3, 5, 5],
      [7, 2, 3],
      [12, 4, 4],
      [1, 10, 10],
      [100, 6, 7],
    ];

    for (const [quantity, minOrderQty, qtyIncrement] of cases) {
      localStorage.clear();
      renderPage({ ...PAYLOAD, quantity, minOrderQty, qtyIncrement }).button.click();
      expect(stored()[0].quantity).toBe(snapQuantity(quantity, minOrderQty, qtyIncrement));
    }
  });

  test("عدّاد السلة يتحدّث فوراً، ويظهر بعد أن كان مخفياً", () => {
    const { button, badge } = renderPage();
    expect(badge.hidden).toBe(true);

    button.click();

    expect(badge.textContent).toBe("5");
    expect(badge.hidden).toBe(false);
  });

  test("نص الزر يؤكّد الإضافة للزبون فوراً", () => {
    const { button, label } = renderPage();
    button.click();
    expect(label.textContent).toBe("تمت الإضافة ✓");
  });

  test("بعد رفع __tfCartLive يتنحّى السكريبت تماماً ويترك الحدث لـReact", () => {
    const { button } = renderPage();
    window.__tfCartLive = true;

    let reachedReact = false;
    document.addEventListener("click", () => {
      reachedReact = true;
    });
    button.click();

    expect(stored()).toEqual([]);
    expect(reachedReact).toBe(true);
  });

  test("قبل الترطيب: الحدث يُوقَف فلا يصل إلى أي مستمع آخر — لا ازدواج ولا إعادة تشغيل", () => {
    const { button } = renderPage();

    let reachedReact = false;
    document.addEventListener("click", () => {
      reachedReact = true;
    });
    button.click();

    expect(stored()).toHaveLength(1);
    expect(reachedReact).toBe(false);
  });

  test("كل إضافة مبكّرة تُصفّ للقياس الداخلي بقيمة سلة صحيحة", () => {
    const { button } = renderPage();
    button.click();
    button.click();

    expect(pending().map(({ at: _at, id: _id, ...rest }) => rest)).toEqual([
      { productId: 7, sku: "TF-CP-001", quantity: 5, cartValue: 600 },
      { productId: 7, sku: "TF-CP-001", quantity: 5, cartValue: 1200 },
    ]);
  });

  test("لكل ضغطة مُعرّف فريد — لا يختلط حدثان أبداً", () => {
    const { button } = renderPage();
    button.click();
    button.click();
    button.click();

    const ids = pending().map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  test("الطابور في التخزين لا في الذاكرة — يعيش بعد مغادرة الصفحة قبل الترطيب", () => {
    // هذه بالضبط الحالة التي فقدنا فيها حدثاً على Production: ضغطة عند
    // الثانية الثانية ثم مغادرة قبل أن يصل React عند العاشرة.
    renderPage().button.click();
    expect(pending()).toHaveLength(1);
    expect(typeof pending()[0].at).toBe("number");
    expect(pending()[0].id).toMatch(/^[a-z0-9]+$/);

    // "صفحة جديدة": ذاكرة نظيفة، نفس التخزين.
    document.body.innerHTML = "";
    expect(pending()).toHaveLength(1);
  });

  test("زر معطّل (نفد المخزون) لا يضيف شيئاً", () => {
    const { button } = renderPage();
    button.disabled = true;
    button.click();

    expect(stored()).toEqual([]);
  });

  test("ضغطة خارج الزر لا تُلمس", () => {
    renderPage();
    document.querySelector("[data-cart-count]")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(stored()).toEqual([]);
  });

  test("تخزين تالف لا يُسقط الإضافة — نبدأ من سلة نظيفة بدل أن نرمي خطأ", () => {
    localStorage.setItem(CART_STORAGE_KEY, "{ليس JSON");
    renderPage().button.click();

    expect(stored()).toHaveLength(1);
  });

  test("السكريبت نحو كيلوبايت على السلك — الكلفة هنا تُدفع في كل صفحة", () => {
    // ما يهمّ هو ما يُنقَل فعلاً: HTML يُقدَّم مضغوطاً دائماً. الحدّ ليس رقماً
    // سحرياً، بل حارس صريح حتى لا يتضخّم هذا السكريبت لاحقاً فينقلب على
    // الغاية التي كُتب لأجلها.
    expect(gzipSync(Buffer.from(EARLY_ADD_SCRIPT, "utf8")).length).toBeLessThan(1200);
  });
});
