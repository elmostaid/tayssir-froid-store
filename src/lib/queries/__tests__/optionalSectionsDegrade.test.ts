import { describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// استعلام يفشل دائماً — يُحاكي بالضبط ما وقع فعلاً: الجدول غير موجود بعد
// لأن الهجرة لم تُطبَّق على القاعدة التي يقرأ منها هذا النشر.
const sqlMock = vi.fn(async () => {
  throw new Error('relation "public.home_featured_products" does not exist');
});
vi.mock("@/lib/db", () => ({ sql: sqlMock }));

const { getFeaturedProducts, getCategoryCoverImages } = await import("@/lib/queries/catalog");

/**
 * قسمان اختياريان لا يجوز لهما إسقاط المتجر.
 *
 * ما وقع: أول بناء معاينة لهذا التغيير ردّ **500 على الصفحة الرئيسية**.
 * السبب سلسلة مقصودة فكل حلقة منها: `failQuery` ترمي
 * ServiceUnavailableError، وsafeQuery تُعيد رميها عمداً حتى لا يُخدَّم متجر
 * فارغ برمز 200. ذلك صحيح للتصنيفات والمنتجات — صفحة بلا منتجات متجرٌ
 * معطّل. لكنه خطأ لقسم اختياري له بديل معرَّف سلفاً: «الأكثر طلباً» يتراجع
 * للقائمة المقاسة، وبطاقة التصنيف بلا غلاف تعرض الأيقونة واسمها.
 *
 * لو دُمج كما كان، لسقط المتجر كله بين لحظة النشر ولحظة تطبيق الهجرة.
 */
describe("الأقسام الاختيارية تتراجع ولا تُسقط الصفحة", () => {
  test("«الأكثر طلباً» يُرجع قائمة فارغة حين يفشل استعلامه", async () => {
    await expect(getFeaturedProducts()).resolves.toEqual([]);
    expect(sqlMock).toHaveBeenCalled();
  });

  test("أغلفة التصنيفات تُرجع لا شيء حين يفشل استعلامها", async () => {
    await expect(getCategoryCoverImages()).resolves.toEqual({});
  });
});
