import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AdminProduct } from "@/lib/queries/adminProducts";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";

const { ProductQuickEditRow } = await import("@/components/admin/ProductQuickEditRow");

afterEach(() => {
  cleanup();
});

const PRODUCT: AdminProduct = {
  id: 1,
  sku: "TF-TEST-001",
  slug: "test-product",
  category_id: 10,
  category_name_ar: "تصنيف اختبار",
  name_ar: "منتج اختبار",
  name_fr: null,
  description_ar: null,
  technical_specs: null,
  unit_label: "قطعة",
  min_order_qty: 1,
  qty_increment: 1,
  purchase_price: null,
  sale_price: "99.00",
  stock_quantity: 10,
  status: "published",
};

function renderRow(overrides: Partial<{ isFirstInCategory: boolean; isLastInCategory: boolean }> = {}) {
  const action = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_prevState: ProductFormState, _formData: FormData): Promise<ProductFormState> => ({
      error: null,
    })
  );
  const createUploadTargetAction = vi.fn();
  const commitPrimaryUploadAction = vi.fn();
  const commitAdditionalUploadAction = vi.fn();
  const moveUpAction = vi.fn(async () => ({ error: null }));
  const moveDownAction = vi.fn(async () => ({ error: null }));

  render(
    <ProductQuickEditRow
      product={PRODUCT}
      action={action}
      images={[]}
      imageUrlByPath={{}}
      canUploadImages
      createUploadTargetAction={createUploadTargetAction}
      commitPrimaryUploadAction={commitPrimaryUploadAction}
      commitAdditionalUploadAction={commitAdditionalUploadAction}
      imagesWithActions={[]}
      isFirstInCategory={overrides.isFirstInCategory ?? false}
      isLastInCategory={overrides.isLastInCategory ?? false}
      moveUpAction={moveUpAction}
      moveDownAction={moveDownAction}
    />
  );

  return { moveUpAction, moveDownAction };
}

describe("ProductQuickEditRow — أزرار ترتيب المنتج داخل تصنيفه", () => {
  test("يعرض زري '↑' و'↓' كأزرار type=button، لا submit", () => {
    renderRow();
    const up = screen.getByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" });
    const down = screen.getByRole("button", { name: "هبّط المنتج للأسفل داخل نفس التصنيف" });
    expect(up.getAttribute("type")).toBe("button");
    expect(down.getAttribute("type")).toBe("button");
  });

  function isDisabled(name: string): boolean {
    return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
  }

  test("منتج فالوسط (ليس أول ولا آخر): كلا الزرين مفعَّلان", () => {
    renderRow({ isFirstInCategory: false, isLastInCategory: false });
    expect(isDisabled("طلّع المنتج للأعلى داخل نفس التصنيف")).toBe(false);
    expect(isDisabled("هبّط المنتج للأسفل داخل نفس التصنيف")).toBe(false);
  });

  test("المنتج الأول فالتصنيف: زر '↑' معطَّل، '↓' مفعَّل", () => {
    renderRow({ isFirstInCategory: true, isLastInCategory: false });
    expect(isDisabled("طلّع المنتج للأعلى داخل نفس التصنيف")).toBe(true);
    expect(isDisabled("هبّط المنتج للأسفل داخل نفس التصنيف")).toBe(false);
  });

  test("المنتج الأخير فالتصنيف: زر '↓' معطَّل، '↑' مفعَّل", () => {
    renderRow({ isFirstInCategory: false, isLastInCategory: true });
    expect(isDisabled("طلّع المنتج للأعلى داخل نفس التصنيف")).toBe(false);
    expect(isDisabled("هبّط المنتج للأسفل داخل نفس التصنيف")).toBe(true);
  });

  test("الضغط على '↑' يستدعي moveUpAction فقط", async () => {
    const { moveUpAction, moveDownAction } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(moveUpAction).toHaveBeenCalledTimes(1));
    expect(moveDownAction).not.toHaveBeenCalled();
  });

  test("الضغط على '↓' يستدعي moveDownAction فقط", async () => {
    const { moveUpAction, moveDownAction } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "هبّط المنتج للأسفل داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(moveDownAction).toHaveBeenCalledTimes(1));
    expect(moveUpAction).not.toHaveBeenCalled();
  });

  test("فشل move: يعرض رسالة الخطأ بلا لمس بقية بيانات الصف", async () => {
    const action = vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_prevState: ProductFormState, _formData: FormData): Promise<ProductFormState> => ({
        error: null,
      })
    );
    const moveUpAction = vi.fn(async () => ({ error: "خطأ تجريبي." }));
    const moveDownAction = vi.fn(async () => ({ error: null }));

    render(
      <ProductQuickEditRow
        product={PRODUCT}
        action={action}
        images={[]}
        imageUrlByPath={{}}
        canUploadImages
        createUploadTargetAction={vi.fn()}
        commitPrimaryUploadAction={vi.fn()}
        commitAdditionalUploadAction={vi.fn()}
        imagesWithActions={[]}
        isFirstInCategory={false}
        isLastInCategory={false}
        moveUpAction={moveUpAction}
        moveDownAction={moveDownAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(screen.getByText("خطأ تجريبي.")).toBeTruthy());

    // اسم المنتج والحقول الأخرى بلا أي تغيير فالواجهة.
    expect(screen.getByText("منتج اختبار")).toBeTruthy();
  });
});
