import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * ما تتحقّق منه هذه الاختبارات هو الشرط الذي طُلب حرفياً بعد عطل
 * 2026-09-21: **فشل استعلام لا يُسقط صفحة الإدارة، ولا يتحوّل إلى رقم.**
 *
 * لذلك لا يكفي أن تُصيَّر الصفحة. كل اختبار هنا يؤكّد ثلاثة أشياء معاً:
 *   1. الصفحة صُيِّرت (لم تُرمَ).
 *   2. القسم المتأثر يعلن تعذُّره صراحةً.
 *   3. لا يظهر مكان الرقم المفقود عنوانُه ولا صفرٌ يُقرأ كأنه حقيقة.
 *
 * الصفحات تُستدعى كدوالّ مباشرةً — نفس أسلوب pageGuards.test.ts — ثم
 * تُصيَّر الشجرة العائدة، فكل مكوّناتها الداخلية متزامنة.
 */

vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: async () => ({ id: "test-admin", email: "admin@test", role: "admin" as const }),
  isOwnerAdmin: () => true,
}));

// RetryButton مكوّن عميل يستعمل useRouter؛ خارج Next.js لا يوجد موجِّه.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/admin",
}));

vi.mock("@/lib/queries/adminReports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/adminReports")>();
  return {
    ...actual,
    getSalesBySource: vi.fn(actual.getSalesBySource),
    getProfitSummary: vi.fn(actual.getProfitSummary),
    getBestSellingProducts: vi.fn(actual.getBestSellingProducts),
    getDeliveredOrdersProfitBreakdown: vi.fn(actual.getDeliveredOrdersProfitBreakdown),
  };
});

vi.mock("@/lib/queries/adminExpenses", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/adminExpenses")>();
  return { ...actual, getExpensesTotal: vi.fn(actual.getExpensesTotal) };
});

vi.mock("@/lib/queries/adminOrders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/adminOrders")>();
  return {
    ...actual,
    getDashboardOrderStats: vi.fn(actual.getDashboardOrderStats),
    listAdminOrders: vi.fn(actual.listAdminOrders),
  };
});

vi.mock("@/lib/queries/adminAnalytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/adminAnalytics")>();
  return {
    ...actual,
    getAnalyticsTotals: vi.fn(actual.getAnalyticsTotals),
    getAnalyticsSources: vi.fn(actual.getAnalyticsSources),
  };
});

const UNAVAILABLE = "تعذّر تحميل هذه البيانات";
const DB_DOWN = () => new Error("CONNECT_TIMEOUT: تعذّر الوصول إلى مجمّع الاتصالات");

/** يُخفي ضجيج console.error الذي تطبعه loadSection عمداً عند كل تعذُّر. */
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function renderReports(range = "30d") {
  const { default: Page } = await import("@/app/admin/(protected)/reports/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range }) }));
}

async function renderAnalytics(range = "30d") {
  const { default: Page } = await import("@/app/admin/(protected)/analytics/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range }) }));
}

async function renderDashboard() {
  const { default: Page } = await import("@/app/admin/(protected)/page");
  return renderToStaticMarkup(await Page());
}

async function renderOrders() {
  const { default: Page } = await import("@/app/admin/(protected)/orders/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

describe("/admin/reports?range=30d", () => {
  test("كل الاستعلامات سليمة: لا يظهر أي إعلان تعذُّر", async () => {
    const html = await renderReports();
    expect(html).not.toContain(UNAVAILABLE);
    expect(html).toContain("التقارير والأرباح");
  });

  test("تعذُّر التفصيل حسب المصدر: الصفحة تبقى، والقسم يعلن تعذّره بلا أرقام", async () => {
    const { getSalesBySource } = await import("@/lib/queries/adminReports");
    vi.mocked(getSalesBySource).mockRejectedValueOnce(DB_DOWN());

    const html = await renderReports();

    expect(html).toContain(UNAVAILABLE);
    // لا سطر «الربح الخام» ولا جدول المصادر — لا بصفر ولا بغيره.
    expect(html).not.toContain("الربح الخام من البضاعة");
    expect(html).not.toContain("صافي الربح الحقيقي");
    // وبقية الصفحة كما هي.
    expect(html).toContain("مبيعات اليوم (المنتجات)");
    expect(html).toContain("إعادة المحاولة");
  });

  test("تعذُّر المصاريف وحدها: مبيعات المصادر تبقى معروضة، وحساب الربح وحده يسقط", async () => {
    const { getExpensesTotal } = await import("@/lib/queries/adminExpenses");
    vi.mocked(getExpensesTotal).mockRejectedValueOnce(DB_DOWN());

    const html = await renderReports();

    expect(html).toContain(UNAVAILABLE);
    // ما وصل يُعرض: بطاقات المبيعات حسب المصدر مبنيّة على bySource وحده.
    expect(html).toContain("مبيعات الموقع (المنتجات)");
    // وما لم يصل لا يُحتسَب صفراً كما كان يفعل الكود السابق: لا بطاقة
    // «مصاريف التشغيل» (اسمها وحده داخل عنصره) ولا سطر صافي الربح.
    expect(html).not.toContain(">مصاريف التشغيل<");
    expect(html).not.toContain("صافي الربح الحقيقي");
  });

  test("تعذُّر ملخّص الأرباح: قسمه وحده يسقط", async () => {
    const { getProfitSummary } = await import("@/lib/queries/adminReports");
    vi.mocked(getProfitSummary).mockRejectedValueOnce(DB_DOWN());

    const html = await renderReports();

    expect(html).toContain(UNAVAILABLE);
    expect(html).toContain("مبيعات اليوم (المنتجات)");
  });
});

describe("/admin/analytics?range=30d", () => {
  test("كل الاستعلامات سليمة: لا يظهر أي إعلان تعذُّر", async () => {
    const html = await renderAnalytics();
    expect(html).not.toContain(UNAVAILABLE);
    expect(html).toContain("تحليلات الزوّار");
  });

  test("تعذُّر أرقام القياس لا يُقرأ «لا توجد بيانات في هذه الفترة»", async () => {
    const { getAnalyticsTotals } = await import("@/lib/queries/adminAnalytics");
    vi.mocked(getAnalyticsTotals).mockRejectedValueOnce(DB_DOWN());

    const html = await renderAnalytics();

    expect(html).toContain(UNAVAILABLE);
    // الادّعاء بأن الفترة فارغة يحتاج رقمين وصَلا فعلاً.
    expect(html).not.toContain("لا توجد بيانات في هذه الفترة");
    expect(html).toContain("تحليلات الزوّار");
  });

  test("تعذُّر المصادر: بقية الأقسام تبقى", async () => {
    const { getAnalyticsSources, getAnalyticsTotals } = await import(
      "@/lib/queries/adminAnalytics"
    );
    // قاعدة الاختبار فارغة، فالصفحة تعرض «لا توجد بيانات» وتتوقّف. نمنحها
    // زوّاراً حقيقيين حتى يُصيَّر جسم الصفحة وتظهر أقسامه.
    vi.mocked(getAnalyticsTotals).mockResolvedValueOnce({
      sessions: 12,
      landingPageViews: 9,
      productViewSessions: 5,
      productViewEvents: 7,
      addToCartSessions: 3,
      addToCartEvents: 4,
      checkoutSessions: 2,
      checkoutEvents: 2,
      purchaseSessions: 0,
      purchaseEvents: 0,
      trackedRevenueMad: 0,
    });
    vi.mocked(getAnalyticsSources).mockRejectedValueOnce(DB_DOWN());

    const html = await renderAnalytics();

    expect(html).toContain(UNAVAILABLE);
    expect(html).toContain("مصادر الزوّار");
    expect(html).not.toContain("لا توجد مصادر مُسجَّلة بعد.");
  });
});

describe("لوحة التحكم (/admin)", () => {
  test("كل الاستعلامات سليمة: لا يظهر أي إعلان تعذُّر", async () => {
    const html = await renderDashboard();
    expect(html).not.toContain(UNAVAILABLE);
    expect(html).toContain("لوحة التحكم");
  });

  test("تعذُّر إحصاءات الطلبات: لا تظهر بطاقات مبيعات ولا شارة طلبات جديدة", async () => {
    const { getDashboardOrderStats } = await import("@/lib/queries/adminOrders");
    vi.mocked(getDashboardOrderStats).mockRejectedValueOnce(DB_DOWN());

    const html = await renderDashboard();

    expect(html).toContain(UNAVAILABLE);
    expect(html).not.toContain("مبيعات 7 أيام (المنتجات)");
    // «اليوم في سطر» مصدره استعلام آخر، فيبقى.
    expect(html).toContain("اليوم في سطر");
  });
});

describe("/admin/orders", () => {
  test("كل الاستعلامات سليمة: لا يظهر أي إعلان تعذُّر", async () => {
    const html = await renderOrders();
    expect(html).not.toContain(UNAVAILABLE);
  });

  test("تعذُّر قائمة الطلبات لا يُعرض «0 طلب»", async () => {
    const { listAdminOrders } = await import("@/lib/queries/adminOrders");
    vi.mocked(listAdminOrders).mockRejectedValueOnce(DB_DOWN());

    const html = await renderOrders();

    expect(html).toContain(UNAVAILABLE);
    expect(html).not.toContain("0 طلب");
    expect(html).not.toContain("لا توجد طلبات مطابقة.");
    // الصفحة نفسها ما زالت خدّامة: الفلترة وزر الطلب اليدوي في مكانهما.
    expect(html).toContain("فلترة");
  });
});
