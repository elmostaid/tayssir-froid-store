import Image from "next/image";
import { WhatsAppInquiryLink } from "@/components/WhatsAppInquiryLink";
import Link from "next/link";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { DELIVERY_AVAILABILITY, DELIVERY_COST_TIMING } from "@/lib/delivery";

export async function SiteFooter() {
  const settings = await safeQuery(
    () => getSettings(),
    FALLBACK_SETTINGS,
    "SiteFooter.getSettings"
  );


  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-neutral-600">
        <div className="flex items-center gap-2">
          <Image
            src="/brand/icon-snowflake.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span className="font-semibold text-neutral-800">Tayssir Froid</span>
        </div>
        <p className="mt-3">
          بيع قطع غيار الغسالات والثلاجات والمجمدات والمكيفات بالجملة —
          للتجار والصنايعية ومحلات قطع الغيار.
        </p>
        <p className="mt-1">{settings.storeCity}</p>
        <p className="mt-1">
          🚚 {DELIVERY_AVAILABILITY}. {DELIVERY_COST_TIMING}. الدفع عند الاستلام
          فقط.
        </p>
        <WhatsAppInquiryLink
          whatsappNumber={settings.whatsappNumber}
          message={`مرحباً، عندي سؤال بخصوص منتجات ${settings.storeName}.`}
          kind="general"
          className="mt-3 inline-block font-medium text-whatsapp-dark underline"
        >
          تواصل معنا عبر واتساب
        </WhatsAppInquiryLink>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          <Link href="/privacy" className="underline">
            سياسة الخصوصية
          </Link>
        </p>
      </div>
    </footer>
  );
}
