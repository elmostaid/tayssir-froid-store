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
  sort_order: 3,
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
  const onMoveUp = vi.fn(async () => ({ error: null }));
  const onMoveDown = vi.fn(async () => ({ error: null }));
  const onMoveToRank = vi.fn(async () => ({ error: null }));

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
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onMoveToRank={onMoveToRank}
    />
  );

  return { onMoveUp, onMoveDown, onMoveToRank };
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

  test("الضغط على '↑' يستدعي onMoveUp فقط", async () => {
    const { onMoveUp, onMoveDown } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(onMoveUp).toHaveBeenCalledTimes(1));
    expect(onMoveDown).not.toHaveBeenCalled();
  });

  test("الضغط على '↓' يستدعي onMoveDown فقط", async () => {
    const { onMoveUp, onMoveDown } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "هبّط المنتج للأسفل داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(onMoveDown).toHaveBeenCalledTimes(1));
    expect(onMoveUp).not.toHaveBeenCalled();
  });

  test("فشل move: يعرض رسالة الخطأ بلا لمس بقية بيانات الصف", async () => {
    const action = vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_prevState: ProductFormState, _formData: FormData): Promise<ProductFormState> => ({
        error: null,
      })
    );
    const onMoveUp = vi.fn(async () => ({ error: "خطأ تجريبي." }));
    const onMoveDown = vi.fn(async () => ({ error: null }));
    const onMoveToRank = vi.fn(async () => ({ error: null }));

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
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onMoveToRank={onMoveToRank}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "طلّع المنتج للأعلى داخل نفس التصنيف" }));
    await vi.waitFor(() => expect(screen.getByText("خطأ تجريبي.")).toBeTruthy());

    // اسم المنتج والحقول الأخرى بلا أي تغيير فالواجهة.
    expect(screen.getByText("منتج اختبار")).toBeTruthy();
  });

  describe("خانة 'المرتبة' + زر 'نقل'", () => {
    test("قيمتها الابتدائية هي sort_order الحالي للمنتج", () => {
      renderRow();
      const rankInput = screen.getByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" }) as HTMLInputElement;
      expect(rankInput.value).toBe("3");
    });

    test("كتابة رقم صحيح والضغط على 'نقل' يستدعي onMoveToRank بالرقم المُدخَل فقط", async () => {
      const { onMoveToRank, onMoveUp, onMoveDown } = renderRow();

      const rankInput = screen.getByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" });
      fireEvent.change(rankInput, { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "نقل" }));

      await vi.waitFor(() => expect(onMoveToRank).toHaveBeenCalledTimes(1));
      expect(onMoveToRank).toHaveBeenCalledWith(2);
      expect(onMoveUp).not.toHaveBeenCalled();
      expect(onMoveDown).not.toHaveBeenCalled();
    });

    test("رقم غير صحيح (0، سالب، أو فارغ): رسالة خطأ محلية بلا أي استدعاء للخادم", async () => {
      const { onMoveToRank } = renderRow();

      const rankInput = screen.getByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" });
      fireEvent.change(rankInput, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: "نقل" }));

      await vi.waitFor(() =>
        expect(screen.getByText("أدخل رقم مرتبة صحيح (1 أو أكثر).")).toBeTruthy()
      );
      expect(onMoveToRank).not.toHaveBeenCalled();
    });

    test("نقل ناجح إلى مرتبة جديدة: القيمة المعروضة تُحدَّث تبعاً لـ sort_order الجديد فprop", () => {
      const onMoveUp = vi.fn(async () => ({ error: null }));
      const onMoveDown = vi.fn(async () => ({ error: null }));
      const onMoveToRank = vi.fn(async () => ({ error: null }));

      const { rerender } = render(
        <ProductQuickEditRow
          product={PRODUCT}
          action={vi.fn(async () => ({ error: null }))}
          images={[]}
          imageUrlByPath={{}}
          canUploadImages
          createUploadTargetAction={vi.fn()}
          commitPrimaryUploadAction={vi.fn()}
          commitAdditionalUploadAction={vi.fn()}
          imagesWithActions={[]}
          isFirstInCategory={false}
          isLastInCategory={false}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onMoveToRank={onMoveToRank}
        />
      );

      rerender(
        <ProductQuickEditRow
          product={{ ...PRODUCT, sort_order: 2 }}
          action={vi.fn(async () => ({ error: null }))}
          images={[]}
          imageUrlByPath={{}}
          canUploadImages
          createUploadTargetAction={vi.fn()}
          commitPrimaryUploadAction={vi.fn()}
          commitAdditionalUploadAction={vi.fn()}
          imagesWithActions={[]}
          isFirstInCategory={false}
          isLastInCategory={false}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onMoveToRank={onMoveToRank}
        />
      );

      const rankInput = screen.getByRole("spinbutton", { name: "مرتبة المنتج داخل تصنيفه" }) as HTMLInputElement;
      expect(rankInput.value).toBe("2");
    });
  });
});
