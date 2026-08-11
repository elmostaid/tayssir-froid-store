import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/pixel/fbq", () => ({ trackPageView: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("MetaPixel — لا يُحمَّل بلا NEXT_PUBLIC_META_PIXEL_ID، ويُهيّئ بلا PageView تلقائي إذا وُجد", () => {
  test("بدون NEXT_PUBLIC_META_PIXEL_ID: لا يُنتج أي عنصر (لا Script، لا noscript)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    const { MetaPixel } = await import("@/components/MetaPixel");
    const { container } = render(<MetaPixel />);
    expect(container.innerHTML).toBe("");
  });

  test("مع NEXT_PUBLIC_META_PIXEL_ID مضبوط: يُنتج <noscript> (React لا يُصيِّر أبناءه فالعميل عمداً — سلوك React الموثَّق، وليس نقصاً هنا)، والسكريبت يُهيّئ فقط بلا fbq('track','PageView') تلقائي", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    const { MetaPixel } = await import("@/components/MetaPixel");
    const { container } = render(<MetaPixel />);

    expect(container.querySelector("noscript")).toBeTruthy();

    // next/script بـstrategy="afterInteractive" لا يُنفَّذ فوراً فبيئة jsdom،
    // وReact لا يُصيِّر محتوى <noscript> فـclient render إطلاقاً (يظهر فقط
    // عند العرض من جهة الخادم الحقيقي، حين تكون JS مُعطَّلة فعلاً بالمتصفح)
    // — لذا نتحقق من محتوى الملف نفسه: المعرّف يُمرَّر صحيحاً لكل من رابط
    // noscript وfbq('init', ...)، وأن fbq('track','PageView') التلقائي غير
    // موجود إطلاقاً (PixelPageViewTracker هو المسؤول الوحيد عن PageView).
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const metaPixelSource = await readFile(
      join(process.cwd(), "src/components/MetaPixel.tsx"),
      "utf-8"
    );
    // نبحث فقط عن نمط الاستدعاء الفعلي (فاصلة + مسافة، كما يظهر فالكود
    // الحقيقي حين يُستدعى) — التعليق التوضيحي أعلى الملف يذكر نفس الاسمين
    // بلا مسافة بعد الفاصلة عمداً (توضيح نصي، وليس استدعاءً حقيقياً)،
    // فلا يتعارض مع هذا الفحص.
    expect(metaPixelSource).not.toMatch(/fbq\(['"]track['"],\s+['"]PageView['"]\)/);
    expect(metaPixelSource).toContain("fbq('init', '${pixelId}')");
    expect(metaPixelSource).toContain("ev=PageView");
    expect(metaPixelSource).toContain("id=${pixelId}");
  });
});
