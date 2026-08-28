import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AdminProduct } from "@/lib/queries/adminProducts";

// ReorderableProductsList يستورد moveProductUp/moveProductDown/moveProductToRank
// مباشرة من actions.ts (Server Actions حقيقية) — نُحاكيها هنا بالكامل: الهدف
// اختبار التحديث الفوري للترتيب فالواجهة (applyReorder) من القيمة المُرجَعة
// فقط، بلا أي علاقة بقاعدة بيانات حقيقية (ذلك مُختبَر بالفعل فـ
// moveProduct.test.ts ضد Postgres حقيقية).
const moveProductUpMock = vi.fn();
const moveProductDownMock = vi.fn();
const moveProductToRankMock = vi.fn();

vi.mock("@/app/admin/(protected)/products/actions", () => ({
  moveProductUp: (...args: unknown[]) => moveProductUpMock(...args),
  moveProductDown: (...args: unknown[]) => moveProductDownMock(...args),
  moveProductToRank: (...args: unknown[]) => moveProductToRankMock(...args),
}));

const { ReorderableProductsList } = await import("@/components/admin/ReorderableProductsList");

afterEach(() => {
  cleanup();
  moveProductUpMock.mockReset();
  moveProductDownMock.mockReset();
  moveProductToRankMock.mockReset();
});

function makeProduct(overrides: Partial<AdminProduct> & { id: number }): AdminProduct {
  return {
    sku: `SKU-${overrides.id}`,
    slug: `slug-${overrides.id}`,
    category_id: 1,
    category_name_ar: "تصنيف اختبار",
    name_ar: `منتج ${overrides.id}`,
    name_fr: null,
    description_ar: null,
    technical_specs: null,
    unit_label: "قطعة",
    min_order_qty: 1,
    qty_increment: 1,
    purchase_price: null,
    sale_price: "10.00",
    stock_quantity: 5,
    status: "published",
    sort_order: overrides.id,
    pricing_mode: "single",
    tier2_min_qty: null,
    tier2_price: null,
    tier3_min_qty: null,
    tier3_price: null,
    show_bulk_whatsapp: false,
    ...overrides,
  };
}

// تصنيف واحد (category_id=1) فيه 3 منتجات بترتيب 1/2/3، وتصنيف آخر
// (category_id=2) فيه منتج واحد — للتأكد أن تحديث تصنيف لا يمسّ الآخر.
const PRODUCTS: AdminProduct[] = [
  makeProduct({ id: 101, sort_order: 1, name_ar: "منتج أ" }),
  makeProduct({ id: 102, sort_order: 2, name_ar: "منتج ب" }),
  makeProduct({ id: 103, sort_order: 3, name_ar: "منتج ج" }),
  makeProduct({ id: 201, category_id: 2, category_name_ar: "تصنيف آخر", sort_order: 1, name_ar: "منتج د" }),
];

function renderList(products: AdminProduct[] = PRODUCTS) {
  const rowConfigs = products.map((p) => ({
    productId: p.id,
    action: vi.fn(async () => ({ error: null })),
    images: [],
    createUploadTargetAction: vi.fn(),
    commitPrimaryUploadAction: vi.fn(),
    commitAdditionalUploadAction: vi.fn(),
    imagesWithActions: [],
  }));

  return render(
    <ReorderableProductsList
      initialProducts={products}
      rowConfigs={rowConfigs}
      imageUrlByPath={{}}
      canUploadImages={false}
    />
  );
}

function orderedNames(): string[] {
  return screen.getAllByRole("link").map((a) => a.textContent ?? "");
}

describe("ReorderableProductsList — تحديث الترتيب فوراً بالواجهة بلا reload كامل للصفحة", () => {
  test("العرض الأولي بترتيب initialProducts", () => {
    renderList();
    expect(orderedNames()).toEqual(["منتج أ", "منتج ب", "منتج ج", "منتج د"]);
  });

  test("نقل ناجح عبر خانة المرتبة يُعيد ترتيب صفوف نفس التصنيف فوراً محلياً، بلا مسّ تصنيف آخر", async () => {
    // منتج ج (103, مرتبة 3) → مرتبة 1: الخادم (المُحاكى) يُرجع الترتيب
    // الجديد للتصنيف بأكمله (101→2، 102→3، 103→1).
    moveProductToRankMock.mockResolvedValueOnce({
      error: null,
      updated: [
        { id: 103, sort_order: 1 },
        { id: 101, sort_order: 2 },
        { id: 102, sort_order: 3 },
      ],
    });

    renderList();

    const rows = screen.getAllByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" });
    // الصف الثالث (منتج ج) هو index=2 فالعرض الأولي.
    fireEvent.change(rows[2], { target: { value: "1" } });
    const moveButtons = screen.getAllByRole("button", { name: "نقل" });
    fireEvent.click(moveButtons[2]);

    await vi.waitFor(() => expect(moveProductToRankMock).toHaveBeenCalledWith(103, 1));

    await vi.waitFor(() => {
      expect(orderedNames()).toEqual(["منتج ج", "منتج أ", "منتج ب", "منتج د"]);
    });

    // منتج د (تصنيف آخر) بقي فمكانه، بلا أي استدعاء يخصّه.
    expect(moveProductUpMock).not.toHaveBeenCalled();
    expect(moveProductDownMock).not.toHaveBeenCalled();
  });

  test("زر '↑' يستدعي moveProductUp بمعرّف المنتج الصحيح ويُطبِّق النتيجة محلياً", async () => {
    moveProductUpMock.mockResolvedValueOnce({
      error: null,
      updated: [
        { id: 102, sort_order: 1 },
        { id: 101, sort_order: 2 },
      ],
    });

    renderList();

    const upButtons = screen.getAllByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" });
    // الصف الثاني (منتج ب، index=1) — الوحيد المفعَّل فوسط تصنيفه.
    fireEvent.click(upButtons[1]);

    await vi.waitFor(() => expect(moveProductUpMock).toHaveBeenCalledWith(102));
    await vi.waitFor(() => {
      expect(orderedNames()).toEqual(["منتج ب", "منتج أ", "منتج ج", "منتج د"]);
    });
  });

  test("فشل النقل: لا تغيير فالترتيب المحلي، رسالة خطأ تظهر فالصف نفسه", async () => {
    moveProductToRankMock.mockResolvedValueOnce({ error: "خطأ من الخادم." });

    renderList();

    const rows = screen.getAllByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" });
    fireEvent.change(rows[0], { target: { value: "3" } });
    const moveButtons = screen.getAllByRole("button", { name: "نقل" });
    fireEvent.click(moveButtons[0]);

    await vi.waitFor(() => expect(screen.getByText("خطأ من الخادم.")).toBeTruthy());
    expect(orderedNames()).toEqual(["منتج أ", "منتج ب", "منتج ج", "منتج د"]);
  });

  test("قائمة فارغة: رسالة 'لا توجد منتجات مطابقة'", () => {
    renderList([]);
    expect(screen.getByText("لا توجد منتجات مطابقة.")).toBeTruthy();
  });
});
