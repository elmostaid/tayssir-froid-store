import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HeaderWhatsAppButton } from "@/components/HeaderWhatsAppButton";

// المسار الحالي هو المتغيّر الوحيد الذي يهمّنا هنا، فنتحكّم فيه مباشرة.
const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const HREF = "https://api.whatsapp.com/send/?phone=212600000000&text=%D8%B3%D8%A4%D8%A7%D9%84";

beforeEach(() => {
  pathname.current = "/";
});

afterEach(() => {
  cleanup();
});

describe("HeaderWhatsAppButton", () => {
  test("يقول وظيفته صراحةً — استفسار، لا إتمام طلب", () => {
    render(<HeaderWhatsAppButton href={HREF} />);

    const link = screen.getByRole("link", { name: "واتساب للاستفسار" });
    expect(link.getAttribute("href")).toBe(HREF);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // نصّ الهاتف ونصّ الحاسوب كلاهما في الـDOM، يظهر أحدهما حسب العرض.
    expect(link.textContent).toContain("استفسار");
    expect(link.textContent).toContain("واتساب للاستفسار");
  });

  // العطل الذي يحرسه هذا الاختبار: الزبون داخل نموذج إتمام الطلب، على بعد
  // حقلين من طلبٍ حقيقي برقم وحجز مخزون، يرى زرّاً أخضر ثابتاً فوق الشاشة
  // فيظنّه زرّ الإنهاء — وهو يُخرجه إلى محادثة عامة بلا سلته ولا بياناته.
  // لا يكفي إخفاؤه بـCSS: ما لا يجب أن يُضغط لا يجب أن يوجد في الصفحة.
  test("يغيب تماماً من صفحة إتمام الطلب — ولا حتى في الـDOM", () => {
    pathname.current = "/checkout";
    const { container } = render(<HeaderWhatsAppButton href={HREF} />);

    expect(container.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("يبقى حاضراً في بقية صفحات المتجر، ومنها السلة", () => {
    for (const path of ["/", "/cart", "/product/door-lock", "/search"]) {
      pathname.current = path;
      const { container } = render(<HeaderWhatsAppButton href={HREF} />);
      expect(container.querySelector("a")).not.toBeNull();
      cleanup();
    }
  });
});
