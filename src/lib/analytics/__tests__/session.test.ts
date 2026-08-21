import { beforeEach, describe, expect, test } from "vitest";
import {
  CONTEXT_COOKIE,
  SESSION_COOKIE,
  captureSessionContext,
  detectBrowser,
  detectDeviceType,
  getOrCreateSession,
} from "@/lib/analytics/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

function setUrl(url: string) {
  window.history.replaceState({}, "", url);
}

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

beforeEach(() => {
  clearCookies();
  setUrl("/");
  setReferrer("");
});

describe("getOrCreateSession — مُعرّف جلسة مجهول", () => {
  test("أول زيارة: يولّد UUID صالحاً ويضعه في كوكي، ويعلن أنها جلسة جديدة", () => {
    const session = getOrCreateSession();
    expect(session).not.toBeNull();
    expect(UUID_RE.test(session!.sessionId)).toBe(true);
    expect(session!.isNew).toBe(true);
    expect(document.cookie).toContain(SESSION_COOKIE);
    expect(document.cookie).toContain(CONTEXT_COOKIE);
  });

  test("الزيارة التالية في نفس الجلسة: نفس المُعرّف بالضبط وليست جديدة", () => {
    const first = getOrCreateSession()!;
    const second = getOrCreateSession()!;
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.isNew).toBe(false);
  });

  test("سياق الحملة يبقى سياق صفحة الهبوط ولا يُستبدل بصفحة لاحقة", () => {
    setUrl("/?utm_source=facebook&utm_campaign=MOROCCO_PURCHASE_BROAD");
    const first = getOrCreateSession()!;
    expect(first.context.utmSource).toBe("facebook");
    expect(first.context.landingPath).toBe("/");

    // الزائر ينتقل لصفحة منتج بلا أي وسوم — السياق لا يتغيّر.
    setUrl("/product/tf-wm-001");
    const second = getOrCreateSession()!;
    expect(second.context.utmSource).toBe("facebook");
    expect(second.context.utmCampaign).toBe("MOROCCO_PURCHASE_BROAD");
    expect(second.context.landingPath).toBe("/");
  });

  test("كوكي تالفة تُعامَل كجلسة جديدة بدل أن تُسقط أي شيء", () => {
    document.cookie = `${SESSION_COOKIE}=not-a-uuid; Path=/`;
    document.cookie = `${CONTEXT_COOKIE}=%7Bbroken; Path=/`;
    const session = getOrCreateSession()!;
    expect(UUID_RE.test(session.sessionId)).toBe(true);
    expect(session.isNew).toBe(true);
  });
});

describe("captureSessionContext — ما يُلتقط وما لا يُلتقط", () => {
  test("fbclid: يُسجَّل وجوده فقط، والقيمة نفسها لا تظهر في السياق إطلاقاً", () => {
    setUrl("/?fbclid=IwAR_super_secret_click_id_value");
    const context = captureSessionContext();
    expect(context.hasClickId).toBe(true);
    expect(JSON.stringify(context)).not.toContain("IwAR_super_secret_click_id_value");
  });

  test("الإحالة تُختصر إلى اسم النطاق فقط، بلا مسار ولا بارامترات", () => {
    setReferrer("https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com&h=SECRET");
    const context = captureSessionContext();
    expect(context.referrerHost).toBe("l.facebook.com");
    expect(JSON.stringify(context)).not.toContain("SECRET");
  });

  test("الإحالة الداخلية (نفس النطاق) تُتجاهَل — التنقّل داخل الموقع ليس مصدر زيارة", () => {
    setReferrer(`${location.origin}/category/x`);
    expect(captureSessionContext().referrerHost).toBeNull();
  });

  test("بلا وسوم حملة: كل الحقول null بلا أي قيمة مخترعة", () => {
    setUrl("/");
    const context = captureSessionContext();
    expect(context.utmSource).toBeNull();
    expect(context.utmMedium).toBeNull();
    expect(context.utmCampaign).toBeNull();
    expect(context.hasClickId).toBe(false);
  });
});

describe("تصنيف الجهاز والمتصفح", () => {
  test.each([
    ["Mozilla/5.0 (Linux; Android 11; SM-A125F) ... Chrome/120 Mobile Safari/537.36", 393, "mobile"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ... Mobile/15E148", 390, "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) ... Safari/604.1", 820, "tablet"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/120 Safari/537.36", 1440, "desktop"],
  ])("نوع الجهاز من %s", (ua, width, expected) => {
    expect(detectDeviceType(ua, width)).toBe(expected);
  });

  test("متصفح فيسبوك الداخلي يُميَّز عن Chrome العادي — وهو أهم تفريق لجمهور الحملة", () => {
    const fb =
      "Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/448.0.0.34.113;]";
    expect(detectBrowser(fb)).toBe("fb_inapp");
    expect(detectBrowser("Mozilla/5.0 (Linux; Android 11) Chrome/120 Mobile Safari/537.36")).toBe(
      "chrome"
    );
  });

  test("متصفح إنستغرام الداخلي", () => {
    expect(detectBrowser("Mozilla/5.0 (iPhone) Instagram 300.0.0.29.110 (iPhone14,2)")).toBe(
      "ig_inapp"
    );
  });
});
