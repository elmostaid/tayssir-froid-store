import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getWhatsappLeadById } from "@/lib/queries/whatsappLeads";
import { formatMad } from "@/lib/format";
import { ORDER_SOURCE_BADGE_CLASSES } from "@/lib/orders/orderSource";

export const dynamic = "force-dynamic";

export const metadata = { title: "تفاصيل طلب واتساب" };

const STATUS_LABELS = {
  whatsapp_pending: "بانتظار بيانات الزبون",
  converted: "تحوَّل إلى طلب",
  abandoned: "متروك",
} as const;

type Props = { params: Promise<{ id: string }> };

export default async function WhatsappLeadDetailPage({ params }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) notFound();

  const lead = await getWhatsappLeadById(leadId);
  if (!lead) notFound();

  const owner = isOwnerAdmin(admin);

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-800">
          <span dir="ltr">{lead.reference}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_SOURCE_BADGE_CLASSES.whatsapp}`}
          >
            واتساب
          </span>
        </h1>
        <Link
          href="/admin/orders/whatsapp"
          className="min-h-9 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700"
        >
          رجوع لطلبات واتساب
        </Link>
      </div>

      <p className="mt-1 text-sm text-neutral-600">
        الحالة: <span className="font-semibold">{STATUS_LABELS[lead.status]}</span>
        {" · "}
        {new Date(lead.createdAt).toLocaleString("ar-MA")}
      </p>

      {lead.convertedOrderId && (
        <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
          تحوَّل هذا الطلب إلى{" "}
          <Link href={`/admin/orders/${lead.convertedOrderId}`} className="underline">
            الطلب رقم #{lead.convertedOrderId}
          </Link>
        </p>
      )}

      <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">المنتجات</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {lead.items.map((item, index) => (
            <li key={`${item.productId ?? "?"}-${item.variantId ?? ""}-${index}`} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-neutral-800">{item.name}</p>
                <p dir="ltr" className="text-xs text-neutral-500">
                  {item.sku} × {item.quantity}
                </p>
              </div>
              <span className="shrink-0 font-medium text-neutral-800">
                {formatMad(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-base font-bold">
          <span>المجموع</span>
          <span className="text-brand-orange">{formatMad(Number(lead.itemsSubtotal))}</span>
        </div>
      </section>

      {owner && lead.status === "whatsapp_pending" && (
        <Link
          href={`/admin/orders/new?fromLead=${lead.id}`}
          className="mt-4 block min-h-11 rounded-full bg-brand-orange px-5 py-3 text-center text-sm font-semibold text-white"
        >
          تحويل إلى طلب
        </Link>
      )}
    </div>
  );
}
