import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChangeProductImageForm } from "@/components/admin/ChangeProductImageForm";

afterEach(() => {
  cleanup();
});

describe("ChangeProductImageForm — عناصر الواجهة الأساسية (كارت المنتج فـ/admin/products)", () => {
  test("يعرض زر واضح 'تغيير الصورة' وinput حقيقي من نوع file بـaccept=image/*", () => {
    const action = vi.fn(async () => ({ error: null, success: true }));
    render(
      <ChangeProductImageForm
        action={action}
        currentImagePath="product-images/TF-TEST-001/current.webp"
        currentImageAlt="منتج اختبار"
      />
    );

    const button = screen.getByRole("button", { name: "تغيير الصورة" });
    expect(button).toBeTruthy();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(fileInput?.getAttribute("accept")).toBe("image/*");
    expect(fileInput?.getAttribute("required")).not.toBeNull();
  });

  test("يعرض الصورة الرئيسية الحالية بحجم صغير (thumbnail) إن وُجدت", () => {
    const action = vi.fn(async () => ({ error: null, success: true }));
    render(
      <ChangeProductImageForm
        action={action}
        currentImagePath="product-images/TF-TEST-001/current.webp"
        currentImageAlt="منتج اختبار"
      />
    );
    const img = screen.getByAltText("منتج اختبار");
    expect(img).toBeTruthy();
  });

  test("لا يظهر زر 'حفظ الصورة' قبل اختيار أي ملف", () => {
    const action = vi.fn(async () => ({ error: null, success: true }));
    render(
      <ChangeProductImageForm action={action} currentImagePath={null} currentImageAlt="منتج بلا صورة" />
    );
    expect(screen.queryByRole("button", { name: "حفظ الصورة" })).toBeNull();
    expect(screen.getByText("بدون صورة")).toBeTruthy();
  });
});
