import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminError from "@/app/admin/error";

/**
 * ما يُثبته هذا الملف وما لا يُثبته — بصراحة:
 *
 * ✅ يُثبت أن مكوّن `error.tsx` يعرض رسالة مفهومة، ويُظهر `digest` حين
 *    يصل، وأن زر «إعادة المحاولة» يستدعي `unstable_retry()` فعلاً.
 * ✅ ويُثبت، عبر `ErrorBoundary` حقيقي من React، أن خطأ **تصيير** داخل
 *    مكوّن ابن يُلتقَط ويُستبدَل بهذه الواجهة بدل أن يُسقط الشجرة كلها.
 *
 * ❌ ولا يُثبت — ولا يمكن لاختبار وحدة أن يُثبت — أن الحاجز يتعامل مع
 *    انتهاء مهلة دالّة Vercel (الدالّة تُقتَل قبل إرسال أي استجابة، فلا
 *    شجرة React هناك أصلاً) ولا مع أخطاء الاتصال التي تلتقطها
 *    `loadSection` قبل أن تُرمى. تركيب `error.tsx` الفعلي في مسار
 *    `/admin` شأن موجِّه Next.js، ويُتحقَّق منه في المعاينة لا هنا.
 */

afterEach(cleanup);

function Boom(): never {
  throw new Error("انهيار تصيير مُفتعَل");
}

/** حاجز خطأ بسيط يُحاكي ما يفعله Next.js حول `error.tsx`. */
import { Component, type ReactNode } from "react";

class TestBoundary extends Component<
  { children: ReactNode },
  { error: (Error & { digest?: string }) | null }
> {
  state: { error: (Error & { digest?: string }) | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <AdminError
          error={this.state.error}
          unstable_retry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

describe("حاجز خطأ لوحة الإدارة", () => {
  test("خطأ تصيير في قسم يُستبدَل بالواجهة بدل إسقاط الشجرة", () => {
    // React يطبع الخطأ على console.error — نكتمه حتى يبقى خرج الاختبارات نظيفاً.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <TestBoundary>
          <Boom />
        </TestBoundary>
      );
      expect(screen.getByText("تعذّر عرض هذا القسم")).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("يطمئن المستخدم أن بقية اللوحة سليمة وأن لا شيء حُفظ", () => {
    render(<AdminError error={new Error("x")} unstable_retry={() => {}} />);
    expect(screen.getByText(/بقية لوحة الإدارة تعمل كالمعتاد/)).toBeDefined();
    expect(screen.getByText(/لم يُحفظ ولم يُعدَّل أي شيء/)).toBeDefined();
  });

  test("زر إعادة المحاولة يستدعي unstable_retry (لا reset)", () => {
    const retry = vi.fn();
    render(<AdminError error={new Error("x")} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("يعرض digest حين يصل — وهو ما يربط ما رآه المستخدم بسجلّات الخادم", () => {
    const error = Object.assign(new Error("x"), { digest: "928079202" });
    render(<AdminError error={error} unstable_retry={() => {}} />);
    expect(screen.getByText("928079202")).toBeDefined();
  });

  test("وبدون digest لا يعرض رمزاً فارغاً", () => {
    render(<AdminError error={new Error("x")} unstable_retry={() => {}} />);
    expect(screen.queryByText(/رمز الخطأ للدعم/)).toBeNull();
  });

  test("يوفّر طريق خروج إلى اللوحة", () => {
    render(<AdminError error={new Error("x")} unstable_retry={() => {}} />);
    const link = screen.getByRole("link", { name: "رجوع للوحة" });
    expect(link.getAttribute("href")).toBe("/admin");
  });
});
