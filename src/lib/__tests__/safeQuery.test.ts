import { describe, expect, test, vi } from "vitest";
import { safeQuery } from "@/lib/safeQuery";

describe("safeQuery — تعذّر الوصول لقاعدة البيانات", () => {
  test("يُعيد القيمة الأصلية عند نجاح الاستعلام", async () => {
    const result = await safeQuery(async () => "قيمة حقيقية", "احتياطي", "test-ok");
    expect(result).toBe("قيمة حقيقية");
  });

  test("يُعيد القيمة الاحتياطية بدل الانهيار عند فشل الاستعلام", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await safeQuery(
      async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
      },
      [] as unknown[],
      "test-db-down"
    );

    expect(result).toEqual([]);
    // يجب أن يُسجَّل الخطأ في سجلات الخادم للمطور
    expect(errorSpy).toHaveBeenCalled();
    // ولا يظهر أي تفصيل تقني في القيمة المُعادة للزائر
    expect(result).not.toContain("ECONNREFUSED");

    errorSpy.mockRestore();
  });
});
