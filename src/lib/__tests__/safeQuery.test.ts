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

  // دليل حقيقي وراء هذا: عطل 504 حقيقي متكرر على Vercel (FUNCTION_
  // INVOCATION_TIMEOUT، ~300 ثانية، بلا أي fetch خارجي) — استعلام "علِق"
  // بلا أي استجابة أصلاً (لا نجاح ولا رفض) لا يُفعِّل try/catch العادي
  // إطلاقاً، فتتعلَّق الصفحة كاملة حتى يقتلها Vercel. هذا الاختبار يثبت أن
  // safeQuery تسترجع القيمة الاحتياطية بعد مهلة محدودة حتى لو لم يستجب
  // الاستعلام إطلاقاً — بغضّ النظر عن سبب التعليق بالضبط (استعمل مؤقّتات
  // زائفة (fake timers) بدل انتظار 15 ثانية حقيقية فكل تشغيل اختبار).
  test("يُعيد القيمة الاحتياطية بعد مهلة محدودة عند تعليق الاستعلام بلا استجابة أصلاً (لا نجاح ولا فشل)", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const neverResolves = new Promise<string>(() => {
      /* يبقى معلَّقاً عمداً — يحاكي اتصالاً/استعلاماً لا يستجيب أصلاً */
    });

    const resultPromise = safeQuery(() => neverResolves, "احتياطي", "test-hang");

    // لا يجب أن تُحسم القيمة قبل مرور المهلة القصوى
    await vi.advanceTimersByTimeAsync(14000);
    let settled = false;
    resultPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // بعد تجاوز المهلة القصوى، يجب أن تُحسم بالقيمة الاحتياطية
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;
    expect(result).toBe("احتياطي");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    vi.useRealTimers();
  });
});
