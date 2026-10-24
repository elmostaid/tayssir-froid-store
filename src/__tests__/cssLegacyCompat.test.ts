import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

// تحقّق هيكلي (وليس سلوكياً بمحرك متصفح مزوَّر) — يُشغِّل خط PostCSS/
// Tailwind الحقيقي المُستعمَل فعلياً فالبناء (نفس postcss.config.mjs) على
// globals.css الحقيقي، ويتأكد أن المخرَج لا يحتوي إطلاقاً على توجيهات/دوال
// CSS حصرية بـTailwind v4 (@layer المُولَّد تلقائياً، @property، color-mix()،
// oklch()/oklab()، @theme). هذا إثبات قاطع من مصدره: Tailwind v3.4 لا يملك
// أصلاً القدرة على توليد هذه الصياغات (غير موجودة فشيفرته إطلاقاً) — بعكس
// اختبار متصفح بـUser-Agent مزوَّر، الذي يبقى محركاً حديثاً بهوية قديمة فقط.
const GLOBALS_CSS_PATH = path.join(process.cwd(), "src/app/globals.css");
const TAILWIND_CONFIG_PATH = path.join(process.cwd(), "tailwind.config.ts");

const V4_ONLY_TOKENS = ["@layer", "@property", "color-mix(", "oklch(", "oklab(", "@theme"];

async function compileGlobalsCss(): Promise<string> {
  const source = readFileSync(GLOBALS_CSS_PATH, "utf-8");
  const result = await postcss([
    tailwindcss({ config: TAILWIND_CONFIG_PATH } as never),
    autoprefixer,
  ]).process(source, { from: GLOBALS_CSS_PATH });
  return result.css;
}

describe("توافق CSS الناتج مع المتصفحات الأقدم (Tailwind v3.4)", () => {
  test("المخرَج الفعلي لا يحتوي على أي صياغة حصرية بـTailwind v4", async () => {
    const css = await compileGlobalsCss();
    expect(css.length).toBeGreaterThan(0);
    for (const token of V4_ONLY_TOKENS) {
      expect(css).not.toContain(token);
    }
  }, 30000);

  test("autoprefixer يُنتج فعلياً بادئات -webkit-/-moz- (يقرأ .browserslistrc الفعلي)", async () => {
    const css = await compileGlobalsCss();
    expect(css).toMatch(/-webkit-/);
  }, 30000);

  test("globals.css يستعمل توجيهات @tailwind الكلاسيكية، وليس @import v4 أو @theme", () => {
    const source = readFileSync(GLOBALS_CSS_PATH, "utf-8");
    expect(source).toContain("@tailwind base");
    expect(source).toContain("@tailwind components");
    expect(source).toContain("@tailwind utilities");
    expect(source).not.toContain('@import "tailwindcss"');
    expect(source).not.toContain("@theme");
  });
});
