import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ProductImagesPanel } from "@/components/admin/ProductImagesPanel";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState } from "@/app/admin/(protected)/products/imageActions";

afterEach(() => {
  cleanup();
});

// jsdom لا يوفّر URL.createObjectURL/revokeObjectURL فعلياً — نُحاكيهما هنا
// فقط لأن المكوّن يستعملهما للمعاينة المحلية؛ لا علاقة لهما بمنطق الاختبار.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock-preview-url");
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

const PRIMARY: AdminProductImage = {
  id: 1,
  product_id: 10,
  storage_path: "product-images/10/primary.webp",
  alt_text_ar: "الصورة الرئيسية لمنتج اختبار",
  sort_order: 1,
  is_primary: true,
};

const SECONDARY: AdminProductImage = {
  id: 2,
  product_id: 10,
  storage_path: "product-images/10/secondary.webp",
  alt_text_ar: "صورة إضافية لمنتج اختبار",
  sort_order: 2,
  is_primary: false,
};

function renderPanel(images: AdminProductImage[], canUploadImages = true) {
  // التوقيع الكامل (ImageActionState, FormData) مطلوب هنا فقط ليلتقط vi.fn
  // نوع args الصحيح لاحقاً فـmock.calls (وليس لأن الاختبار يقرأ المعاملين).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const replacePrimaryAction = vi.fn(async (_prevState: ImageActionState, _formData: FormData) => ({
    error: null,
    success: true,
  }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addImageAction = vi.fn(async (_prevState: ImageActionState, _formData: FormData) => ({
    error: null,
    success: true,
  }));
  const setPrimaryAction = vi.fn(async () => ({ error: null }));
  const deleteAction = vi.fn(async () => ({ error: null }));

  render(
    <ProductImagesPanel
      productNameAr="منتج اختبار"
      images={images}
      canUploadImages={canUploadImages}
      replacePrimaryAction={replacePrimaryAction}
      addImageAction={addImageAction}
      imagesWithActions={images
        .filter((img) => !img.is_primary)
        .map((image) => ({ image, setPrimaryAction, deleteAction }))}
    />
  );

  return { replacePrimaryAction, addImageAction, setPrimaryAction, deleteAction };
}

describe("ProductImagesPanel — كارت صور المنتج فـ/admin/products", () => {
  test("يعرض كل صور المنتج مع علامة 'الصورة الرئيسية' على الصورة الأولى فقط", () => {
    renderPanel([PRIMARY, SECONDARY]);
    expect(screen.getByText("الصورة الرئيسية")).toBeTruthy();
    expect(screen.getByAltText(PRIMARY.alt_text_ar!)).toBeTruthy();
    // الصورة الإضافية تظهر مرتين: فشبكة كل الصور، وفقائمة "الصور الإضافية"
    // (المصحوبة بأزرار "اجعلها رئيسية"/"حذف").
    expect(screen.getAllByAltText(SECONDARY.alt_text_ar!)).toHaveLength(2);
  });

  test("يعرض زر 'تغيير الصورة الرئيسية' و'إضافة صورة'، وinput حقيقي لكل واحد", () => {
    renderPanel([PRIMARY]);
    expect(screen.getByText("تغيير الصورة الرئيسية")).toBeTruthy();
    expect(screen.getByText("إضافة صورة")).toBeTruthy();

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBe(2);
    fileInputs.forEach((input) => {
      expect(input.getAttribute("accept")).toBe("image/*");
    });
  });

  test("لا يظهر زر 'حفظ' لتغيير الصورة الرئيسية قبل اختيار ملف", () => {
    renderPanel([PRIMARY]);
    expect(screen.queryByRole("button", { name: "حفظ" })).toBeNull();
  });

  test("بعد اختيار ملف لتغيير الصورة الرئيسية، يظهر زر 'حفظ' ومعاينة", () => {
    renderPanel([PRIMARY]);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const replaceInput = fileInputs[0] as HTMLInputElement;

    const file = new File(["x"], "new.png", { type: "image/png" });
    fireEvent.change(replaceInput, { target: { files: [file] } });

    expect(screen.getByRole("button", { name: "حفظ" })).toBeTruthy();
    expect(screen.getByAltText("معاينة الصورة الجديدة")).toBeTruthy();
  });

  test("عند الضغط على 'حفظ' بعد اختيار ملف، يُستدعى الإجراء بـFile حقيقي داخل FormData وليس بـpreview URL فقط", async () => {
    const { replacePrimaryAction } = renderPanel([PRIMARY]);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const replaceInput = fileInputs[0] as HTMLInputElement;

    const file = new File(["x"], "new.png", { type: "image/png" });
    fireEvent.change(replaceInput, { target: { files: [file] } });

    const saveButton = screen.getByRole("button", { name: "حفظ" });
    fireEvent.click(saveButton);

    await vi.waitFor(() => expect(replacePrimaryAction).toHaveBeenCalledTimes(1));
    const [, formData] = replacePrimaryAction.mock.calls[0];
    const sentFile = formData.get("file");
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe("new.png");
  });

  test("لكل صورة إضافية: زر 'اجعلها رئيسية' وزر 'حذف'، ولا يظهران على الصورة الرئيسية", () => {
    renderPanel([PRIMARY, SECONDARY]);
    expect(screen.getAllByRole("button", { name: "اجعلها رئيسية" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "حذف" })).toHaveLength(1);
  });

  test("اختيار ملف لإضافة صورة يستدعي الإجراء فوراً بدون خطوة حفظ منفصلة", async () => {
    const { addImageAction } = renderPanel([PRIMARY]);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const addInput = fileInputs[1] as HTMLInputElement;

    const file = new File(["x"], "extra.png", { type: "image/png" });
    fireEvent.change(addInput, { target: { files: [file] } });

    await vi.waitFor(() => expect(addImageAction).toHaveBeenCalledTimes(1));
    const [, formData] = addImageAction.mock.calls[0];
    expect((formData.get("file") as File).name).toBe("extra.png");
  });

  test("canUploadImages=false: تعطيل حقول اختيار الملف وعرض رسالة واضحة بدل السماح برفع سيفشل", () => {
    renderPanel([PRIMARY], false);
    expect(
      screen.getByText(/رفع الصور غير مُفعَّل حالياً على هذه البيئة/)
    ).toBeTruthy();

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBe(2);
    fileInputs.forEach((input) => {
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });
});
