import { describe, expect, test, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * الجلب المسبق التلقائي لـnext/link كان ~95% من استدعاءات Vercel، وأوقف الموقع
 * في 13/11/2026 (راجع src/components/Link.tsx). هذان الاختباران يحرسان الإصلاح.
 */

const received: Array<Record<string, unknown>> = [];
vi.mock("next/link", () => ({
  default: (props: Record<string, unknown>) => {
    received.push(props);
    return null;
  },
}));

describe("Link", () => {
  test("بلا جلب مسبق افتراضياً، ويُبقي الصريح إن طُلب", async () => {
    const { default: Link } = await import("@/components/Link");
    received.length = 0;

    // استدعاء مباشر للمكوّن (دالة): يكفي لرؤية ما يُمرَّر إلى next/link.
    const plain = Link({ href: "/product/x", children: "x" });
    const explicit = Link({ href: "/cart", prefetch: true, children: "c" });
    const [first, second] = [plain, explicit].map((el) => (el as { props: Record<string, unknown> }).props);

    expect(first.prefetch).toBe(false);
    expect(first.href).toBe("/product/x");
    expect(second.prefetch).toBe(true);
  });

  test("لا ملف في src يستورد next/link مباشرةً غير الغلاف", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "__tests__") walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || path.endsWith(join("components", "Link.tsx"))) continue;
        if (/from\s+["']next\/link["']/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
