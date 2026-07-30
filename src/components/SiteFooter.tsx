import Image from "next/image";
import { buildWhatsAppLink } from "@/lib/whatsapp";

export function SiteFooter() {
  const whatsappLink = buildWhatsAppLink(
    "مرحباً، عندي سؤال بخصوص منتجات Tayssir Froid."
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
        <p className="mt-1">مراكش، حي المحاميد</p>
        <p className="mt-1">
          الحد الأدنى للطلبية 1000 درهم. التوصيل 45 درهماً لكل كرطونة. الدفع
          عند الاستلام.
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
