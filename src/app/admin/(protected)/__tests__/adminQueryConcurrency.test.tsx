import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ADMIN_MAX_CONCURRENT_QUERIES } from "@/lib/admin/sectionData";

/**
 * قياس — لا وصف — لسقف التزامن في صفحات الإدارة الثقيلة.
 *
 * سبب عطل 2026-09-21 أن الصفحة الواحدة كانت تطلب من مجمّع اتصالات سعته
 * خمسة أكثر مما فيه (analytics ثمانية + استعلام الـlayout)، فينتظر الفائض
 * في طابور postgres.js وكل محاولة اتصال جديدة قد تكلّف خمس ثوانٍ كاملة.
 * لذلك لا يكفي أن نختبر `inBatches` وحدها: ما يهمّ هو ألّا تتجاوز **الصفحة
 * كاملةً** الحدّ، مهما أُضيف إليها لاحقاً من استعلامات.
 *
 * الطريقة: كل دالّة تُعيد Promise في وحدات الاستعلامات تُلفّ بعدّاد يزيد
 * عند إنشاء الوعد وينقص عند استقراره، ونحتفظ بأعلى قيمة بلغها. الاستعلامات
 * الحقيقية تعمل كما هي على قاعدة الاختبار، فالقياس على المسار الفعلي.
 *
 * هذا القياس يخصّ الصفحة وحدها. يُضاف إليه في الإنتاج استعلام واحد من
 * الـlayout (شارة الطلبات الجديدة داخل <Suspense>) واستعلام دور المدير
 * (getAdminUser، مُغلَّف بـcache فمرّة واحدة لكل طلب ويسبق الدفعات).
 */

const meter = vi.hoisted(() => {
  const state = { running: 0, peak: 0 };
  const wrapModule = <T extends Record<string, unknown>>(actual: T): T => {
    const out: Record<string, unknown> = { ...actual };
    for (const [key, value] of Object.entries(actual)) {
      if (typeof value !== "function") continue;
      const fn = value as (...args: unknown[]) => unknown;
      out[key] = (...args: unknown[]) => {
        const result = fn(...args);
        if (!result || typeof (result as Promise<unknown>).then !== "function") return result;
        state.running += 1;
        state.peak = Math.max(state.peak, state.running);
        return (result as Promise<unknown>).finally(() => {
          state.running -= 1;
        });
      };
    }
    return out as T;
  };
  return { state, wrapModule };
});

vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: async () => ({ id: "test-admin", email: "admin@test", role: "admin" as const }),
  isOwnerAdmin: () => true,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${url}` });
  },
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/admin",
}));

vi.mock("@/lib/queries/adminReports", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/adminExpenses", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/adminOrders", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/adminAnalytics", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/adminProducts", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/adminDashboardSummary", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/settings", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

vi.mock("@/lib/queries/whatsappLeads", async (importOriginal) =>
  meter.wrapModule(await importOriginal<Record<string, unknown>>())
);

beforeEach(() => {
  meter.state.running = 0;
  meter.state.peak = 0;
});

async function peakFor(render: () => Promise<unknown>): Promise<number> {
  await render();
  return meter.state.peak;
}

describe("سقف الاستعلامات المتوازية في كل صفحة إدارة ثقيلة", () => {
  test("/admin/reports?range=30d", async () => {
    const { default: Page } = await import("@/app/admin/(protected)/reports/page");
    const peak = await peakFor(async () =>
      renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range: "30d" }) }))
    );
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(ADMIN_MAX_CONCURRENT_QUERIES);
  });

  test("/admin/analytics?range=30d", async () => {
    const { default: Page } = await import("@/app/admin/(protected)/analytics/page");
    const peak = await peakFor(async () =>
      renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range: "30d" }) }))
    );
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(ADMIN_MAX_CONCURRENT_QUERIES);
  });

  test("لوحة التحكم (/admin)", async () => {
    const { default: Page } = await import("@/app/admin/(protected)/page");
    const peak = await peakFor(async () => renderToStaticMarkup(await Page()));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(ADMIN_MAX_CONCURRENT_QUERIES);
  });

  test("/admin/orders", async () => {
    const { default: Page } = await import("@/app/admin/(protected)/orders/page");
    const peak = await peakFor(async () =>
      renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    );
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(ADMIN_MAX_CONCURRENT_QUERIES);
  });
});
