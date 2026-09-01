import { headers, cookies } from "next/headers";
import { SESSION_COOKIE, CONTEXT_COOKIE } from "@/lib/analytics/session";
import { parseSessionContextJson } from "@/lib/analytics/sessionContext";
import { GA_MEASUREMENT_ID } from "@/lib/analytics/config";
import type { CreateOrderRequestContext } from "@/lib/orders/types";

/**
 * سياق الطلب كما يُقرأ من ترويسات المتصفح وكوكيّاته.
 *
 * كان هذا الكود مكرَّراً حرفياً في `/api/orders` و`checkout/actions.ts`.
 * توحيده هنا ليس ترتيباً تجميلياً: صار يقرأ أيضاً كوكي القياس الداخلي
 * وكوكيّي GA4، ونسخة واحدة تتخلّف عن الأخرى تعني طلبات تُنشأ بسياق ناقص
 * حسب المسار الذي دخلت منه — وهو بالضبط نوع الخلل الذي نُصلحه هنا.
 *
 * كل شيء هنا "أفضل مجهود": أي فشل يُنتج undefined بلا استثناء، ولا يؤثّر
 * إطلاقاً على إنشاء الطلب نفسه.
 */

/**
 * كوكي جلسة GA4 لهذه الخاصية. اسمها مشتق من معرّف القياس نفسه
 * (`G-SEJZVX93W4` ← `_ga_SEJZVX93W4`)، فلا يمكن أن تفترق عنه.
 */
export const GA_SESSION_COOKIE = `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, "")}`;

/**
 * `client_id` كما يفهمه GA4، من كوكي `_ga`.
 *
 * شكلها `GA1.1.1234567890.1700000000`، والمُعرّف هو المقطعان الأخيران معاً.
 * أي شكل آخر يعني كوكي لا نعرفها — نُرجع null بدل تخمين مُعرّف خاطئ يفتح
 * جلسة وهمية في GA4.
 */
export function gaClientIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 4) return null;
  const clientId = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return /^\d+\.\d+$/.test(clientId) ? clientId : null;
}

/**
 * `session_id` من كوكي `_ga_<container>`، شكلها `GS1.1.<session_id>.<n>...`.
 *
 * بدونها يصل الشراء إلى GA4 كجلسة جديدة منفصلة، فينكسر ربطه بالحملة التي
 * جاءت بالزبون — وهذا يُفسد النسب بدل أن يُصلحه. لذلك نقرأها ونمرّرها.
 */
export function gaSessionIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const parts = raw.split(".");
  const candidate = parts[2];
  return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

export async function readOrderRequestContext(): Promise<
  CreateOrderRequestContext | undefined
> {
  try {
    const headerList = await headers();
    const cookieStore = await cookies();
    const forwardedFor = headerList.get("x-forwarded-for");

    return {
      clientIpAddress:
        forwardedFor?.split(",")[0]?.trim() || headerList.get("x-real-ip") || undefined,
      clientUserAgent: headerList.get("user-agent") || undefined,
      fbp: cookieStore.get("_fbp")?.value,
      fbc: cookieStore.get("_fbc")?.value,
      eventSourceUrl: headerList.get("referer") || undefined,
      analyticsSessionId: cookieStore.get(SESSION_COOKIE)?.value,
      analyticsContext:
        parseSessionContextJson(cookieStore.get(CONTEXT_COOKIE)?.value) ?? undefined,
      gaClientId: gaClientIdFromCookie(cookieStore.get("_ga")?.value) ?? undefined,
      gaSessionId: gaSessionIdFromCookie(cookieStore.get(GA_SESSION_COOKIE)?.value) ?? undefined,
    };
  } catch {
    return undefined;
  }
}
