import { RetryButton } from "@/components/admin/RetryButton";

/**
 * مكان القسم الذي تعذّر تحميله — لا أرقامه.
 *
 * القاعدة التي يفرضها هذا المكوّن: **لا يُعرض رقم لم يُقرأ من القاعدة.**
 * صفرٌ في مكان الربح أو عدد الطلبات يبدو معلومة وهو ليس كذلك، وصاحب
 * المتجر يقرأه ويقرّر عليه. فيحلّ محلّه هنا إقرار صريح بأن البيانات لم
 * تصل، وزرّ يُعيد المحاولة.
 */
export function SectionUnavailable({ label }: { label: string }) {
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-900">تعذّر تحميل هذه البيانات</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        {label} — لم تصل من قاعدة البيانات، ولا تُعرض هنا أرقام تقديرية. بقية الصفحة صحيحة.
      </p>
      <RetryButton />
    </div>
  );
}
