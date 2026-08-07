import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getOrderByPublicReference,
  getOrderItemsByPublicReference,
} from "@/lib/queries/orders";
import { formatMad } from "@/lib/format";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { ServiceUnavailable } from "@/components/ServiceUnavailable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تم استلام طلبك",
};

type Props = {
  params: Promise<{ reference: string }>;
};

export default async function OrderSuccessPage({ params }: Props) {
  const { reference } = await params;

  let order: Awaited<ReturnType<typeof getOrderByPublicReference>>;
  try {
    order = await getOrderByPublicReference(reference);
  } catch (error) {
    console.error("OrderSuccessPage: تعذّر الاتصال بقاعدة البيانات", error);
    return <ServiceUnavailable />;
  }

  if (!order) {
    notFound();
  }

  const items = await getOrderItemsByPublicReference(reference);
  const settings = await safeQuery(
    () => getSettings(),
    FALLBACK_SETTINGS,
    "orderSuccess.getSettings"
  );

  // رابط واتساب يحتوي فقط على مرجع الطلب العام، بدون أي بيانات شخصية حساسة
  const whatsappLink = buildWhatsAppLink(
    settings.whatsappNumber,
    `مرحباً، أريد الاستفسار عن طلبي رقم ${order.publicReference}.`
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-turquoise-tint text-2xl text-brand-turquoise-dark">
        ✓
      </div>
      <h1 className="mt-4 text-xl font-bold text-neutral-900">
        تم استلام طلبك بنجاح
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        رقم طلبك:{" "}
        <span className="font-mono text-base font-bold text-brand-orange">
          {order.publicReference}
        </span>
      </p>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-4 text-right">
        <h2 className="text-sm font-semibold text-neutral-800">ملخص الطلب</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-700">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between">
              <span>
                {item.productNameSnapshot} × {item.quantity}
              </span>
              <span className="font-medium">{formatMad(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-sm font-bold">
          <span>مجموع المنتجات</span>
          <span className="text-brand-orange">{formatMad(order.itemsSubtotal)}</span>
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-brand-turquoise-tint px-3 py-3 text-sm text-brand-turquoise-dark">
        هذا طلب أولي في انتظار التأكيد. سيتواصل معك فريق Tayssir Froid قريباً
        لتأكيد الطلب وتحديد عدد الكرطونات، وعندها سيُحتسب المجموع النهائي
        شاملاً مصاريف التوصيل. الدفع عند الاستلام بعد معاينة السلعة.
      </p>

      <a
        href={`/order/${order.publicReference}/receipt.pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block rounded-full border border-neutral-300 px-5 py-3 text-sm font-semibold text-neutral-700"
      >
        تحميل وصل الطلب (PDF)
      </a>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-full bg-whatsapp px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-whatsapp-dark"
        >
          تواصل معنا عبر واتساب
        </a>
        <Link
          href="/"
          className="flex-1 rounded-full border border-neutral-300 px-5 py-3 text-sm font-semibold text-neutral-700"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    </div>
  );
}
