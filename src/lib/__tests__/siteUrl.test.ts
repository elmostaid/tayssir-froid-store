import { afterEach, describe, expect, test } from "vitest";
import { getSiteUrl } from "@/lib/siteUrl";

const ORIGINAL_SITE_URL = process.env.SITE_URL;

afterEach(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = ORIGINAL_SITE_URL;
});

// عطل الإنتاج الحقيقي: SITE_URL كان مضبوطاً بالخطأ بقيمة تشبه مقتطفاً من
// DATABASE_URL ("postgres.vowhaasgwvbbxaxzdtzy" — بادئة اسم مستخدم مجمِّع
// اتصالات Supabase)، فكان src/app/layout.tsx (الجذر، يُحمَّل مع كل صفحة)
// يرمي "TypeError: Invalid URL" عند `new URL(siteUrl)`، فيُسقط بناء الموقع
// بأكمله. getSiteUrl() يجب أن تتصرف كأن SITE_URL غير مضبوط إطلاقاً (null)
// لأي قيمة لا تكون رابط http(s) صالحاً، بدل تمرير قيمة ستُسقط new URL لاحقاً.
describe("getSiteUrl — لا يرجع أبداً قيمة قد تُسقط new URL(...) في layout.tsx", () => {
  test("قيمة غير مضبوطة: يرجع null", () => {
    delete process.env.SITE_URL;
    expect(getSiteUrl()).toBeNull();
  });

  test("قيمة غير رابط صالح إطلاقاً (مقتطف من connection string): يرجع null بدل رمي استثناء", () => {
    process.env.SITE_URL = "postgres.vowhaasgwvbbxaxzdtzy";
    expect(getSiteUrl()).toBeNull();
    expect(() => getSiteUrl()).not.toThrow();
  });

  test("رابط صالح: يرجع نفس القيمة (بلا / نهائية)", () => {
    process.env.SITE_URL = "https://tayssirfroid.com/";
    expect(getSiteUrl()).toBe("https://tayssirfroid.com");
  });

  test("مخطط غير http(s) (مثل ftp://) يُعتبر غير صالح: يرجع null", () => {
    process.env.SITE_URL = "ftp://example.com";
    expect(getSiteUrl()).toBeNull();
  });

  test("قيمة صالحة تُستعمل فعلاً بنجاح داخل new URL(...) بدون رمي استثناء", () => {
    process.env.SITE_URL = "https://tayssirfroid.com";
    const siteUrl = getSiteUrl();
    expect(siteUrl).not.toBeNull();
    expect(() => new URL(siteUrl!)).not.toThrow();
  });
});
