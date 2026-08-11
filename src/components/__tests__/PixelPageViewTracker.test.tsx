import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const usePathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const trackPageViewMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackPageView: () => trackPageViewMock(),
}));

const { PixelPageViewTracker } = await import("@/components/PixelPageViewTracker");

afterEach(() => {
  cleanup();
  trackPageViewMock.mockClear();
  usePathnameMock.mockReset();
  usePathnameMock.mockReturnValue("/");
});

describe("PixelPageViewTracker — PageView مرة واحدة فقط لكل مسار، بلا تكرار", () => {
  test("التحميل الأول: يستدعي trackPageView مرة واحدة بالضبط", () => {
    render(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
  });

  test("إعادة رندر بنفس المسار (بلا تنقّل حقيقي): لا يُطلِق PageView ثانية", () => {
    const { rerender } = render(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);

    // إعادة رندر عادية (مثلاً بسبب تغيّر state فمكوّن أب) بنفس pathname —
    // usePathname ترجع نفس القيمة "/" كما فالمرة الأولى.
    rerender(<PixelPageViewTracker />);
    rerender(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
  });

  test("تنقّل حقيقي لمسار جديد: يُطلِق PageView مرة أخرى (مرة واحدة لكل مسار)", () => {
    usePathnameMock.mockReturnValue("/product/some-product");
    const { rerender } = render(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);

    usePathnameMock.mockReturnValue("/cart");
    rerender(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(2);

    // العودة لنفس "/cart" (بلا تغيّر حقيقي) لا تُطلِق حدثاً ثالثاً.
    rerender(<PixelPageViewTracker />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(2);
  });
});
