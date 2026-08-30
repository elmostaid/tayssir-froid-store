"use client";

import { useEffect } from "react";
import { captureAttribution } from "@/lib/attribution/capture";

/**
 * يُثبّت مصدر الزائر عند كل تحميل صفحة.
 *
 * مكوّن منفصل تماماً عن AnalyticsClient وMetaPixel وGoogleAnalytics ولا
 * يستورد شيئاً منها: النسب مسار مستقل، فتعطّله لا يمسّ أي قياس آخر ولا العكس.
 * لا يعرض شيئاً ولا يؤثّر على التخطيط.
 */
export function AttributionTracker() {
  useEffect(() => {
    captureAttribution();
  }, []);

  return null;
}
