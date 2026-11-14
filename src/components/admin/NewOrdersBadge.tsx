import { cache } from "react";
import { countNewOrders } from "@/lib/queries/adminOrders";

/**
 * عدّاد الطلبات الجديدة — خارج المسار الحرج للتصيير.
 *
 * كان هذا الاستعلام يُنتظَر داخل AdminShell، فلا يظهر أي شيء من لوحة
 * الإدارة حتى يعود. وهو يُصيَّر بالتوازي مع الصفحة، فكان يُضاف إلى
 * استعلاماتها في نفس اللحظة: خمسة من الصفحة + هذا = ستة على مجمّع سعته
 * خمسة (راجع lib/admin/sectionData.ts).
 *
 * صار الآن مكوّن خادم مستقلّاً داخل `<Suspense>`: الهيكل والقائمة تُرسَل
 * فوراً، والشارة تلحق حين تصل. وإن لم تصل — قاعدة بطيئة أو اتصال متعذّر —
 * لا تظهر شارة ولا تسقط اللوحة، وهو السلوك الصحيح: شارةٌ غائبة أهون من
 * لوحة لا تُفتح، و«0» زائفة غير واردة أصلاً لأن الغياب هنا لا يُعرض رقماً.
 *
 * و`cache` يجعل النسختين (أيقونة القائمة وسطر «الطلبات» داخلها) تقرآن
 * نتيجة استعلام واحد لا اثنين.
 */
const loadCount = cache(async (): Promise<number | null> => {
  try {
    return await countNewOrders();
  } catch (error) {
    console.error("NewOrdersBadge.countNewOrders: تعذّر عدّ الطلبات الجديدة", error);
    return null;
  }
});

export async function NewOrdersIconBadge() {
  const count = await loadCount();
  if (count === null || count <= 0) return null;
  return (
    <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-orange px-0.5 text-[10px] font-bold text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

export async function NewOrdersMenuBadge() {
  const count = await loadCount();
  if (count === null || count <= 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-orange px-1 text-xs font-semibold text-white">
      {count}
    </span>
  );
}
