import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ManualOrderForm } from "@/components/admin/ManualOrderForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "إضافة طلب يدوي" };

export default async function NewManualOrderPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  // نفس حارس الإجراء نفسه — إخفاء الصفحة ليس حماية، لكن إظهارها لمن لا
  // يملك الصلاحية إحباطٌ بلا سبب.
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-800">إضافة طلب يدوي / طلب واتساب</h1>
        <Link
          href="/admin/orders"
          className="min-h-9 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700"
        >
          رجوع للطلبات
        </Link>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        لتسجيل بيع وقع خارج الموقع. يدخل المبيعات والأرباح والتقارير كأي طلب، ويبقى مميَّزاً بمصدره
        حتى تقارن بين قنواتك — ولا يدخل قمع تحويل الموقع لأنه لم يمرّ به.
      </p>
      <ManualOrderForm />
    </div>
  );
}
