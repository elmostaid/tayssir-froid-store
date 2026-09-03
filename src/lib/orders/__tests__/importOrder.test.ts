import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import { buildOrderDraft, parseOrderJson } from "@/lib/orders/importOrder";

/**
 * الاستيراد يقرأ ولا يكتب. هذه الاختبارات تُثبت الأمرين: أن كل بون فاسد
 * يُرفَض برسالة تقول أين الخطأ، وأن **المخزون لا يتحرّك** مهما كان البون.
 */

const SKUS = ["IMP-FIX-001", "IMP-FIX-002", "IMP-FIX-003"];
const stockOf = async (sku: string) =>
  (await sql<{ stock_quantity: number }[]>`select stock_quantity from public.products where sku = ${sku}`)[0]
    .stock_quantity;

const bon = (over: Record<string, unknown> = {}) => ({
  customer_name: "عبد الحق",
  phone: "0673155475",
  city: "تندرار",
  address: "حي الرجاء في الله",
  source: "whatsapp",
  delivery_fee: 45,
  notes: "",
  items: [
    { sku: "IMP-FIX-001", quantity: 1, unit_price: 1000 },
    { sku: "IMP-FIX-002", quantity: 1, unit_price: 850 },
  ],
  ...over,
});

const draftOf = async (payload: unknown) => {
  const parsed = parseOrderJson(JSON.stringify(payload));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("unreachable");
  return buildOrderDraft(parsed.value);
};

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  await sql`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values
    ('IMP-FIX-001', 'imp-fix-001', ${category.id}, 'مكيف اختبار', 'قطعة', 1, 1, 700.00, 1100.00, 20, 'published'),
    ('IMP-FIX-002', 'imp-fix-002', ${category.id}, 'غاز اختبار',  'قطعة', 1, 1, 600.00,  850.00,  5, 'published'),
    ('IMP-FIX-003', 'imp-fix-003', ${category.id}, 'قطعة بلا تكلفة', 'قطعة', 1, 1, null, 300.00, 10, 'published')
    on conflict (sku) do nothing
  `;
});

afterAll(async () => {
  await sql`delete from public.products where sku = any(${SKUS})`;
});

describe("قراءة البون — الحالة الناجحة", () => {
  test("يطابق الأكواد ويحسب المجاميع والتكلفة والربح", async () => {
    const result = await draftOf(bon());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { draft } = result;
    expect(draft.customerName).toBe("عبد الحق");
    expect(draft.source).toBe("whatsapp");
    expect(draft.deliveryFee).toBe(45);
    expect(draft.items).toHaveLength(2);

    const subtotal = draft.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const cost = draft.items.reduce((s, i) => s + (i.purchasePrice ?? 0) * i.quantity, 0);
    expect(subtotal).toBe(1850);
    expect(subtotal + draft.deliveryFee).toBe(1895);
    expect(cost).toBe(1300);
    expect(subtotal - cost).toBe(550);
  });

  test("ثمن خاص يُقبَل كما اتُّفق عليه، مع تنبيه أنه يخالف سعر المنتج", async () => {
    const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-001", quantity: 2, unit_price: 950 }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.items[0].unitPrice).toBe(950);
    expect(result.warnings.some((w) => w.message.includes("يختلف عن سعر المنتج"))).toBe(true);
  });

  test("بون بلا ثمن: يُملأ من سعر المنتج ويُوسَم بذلك", async () => {
    const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-001", quantity: 1 }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.items[0].unitPrice).toBe(1100);
    expect(result.draft.items[0].priceFromCatalog).toBe(true);
  });

  test("الكود يُطابَق بلا حساسية لحالة الأحرف — البون يُكتب بيد بشرية", async () => {
    const result = await draftOf(bon({ items: [{ sku: "imp-fix-001", quantity: 1, unit_price: 1000 }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.items[0].sku).toBe("IMP-FIX-001");
  });

  test("منتج بلا ثمن شراء يمرّ، لكن مع تنبيه أن ربحه غير معروف", async () => {
    const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-003", quantity: 1, unit_price: 300 }] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.items[0].purchasePrice).toBeNull();
    expect(result.warnings.some((w) => w.message.includes("لا ثمن شراء"))).toBe(true);
  });

  test("الأرقام كنصوص مقبولة — البونات تأتي بالشكلين", async () => {
    const result = await draftOf(bon({ delivery_fee: "45", items: [{ sku: "IMP-FIX-001", quantity: 1, unit_price: "1000" }] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.deliveryFee).toBe(45);
  });

  test("**القراءة لا تمسّ المخزون إطلاقاً**", async () => {
    const before = await stockOf("IMP-FIX-001");
    await draftOf(bon({ items: [{ sku: "IMP-FIX-001", quantity: 5, unit_price: 1000 }] }));
    expect(await stockOf("IMP-FIX-001")).toBe(before);
  });
});

/**
 * توافق البونات القديمة — الشرط الذي لا يجوز كسره.
 *
 * كل بون كُتب قبل اليوم لا يحمل `actual_delivery_cost`، والاستيراد يجب أن
 * يمرّ كما كان تماماً وتبقى القيمة «غير مسجَّلة». الحقل اختياري إلى الأبد،
 * لا اختياري مؤقتاً.
 */
describe("تكلفة التوصيل الفعلية في البون — اختيارية", () => {
  test("بون بلا الحقل إطلاقاً: يُستورَد عادياً والقيمة null", async () => {
    const draft = await draftOf(bon());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.draft.actualDeliveryCost).toBeNull();
    // ولا يتحوّل صفراً بأي حال.
    expect(draft.draft.actualDeliveryCost).not.toBe(0);
    // وبقية البون تُقرأ كما كانت.
    expect(draft.draft.deliveryFee).toBe(45);
    expect(draft.draft.items).toHaveLength(2);
  });

  test("بون يذكرها: تُقرأ رقماً", async () => {
    const draft = await draftOf(bon({ actual_delivery_cost: 60 }));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.draft.actualDeliveryCost).toBe(60);
  });

  test("تُقبَل نصاً كبقية أرقام البون", async () => {
    const draft = await draftOf(bon({ actual_delivery_cost: "37.50" }));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.draft.actualDeliveryCost).toBe(37.5);
  });

  test("null أو نص فارغ = غير مسجَّلة، بلا خطأ", async () => {
    for (const value of [null, ""]) {
      const draft = await draftOf(bon({ actual_delivery_cost: value }));
      expect(draft.ok).toBe(true);
      if (!draft.ok) return;
      expect(draft.draft.actualDeliveryCost).toBeNull();
    }
  });

  test("صفر صريح يُقبَل — توصيل لم يكلّفنا شيئاً فعلاً", async () => {
    const draft = await draftOf(bon({ actual_delivery_cost: 0 }));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.draft.actualDeliveryCost).toBe(0);
  });

  test("قيمة غير صالحة تُرفَض برسالة تشرح أن الحذف ممكن", async () => {
    const draft = await draftOf(bon({ actual_delivery_cost: -5 }));
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.errors.some((e) => e.field === "actual_delivery_cost")).toBe(true);
  });
});

describe("قراءة البون — حالات الخطأ", () => {
  test("JSON تالف: رسالة تقول إنه ليس JSON", () => {
    const parsed = parseOrderJson("{ليس JSON");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0].message).toContain("ليس JSON صالحاً");
  });

  test("نص فارغ", () => {
    expect(parseOrderJson("   ").ok).toBe(false);
  });

  test("قائمة بدل كائن", () => {
    const parsed = parseOrderJson("[]");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0].message).toContain("كائن JSON واحد");
  });

  test("SKU غير موجود: الرسالة تذكر الكود نفسه", async () => {
    const result = await draftOf(bon({ items: [{ sku: "LA-YOUJAD-999", quantity: 1, unit_price: 10 }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain("LA-YOUJAD-999");
  });

  test("كمية صفر أو سالبة أو كسرية", async () => {
    for (const quantity of [0, -3, 1.5]) {
      const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-001", quantity, unit_price: 100 }] }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message).toContain("الكمية");
    }
  });

  test("ثمن سالب أو غير رقمي", async () => {
    for (const unit_price of [-5, "غير رقم"]) {
      const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-001", quantity: 1, unit_price }] }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message).toContain("ثمن البيع");
    }
  });

  test("مخزون غير كافٍ: الرسالة تذكر المتوفر والمطلوب", async () => {
    const result = await draftOf(bon({ items: [{ sku: "IMP-FIX-002", quantity: 99, unit_price: 850 }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain("5");
      expect(result.errors[0].message).toContain("99");
    }
  });

  test("مصاريف توصيل غير صالحة", async () => {
    for (const delivery_fee of [-10, "مجاناً"]) {
      const result = await draftOf(bon({ delivery_fee }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((e) => e.field === "delivery_fee")).toBe(true);
    }
  });

  test("هاتف غير صالح، واسم/مدينة/عنوان مفقود", async () => {
    const bad = await draftOf(bon({ phone: "12345", customer_name: "", city: "", address: "" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const fields = bad.errors.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["phone", "customer_name", "city", "address"]));
    }
  });

  test("المصدر website مرفوض — هذا المسار للبيع خارج الموقع", async () => {
    const result = await draftOf(bon({ source: "website" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "source")).toBe(true);
  });

  test("بون بلا منتجات", async () => {
    const result = await draftOf(bon({ items: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe("items");
  });

  test("كل الأخطاء تُعاد معاً لا واحداً واحداً", async () => {
    const result = await draftOf(
      bon({
        items: [
          { sku: "LA-YOUJAD-1", quantity: 1, unit_price: 10 },
          { sku: "IMP-FIX-001", quantity: 0, unit_price: 10 },
          { sku: "IMP-FIX-002", quantity: 99, unit_price: 10 },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test("**أي خطأ لا يمسّ المخزون**", async () => {
    const before = await stockOf("IMP-FIX-002");
    await draftOf(bon({ items: [{ sku: "IMP-FIX-002", quantity: 99, unit_price: 850 }] }));
    await draftOf(bon({ delivery_fee: -1 }));
    expect(await stockOf("IMP-FIX-002")).toBe(before);
  });
});
