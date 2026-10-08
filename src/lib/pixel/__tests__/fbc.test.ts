import { describe, expect, test } from "vitest";
import { buildFbc, resolveFbc, subdomainIndexFromHost } from "@/lib/pixel/fbc";

/**
 * `fbc` هو مفتاح الإسناد الوحيد الذي يربط حدثاً بنقرة إعلانية — وكان يُقرأ
 * من كوكي `_fbc` فقط، وهي كوكي **تكتبها Meta Pixel نفسها** لا هذا المشروع.
 * فإذا حُجبت الـPixel وصل الحدث إلى Meta بلا إسناد لأي إعلان ولم يظهر في
 * تقارير الحملة أبداً. القياس في حملة واحدة: 20 سلّة عند Meta مقابل 46
 * جلسة سلّة في قياسنا.
 *
 * وما يختبره هذا الملف هو البديل: بناء القيمة من `fbclid` المحفوظ عندنا
 * أصلاً. والحرص كله على ألّا نُلفّق قيمة — `fbc` خاطئ يكسر الإسناد ولا
 * يُعلن عن نفسه، فالرفض (null) أسلم من التقريب دائماً.
 */

const VALID_FBCLID = "IwZXh0bgNhZW0BMABwZG9mBWFkaWQBqzg8MyFoVnNydGMG";
// 2026-09-29 18:52 بالمللي — من نطاق الطلبات الحقيقية.
const AT = 1_790_700_720_000;

/**
 * كوكي `_fbc` حقيقية كتبتها Meta Pixel بنفسها، من الطلب 176 في الإنتاج
 * (طلب موقع من 2026-10-07 على `www.tayssirfroid.com`). هي المرجع الذي
 * يحكم على حسابنا: فهرسها **1** رغم أن الصفحة على `www`، لأن الـPixel تضع
 * الكوكي على النطاق المُسجَّل. وكان حسابنا يُنتج 2.
 */
const REAL_PIXEL_COOKIE =
  "fb.1.1791393058083.IwZXh0bgNhZW0CMTAAcGRvZgVmZGlkFlD9bj62LUcnAnpdSXzuzoZQ";

describe("subdomainIndexFromHost — يطابق ما تكتبه Meta على نطاقنا", () => {
  test("النطاق المُسجَّل: 1", () => {
    expect(subdomainIndexFromHost("tayssirfroid.com")).toBe(1);
  });

  test("www لا يرفع الفهرس: الكوكي على النطاق المُسجَّل لا على www", () => {
    expect(subdomainIndexFromHost("www.tayssirfroid.com")).toBe(1);
  });

  test("فهرسنا المحسوب = فهرس الكوكي الحقيقية من الإنتاج", () => {
    const fromRealCookie = Number(REAL_PIXEL_COOKIE.split(".")[1]);
    expect(subdomainIndexFromHost("https://www.tayssirfroid.com/checkout")).toBe(fromRealCookie);
  });

  test("أي نطاق فرعي آخر كذلك: الكوكي ليست عليه", () => {
    expect(subdomainIndexFromHost("shop.tayssirfroid.com")).toBe(1);
    expect(subdomainIndexFromHost("a.b.tayssirfroid.com")).toBe(1);
  });

  test("لاحقة مستوى ثانٍ تحتاج ثلاثة مقاطع ليكتمل النطاق المُسجَّل", () => {
    expect(subdomainIndexFromHost("example.co.uk")).toBe(2);
    expect(subdomainIndexFromHost("www.example.co.uk")).toBe(2);
    expect(subdomainIndexFromHost("shop.example.com.br")).toBe(2);
  });

  test("يتجاهل المنفذ والحالة والمسار", () => {
    expect(subdomainIndexFromHost("WWW.TayssirFroid.com:3000")).toBe(1);
    expect(subdomainIndexFromHost("tayssirfroid.com/checkout")).toBe(1);
  });

  test("يقبل رابطاً كاملاً لا مضيفاً فقط", () => {
    // `capi_identity.eventSourceUrl` رابط كامل، و`request.headers.get("host")`
    // مضيف مجرَّد — المُنادون يُمرّرون الاثنين، فكلاهما يجب أن يُفهَم.
    expect(subdomainIndexFromHost("https://www.tayssirfroid.com/checkout")).toBe(1);
    expect(subdomainIndexFromHost("https://tayssirfroid.com/")).toBe(1);
    expect(subdomainIndexFromHost("http://tayssirfroid.com:3000/cart")).toBe(1);
  });

  test("localhost وعنوان IP ونطاق غائب: 1 — لا نخترع مقاطع", () => {
    expect(subdomainIndexFromHost("localhost")).toBe(1);
    expect(subdomainIndexFromHost("127.0.0.1")).toBe(1);
    expect(subdomainIndexFromHost(null)).toBe(1);
    expect(subdomainIndexFromHost(undefined)).toBe(1);
    expect(subdomainIndexFromHost("")).toBe(1);
  });
});

describe("buildFbc — يبني الصيغة الصحيحة", () => {
  test("الصيغة fb.<subdomainIndex>.<ms>.<fbclid> بالضبط", () => {
    expect(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT, host: "tayssirfroid.com" })
    ).toBe(`fb.1.${AT}.${VALID_FBCLID}`);
  });

  test("نفس الصيغة من www — لا فهرس مختلف لنفس الموقع", () => {
    // الإسناد يكسره اختلافٌ لا يُعلن عن نفسه: `fbc` نبنيه بفهرس 2 بينما
    // تكتب Meta 1 لنفس المتجر يعني قيمتين لنفس النقرة.
    expect(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT, host: "www.tayssirfroid.com" })
    ).toBe(`fb.1.${AT}.${VALID_FBCLID}`);
    expect(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT, host: "https://www.tayssirfroid.com/checkout" })
    ).toBe(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT, host: "tayssirfroid.com" })
    );
  });

  test("الكوكي الأصلية تبقى الأولى، بلا أي إعادة بناء", () => {
    // حين توجد كوكي كتبتها Meta فهي المرجع — تُمرَّر كما هي حرفياً.
    expect(
      resolveFbc({
        cookieFbc: REAL_PIXEL_COOKIE,
        fbclid: VALID_FBCLID,
        fbclidAt: AT,
        host: "https://www.tayssirfroid.com/checkout",
      })
    ).toBe(REAL_PIXEL_COOKIE);
  });

  test("يستعمل لحظة أول ظهور الـfbclid، لا الآن", () => {
    const built = buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT });
    // لو استُعمل Date.now() لاختلف الرقم في كل تشغيل، ولانحرفت نافذة
    // الإسناد عن اللحظة التي وقعت فيها النقرة فعلاً.
    expect(built).toContain(`.${AT}.`);
    expect(built).not.toContain(`.${Date.now()}.`);
  });

  test("المللي الكسرية تُقصّ إلى عدد صحيح", () => {
    expect(buildFbc({ fbclid: VALID_FBCLID, fbclidAt: AT + 0.7 })).toBe(
      `fb.1.${AT}.${VALID_FBCLID}`
    );
  });
});

describe("buildFbc — يرفض بدل أن يُلفّق", () => {
  test("بلا fbclid: null", () => {
    expect(buildFbc({ fbclid: null, fbclidAt: AT })).toBeNull();
    expect(buildFbc({ fbclid: undefined, fbclidAt: AT })).toBeNull();
    expect(buildFbc({ fbclid: "   ", fbclidAt: AT })).toBeNull();
  });

  test("fbclid فيه محارف غير مسموحة: null", () => {
    // قيمة ملوَّثة (محاولة حقن، أو رابط مُشوَّه) لا تُمرَّر إلى Meta.
    expect(buildFbc({ fbclid: "abc.def", fbclidAt: AT })).toBeNull();
    expect(buildFbc({ fbclid: "abc def", fbclidAt: AT })).toBeNull();
    expect(buildFbc({ fbclid: "abc&x=1", fbclidAt: AT })).toBeNull();
  });

  test("fbclid أطول من الحد: null", () => {
    expect(buildFbc({ fbclid: "a".repeat(513), fbclidAt: AT })).toBeNull();
  });

  test("وقت غائب أو صفر أو بالثواني بدل المللي: null", () => {
    expect(buildFbc({ fbclid: VALID_FBCLID, fbclidAt: null })).toBeNull();
    expect(buildFbc({ fbclid: VALID_FBCLID, fbclidAt: 0 })).toBeNull();
    // 1790700720 ثانية — خطأ شائع، ولو قُبل لصار الإسناد في 1970.
    expect(buildFbc({ fbclid: VALID_FBCLID, fbclidAt: 1_790_700_720 })).toBeNull();
  });

  test("وقت من المستقبل: null", () => {
    expect(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: Date.now() + 86_400_000 })
    ).toBeNull();
  });

  test("وقت ليس رقماً: null", () => {
    expect(buildFbc({ fbclid: VALID_FBCLID, fbclidAt: Number.NaN })).toBeNull();
    expect(
      buildFbc({ fbclid: VALID_FBCLID, fbclidAt: Number.POSITIVE_INFINITY })
    ).toBeNull();
  });
});

describe("resolveFbc — الكوكي أولاً دائماً", () => {
  test("كوكي موجودة: تُعاد كما هي ولا يُبنى شيء", () => {
    const cookie = "fb.1.1700000000000.FROM_COOKIE";
    expect(
      resolveFbc({ cookieFbc: cookie, fbclid: VALID_FBCLID, fbclidAt: AT })
    ).toBe(cookie);
  });

  test("كوكي غائبة: يُبنى من fbclid", () => {
    expect(
      resolveFbc({ cookieFbc: undefined, fbclid: VALID_FBCLID, fbclidAt: AT })
    ).toBe(`fb.1.${AT}.${VALID_FBCLID}`);
  });

  test("كوكي فارغة أو فراغات: تُعامَل كغائبة", () => {
    expect(resolveFbc({ cookieFbc: "", fbclid: VALID_FBCLID, fbclidAt: AT })).toBe(
      `fb.1.${AT}.${VALID_FBCLID}`
    );
    expect(resolveFbc({ cookieFbc: "  ", fbclid: VALID_FBCLID, fbclidAt: AT })).toBe(
      `fb.1.${AT}.${VALID_FBCLID}`
    );
  });

  test("لا كوكي ولا fbclid: null — وهذا صحيح لا ناقص", () => {
    // زبون جاء مباشرةً أو من بحث عضوي: لا إسناد إعلاني لأن لا إعلان.
    expect(resolveFbc({ cookieFbc: null, fbclid: null, fbclidAt: null })).toBeNull();
  });
});
