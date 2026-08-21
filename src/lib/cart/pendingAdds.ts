"use client";

import { SESSION_IDLE_MINUTES } from "@/lib/analytics/session";
import { sendAnalyticsEventsNow } from "@/lib/analytics/track";
import { PENDING_ADDS_KEY, type PendingAdd } from "@/lib/cart/earlyAdd";

/**
 * تفريغ طابور الإضافات التي وقعت قبل وصول React.
 *
 * القاعدة الحاكمة: **لا نمسح إضافة من الطابور قبل أن يؤكّد الخادم استلامها.**
 * الترتيب المعاكس (امسح ثم أرسل) يبدو أنظف لكنه يفقد الحدث كلما انقطعت
 * الشبكة — وهو بالضبط حال الهاتف الضعيف الذي بُني هذا كله لأجله. فنُبقيها
 * حتى تُؤكَّد، وتُعيد المحاولة أول صفحة يكتمل ترطيبها.
 *
 * المقايضة معروفة ومقصودة: لو مات الاتصال **بعد** أن كتب الخادم الصف وقبل
 * أن تصل الاستجابة، ستُعاد المحاولة فيتكرّر الحدث. اخترنا هذا الاحتمال
 * النادر على احتمال الضياع المتكرّر، لأن جدول القياس لا يحمل مفتاحاً
 * لإزالة التكرار من جهة الخادم، وإضافة عمود إليه تغييرٌ في قاعدة إنتاج
 * حيّة لا يستحقّه فرقٌ بهذا الحجم.
 *
 * وما شاخ أكثر من عمر الجلسة يُسقَط: نسبته إلى جلسة أخرى لاحقة كذبٌ أسوأ
 * من إسقاطه، وهو أيضاً ما يمنع الطابور من التورّم إن بقيت الشبكة مقطوعة.
 */

let inFlight = false;

function read(): PendingAdd[] {
  try {
    const raw = window.localStorage.getItem(PENDING_ADDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: PendingAdd[]): void {
  try {
    if (items.length === 0) window.localStorage.removeItem(PENDING_ADDS_KEY);
    else window.localStorage.setItem(PENDING_ADDS_KEY, JSON.stringify(items));
  } catch {
    // تخزين ممتلئ أو محظور — لا شيء نفعله، والقياس لا يُسقط صفحة أبداً.
  }
}

function isUsable(add: PendingAdd, oldest: number): boolean {
  return Boolean(add) && typeof add.id === "string" && typeof add.at === "number" && add.at >= oldest;
}

export async function flushPendingEarlyAdds(): Promise<void> {
  if (typeof window === "undefined" || inFlight) return;

  const oldest = Date.now() - SESSION_IDLE_MINUTES * 60_000;
  const fresh = read().filter((add) => isUsable(add, oldest));
  if (fresh.length === 0) {
    write([]);
    return;
  }

  inFlight = true;
  try {
    const delivered = await sendAnalyticsEventsNow(
      fresh.map(({ productId, sku, quantity, cartValue }) => ({
        name: "add_to_cart" as const,
        productId,
        sku,
        quantity,
        cartValue,
      }))
    );

    // نُعيد القراءة لا نكتب `fresh`: قد تكون ضغطة جديدة دخلت الطابور أثناء
    // الرحلة إلى الخادم، ولا يصحّ أن تُمحى مع ما أُكِّد وصوله.
    const sentIds = new Set(fresh.map((add) => add.id));
    const remaining = read().filter(
      (add) => isUsable(add, oldest) && !(delivered && sentIds.has(add.id))
    );
    write(remaining);
  } finally {
    inFlight = false;
  }
}

/** للاختبارات فقط. */
export function __resetPendingFlushForTests(): void {
  inFlight = false;
}
