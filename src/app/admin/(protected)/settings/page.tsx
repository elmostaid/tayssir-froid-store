import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getSettings } from "@/lib/queries/settings";
import { SettingsForm } from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "الإعدادات" };

export default async function AdminSettingsPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  // قراءة مباشرة (بدون safeQuery/fallback) عمداً — هذه لوحة الإدارة، فإذا
  // تعذّر الاتصال بقاعدة البيانات يجب أن يظهر خطأ حقيقي بدل حفظ إعدادات فوق
  // قيم افتراضية قد لا تطابق ما هو محفوظ فعلاً.
  const settings = await getSettings();

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">إعدادات المتجر</h1>
      <p className="mt-1 text-xs text-neutral-500">
        كل تعديل هنا ينعكس مباشرة على الموقع العام (الترويسة، التذييل،
        الصفحة الرئيسية، صفحة المنتج، السلة، وإتمام الطلب) — مصدر واحد فقط،
        بدون الحاجة لأي تعديل فالكود.
      </p>
      <SettingsForm settings={settings} />
    </div>
  );
}
