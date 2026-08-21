"use client";

import {
  ANALYTICS_ENDPOINT,
  MAX_EVENTS_PER_BATCH,
  type AnalyticsEventName,
  type AnalyticsEventPayload,
  type AnalyticsWireBatch,
  type AnalyticsWireEvent,
} from "@/lib/analytics/events";
import { detectBrowser, detectDeviceType, getOrCreateSession } from "@/lib/analytics/session";

/**
 * طبقة الإرسال. القاعدة الحاكمة الوحيدة: **لا شيء هنا يحجب أو يؤخّر أي تفاعل
 * في الصفحة، ولا يرمي أي استثناء أبداً.** فشل القياس يجب أن يمرّ دون أن
 * يلاحظه الزبون إطلاقاً — الموقع يبيع قطع غيار، لا يجمع إحصاءات.
 *
 * لماذا تجميع (batching) بدل طلب لكل حدث: الجلسة الواحدة تنتج 4–7 أحداث.
 * طلب منفصل لكل واحد = 7 استدعاءات serverless و7 اتصالات بقاعدة البيانات
 * لكل زائر، مع مجمّع اتصالات محدود بـmax: 5. التجميع يُنزل الرقم إلى 1–2،
 * وهو الفرق بين نظام قياس غير محسوس ونظام يُعيد إنتاج نفس ضغط الاتصالات
 * الذي أصلحناه سابقاً.
 */

/** مهلة التجميع: نُمهل الأحداث المتتابعة لتُرسَل معاً في طلب واحد. */
const FLUSH_DELAY_MS = 4000;

let queue: AnalyticsWireEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersBound = false;

function nowPath(): string {
  return typeof location !== "undefined" ? location.pathname : "/";
}

function buildBatch(events: AnalyticsWireEvent[]): AnalyticsWireBatch | null {
  const session = getOrCreateSession();
  if (!session) return null;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const width = typeof window !== "undefined" ? window.innerWidth : 0;
  const height = typeof window !== "undefined" ? window.innerHeight : 0;

  return {
    sessionId: session.sessionId,
    context: session.context,
    deviceType: detectDeviceType(ua, width),
    browser: detectBrowser(ua),
    viewportW: width,
    viewportH: height,
    events,
  };
}

function send(batch: AnalyticsWireBatch): void {
  const body = JSON.stringify(batch);

  // sendBeacon هو الأداة الصحيحة هنا وليس اختياراً تجميلياً: المتصفح يتكفّل
  // بإرسالها حتى بعد أن تُغلق الصفحة أو تنتقل إلى واتساب، وهي بالضبط اللحظة
  // التي يقع فيها حدث الشراء.
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ANALYTICS_ENDPOINT, blob)) return;
    } catch {
      // نُكمل إلى fetch أسفله.
    }
  }

  if (typeof fetch !== "function") return;
  try {
    void fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // أفضل مجهود — لا شيء يُفعَل هنا عمداً.
    });
  } catch {
    // متصفح لا يدعم keepalive أو منع الطلب — نتجاهل بصمت.
  }
}

export function flushAnalytics(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;

  const events = queue;
  queue = [];
  try {
    const batch = buildBatch(events);
    if (batch) send(batch);
  } catch {
    // لا شيء — القياس لا يُسقط صفحة أبداً.
  }
}

function bindFlushListeners(): void {
  if (listenersBound || typeof document === "undefined") return;
  listenersBound = true;

  // pagehide يغطّي الإغلاق والتنقّل بما فيه bfcache على iOS، و
  // visibilitychange يغطّي تبديل التطبيقات على الهاتف (وهو الأشيع هنا:
  // الزبون ينتقل إلى واتساب). كلاهما مطلوب — أحدهما وحده يفقد حالات.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAnalytics();
  });
  window.addEventListener("pagehide", flushAnalytics);
}

/**
 * تسجيل حدث. يعود فوراً دائماً؛ الإرسال الفعلي يقع لاحقاً في دفعة.
 * `immediate` تُستعمَل للشراء فقط، حيث لا نملك ترف الانتظار.
 */
export function trackAnalyticsEvent(
  name: AnalyticsEventName,
  payload: AnalyticsEventPayload = {},
  options: { immediate?: boolean } = {}
): void {
  if (typeof window === "undefined") return;

  try {
    bindFlushListeners();

    const session = getOrCreateSession();
    queue.push({
      name,
      pagePath: nowPath(),
      sessionMs: session ? Math.max(0, Date.now() - session.context.startedAt) : 0,
      ...payload,
    });

    if (options.immediate || queue.length >= MAX_EVENTS_PER_BATCH) {
      flushAnalytics();
      return;
    }

    if (flushTimer === null) {
      flushTimer = setTimeout(flushAnalytics, FLUSH_DELAY_MS);
    }
  } catch {
    // نفس المبدأ: خطأ في القياس لا يصل الزبون أبداً.
  }
}

/**
 * إرسال يُخبرنا هل وصل أم لا — للإضافات المبكّرة وحدها.
 *
 * باقي الأحداث تُرسَل بأفضل مجهود عبر sendBeacon وتُنسى، وهذا صحيح لها:
 * كلها تقع بينما الصفحة حيّة ومُرطَّبة. أما الإضافة المبكّرة فتقع قبل أن
 * يصل React بثوانٍ، وقد يغادر صاحبها الصفحة أو تنقطع شبكته قبل أن تُرسَل
 * — فهي الحدث الوحيد الذي نحتاج أن نعرف مصيره لنقرّر: نمسحه من الطابور أم
 * نُعيد المحاولة في الصفحة التالية.
 *
 * يُعيد استعمال buildBatch نفسه (الجلسة، السياق، الجهاز) فلا تنشأ نسخة
 * ثانية من منطق السياق تنحرف مع الوقت. `keepalive` يُبقي الطلب حياً حتى لو
 * غادرت الصفحة أثناءه.
 */
export async function sendAnalyticsEventsNow(
  events: Array<{ name: AnalyticsEventName; pagePath?: string } & AnalyticsEventPayload>
): Promise<boolean> {
  if (typeof window === "undefined" || typeof fetch !== "function") return false;
  if (events.length === 0) return true;

  try {
    const session = getOrCreateSession();
    const startedAt = session?.context.startedAt ?? Date.now();
    const batch = buildBatch(
      events.slice(0, MAX_EVENTS_PER_BATCH).map(({ name, pagePath, ...payload }) => ({
        name,
        pagePath: pagePath ?? nowPath(),
        sessionMs: Math.max(0, Date.now() - startedAt),
        ...payload,
      }))
    );
    if (!batch) return false;

    const response = await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true,
    });
    return response.ok;
  } catch {
    // شبكة مقطوعة أو طلب مرفوض — نُبلّغ بالفشل حتى يبقى الحدث في الطابور.
    return false;
  }
}

/** للاختبارات فقط — تفريغ الحالة بين الحالات. */
export function __resetAnalyticsQueueForTests(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  queue = [];
  listenersBound = false;
}
