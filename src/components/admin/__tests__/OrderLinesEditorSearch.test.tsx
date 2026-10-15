import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// الـServer Action يُستبدَل: الاختبار يقيس **عدد النداءات وترتيب تطبيق
// النتائج**، لا سلوك الخادم. المصادقة والصلاحيات تبقى داخل الإجراء الحقيقي
// (`requireOwner` في actions.ts) ولم تُمسّ — هذا الملف لا يتجاوزها، بل لا
// يصل إليها أصلاً.
const searchProductsAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/admin/(protected)/orders/actions", () => ({ searchProductsAction }));

import { OrderLinesEditor, PRODUCT_SEARCH_DEBOUNCE_MS } from "@/components/admin/OrderLinesEditor";

const WAIT = { timeout: PRODUCT_SEARCH_DEBOUNCE_MS + 2000 };

function product(id: number, name: string) {
  return {
    id,
    sku: `TF-T-${id}`,
    name,
    salePriceMad: 100,
    purchasePriceMad: 60,
    stockQuantity: 10,
    minOrderQty: 1,
    unitLabel: "قطعة",
    status: "published",
  };
}

function renderEditor() {
  render(<OrderLinesEditor initialLines={[]} initialDeliveryFee={35} />);
}

const box = () => screen.getByRole("searchbox") as HTMLInputElement;

/** يحاكي الكتابة حرفاً حرفاً: كل حرف حدث `change` مستقل، كضغطة مفتاح. */
function typeChars(text: string, from = "") {
  let value = from;
  for (const ch of text) {
    value += ch;
    fireEvent.change(box(), { target: { value } });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  searchProductsAction.mockReset();
  searchProductsAction.mockResolvedValue({ ok: true, results: [] });
});

afterEach(cleanup);

describe("بحث المنتجات — تقليل نداءات الخادم", () => {
  test("كتابة كلمة كاملة تُنتج نداءً واحداً لا نداءً لكل حرف", async () => {
    renderEditor();
    typeChars("TF-RF-006"); // تسع ضغطات، ثمانٍ منها تتجاوز حدّ الحرفين

    // قبل انقضاء مهلة السكون لم يُرسَل شيء بعد.
    expect(searchProductsAction).not.toHaveBeenCalled();

    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(1), WAIT);
    // وبالمصطلح الكامل، لا بمصطلح ناقص من منتصف الكتابة.
    expect(searchProductsAction).toHaveBeenCalledWith("TF-RF-006");
  });

  test("توقّف ثم متابعة = نداءان، كلٌّ بمصطلحه", async () => {
    renderEditor();

    typeChars("ضاغ");
    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(1), WAIT);

    typeChars("ط", "ضاغ");
    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(2), WAIT);

    expect(searchProductsAction).toHaveBeenNthCalledWith(1, "ضاغ");
    expect(searchProductsAction).toHaveBeenNthCalledWith(2, "ضاغط");
  });

  test("حرف واحد لا يُرسَل إطلاقاً", async () => {
    renderEditor();
    typeChars("ض");
    await sleep(PRODUCT_SEARCH_DEBOUNCE_MS + 200);
    expect(searchProductsAction).not.toHaveBeenCalled();
  });
});

describe("بحث المنتجات — نتيجة قديمة لا تدهس أحدث منها", () => {
  test("استجابة بطيئة لمصطلح قديم تُهمَل بعد وصول استجابة أحدث", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    searchProductsAction.mockImplementation(async (term: string) => {
      if (term === "ضاغ") {
        await slow; // الأول يتأخّر عمداً
        return { ok: true, results: [product(1, "نتيجة قديمة")] };
      }
      return { ok: true, results: [product(2, "نتيجة أحدث")] };
    });

    renderEditor();

    typeChars("ضاغ");
    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(1), WAIT);

    typeChars("ط", "ضاغ");
    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(2), WAIT);

    expect(await screen.findByText("نتيجة أحدث", undefined, WAIT)).toBeDefined();

    // تصل القديمة الآن متأخّرة — يجب ألا تحلّ محلّ الأحدث.
    releaseSlow();
    await sleep(200);

    expect(screen.queryByText("نتيجة قديمة")).toBeNull();
    expect(screen.queryByText("نتيجة أحدث")).not.toBeNull();
  });

  test("مسح الحقل يُبطل استجابة في الطريق فلا تعود القائمة", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    searchProductsAction.mockImplementation(async () => {
      await pending;
      return { ok: true, results: [product(3, "نتيجة متأخّرة")] };
    });

    renderEditor();
    typeChars("ضاغط");
    await waitFor(() => expect(searchProductsAction).toHaveBeenCalledTimes(1), WAIT);

    fireEvent.change(box(), { target: { value: "" } });
    release();
    await sleep(200);

    expect(screen.queryByText("نتيجة متأخّرة")).toBeNull();
  });
});

describe("بحث المنتجات — الوظائف القائمة لم تتغيّر", () => {
  test("النتائج تُعرض، وإضافة منتج تُفرّغ الحقل", async () => {
    searchProductsAction.mockResolvedValue({
      ok: true,
      results: [product(7, "ضاغط ثلاجة")],
    });

    renderEditor();
    typeChars("ضاغط");

    const hit = await screen.findByText("ضاغط ثلاجة", undefined, WAIT);
    fireEvent.click(hit);

    await waitFor(() => expect(box().value).toBe(""));
  });

  test("خطأ من الخادم يُعرض كما كان", async () => {
    searchProductsAction.mockResolvedValue({ ok: false, error: "صلاحية غير كافية" });

    renderEditor();
    typeChars("ضاغط");

    expect(await screen.findByText("صلاحية غير كافية", undefined, WAIT)).toBeDefined();
  });

  test("الحقل المعطّل لا يبحث", async () => {
    render(<OrderLinesEditor initialLines={[]} initialDeliveryFee={0} disabled />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).disabled).toBe(true);
  });
});
