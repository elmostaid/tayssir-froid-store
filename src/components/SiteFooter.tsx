import Image from "next/image";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getSettings } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { formatMad } from "@/lib/format";

export async function SiteFooter() {
  const whatsappLink = buildWhatsAppLink(
    "مرحباً، عندي سؤال بخصوص منتجات Tayssir Froid."
  );

  const settings = await safeQuery(
    () => getSettings(),
    {
      minOrderAmountMad: 1000,
      deliveryFeePerCartonMad: 45,
      whatsappNumber: "+212722083458",
      storeCity: "مراكش - حي المحاميد",
    },
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
          الحد الأدنى للطلبية {formatMad(settings.minOrderAmountMad)} (دون
          احتساب التوصيل). التوصيل {formatMad(settings.deliveryFeePerCartonMad)}{" "}
          لكل كرطونة، يُحدَّد عدد الكرطونات بعد تجهيز الطلب. الدفع عند
          الاستلام فقط.
        </p>
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block font-medium text-whatsapp-dark underline"
        >
          تواصل معنا عبر واتساب
        </a>
      </div>
    </footer>
  );
}
