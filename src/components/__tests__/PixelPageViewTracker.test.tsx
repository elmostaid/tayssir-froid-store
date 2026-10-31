import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { writeAdConsent } from "@/lib/privacy/consent";

const usePathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

const trackPageViewMock = vi.fn();
const ensureLoadedMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackPageView: () => trackPageViewMock(),
  ensureMetaPixelLoaded: (id: string) => ensureLoadedMock(id),
}));

const { PixelPageViewTracker } = await import("@/components/PixelPageViewTracker");

const PIXEL = "2565914390520172";

beforeEach(() => {
  document.cookie = "tf_ad_consent=granted; path=/";
});

afterEach(() => {
  cleanup();
  trackPageViewMock.mockClear();
  ensureLoadedMock.mockClear();
  usePathnameMock.mockReset();
  usePathnameMock.mockReturnValue("/");
  document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
});

describe("PixelPageViewTracker — PageView مرة واحدة فقط لكل مسار، بلا تكرار", () => {
  test("التحميل الأول: يُحمّل Pixel بمعرّفه ثم يستدعي trackPageView مرة واحدة", () => {
    render(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(ensureLoadedMock).toHaveBeenCalledWith(PIXEL);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
  });

  test("إعادة رندر بنفس المسار (بلا تنقّل حقيقي): لا يُطلِق PageView ثانية", () => {
    const { rerender } = render(<PixelPageViewTracker pixelId={PIXEL} />);
    rerender(<PixelPageViewTracker pixelId={PIXEL} />);
    rerender(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
  });

  test("تنقّل حقيقي لمسار جديد: يُطلِق PageView مرة أخرى (مرة واحدة لكل مسار)", () => {
    usePathnameMock.mockReturnValue("/product/some-product");
    const { rerender } = render(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);

    usePathnameMock.mockReturnValue("/cart");
    rerender(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(2);

    rerender(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(trackPageViewMock).toHaveBeenCalledTimes(2);
  });
});

describe("PixelPageViewTracker — لا Pixel قبل الموافقة", () => {
  test("لم يُجب الزائر: لا تحميل ولا PageView", () => {
    document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
    render(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(ensureLoadedMock).not.toHaveBeenCalled();
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });

  test("يوافق وهو في الصفحة: Pixel يُحمَّل وPageView الصفحة يُطلَق لحظتها", () => {
    document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
    render(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(trackPageViewMock).not.toHaveBeenCalled();

    act(() => writeAdConsent("granted"));
    expect(ensureLoadedMock).toHaveBeenCalledWith(PIXEL);
    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
  });

  test("يرفض: لا شيء، ولا بعد التنقّل", () => {
    document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
    const { rerender } = render(<PixelPageViewTracker pixelId={PIXEL} />);
    act(() => writeAdConsent("denied"));
    usePathnameMock.mockReturnValue("/cart");
    rerender(<PixelPageViewTracker pixelId={PIXEL} />);
    expect(ensureLoadedMock).not.toHaveBeenCalled();
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });
});
