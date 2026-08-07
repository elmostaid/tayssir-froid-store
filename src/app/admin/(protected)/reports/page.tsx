import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import {
  getProfitSummary,
  getDeliveredOrdersProfitBreakdown,
  getBestSellingProducts,
} from "@/lib/queries/adminReports";
import { getDashboardOrderStats } from "@/lib/queries/adminOrders";
import { formatMad } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "التقارير والأرباح" };

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ? "text-brand-orange" : "text-neutral-800"}`}>
        {value}
      </p>
    </div>
  );
}

export default async function AdminReportsPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  const [salesStats, profit, recentDelivered, bestByQuantity, bestByValue] = await Promise.all([
    getDashboardOrderStats(),
    getProfitSummary(),
    getDeliveredOrdersProfitBreakdown(10),
    getBestSellingProducts("quantity", 5),
    getBestSellingProducts("value", 5),
  ]);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">التقارير والأرباح</h1>

      <h2 className="mt-4 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        المبيعات (طلبات غير ملغاة وغير راجعة)
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="مبيعات اليوم" value={formatMad(salesStats.salesTodayMad)} />
        <StatCard label="مبيعات آخر 7 أيام" value={formatMad(salesStats.sales7DaysMad)} />
        <StatCard label="مبيعات الشهر الحالي" value={formatMad(salesStats.salesThisMonthMad)} />
      </div>

      <h2 className="mt-6 border-r-4 border-brand-orange pr-3 text-base font-bold text-neutral-800">
        الطلبات المسلَّمة فعلياً (منفصلة عن المبيعات أعلاه)
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        القيمة هنا تشمل فقط الطلبات بحالة &quot;تم التسليم&quot; — وليست كل
        الطلبات النشطة كما فقسم المبيعات أعلاه، ولا تشمل الملغى أو الراجع
        إطلاقاً.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="عدد المسلَّمة" value={String(profit.deliveredOrdersCount)} />
        <StatCard label="قيمة المسلَّمة" value={formatMad(profit.deliveredRevenueMad)} accent />
        <StatCard label="عدد الملغاة" value={String(profit.cancelledOrdersCount)} />
        <StatCard label="عدد الراجعة" value={String(profit.returnedOrdersCount)} />
      </div>

      <h2 className="mt-6 border-r-4 border-brand-orange pr-3 text-base font-bold text-neutral-800">
        الربح الإجمالي (طلبات مسلَّمة فقط)
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        الربح = قيمة المنتجات (items_subtotal) − تكلفة الشراء المحفوظة وقت
        إنشاء كل طلب (purchase price snapshot × الكمية)، بدون احتساب مصاريف
        التوصيل. ربح الطلب لا يتغيّر بعد ذلك حتى لو عُدِّل ثمن شراء المنتج
        لاحقاً.
      </p>
      {profit.approximateProfitOrdersCount > 0 && (
        <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {profit.approximateProfitOrdersCount} من الطلبات المسلَّمة أُنشئت
          قبل حفظ ثمن الشراء لحظياً — ربحها هنا تقدير تاريخي بثمن الشراء
          الحالي فقط، وقد يتغيّر إذا عُدِّل ثمن الشراء لاحقاً (موسومة
          &quot;تقدير&quot; فـجدول آخر الطلبات أسفله).
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="ربح اليوم" value={formatMad(profit.profitTodayMad)} accent />
        <StatCard label="ربح آخر 7 أيام" value={formatMad(profit.profitLast7DaysMad)} accent />
        <StatCard label="ربح الشهر الحالي" value={formatMad(profit.profitThisMonthMad)} accent />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatCard label="تكلفة الشراء الإجمالية (COGS)" value={formatMad(profit.cogsMad)} />
        <StatCard label="الربح الإجمالي الكلي" value={formatMad(profit.grossProfitMad)} accent />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h2 className="border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
            الأكثر مبيعاً بالكمية
          </h2>
          {bestByQuantity.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">لا توجد طلبات مسلَّمة بعد.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {bestByQuantity.map((p) => (
                <div
                  key={p.sku}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800">{p.name}</p>
                    <p className="text-xs text-neutral-500" dir="ltr">{p.sku}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-neutral-800">
                    {p.totalQuantity} قطعة
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
            الأكثر مبيعاً بالقيمة
          </h2>
          {bestByValue.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">لا توجد طلبات مسلَّمة بعد.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {bestByValue.map((p) => (
                <div
                  key={p.sku}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800">{p.name}</p>
                    <p className="text-xs text-neutral-500" dir="ltr">{p.sku}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-brand-orange">
                    {formatMad(p.totalValueMad)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <h2 className="mt-6 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        ربح آخر الطلبات المسلَّمة
      </h2>
      {recentDelivered.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">لا توجد طلبات مسلَّمة بعد.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[500px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-right text-xs text-neutral-500">
                <th className="pb-2 font-medium">رقم الطلب</th>
                <th className="pb-2 font-medium">التاريخ</th>
                <th className="pb-2 font-medium">المبيعات</th>
                <th className="pb-2 font-medium">التكلفة</th>
                <th className="pb-2 font-medium">الربح</th>
              </tr>
            </thead>
            <tbody>
              {recentDelivered.map((o) => (
                <tr key={o.orderId} className="border-b border-neutral-100">
                  <td dir="ltr" className="py-2 text-right font-mono text-xs">{o.orderNumber}</td>
                  <td className="py-2">{new Date(o.createdAt).toLocaleDateString("ar-MA")}</td>
                  <td className="py-2">{formatMad(o.revenueMad)}</td>
                  <td className="py-2 text-neutral-500">{formatMad(o.cogsMad)}</td>
                  <td className="py-2 font-bold text-brand-orange">
                    {formatMad(o.profitMad)}
                    {!o.isExactHistoricalProfit && (
                      <span className="ms-1.5 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">
                        تقدير
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
