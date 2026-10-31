import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const ensureLoadedMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/fbq", () => ({
  trackPageView: vi.fn(),
  ensureMetaPixelLoaded: ensureLoadedMock,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  ensureLoadedMock.mockClear();
  document.cookie = "tf_ad_consent=; Max-Age=0; path=/";
});

describe("MetaPixel — لا شيء يُحقن في الصفحة قبل الموافقة", () => {
  test("بدون NEXT_PUBLIC_META_PIXEL_ID: لا يُنتج أي عنصر ولا يُحمّل شيئاً", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    document.cookie = "tf_ad_consent=granted; path=/";
    const { MetaPixel } = await import("@/components/MetaPixel");
    const { container } = render(<MetaPixel />);
    expect(container.innerHTML).toBe("");
    expect(ensureLoadedMock).not.toHaveBeenCalled();
  });

  test("بالمعرّف وبلا موافقة: لا سكريبت، ولا <noscript> (الصورة كانت تودع _fbp بلا سؤال)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    const { MetaPixel } = await import("@/components/MetaPixel");
    const { container } = render(<MetaPixel />);
    expect(container.querySelector("noscript")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(ensureLoadedMock).not.toHaveBeenCalled();
  });

  test("بالمعرّف وبالموافقة: يُحمَّل بنفس المعرّف", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    document.cookie = "tf_ad_consent=granted; path=/";
    const { MetaPixel } = await import("@/components/MetaPixel");
    render(<MetaPixel />);
    expect(ensureLoadedMock).toHaveBeenCalledWith("2565914390520172");
  });
});
