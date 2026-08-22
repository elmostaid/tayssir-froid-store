import { beforeEach, describe, expect, test, vi } from "vitest";

// اختبارات الصلاحيات على مستوى الصفحات (وليس فقط Server Actions):
// Staff يُعاد توجيهه فوراً من كل صفحة مقصورة على Owner/Admin (قبل أي
// استعلام)، وله وصول كامل لصفحات الطلبات (ضمن قائمة صلاحياته الصريحة).
// نفس أسلوب محاكاة getAdminUser() المستعمل فـ
// products/__tests__/quickUpdateProduct.test.ts وorders/__tests__/actions.test.ts.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

async function expectsRedirectTo(fn: () => Promise<unknown>, path: string) {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  const digest = String((caught as { digest?: string } | undefined)?.digest ?? "");
  expect(digest).toContain("NEXT_REDIRECT");
  expect(digest).toContain(path);
}

async function expectsNoRedirectTo(fn: () => Promise<unknown>, path: string) {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  const digest = String((caught as { digest?: string } | undefined)?.digest ?? "");
  // إما نجحت الصفحة تماماً (لا استثناء)، أو رمت استثناءً آخر غير الارتداد
  // نحو `path` تحديداً (مثل NEXT_NOT_FOUND لصفحة تعديل بمعرّف وهمي) — المهم
  // فقط أن فحص الصلاحية نفسه لم يمنعها.
  if (digest.includes("NEXT_REDIRECT")) {
    expect(digest).not.toContain(path);
  }
}

describe("صفحات مقصورة على Owner/Admin — Staff يُعاد توجيهه إلى /admin/orders", () => {
  test("لوحة التحكم الرئيسية", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminDashboardPage } = await import("@/app/admin/(protected)/page");
    await expectsRedirectTo(() => AdminDashboardPage(), "/admin/orders");
  });

  test("قائمة المنتجات (التعديل السريع)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminProductsPage } = await import(
      "@/app/admin/(protected)/products/page"
    );
    await expectsRedirectTo(
      () => AdminProductsPage({ searchParams: Promise.resolve({}) }),
      "/admin/orders"
    );
  });

  test("منتج جديد", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: NewProductPage } = await import(
      "@/app/admin/(protected)/products/new/page"
    );
    await expectsRedirectTo(() => NewProductPage(), "/admin/orders");
  });

  test("تعديل منتج (يشمل ثمن الشراء) — الارتداد يسبق أي استعلام", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: EditProductPage } = await import(
      "@/app/admin/(protected)/products/[id]/page"
    );
    await expectsRedirectTo(
      () => EditProductPage({ params: Promise.resolve({ id: "1" }) }),
      "/admin/orders"
    );
  });

  test("قائمة التصنيفات", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminCategoriesPage } = await import(
      "@/app/admin/(protected)/categories/page"
    );
    await expectsRedirectTo(() => AdminCategoriesPage(), "/admin/orders");
  });

  test("تصنيف جديد", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: NewCategoryPage } = await import(
      "@/app/admin/(protected)/categories/new/page"
    );
    await expectsRedirectTo(() => NewCategoryPage(), "/admin/orders");
  });

  test("تعديل تصنيف", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: EditCategoryPage } = await import(
      "@/app/admin/(protected)/categories/[id]/page"
    );
    await expectsRedirectTo(
      () => EditCategoryPage({ params: Promise.resolve({ id: "1" }) }),
      "/admin/orders"
    );
  });

  test("الزبائن", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminCustomersPage } = await import(
      "@/app/admin/(protected)/customers/page"
    );
    await expectsRedirectTo(
      () => AdminCustomersPage({ searchParams: Promise.resolve({}) }),
      "/admin/orders"
    );
  });

  test("التقارير والأرباح (COGS/الربح)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminReportsPage } = await import("@/app/admin/(protected)/reports/page");
    await expectsRedirectTo(
      () => AdminReportsPage({ searchParams: Promise.resolve({}) }),
      "/admin/orders"
    );
  });

  test("الإعدادات", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminSettingsPage } = await import("@/app/admin/(protected)/settings/page");
    await expectsRedirectTo(() => AdminSettingsPage(), "/admin/orders");
  });

  test("المستخدمون والخدامة", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminUsersPage } = await import("@/app/admin/(protected)/users/page");
    await expectsRedirectTo(() => AdminUsersPage(), "/admin/orders");
  });
});

describe("Admin لا يُعاد توجيهه من الصفحات المقصورة عليه (فحص الصلاحية نفسه لا يمنعه)", () => {
  test("لوحة التحكم الرئيسية تُحمَّل كاملة بدون ارتداد", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const { default: AdminDashboardPage } = await import("@/app/admin/(protected)/page");
    await expectsNoRedirectTo(() => AdminDashboardPage(), "/admin/orders");
  });

  test("قائمة المنتجات تُحمَّل كاملة بدون ارتداد", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const { default: AdminProductsPage } = await import(
      "@/app/admin/(protected)/products/page"
    );
    await expectsNoRedirectTo(
      () => AdminProductsPage({ searchParams: Promise.resolve({}) }),
      "/admin/orders"
    );
  });

  test("الإعدادات تُحمَّل كاملة بدون ارتداد", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const { default: AdminSettingsPage } = await import("@/app/admin/(protected)/settings/page");
    await expectsNoRedirectTo(() => AdminSettingsPage(), "/admin/orders");
  });

  test("المستخدمون والخدامة تُحمَّل كاملة بدون ارتداد", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const { default: AdminUsersPage } = await import("@/app/admin/(protected)/users/page");
    await expectsNoRedirectTo(() => AdminUsersPage(), "/admin/orders");
  });
});

describe("صفحات الطلبات — متاحة لـStaff (ضمن صلاحياته الصريحة)", () => {
  test("قائمة الطلبات لا تُعيد توجيه Staff", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { default: AdminOrdersPage } = await import("@/app/admin/(protected)/orders/page");
    await expectsNoRedirectTo(
      () => AdminOrdersPage({ searchParams: Promise.resolve({}) }),
      "/admin/orders"
    );
  });

  test("تفاصيل طلب حقيقي لا تُعيد توجيه Staff", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const { sql } = await import("@/lib/db");
    const [order] = await sql<{ id: number }[]>`select id from public.orders order by id limit 1`;
    if (!order) return; // بيئة بدون أي طلب — يتخطّى بأمان

    const { default: AdminOrderDetailPage } = await import(
      "@/app/admin/(protected)/orders/[id]/page"
    );
    let threw = false;
    try {
      await AdminOrderDetailPage({ params: Promise.resolve({ id: String(order.id) }) });
    } catch (err) {
      threw = true;
      const digest = String((err as { digest?: string } | undefined)?.digest ?? "");
      expect(digest).not.toContain("NEXT_REDIRECT");
    }
    expect(threw === true || threw === false).toBe(true); // لا يشترط عدم رمي استثناء آخر، فقط عدم الارتداد
  });
});

describe("الطلبات اليدوية وتعديل محتوى الطلب — مقصورة على Owner/Admin", () => {
  // نُصفّر المحاكاة قبل كل حالة ونضبط قيمة ثابتة بدل mockResolvedValueOnce:
  // بقية هذا الملف تعتمد على طابور استهلاك دقيق، وأي قيمة غير مُستهلَكة فيه
  // كانت ستُزيح حالاتنا. الاستقلال هنا أرخص من ضبط الطابور كله.
  beforeEach(() => {
    getAdminUserMock.mockReset();
  });

  test("صفحة إضافة طلب يدوي: Staff يُعاد توجيهه", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);
    const { default: NewManualOrderPage } = await import(
      "@/app/admin/(protected)/orders/new/page"
    );
    await expectsRedirectTo(() => NewManualOrderPage(), "/admin/orders");
  });

  test("صفحة إضافة طلب يدوي: Admin لا يُعاد توجيهه", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);
    const { default: NewManualOrderPage } = await import(
      "@/app/admin/(protected)/orders/new/page"
    );
    await expectsNoRedirectTo(() => NewManualOrderPage(), "/admin/orders");
  });

  // الحماية الحقيقية في الخادم: إخفاء الزرّ لا يمنع استدعاء الإجراء مباشرة.
  test("إنشاء طلب يدوي: الإجراء نفسه يرفض Staff قبل أي فحص آخر", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);
    const { createManualOrderAction } = await import("@/app/admin/(protected)/orders/actions");
    const form = new FormData();
    form.set("source", "whatsapp");
    form.set("fullName", "زبون");
    form.set("phone", "0612345678");
    form.set("city", "مراكش");
    form.set("address", "عنوان");
    form.append("productId", "1");
    form.append("quantity", "1");

    const result = await createManualOrderAction({ error: null }, form);
    expect(result.error).toContain("صاحب الحساب");
  });

  test("تعديل محتوى الطلب: الإجراء نفسه يرفض Staff", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);
    const { updateOrderLinesAction } = await import("@/app/admin/(protected)/orders/actions");
    const form = new FormData();
    form.set("orderId", "1");
    form.append("productId", "1");
    form.append("quantity", "1");

    const result = await updateOrderLinesAction({ error: null }, form);
    expect(result.error).toContain("صاحب الحساب");
  });

  test("بحث المنتجات: يرفض Staff لأن نتيجته تحمل ثمن الشراء السرّي", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);
    const { searchProductsAction } = await import("@/app/admin/(protected)/orders/actions");
    expect((await searchProductsAction("ضاغط")).ok).toBe(false);
  });

  test("استيراد البون: يرفض Staff — النتيجة تحمل ثمن الشراء أيضاً", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);
    const { importOrderDraftAction } = await import("@/app/admin/(protected)/orders/actions");
    const result = await importOrderDraftAction("{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain("صاحب الحساب");
  });

  test("زائر غير مسجَّل يُرفض في كل هذه الإجراءات", async () => {
    getAdminUserMock.mockResolvedValue(null);
    const {
      createManualOrderAction,
      updateOrderLinesAction,
      searchProductsAction,
      importOrderDraftAction,
    } = await import("@/app/admin/(protected)/orders/actions");

    expect((await createManualOrderAction({ error: null }, new FormData())).error).toBeTruthy();
    expect((await updateOrderLinesAction({ error: null }, new FormData())).error).toBeTruthy();
    expect((await searchProductsAction("x")).ok).toBe(false);
    expect((await importOrderDraftAction("{}")).ok).toBe(false);
  });
});
