"use client";

import type { AttributionTouch, OrderAttribution } from "@/lib/attribution/types";
import { isUnfilledMacro, shouldKeepPreviousTouch } from "@/lib/attribution/types";
import {
  AD_CONSENT_EVENT,
  isAdConsentGranted,
  readAdConsentFromDocument,
} from "@/lib/privacy/consent";

/**
 * التقاط مصدر الزائر وحفظه حتى لحظة الطلب.
 *
 * القاعدة الحاكمة، كما في باقي طبقات القياس: **لا شيء هنا يرمي استثناءً ولا
 * يعطّل أي تفاعل.** تخزين ممتلئ أو محظور يعني نسباً أضعف، لا صفحة مكسورة.
 *
 * لماذا localStorage لا كوكي الجلسة: الجلسة تنتهي بعد 30 دقيقة خمول، بينما
 * أول لمسة يجب أن تبقى عبر الجلسات — الزبون قد يرى الإعلان اليوم ويطلب بعد
 * ثلاثة أيام، ونريد أن نعرف أن الإعلان هو من جاء به أصلاً.
 *
 * التمييز بين اللمسة والتنقّل الداخلي هو جوهر هذا الملف: صفحة تُفتح بلا وسوم
 * حملة وبلا إحالة خارجية ليست مصدراً جديداً، فلا تُكتب فوق آخر لمسة. بدون
 * هذا التمييز كان أي تنقّل داخل الموقع سيمحو الحملة التي جاءت بالزبون.
 */

const FIRST_KEY = "tf_attr_first";
const LAST_KEY = "tf_attr_last";

/** نافذة أول لمسة: بعدها تُعتبر متقادمة ويُعاد تأسيسها. */
const FIRST_TOUCH_MAX_AGE_DAYS = 90;

/**
 * معرّفات النقر (`fbclid`/`gclid`/`ttclid`) لا تُكتب في المتصفح قبل الموافقة.
 *
 * هي مُعرّفات إشهار شخصية، والتخزين على جهاز الزائر «إيداع» تشترط له
 * مداولة CNDP D-939-2025 موافقة مسبقة. لكن الزائر يصل عادةً من الإعلان
 * ويرى شريط الموافقة **في نفس الصفحة**؛ لو أسقطنا المعرّف فوراً لضاع إسناد
 * من يوافق بعد ثانيتين. فيبقى في الذاكرة وحدها (لا تخزين) حتى يُجيب: موافقة
 * ⇒ يُكتب في اللمسة التي جاء معها، رفض أو مغادرة ⇒ يختفي مع الصفحة.
 */
type ClickIds = Pick<AttributionTouch, "fbclid" | "gclid" | "ttclid"> & { at: number };
let pendingClickIds: ClickIds | null = null;

function withoutClickIdsUnlessConsented(touch: AttributionTouch): AttributionTouch {
  if (isAdConsentGranted(readAdConsentFromDocument())) return touch;
  if (touch.fbclid || touch.gclid || touch.ttclid) {
    pendingClickIds = { fbclid: touch.fbclid, gclid: touch.gclid, ttclid: touch.ttclid, at: touch.at };
  }
  return { ...touch, fbclid: null, gclid: null, ttclid: null };
}

/** عند الموافقة: معرّفات اللمسة المنتظرة تُكتب فيها هي وحدها (نفس `at`). */
export function persistPendingClickIds(): void {
  if (!pendingClickIds || !isAdConsentGranted(readAdConsentFromDocument())) return;
  const pending = pendingClickIds;
  pendingClickIds = null;
  for (const key of [FIRST_KEY, LAST_KEY]) {
    const stored = readStored(key);
    if (stored && stored.at === pending.at) {
      writeStored(key, { ...stored, fbclid: pending.fbclid, gclid: pending.gclid, ttclid: pending.ttclid });
    }
  }
}

/** عند الرفض أو السحب: لا معرّف نقرة يبقى على الجهاز. */
export function clearStoredClickIds(): void {
  pendingClickIds = null;
  for (const key of [FIRST_KEY, LAST_KEY]) {
    const stored = readStored(key);
    if (stored && (stored.fbclid || stored.gclid || stored.ttclid)) {
      writeStored(key, { ...stored, fbclid: null, gclid: null, ttclid: null });
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(AD_CONSENT_EVENT, (event) => {
    const value = (event as CustomEvent<string>).detail;
    if (value === "granted") persistPendingClickIds();
    else clearStoredClickIds();
  });
}

function readStored(key: string): AttributionTouch | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AttributionTouch>;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.at !== "number") return null;
    return {
      utmSource: parsed.utmSource ?? null,
      utmMedium: parsed.utmMedium ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      utmContent: parsed.utmContent ?? null,
      utmTerm: parsed.utmTerm ?? null,
      fbclid: parsed.fbclid ?? null,
      gclid: parsed.gclid ?? null,
      ttclid: parsed.ttclid ?? null,
      landingPath: parsed.landingPath ?? null,
      referrerHost: parsed.referrerHost ?? null,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

function writeStored(key: string, touch: AttributionTouch): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(touch));
  } catch {
    // تخزين ممتلئ أو محظور (تصفّح خاص) — النسب يضعف ولا شيء يتعطّل.
  }
}

function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/**
 * يقرأ اللمسة من الصفحة الحالية، أو null إن كان هذا مجرّد تنقّل داخلي.
 *
 * `treatDirectAsTouch` تُستعمَل لأول لمسة وحدها: زائر جاء مباشرة بلا إحالة
 * ولا وسوم يبقى مصدراً حقيقياً («مباشر») ويستحق أن يُسجَّل كأول لمسة — لكنه
 * لا يجوز أن يمحو آخر لمسة إعلانية معروفة.
 */
export function readTouchFromLocation(treatDirectAsTouch = false): AttributionTouch | null {
  if (typeof window === "undefined" || typeof location === "undefined") return null;

  const params = new URLSearchParams(location.search);
  const get = (key: string) => {
    const value = params.get(key)?.trim();
    // `{{ad.id}}` حرفياً = وسم لم تعوّضه Meta، لا مصدر.
    return value && !isUnfilledMacro(value) ? value : null;
  };

  const referrer = typeof document !== "undefined" ? document.referrer : "";
  const referrerHost = referrer ? hostOf(referrer) : null;
  // الإحالة الداخلية ليست مصدر زيارة — نفس قاعدة القياس الداخلي.
  const externalReferrer =
    referrerHost && referrerHost !== location.hostname ? referrerHost : null;

  const touch: AttributionTouch = {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
    fbclid: get("fbclid"),
    gclid: get("gclid"),
    ttclid: get("ttclid"),
    landingPath: location.pathname || "/",
    referrerHost: externalReferrer,
    at: Date.now(),
  };

  const hasCampaign = Boolean(
    touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.utmContent ||
      touch.utmTerm || touch.fbclid || touch.gclid || touch.ttclid
  );

  if (hasCampaign || externalReferrer) return touch;
  return treatDirectAsTouch ? touch : null;
}

/**
 * تُستدعى مرة عند كل تحميل صفحة. تُثبّت أول لمسة وتحدّث آخر لمسة عند مصدر
 * جديد فقط.
 */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = readStored(FIRST_KEY);
    const expired =
      stored !== null && Date.now() - stored.at > FIRST_TOUCH_MAX_AGE_DAYS * 86_400_000;

    if (!stored || expired) {
      // لا أول لمسة بعد (أو تقادمت): حتى الزيارة المباشرة تستحق التسجيل.
      const raw = readTouchFromLocation(true);
      if (raw) {
        const touch = withoutClickIdsUnlessConsented(raw);
        writeStored(FIRST_KEY, touch);
        writeStored(LAST_KEY, touch);
      }
      return;
    }

    // أول لمسة محفوظة ولا تُمسّ. آخر لمسة تتغيّر عند مصدر جديد وحده.
    const raw = readTouchFromLocation(false);
    if (!raw) return;
    // إحالة عارية من نفس الشبكة لا تمحو إعلاناً موسوماً حديثاً (انظر types.ts).
    if (shouldKeepPreviousTouch(raw, readStored(LAST_KEY))) return;
    writeStored(LAST_KEY, withoutClickIdsUnlessConsented(raw));
  } catch {
    // القياس لا يُسقط صفحة أبداً.
  }
}

/** ما يُرسَل مع الطلب. آخر لمسة تعود إلى الأولى إن لم تُسجَّل بعد. */
export function getOrderAttribution(): OrderAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const first = readStored(FIRST_KEY);
    const last = readStored(LAST_KEY) ?? first;
    if (!first && !last) return null;
    return { first, last };
  } catch {
    return null;
  }
}

/** للاختبارات فقط. */
export const __ATTRIBUTION_KEYS_FOR_TESTS = { FIRST_KEY, LAST_KEY, FIRST_TOUCH_MAX_AGE_DAYS };
