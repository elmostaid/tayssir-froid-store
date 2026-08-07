import { describe, expect, test } from "vitest";
import { isValidMoroccanPhone, toInternationalDigits } from "@/lib/phone";

describe("isValidMoroccanPhone", () => {
  test("يقبل صيغة محلية تبدأ بـ 0", () => {
    expect(isValidMoroccanPhone("0612345678")).toBe(true);
    expect(isValidMoroccanPhone("0712345678")).toBe(true);
    expect(isValidMoroccanPhone("0512345678")).toBe(true);
  });

  test("يقبل صيغة دولية بـ +212", () => {
    expect(isValidMoroccanPhone("+212612345678")).toBe(true);
  });

  test("يتجاهل المسافات والشرطات", () => {
    expect(isValidMoroccanPhone("06 12 34 56 78")).toBe(true);
    expect(isValidMoroccanPhone("0612-345-678")).toBe(true);
  });

  test("يرفض رقماً بعدد أرقام خاطئ", () => {
    expect(isValidMoroccanPhone("06123456")).toBe(false);
    expect(isValidMoroccanPhone("061234567890")).toBe(false);
  });

  test("يرفض بادئة شبكة غير صالحة", () => {
    expect(isValidMoroccanPhone("0812345678")).toBe(false);
  });

  test("يرفض نصاً فارغاً أو غير رقمي", () => {
    expect(isValidMoroccanPhone("")).toBe(false);
    expect(isValidMoroccanPhone("ليس رقماً")).toBe(false);
  });
});

describe("toInternationalDigits", () => {
  test("يحوّل صيغة محلية 0X إلى 212X", () => {
    expect(toInternationalDigits("0612345678")).toBe("212612345678");
  });

  test("يحوّل صيغة +212 إلى أرقام خالصة بدون +", () => {
    expect(toInternationalDigits("+212612345678")).toBe("212612345678");
  });

  test("يتجاهل المسافات والشرطات قبل التحويل", () => {
    expect(toInternationalDigits("06 12 34 56 78")).toBe("212612345678");
  });
});
