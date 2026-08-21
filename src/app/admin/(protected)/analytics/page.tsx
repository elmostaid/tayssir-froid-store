import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import {
  getAnalyticsByBrowser,
  getAnalyticsByDevice,
  getAnalyticsDaily,
  getAnalyticsSources,
  getAnalyticsTotals,
  getOrdersDaily,
  getOrdersTotals,
  rate,
} from "@/lib/queries/adminAnalytics";
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  resolveRange,
  type RangePreset,
} from "@/lib/analytics/dateRange";

export const dynamic = "force-dynamic";

export const metadata = { title: "تحليلات الزوّار" };

const BROWSER_LABELS: Record<string, string> = {
  fb_inapp: "متصفح فيسبوك الداخلي",
  ig_inapp: "متصفح إنستغرام الداخلي",
  chrome: "Chrome",
  safari: "Safari",
  firefox: "Firefox",
  samsung: "Samsung Internet",
  edge: "Edge",
  opera: "Opera",
  other: "أخرى",
};

const DEVICE_LABELS: Record<string, string> = {
  mobile: "هاتف",
  tablet: "لوحي",
  desktop: "حاسوب",
};

function pct(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function num(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * بطاقة رقم. `hint` هو ما يمنع الالتباس الأهم في اللوحة كلها: كل بطاقة
 * تُصرّح هل رقمها أحداث أم أشخاص.
 */
function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "orange" | "turquoise";
}) {
  const color =
    accent === "orange"
      ? "text-brand-orange"
      : accent === "turquoise"
        ? "text-brand-turquoise-dark"
        : "text-neutral-800";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-xs leading-snug text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">{hint}</p>}
    </div>
  );
}

function FunnelStep({
  label,
  value,
  fromPrevious,
  fromSessions,
  width,
}: {
  label: string;
  value: number;
  fromPrevious: number | null;
  fromSessions: number;
  width: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-neutral-800">{label}</span>
        <span className="tabular-nums font-bold text-neutral-800">{num(value)}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-brand-turquoise"
          style={{ width: `${Math.max(width, value > 0 ? 2 : 0)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-neutral-500">
        <span>{fromPrevious === null ? "نقطة البداية" : `${pct(fromPrevious)} من المرحلة السابقة`}</span>
        <span>{pct(fromSessions)} من الزوّار</span>
      </div>
    </div>
  );
}

function RangePicker({
  preset,
  fromDay,
  toDay,
}: {
  preset: RangePreset;
  fromDay: string;
  toDay: string;
}) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {RANGE_PRESETS.filter((p) => p !== "custom").map((p) => (
          <Link
            key={p}
            href={`/admin/analytics?range=${p}`}
            className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === p
                ? "border-brand-turquoise bg-brand-turquoise-tint text-brand-turquoise-dark"
                : "border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {RANGE_LABELS[p]}
          </Link>
        ))}
      </div>

      {/* نموذج GET عادي بلا أي JavaScript — أخفّ شيء ممكن، ويشتغل على أي هاتف. */}
      <form
        action="/admin/analytics"
        method="GET"
        className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3"
      >
        <input type="hidden" name="range" value="custom" />
        <label className="text-xs text-neutral-600">
          <span className="mb-1 block">من</span>
          <input
            type="date"
            name="from"
            defaultValue={fromDay}
            className="min-h-10 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-neutral-600">
          <span className="mb-1 block">إلى</span>
          <input
            type="date"
            name="to"
            defaultValue={toDay}
            className="min-h-10 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="min-h-10 rounded-full bg-brand-turquoise px-4 text-sm font-semibold text-white"
        >
          عرض
        </button>
      </form>
    </div>
  );
}

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mt-7">
      <h2 className="border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        {children}
      </h2>
      {note && <p className="mt-1 text-xs text-neutral-500">{note}</p>}
    </div>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  // أرقام مبيعات وإيراد — مقصورة على صاحب الحساب، كصفحة التقارير بالضبط.
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const { range: rangeParam, from, to } = await searchParams;
  const range = resolveRange(rangeParam, from, to);

  const [totals, orders, daily, ordersDaily, sources, devices, browsers] = await Promise.all([
    getAnalyticsTotals(range),
    getOrdersTotals(range),
    getAnalyticsDaily(range),
    getOrdersDaily(range),
    getAnalyticsSources(range),
    getAnalyticsByDevice(range),
    getAnalyticsByBrowser(range),
  ]);

  const ordersByDay = new Map(ordersDaily.map((row) => [row.day, row]));
  const days = [...new Set([...daily.map((d) => d.day), ...ordersDaily.map((d) => d.day)])].sort(
    (a, b) => (a < b ? 1 : -1)
  );

  const aov = orders.orders > 0 ? orders.revenueMad / orders.orders : 0;
  const conversion = rate(orders.orders, totals.sessions);
  const purchaseGap = orders.orders - totals.purchaseEvents;
  const isEmpty = totals.sessions === 0 && orders.orders === 0;

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">تحليلات الزوّار</h1>
      <p className="mt-1 text-xs text-neutral-500">
        قياس داخلي مجهول — يعدّ الأشخاص لا الأحداث فقط. التوقيت بتوقيت المغرب.
      </p>

      <RangePicker preset={range.preset} fromDay={range.fromDay} toDay={range.toDay} />

      <p className="mt-2 text-xs text-neutral-500">
        الفترة المعروضة:{" "}
        <span dir="ltr" className="font-semibold text-neutral-700">
          {range.fromDay} → {range.toDay}
        </span>
      </p>

      {isEmpty ? (
        <div className="mt-6 rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-neutral-700">لا توجد بيانات في هذه الفترة</p>
          <p className="mt-1 text-xs text-neutral-500">
            القياس يبدأ من لحظة تشغيله فقط، ولا يعرف شيئاً عن الزيارات التي سبقته. جرّب فترة أوسع،
            أو انتظر وصول الزوّار.
          </p>
        </div>
      ) : (
        <>
          {/* ملاحظة سلامة البيانات: تظهر فقط عند وجود فرق حقيقي. */}
          {purchaseGap !== 0 && (
            <div
              className={`mt-4 rounded-xl border p-3 text-sm ${
                purchaseGap > 0
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-blue-300 bg-blue-50 text-blue-900"
              }`}
            >
              <p className="font-semibold">
                {purchaseGap > 0
                  ? `فرق في التتبّع: ${num(orders.orders)} طلباً حقيقياً مقابل ${num(totals.purchaseEvents)} حدث شراء مُسجَّل`
                  : `أحداث الشراء (${num(totals.purchaseEvents)}) أكثر من الطلبات الحقيقية (${num(orders.orders)})`}
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {purchaseGap > 0
                  ? "جدول الطلبات هو المرجع النهائي دائماً — الأرقام المالية أعلاه محسوبة منه لا من القياس. الفرق طبيعي عندما يُغلق الزبون المتصفح فوراً بعد الإرسال. لا نُعوّض الفارق ولا نخترع حدثاً."
                  : "قد يعني هذا أن طلباً حُذف من لوحة الإدارة بعد تسجيل شرائه. سجلّ القياس يبقى كما هو عمداً."}
              </p>
            </div>
          )}

          <SectionTitle note="كل بطاقة تُصرّح: هل الرقم أحداث أم أشخاص (جلسات فريدة).">
            الأرقام الأساسية
          </SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="الزوّار" value={num(totals.sessions)} hint="جلسات فريدة" accent="turquoise" />
            <StatCard
              label="زيارات صفحة الهبوط"
              value={num(totals.landingPageViews)}
              hint="أحداث"
            />
            <StatCard
              label="شاهدوا منتجاً"
              value={num(totals.productViewSessions)}
              hint={`${num(totals.productViewEvents)} حدث مشاهدة`}
            />
            <StatCard
              label="أضافوا للسلة"
              value={num(totals.addToCartSessions)}
              hint="أشخاص (جلسات فريدة)"
              accent="turquoise"
            />
            <StatCard
              label="أحداث الإضافة للسلة"
              value={num(totals.addToCartEvents)}
              hint={
                totals.addToCartSessions > 0
                  ? `${(totals.addToCartEvents / totals.addToCartSessions).toFixed(1)} إضافة لكل شخص`
                  : "أحداث"
              }
            />
            <StatCard
              label="وصلوا Checkout"
              value={num(totals.checkoutSessions)}
              hint="أشخاص (جلسات فريدة)"
            />
            <StatCard
              label="الطلبات"
              value={num(orders.orders)}
              hint="من جدول الطلبات — المرجع النهائي"
              accent="orange"
            />
            <StatCard label="الإيراد" value={formatMad(orders.revenueMad)} hint="من الطلبات الحقيقية" accent="orange" />
            <StatCard
              label="نسبة التحويل"
              value={pct(conversion)}
              hint="زائر ← طلب"
              accent="orange"
            />
            <StatCard label="متوسط قيمة الطلب" value={formatMad(aov)} hint="الإيراد ÷ الطلبات" />
          </div>

          <SectionTitle note="كل مرحلة تعدّ الأشخاص (جلسات فريدة)، ما عدا الطلبات فهي من جدول الطلبات.">
            القمع (Funnel)
          </SectionTitle>
          <div className="mt-3 flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4">
            <FunnelStep
              label="الزوّار"
              value={totals.sessions}
              fromPrevious={null}
              fromSessions={100}
              width={100}
            />
            <FunnelStep
              label="شاهدوا منتجاً"
              value={totals.productViewSessions}
              fromPrevious={rate(totals.productViewSessions, totals.sessions)}
              fromSessions={rate(totals.productViewSessions, totals.sessions)}
              width={rate(totals.productViewSessions, totals.sessions)}
            />
            <FunnelStep
              label="أضافوا للسلة"
              value={totals.addToCartSessions}
              fromPrevious={rate(totals.addToCartSessions, totals.productViewSessions)}
              fromSessions={rate(totals.addToCartSessions, totals.sessions)}
              width={rate(totals.addToCartSessions, totals.sessions)}
            />
            <FunnelStep
              label="وصلوا Checkout"
              value={totals.checkoutSessions}
              fromPrevious={rate(totals.checkoutSessions, totals.addToCartSessions)}
              fromSessions={rate(totals.checkoutSessions, totals.sessions)}
              width={rate(totals.checkoutSessions, totals.sessions)}
            />
            <FunnelStep
              label="اشتروا"
              value={orders.orders}
              fromPrevious={rate(orders.orders, totals.checkoutSessions)}
              fromSessions={rate(orders.orders, totals.sessions)}
              width={rate(orders.orders, totals.sessions)}
            />
          </div>

          <SectionTitle note="هذا الجدول يجيب عن السؤال: هل انخفضت الطلبات بسبب قلّة الزوّار أم بسبب مرحلة بعينها؟">
            حسب اليوم
          </SectionTitle>
          <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">اليوم</th>
                  <th className="px-3 py-2 text-right font-semibold">الزوّار</th>
                  <th className="px-3 py-2 text-right font-semibold">شاهدوا منتجاً</th>
                  <th className="px-3 py-2 text-right font-semibold">أضافوا للسلة</th>
                  <th className="px-3 py-2 text-right font-semibold">أحداث الإضافة</th>
                  <th className="px-3 py-2 text-right font-semibold">Checkout</th>
                  <th className="px-3 py-2 text-right font-semibold">الطلبات</th>
                  <th className="px-3 py-2 text-right font-semibold">التحويل</th>
                  <th className="px-3 py-2 text-right font-semibold">الإيراد</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const row = daily.find((d) => d.day === day);
                  const order = ordersByDay.get(day);
                  const sessions = row?.sessions ?? 0;
                  const dayOrders = order?.orders ?? 0;
                  return (
                    <tr key={day} className="border-t border-neutral-100">
                      <td className="px-3 py-2 font-semibold tabular-nums text-neutral-800" dir="ltr">
                        {day}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{num(sessions)}</td>
                      <td className="px-3 py-2 tabular-nums">{num(row?.productViewSessions ?? 0)}</td>
                      <td className="px-3 py-2 tabular-nums">{num(row?.addToCartSessions ?? 0)}</td>
                      <td className="px-3 py-2 tabular-nums text-neutral-500">
                        {num(row?.addToCartEvents ?? 0)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{num(row?.checkoutSessions ?? 0)}</td>
                      <td className="px-3 py-2 tabular-nums font-bold text-brand-orange">
                        {num(dayOrders)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{pct(rate(dayOrders, sessions))}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMad(order?.revenueMad ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <SectionTitle note="وسوم UTM تُلتقط من رابط الإعلان عند أول صفحة، وتبقى منسوبة للجلسة كلها.">
            مصادر الزوّار
          </SectionTitle>
          <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-600">
                <tr>
                  <th className="px-3 py-2 text-right font-semibold">المصدر</th>
                  <th className="px-3 py-2 text-right font-semibold">الوسيط</th>
                  <th className="px-3 py-2 text-right font-semibold">الحملة</th>
                  <th className="px-3 py-2 text-right font-semibold">الإعلان</th>
                  <th className="px-3 py-2 text-right font-semibold">الإحالة</th>
                  <th className="px-3 py-2 text-right font-semibold">الزوّار</th>
                  <th className="px-3 py-2 text-right font-semibold">أضافوا للسلة</th>
                  <th className="px-3 py-2 text-right font-semibold">Checkout</th>
                  <th className="px-3 py-2 text-right font-semibold">شراء</th>
                  <th className="px-3 py-2 text-right font-semibold">التحويل</th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-4 text-center text-xs text-neutral-500">
                      لا توجد مصادر مُسجَّلة بعد.
                    </td>
                  </tr>
                )}
                {sources.map((source, index) => (
                  <tr key={index} className="border-t border-neutral-100">
                    <td className="px-3 py-2">{source.utmSource ?? "مباشر"}</td>
                    <td className="px-3 py-2 text-neutral-500">{source.utmMedium ?? "—"}</td>
                    <td className="px-3 py-2">{source.utmCampaign ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-500">{source.utmContent ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-500" dir="ltr">
                      {source.referrerHost ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{num(source.sessions)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(source.addToCartSessions)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(source.checkoutSessions)}</td>
                    <td className="px-3 py-2 tabular-nums">{num(source.purchaseEvents)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {pct(rate(source.purchaseEvents, source.sessions))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <SectionTitle>الأجهزة</SectionTitle>
              <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold">الجهاز</th>
                      <th className="px-3 py-2 text-right font-semibold">الزوّار</th>
                      <th className="px-3 py-2 text-right font-semibold">للسلة</th>
                      <th className="px-3 py-2 text-right font-semibold">شراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((row) => (
                      <tr key={row.key} className="border-t border-neutral-100">
                        <td className="px-3 py-2">{DEVICE_LABELS[row.key] ?? row.key}</td>
                        <td className="px-3 py-2 tabular-nums font-semibold">{num(row.sessions)}</td>
                        <td className="px-3 py-2 tabular-nums">{num(row.addToCartSessions)}</td>
                        <td className="px-3 py-2 tabular-nums">{num(row.purchaseEvents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <SectionTitle>المتصفحات</SectionTitle>
              <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold">المتصفح</th>
                      <th className="px-3 py-2 text-right font-semibold">الزوّار</th>
                      <th className="px-3 py-2 text-right font-semibold">للسلة</th>
                      <th className="px-3 py-2 text-right font-semibold">شراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {browsers.map((row) => (
                      <tr key={row.key} className="border-t border-neutral-100">
                        <td className="px-3 py-2">{BROWSER_LABELS[row.key] ?? row.key}</td>
                        <td className="px-3 py-2 tabular-nums font-semibold">{num(row.sessions)}</td>
                        <td className="px-3 py-2 tabular-nums">{num(row.addToCartSessions)}</td>
                        <td className="px-3 py-2 tabular-nums">{num(row.purchaseEvents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
