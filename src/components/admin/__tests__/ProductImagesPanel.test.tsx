import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { AdminProductImage } from "@/lib/queries/adminProducts";
import type { ImageActionState, UploadTargetState } from "@/app/admin/(protected)/products/imageActions";

const uploadToSignedUrlMock = vi.fn<
  (path: string, token: string, fileBody: File) => Promise<{ data: { path: string } | null; error: unknown }>
>(async () => ({ data: { path: "x" }, error: null }));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({ uploadToSignedUrl: uploadToSignedUrlMock }),
    },
  }),
}));

const { ProductImagesPanel } = await import("@/components/admin/ProductImagesPanel");

afterEach(() => {
  cleanup();
  uploadToSignedUrlMock.mockClear();
  uploadToSignedUrlMock.mockResolvedValue({ data: { path: "x" }, error: null });
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
  const createUploadTargetAction = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_contentType: string): Promise<UploadTargetState> => ({
      error: null,
      uploadUrl: "https://example.supabase.co/storage/v1/upload/sign/10/new.png",
      token: "fake-token",
      objectPath: "10/new.png",
    })
  );
  const commitUploadAction = vi.fn(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (_objectPath: string): Promise<ImageActionState> => ({ error: null, success: true })
  );
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
      createUploadTargetAction={createUploadTargetAction}
      commitUploadAction={commitUploadAction}
      addImageAction={addImageAction}
      imagesWithActions={images
        .filter((img) => !img.is_primary)
        .map((image) => ({ image, setPrimaryAction, deleteAction }))}
    />
  );

  return { createUploadTargetAction, commitUploadAction, addImageAction, setPrimaryAction, deleteAction };
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

  test("عند الضغط على 'حفظ': يُطلَب رابط رفع موقَّع، يُرفَع الملف مباشرة إلى Supabase (بدون Server Action)، ثم يُثبَّت التغيير — بنفس ترتيب الخطوات الثلاث", async () => {
    const { createUploadTargetAction, commitUploadAction } = renderPanel([PRIMARY]);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const replaceInput = fileInputs[0] as HTMLInputElement;

    const file = new File(["x".repeat(2_000_000)], "phone-photo.jpg", { type: "image/jpeg" });
    fireEvent.change(replaceInput, { target: { files: [file] } });

    const saveButton = screen.getByRole("button", { name: "حفظ" });
    fireEvent.click(saveButton);

    await vi.waitFor(() => expect(commitUploadAction).toHaveBeenCalledTimes(1));

    // 1) طلب رابط الرفع: نوع الملف فقط، لا الملف نفسه.
    expect(createUploadTargetAction).toHaveBeenCalledWith("image/jpeg");

    // 2) الرفع المباشر: الملف الحقيقي يذهب لـSupabase عبر uploadToSignedUrl،
    // وليس عبر أي Server Action.
    expect(uploadToSignedUrlMock).toHaveBeenCalledTimes(1);
    const [uploadedPath, uploadedToken, uploadedFile] = uploadToSignedUrlMock.mock.calls[0];
    expect(uploadedPath).toBe("10/new.png");
    expect(uploadedToken).toBe("fake-token");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe("phone-photo.jpg");
    expect((uploadedFile as File).size).toBeGreaterThan(1_000_000);

    // 3) التثبيت النهائي: objectPath فقط، لا الملف.
    expect(commitUploadAction).toHaveBeenCalledWith("10/new.png");
  });

  test("فشل الرفع المباشر إلى Supabase: يعرض رسالة خطأ ولا يُستدعى commitUploadAction إطلاقاً", async () => {
    uploadToSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: "network error" } as never });
    const { commitUploadAction } = renderPanel([PRIMARY]);
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const replaceInput = fileInputs[0] as HTMLInputElement;

    const file = new File(["x"], "new.png", { type: "image/png" });
    fireEvent.change(replaceInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await vi.waitFor(() => expect(screen.getByText(/تعذّر رفع الصورة/)).toBeTruthy());
    expect(commitUploadAction).not.toHaveBeenCalled();
  });

  test("فشل تحضير رابط الرفع (createUploadTargetAction): يعرض الخطأ ولا يحاول الرفع", async () => {
    const createUploadTargetAction = vi.fn(async (): Promise<UploadTargetState> => ({
      error: "رفع الصور غير مُفعَّل حالياً.",
    }));
    const commitUploadAction = vi.fn(async (): Promise<ImageActionState> => ({ error: null, success: true }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const addImageAction = vi.fn(async (_prevState: ImageActionState, _formData: FormData) => ({
      error: null,
      success: true,
    }));

    render(
      <ProductImagesPanel
        productNameAr="منتج اختبار"
        images={[PRIMARY]}
        canUploadImages
        createUploadTargetAction={createUploadTargetAction}
        commitUploadAction={commitUploadAction}
        addImageAction={addImageAction}
        imagesWithActions={[]}
      />
    );

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const file = new File(["x"], "new.png", { type: "image/png" });
    fireEvent.change(fileInputs[0], { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await vi.waitFor(() => expect(screen.getByText("رفع الصور غير مُفعَّل حالياً.")).toBeTruthy());
    expect(uploadToSignedUrlMock).not.toHaveBeenCalled();
    expect(commitUploadAction).not.toHaveBeenCalled();
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
