import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StorefrontError from "@/app/(storefront)/error";

/**
 * ما يُثبته هذا الملف: أن زرّ «إعادة المحاولة» الذي يراه **الزبون** يستدعي
 * `unstable_retry` — الدالّة التي يقول توثيق Next.js 16 إنها تُعيد الجلب
 * فعلاً — لا `reset` التي تُعيد التصيير بلا جلب.
 *
 * ولماذا يستحقّ هذا اختباراً: الفرق غير مرئي في الواجهة. زرٌّ يستدعي
 * `reset` يبدو سليماً تماماً ويفعل لا شيء، لأن كل عطل يوصِل الزبون إلى
 * هذه الصفحة سببه تعذّر قراءة قاعدة البيانات — فإعادة التصيير تُعيد رسم
 * نفس الفشل. انحدارٌ كهذا لا يُكتشَف إلا بسطر يقيس أي دالّة استُدعيت.
 *
 * وما لا يُثبته: أن إعادة الجلب تنجح فعلاً (ذاك شأن Next.js نفسه)، ولا
 * تركيب هذا الملف على المسار الصحيح (شأن الموجِّه، يُتحقَّق في المعاينة).
 */

afterEach(cleanup);

describe("صفحة خطأ المتجر — ما يراه الزبون", () => {
  test("زرّ إعادة المحاولة يستدعي unstable_retry، لا reset", () => {
    const retry = vi.fn();
    render(<StorefrontError error={new Error("x")} unstable_retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("الرسالة تبقى بالعربية ومفهومة للزبون، بلا أي تفصيل تقني", () => {
    render(<StorefrontError error={new Error("57014: canceling statement")} unstable_retry={() => {}} />);
    expect(screen.getByText("تعذّر تحميل الصفحة مؤقتاً")).toBeDefined();
    expect(screen.getByText(/التواصل معنا مباشرة عبر واتساب/)).toBeDefined();
    // لا تُسرَّب رسالة الخطأ الحقيقية إلى الزبون.
    expect(screen.queryByText(/57014/)).toBeNull();
    expect(screen.queryByText(/canceling statement/)).toBeNull();
  });

  test("رمز المرجع يُعرض حين يصل — فلا يُخفى العطل عن الدعم", () => {
    const error = Object.assign(new Error("x"), { digest: "928079202" });
    render(<StorefrontError error={error} unstable_retry={() => {}} />);
    expect(screen.getByText(/928079202/)).toBeDefined();
  });

  test("وبدون digest لا يُعرض رمز فارغ", () => {
    render(<StorefrontError error={new Error("x")} unstable_retry={() => {}} />);
    expect(screen.queryByText(/رمز المرجع/)).toBeNull();
  });
});
