import { afterEach, describe, expect, test, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

const trackViewContentMock = vi.fn();
vi.mock("@/lib/pixel/fbq", () => ({
  trackViewContent: (...args: unknown[]) => trackViewContentMock(...args),
}));

const { ProductViewContentPixel } = await import("@/components/ProductViewContentPixel");

afterEach(() => {
  cleanup();
  trackViewContentMock.mockReset();
});

describe("ProductViewContentPixel — ViewContent مرة واحدة فقط لكل منتج", () => {
  test("mount: يُطلِق ViewContent مرة واحدة بالقيم الصحيحة", () => {
    render(<ProductViewContentPixel sku="TF-1" name="منتج" price={99.9} category="تصنيف" />);
    expect(trackViewContentMock).toHaveBeenCalledTimes(1);
    expect(trackViewContentMock).toHaveBeenCalledWith({
      sku: "TF-1",
      name: "منتج",
      price: 99.9,
      category: "تصنيف",
    });
  });

  test("إعادة رندر بنفس SKU: لا يُطلِق ViewContent ثانية", () => {
    const { rerender } = render(
      <ProductViewContentPixel sku="TF-1" name="منتج" price={99.9} category="تصنيف" />
    );
    rerender(<ProductViewContentPixel sku="TF-1" name="منتج" price={99.9} category="تصنيف" />);
    expect(trackViewContentMock).toHaveBeenCalledTimes(1);
  });

  test("SKU مختلف (منتج آخر فعلياً): يُطلِق ViewContent مرة أخرى", () => {
    const { rerender } = render(
      <ProductViewContentPixel sku="TF-1" name="منتج 1" price={10} category="تصنيف" />
    );
    rerender(<ProductViewContentPixel sku="TF-2" name="منتج 2" price={20} category="تصنيف" />);
    expect(trackViewContentMock).toHaveBeenCalledTimes(2);
  });
});
