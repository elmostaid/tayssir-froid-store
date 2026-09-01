import type { AnalyticsSessionContext } from "@/lib/analytics/events";

/**
 * قراءة سياق الجلسة من نص الكوكي — بلا `document` وبلا قاعدة بيانات، حتى
 * يستعملها الطرفان: المتصفح (session.ts) والخادم حين يكتب حدث الشراء بنفسه.
 *
 * القيمة كتبها المتصفح، فهي غير موثوقة بالضرورة: أي شكل غير متوقّع يُرجع
 * null بدل استثناء، والحقول الناقصة تصير null بدل undefined حتى تدخل أعمدة
 * القاعدة كما هي.
 */
export function parseSessionContextJson(raw: string | null | undefined): AnalyticsSessionContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalyticsSessionContext>;
    if (typeof parsed.landingPath !== "string" || typeof parsed.startedAt !== "number") {
      return null;
    }
    return {
      landingPath: parsed.landingPath,
      referrerHost: parsed.referrerHost ?? null,
      utmSource: parsed.utmSource ?? null,
      utmMedium: parsed.utmMedium ?? null,
      utmCampaign: parsed.utmCampaign ?? null,
      utmContent: parsed.utmContent ?? null,
      utmTerm: parsed.utmTerm ?? null,
      hasClickId: Boolean(parsed.hasClickId),
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}
