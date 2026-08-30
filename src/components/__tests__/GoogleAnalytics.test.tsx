import { describe, test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GA_MEASUREMENT_ID } from "@/lib/analytics/config";

const componentPath = join(process.cwd(), "src/components/GoogleAnalytics.tsx");
const rootLayoutPath = join(process.cwd(), "src/app/layout.tsx");

describe("GoogleAnalytics — وسم GA4 الأساسي فقط، مرة واحدة، بلا مساس بـMeta Pixel", () => {
  test("المعرّف هو معرّف القياس الحقيقي للموقع بصيغة GA4 صالحة", () => {
    expect(GA_MEASUREMENT_ID).toBe("G-SEJZVX93W4");
    expect(GA_MEASUREMENT_ID).toMatch(/^G-[A-Z0-9]+$/);
  });

  test("المكوّن يحمّل gtag.js من نطاق Google الرسمي ويُهيّئه بنفس المعرّف", async () => {
    const source = await readFile(componentPath, "utf-8");
    expect(source).toContain("https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}");
    expect(source).toContain("gtag('js', new Date());");
    expect(source).toContain("gtag('config', '${GA_MEASUREMENT_ID}');");
    // الاستراتيجية التي يوصي بها توثيق Next للتحليلات.
    expect(source).toContain('strategy="afterInteractive"');
  });

  test("وسم أساسي فقط: بلا أي حدث مخصّص وبلا متتبّع تنقّل يدوي (تفادي page_view مزدوج)", async () => {
    const source = await readFile(componentPath, "utf-8");
    // لا gtag('event', ...) إطلاقاً — أي حدث مخصّص خارج نطاق الوسم الأساسي.
    expect(source).not.toMatch(/gtag\(\s*['"]event['"]/);
    // لا متتبّع تنقّل: GA4 يتكفّل بتنقّلات App Router عبر القياس المحسَّن.
    expect(source).not.toContain("usePathname");
    expect(source).not.toContain("use client");
  });

  test("مركَّب مرة واحدة فقط في الجذر — لا ازدواج في التتبّع", async () => {
    const layout = await readFile(rootLayoutPath, "utf-8");
    expect(layout).toContain("<GoogleAnalytics />");
    expect(layout.match(/<GoogleAnalytics \/>/g)).toHaveLength(1);
  });

  test("Meta Pixel لا يزال مركَّباً كما كان، ومستقلاً عن GA (لا كائن عام مشترك)", async () => {
    const layout = await readFile(rootLayoutPath, "utf-8");
    expect(layout).toContain("<MetaPixel />");

    // نبحث عن استدعاء fbq حقيقي، لا عن مجرّد ذكر الاسم: تعليق المكوّن يشرح
    // عمداً استقلاله عن fbq بالاسم، وهذا توضيح نصي وليس تتبّعاً.
    const source = await readFile(componentPath, "utf-8");
    expect(source).not.toMatch(/fbq\s*\(/);
    expect(source).not.toContain("connect.facebook.net");
  });
});
