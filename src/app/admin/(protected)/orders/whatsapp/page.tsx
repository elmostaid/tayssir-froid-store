import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { listWhatsappLeads, type WhatsappLeadStatus } from "@/lib/queries/whatsappLeads";
import { formatMad } from "@/lib/format";
import { ORDER_SOURCE_BADGE_CLASSES } from "@/lib/orders/orderSource";

export const dynamic = "force-dynamic";

export const metadata = { title: "طلبات واتساب" };

const STATUS_LABELS: Record<WhatsappLeadStatus, string> = {
  whatsapp_pending: "بانتظار بيانات الزبون",
  converted: "تحوَّل إلى طلب",
  abandoned: "متروك",
};

const STATUS_BADGE_CLASSES: Record<WhatsappLeadStatus, string> = {
  whatsapp_pending: "bg-amber-100 text-amber-700",
  converted: "bg-green-100 text-green-700",
  abandoned: "bg-neutral-100 text-neutral-600",
};

type Props = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * سلات "أكمل الطلب عبر واتساب" التي وصلت قبل أن يُكمل الزبون بياناته —
 * كانت تضيع بالكامل دون أن تظهر هنا إطلاقاً (انظر lib/orders/createWhatsappLead.ts).
 * قسم منفصل عن /admin/orders عمداً: هذه ليست طلبات TF بعد، ولا يصحّ خلطها
 * بقائمة طلبات حقيقية بحالات ومخزون محجوز.
 */
export default async function WhatsappLeadsPage({ searchParams }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  const { status } = await searchParams;
  const validStatus =
    status === "whatsapp_pending" || status === "converted" || status === "abandoned"
      ? status
      : undefined;

  const leads = await listWhatsappLeads({ status: validStatus });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-800">طلبات واتساب</h1>
        <Link
          href="/admin/orders"
          className="min-h-9 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700"
        >
          رجوع للطلبات
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        سلات ضغط عليها زبون زرّ &quot;أكمل الطلب عبر واتساب&quot; قبل أن يُكمل اسمه وهاتفه ومدينته في
        المحادثة. ليست طلبات TF بعد — لا حجز مخزون ولا Purchase — حتى تُحوَّل يدوياً إلى طلب.
      </p>

      <form action="/admin/orders/whatsapp" method="GET" className="mt-4 flex flex-wrap gap-2">
        <select
          name="status"
          defaultValue={validStatus ?? ""}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">كل الحالات</option>
          {(Object.keys(STATUS_LABELS) as WhatsappLeadStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white"
        >
          فلترة
        </button>
      </form>

      <p className="mt-3 text-sm text-neutral-500">{leads.length} سلة</p>

      {leads.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">لا توجد سلات واتساب مطابقة.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {leads.map((lead) => (
            <Link
              key={lead.id}
              href={`/admin/orders/whatsapp/${lead.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm font-semibold text-neutral-800">
                    {lead.reference}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_SOURCE_BADGE_CLASSES.whatsapp}`}
                  >
                    واتساب
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_CLASSES[lead.status]}`}
                  >
                    {STATUS_LABELS[lead.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  {lead.itemCount} منتجاً
                  {lead.convertedOrderId && (
                    <>
                      {" "}
                      · حُوِّل إلى الطلب رقم{" "}
                      <span dir="ltr" className="font-mono">
                        #{lead.convertedOrderId}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="shrink-0 text-left text-sm font-semibold text-neutral-800">
                {formatMad(Number(lead.itemsSubtotal))}
                <p className="text-xs font-normal text-neutral-500">
                  {new Date(lead.createdAt).toLocaleString("ar-MA")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
