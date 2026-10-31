import { resolveFbc } from "@/lib/pixel/fbc";
import { isAdConsentGranted } from "@/lib/privacy/consent";
import type { AttributionTouch } from "@/lib/attribution/types";
import type { CreateOrderRequestContext } from "@/lib/orders/types";
import type { CapiIdentitySnapshot } from "@/lib/pixel/sendDeferredPurchase";

/**
 * لقطة هوية متصفح **الزبون** وقت زيارته — أو لا شيء.
 *
 * مصدر واحد لثلاثة مسارات كانت ستتكرّر: طلب الموقع، وسلة واتساب (W-)،
 * والاستفسار (Q-). كلها تلتقط الهوية في اللحظة الوحيدة التي تكون فيها
 * هوية الزبون لا المدير (انظر القرار 2 في sendDeferredPurchase.ts).
 *
 * **بلا موافقة ⇒ `null`.** لا IP ولا User-Agent ولا `_fbp` ولا `fbc` تُحفظ
 * لزائر لم يوافق: ما لا يُحفظ لا يمكن أن يُرسَل خطأً لاحقاً.
 *
 * و`fbc` لا يُخترَع: كوكي `_fbc` إن وُجدت، وإلا يُبنى من `fbclid` حقيقي
 * بلحظة التقاطه الحقيقية (lib/pixel/fbc.ts) — وإلا `null`.
 */
export function capiIdentityFromRequest(
  requestContext: CreateOrderRequestContext | undefined,
  lastTouch: AttributionTouch | null
): CapiIdentitySnapshot | null {
  if (!isAdConsentGranted(requestContext?.adConsent)) return null;

  return {
    fbp: requestContext?.fbp ?? null,
    fbc:
      resolveFbc({
        cookieFbc: requestContext?.fbc,
        fbclid: lastTouch?.fbclid,
        fbclidAt: lastTouch?.at,
        host: requestContext?.eventSourceUrl,
      }) ?? null,
    fbclid: lastTouch?.fbclid ?? null,
    fbclidAt: lastTouch?.fbclid ? lastTouch.at : null,
    clientIpAddress: requestContext?.clientIpAddress ?? null,
    clientUserAgent: requestContext?.clientUserAgent ?? null,
    eventSourceUrl: requestContext?.eventSourceUrl ?? null,
  };
}
