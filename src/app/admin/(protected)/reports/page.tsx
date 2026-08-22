import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import {
  getProfitSummary,
  getSalesBySource,
  getDeliveredOrdersProfitBreakdown,
  getBestSellingProducts,
} from "@/lib/queries/adminReports";
import { getDashboardOrderStats } from "@/lib/queries/adminOrders";
import { formatMad } from "@/lib/format";
import Link from "next/link";
import { RANGE_LABELS, RANGE_PRESETS, resolveRange } from "@/lib/analytics/dateRange";
import {
  isOrderSource,
  ORDER_SOURCES,
  ORDER_SOURCE_BADGE_CLASSES,
  ORDER_SOURCE_LABELS,
  orderSourceLabel,
} from "@/lib/orders/orderSource";

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

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; source?: string }>;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const params = await searchParams;
  const range = resolveRange(params.range, params.from, params.to);
  const source = isOrderSource(params.source) ? params.source : null;

  // خمسة استعلامات متوازية لا ستة: مجمّع الاتصالات محدود بـmax 5 (انظر
  // db.ts)، وإضافة سادس إلى نفس الدفعة جعلت هذه الصفحة تتعثّر على Preview
  // بينما كانت تُفتح في أقل من ثانية بدونه. التفصيل حسب المصدر يأتي بعدها
  // بترتيب متسلسل — كلفته أجزاء من الثانية، مقابل صفحة لا تتعثّر.
  const [salesStats, profit, recentDelivered, bestByQuantity, bestByValue] = await Promise.all([
    getDashboardOrderStats(),
    getProfitSummary(),
    getDeliveredOrdersProfitBreakdown(10),
    getBestSellingProducts("quantity", 5),
    getBestSellingProducts("value", 5),
  ]);

  // وحتى لو تعثّر هذا الاستعلام وحده، تبقى بقية الصفحة كما هي بدل أن تسقط
  // كلها — نفس ما تفعله بقية صفحات الإدارة عبر safeQuery.
  const bySourceResult = await getSalesBySource(range, source).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      console.error("adminReports.getSalesBySource: تعذّر التفصيل حسب المصدر", error);
      return { ok: false as const };
    }
  );

  const bySource = bySourceResult.ok
    ? bySourceResult.value
    : {
        rows: [],
        totals: {
          deliveredOrders: 0,
          revenueMad: 0,
          deliveryFeesMad: 0,
          cogsMad: 0,
          grossProfitMad: 0,
          ordersWithMissingCost: 0,
          pendingOrders: 0,
          pendingRevenueMad: 0,
        },
      };
  const websiteRow = bySource.rows.find((row) => row.source === "website");
  const manualRevenue = bySource.rows
    .filter((row) => row.source !== "website")
    .reduce((sum, row) => sum + row.revenueMad, 0);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">التقارير والأرباح</h1>

      <h2 className="mt-4 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        المبيعات (طلبات غير ملغاة وغير راجعة) — مجموع المنتجات بلا توصيل
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="مبيعات اليوم (المنتجات)" value={formatMad(salesStats.salesTodayMad)} />
        <StatCard label="مبيعات 7 أيام (المنتجات)" value={formatMad(salesStats.sales7DaysMad)} />
        <StatCard label="مبيعات الشهر (المنتجات)" value={formatMad(salesStats.salesThisMonthMad)} />
      </div>

      <h2 className="mt-6 border-r-4 border-brand-orange pr-3 text-base font-bold text-neutral-800">
        المبيعات والأرباح حسب المصدر
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        الأرقام هنا من الطلبات <span className="font-semibold">المسلَّمة</span> داخل المدى
        المختار — نفس أساس بقية هذه الصفحة، ولنفس السبب: الدفع عند الاستلام، فالبيع لا يصير مالاً
        إلا بالتسليم. طلب واتساب يُسجَّل «مؤكَّد»، فلا يدخل الربح حتى تُعلن تسليمه.
      </p>

      {/* فلاتر: نموذج GET عادي بلا JavaScript. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {RANGE_PRESETS.filter((preset) => preset !== "custom").map((preset) => (
          <Link
            key={preset}
            href={`/admin/reports?range=${preset}${source ? `&source=${source}` : ""}`}
            className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              range.preset === preset
                ? "border-brand-turquoise bg-brand-turquoise-tint text-brand-turquoise-dark"
                : "border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {RANGE_LABELS[preset]}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href={`/admin/reports?range=${range.preset}`}
          className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            source === null
              ? "border-brand-orange bg-brand-orange-tint text-brand-orange"
              : "border-neutral-200 bg-white text-neutral-700"
          }`}
        >
          كل المصادر
        </Link>
        {ORDER_SOURCES.map((value) => (
          <Link
            key={value}
            href={`/admin/reports?range=${range.preset}&source=${value}`}
            className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              source === value
                ? "border-brand-orange bg-brand-orange-tint text-brand-orange"
                : "border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {ORDER_SOURCE_LABELS[value]}
          </Link>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="مبيعات الموقع (المنتجات)" value={formatMad(websiteRow?.revenueMad ?? 0)} />
        <StatCard label="مبيعات واتساب/يدوية (المنتجات)" value={formatMad(manualRevenue)} />
        <StatCard label="مبيعات المنتجات إجمالاً" value={formatMad(bySource.totals.revenueMad)} accent />
        <StatCard label="تكلفة البضاعة" value={formatMad(bySource.totals.cogsMad)} />
        <StatCard label="الربح الخام" value={formatMad(bySource.totals.grossProfitMad)} accent />
        <StatCard label="مصاريف التوصيل المحصَّلة" value={formatMad(bySource.totals.deliveryFeesMad)} />
      </div>

      {!bySourceResult.ok && (
        <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          تعذّر حساب التفصيل حسب المصدر الآن. بقية أرقام الصفحة صحيحة — حدّث الصفحة بعد قليل.
        </p>
      )}

      {bySource.rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-xs text-neutral-500">
          لا توجد طلبات في هذا المدى.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-600">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">المصدر</th>
                <th className="px-3 py-2 text-right font-semibold">طلبات مسلَّمة</th>
                <th className="px-3 py-2 text-right font-semibold">المبيعات</th>
                <th className="px-3 py-2 text-right font-semibold">التكلفة</th>
                <th className="px-3 py-2 text-right font-semibold">الربح الخام</th>
                <th className="px-3 py-2 text-right font-semibold">التوصيل المحصَّل</th>
                <th className="px-3 py-2 text-right font-semibold">لم تُسلَّم بعد</th>
              </tr>
            </thead>
            <tbody>
              {bySource.rows.map((row) => (
                <tr key={row.source} className="border-t border-neutral-100">
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        ORDER_SOURCE_BADGE_CLASSES[
                          row.source as keyof typeof ORDER_SOURCE_BADGE_CLASSES
                        ] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {orderSourceLabel(row.source)}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.deliveredOrders}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold">{formatMad(row.revenueMad)}</td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">{formatMad(row.cogsMad)}</td>
                  <td className="px-3 py-2 tabular-nums font-bold text-brand-turquoise-dark">
                    {formatMad(row.grossProfitMad)}
                    {row.ordersWithMissingCost > 0 && (
                      <span className="mr-1 text-[11px] font-normal text-amber-700">
                        ({row.ordersWithMissingCost} بلا تكلفة)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">
                    {formatMad(row.deliveryFeesMad)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">
                    {row.pendingOrders > 0
                      ? `${row.pendingOrders} · ${formatMad(row.pendingRevenueMad)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
        <span className="font-semibold text-neutral-600">عن التوصيل:</span> العمود أعلاه هو ما
        دفعه الزبون، لا ما كلّفنا. قاعدة البيانات لا تحمل تكلفة توصيل فعلية، فلا يمكن حساب «ربح
        نهائي بعد التوصيل» بصدق — ولذلك لا يُطرَح ولا يُجمَع في الربح.
        {bySource.totals.ordersWithMissingCost > 0 && (
          <>
            {" "}
            و<span className="font-semibold text-amber-700">
              {bySource.totals.ordersWithMissingCost} طلباً
            </span>{" "}
            ينقص أحد سطوره ثمن الشراء، فيُحتسَب بصفر ويبدو ربحه كامل ثمن البيع. لا نُخمّن ثمناً غير
            مسجَّل.
          </>
        )}
      </p>

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
