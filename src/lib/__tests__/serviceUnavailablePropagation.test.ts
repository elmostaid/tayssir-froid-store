import { describe, expect, test, vi } from "vitest";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailableError } from "@/lib/serviceUnavailable";

// عطل 16 غشت: كل صفحات المتجر كانت تُرجع HTTP 200 أثناء العطل الكامل — مرّة
// بصفحة "تعذّر تحميل الصفحة" ومرّة (الأسوأ) ببيانات /preview التجريبية
// معروضة كأنها منتجات وأثمان حقيقية. أي فحص توفّر خارجي كان يرى الموقع
// سليماً طوال سبع دقائق من التعطّل الكامل.
//
// هذه الاختبارات تُثبِّت السلوك الجديد: عدم توفّر القاعدة يمرّ إلى الأعلى
// (فيُنتج 5xx حقيقياً عبر error.tsx)، بينما تبقى بقية الأخطاء تتراجع بهدوء
// كما كانت.
describe("انتشار ServiceUnavailableError عبر safeQuery", () => {
  test("عدم توفّر القاعدة يُعاد رميه ولا يُبتلع كقيمة احتياطية", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      safeQuery(
        () => Promise.reject(new ServiceUnavailableError("test.context")),
        ["fallback"],
        "test.context"
      )
    ).rejects.toBeInstanceOf(ServiceUnavailableError);

    errorSpy.mockRestore();
  });

  test("أي خطأ آخر يبقى يتراجع للقيمة الاحتياطية كما كان", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      safeQuery(
        () => Promise.reject(new Error("خطأ عابر غير متعلق بتوفّر القاعدة")),
        ["fallback"],
        "test.context"
      )
    ).resolves.toEqual(["fallback"]);

    errorSpy.mockRestore();
  });

  test("النجاح العادي يمرّ بلا تغيير", async () => {
    await expect(
      safeQuery(() => Promise.resolve(["real"]), ["fallback"], "test.context")
    ).resolves.toEqual(["real"]);
  });
});
