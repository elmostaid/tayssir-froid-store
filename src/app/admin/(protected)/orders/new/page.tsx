import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ManualOrderForm } from "@/components/admin/ManualOrderForm";
import { getWhatsappLeadById } from "@/lib/queries/whatsappLeads";
import { draftFromWhatsappLead } from "@/lib/orders/whatsappLeadDraft";

export const dynamic = "force-dynamic";

export const metadata = { title: "إضافة طلب يدوي" };

type Props = {
  searchParams: Promise<{ fromLead?: string }>;
};

export default async function NewManualOrderPage({ searchParams }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  // نفس حارس الإجراء نفسه — إخفاء الصفحة ليس حماية، لكن إظهارها لمن لا
  // يملك الصلاحية إحباطٌ بلا سبب.
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const { fromLead } = await searchParams;
  const leadId = fromLead ? Number(fromLead) : null;
  const lead =
    leadId && Number.isInteger(leadId) && leadId > 0 ? await getWhatsappLeadById(leadId) : null;

  // Lead غير موجود، أو مُحوَّل مسبقاً (أو تحويله جارٍ الآن من تبويب آخر) —
  // لا داعٍ لعرض نموذج تحويل لا يصحّ إرساله؛ نعيد المدير إلى مكان مفيد.
  // convertedOrderId متوفّر فقط حين اكتمل التحويل فعلاً بربطه بطلب حقيقي.
  if (leadId && !lead) redirect("/admin/orders/whatsapp");
  if (lead && lead.status !== "whatsapp_pending") {
    redirect(lead.convertedOrderId ? `/admin/orders/${lead.convertedOrderId}` : "/admin/orders/whatsapp");
  }

  const initialDraft = lead ? await draftFromWhatsappLead(lead) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-800">
          {lead ? `تحويل طلب واتساب ${lead.reference} إلى طلب` : "إضافة طلب يدوي / طلب واتساب"}
        </h1>
        <Link
          href={lead ? "/admin/orders/whatsapp" : "/admin/orders"}
          className="min-h-9 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700"
        >
          {lead ? "رجوع لطلبات واتساب" : "رجوع للطلبات"}
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        {lead
          ? "المنتجات معبَّأة من طلب واتساب تلقائياً — أضف اسم الزبون وهاتفه ومدينته كما وصلتك في المحادثة، ثم أكّد."
          : "لتسجيل بيع وقع خارج الموقع. يدخل المبيعات والأرباح والتقارير كأي طلب، ويبقى مميَّزاً بمصدره حتى تقارن بين قنواتك — ولا يدخل قمع تحويل الموقع لأنه لم يمرّ به."}
      </p>
      <ManualOrderForm initialDraft={initialDraft} leadId={lead?.id} />
    </div>
  );
}
