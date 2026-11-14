import type { AttributionTouch, OrderAttribution } from "@/lib/attribution/types";
import { isAdTrackingAllowed, type AdConsent } from "@/lib/privacy/consent";

/**
 * ما يُحفظ من الإسناد حسب الموافقة.
 *
 * وسوم UTM والصفحة والإحالة إحصاءٌ مجمَّع لا يُعرّف شخصاً — تبقى دائماً،
 * وعليها يقوم قياس الحملات الداخلي. أما `fbclid`/`gclid`/`ttclid` فمُعرّفات
 * نقرة شخصية تقرأها منصّات الإشهار: لا تُخزَّن على الخادم بلا موافقة.
 */
export const CLICK_ID_KEYS = ["fbclid", "gclid", "ttclid"] as const;

function stripTouch(touch: AttributionTouch | null): AttributionTouch | null {
  if (!touch) return null;
  return { ...touch, fbclid: null, gclid: null, ttclid: null };
}

export function attributionForConsent(
  attribution: OrderAttribution | null,
  consent: AdConsent
): OrderAttribution | null {
  if (!attribution || isAdTrackingAllowed(consent)) return attribution;
  return { first: stripTouch(attribution.first), last: stripTouch(attribution.last) };
}
