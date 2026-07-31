import { describe, expect, test } from "vitest";

// اختبار ارتداد حرج: في Next.js App Router، اختيار admin/(protected)/layout.tsx
// عرض <SupabaseNotConfigured/> بدل {children} لا يمنع Next.js من تنفيذ صفحة
// الابن نفسها وجلب بياناتها (اكتُشف هذا فعلياً أثناء أخذ لقطات شاشة الهاتف:
// طلب curl مجهول لـ/admin/products/1 كان يُرجع purchase_price كاملاً ضمن
// حمولة RSC في HTML الخام، رغم عرض واجهة "غير مُهيَّأة" بصرياً). الإصلاح:
// كل صفحة إدارية تتحقق بنفسها من getAdminUser() قبل أي استعلام. هذا
// الاختبار يتأكد أن التحقق ما زال أول سطر منفَّذ في كل صفحة (يرمي
// NEXT_REDIRECT نحو /admin/login قبل أي وصول لقاعدة البيانات).

async function expectsRedirectToLogin(fn: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  const digest = String((caught as { digest?: string } | undefined)?.digest ?? "");
  expect(digest).toContain("NEXT_REDIRECT");
  expect(digest).toContain("/admin/login");
}

describe("صفحات لوحة الإدارة — الحماية داخل كل صفحة (وليس الـlayout فقط)", () => {
  test("لوحة التحكم الرئيسية ترفض الزائر قبل أي عرض", async () => {
    const { default: AdminDashboardPage } = await import("@/app/admin/(protected)/page");
    await expectsRedirectToLogin(() => AdminDashboardPage());
  });

  test("قائمة المنتجات ترفض الزائر قبل جلب المنتجات (وثمن الشراء)", async () => {
    const { default: AdminProductsPage } = await import(
      "@/app/admin/(protected)/products/page"
    );
    await expectsRedirectToLogin(() => AdminProductsPage());
  });

  test("منتج جديد ترفض الزائر قبل جلب التصنيفات", async () => {
    const { default: NewProductPage } = await import(
      "@/app/admin/(protected)/products/new/page"
    );
    await expectsRedirectToLogin(() => NewProductPage());
  });

  test("تعديل منتج ترفض الزائر قبل جلب المنتج (وثمن الشراء)", async () => {
    const { default: EditProductPage } = await import(
      "@/app/admin/(protected)/products/[id]/page"
    );
    await expectsRedirectToLogin(() => EditProductPage({ params: Promise.resolve({ id: "1" }) }));
  });

  test("قائمة التصنيفات ترفض الزائر قبل جلب التصنيفات", async () => {
    const { default: AdminCategoriesPage } = await import(
      "@/app/admin/(protected)/categories/page"
    );
    await expectsRedirectToLogin(() => AdminCategoriesPage());
  });

  test("تصنيف جديد ترفض الزائر قبل جلب التصنيفات", async () => {
    const { default: NewCategoryPage } = await import(
      "@/app/admin/(protected)/categories/new/page"
    );
    await expectsRedirectToLogin(() => NewCategoryPage());
  });

  test("تعديل تصنيف ترفض الزائر قبل جلب التصنيف", async () => {
    const { default: EditCategoryPage } = await import(
      "@/app/admin/(protected)/categories/[id]/page"
    );
    await expectsRedirectToLogin(() =>
      EditCategoryPage({ params: Promise.resolve({ id: "1" }) })
    );
  });
});
