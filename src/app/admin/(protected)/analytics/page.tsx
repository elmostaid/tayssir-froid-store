import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import {
  getAbandonedCarts,
  getAnalyticsByBrowser,
  getAnalyticsByDevice,
  getAnalyticsDaily,
  getAnalyticsSources,
  getAnalyticsTotals,
  getOrdersDaily,
  getOrdersTotals,
  rate,
  REPORT_TIME_ZONE,
  type AbandonedCartRow,
} from "@/lib/queries/adminAnalytics";
import { getSettings } from "@/lib/queries/settings";
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

const EVENT_LABELS: Record<string, string> = {
  session_start: "دخل الموقع",
  landing_page_view: "صفحة الهبوط",
  product_view: "شاهد منتجاً",
  add_to_cart: "أضاف للسلة",
  cart_view: "فتح السلة",
  begin_checkout: "فتح Checkout",
  purchase: "اشترى",
};

/** مدة مقروءة بلمحة: «3د 12ث» لا 192000 مللي ثانية. */
function duration(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}ث`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}د ${rest}ث` : `${minutes}د`;
  return `${Math.floor(minutes / 60)}س ${minutes % 60}د`;
}

const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function whenLocal(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
}

/** المصدر كما يُعرض: الحملة أدقّ من المصدر، والإحالة آخر ما نلجأ إليه. */
function sourceLabel(row: AbandonedCartRow): string {
  const parts = [row.utmSource, row.utmCampaign].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return row.referrerHost ?? "مباشر";
}

/**
 * عدد المنتجات المختلفة يعتمد على product_id في حدث الإضافة. أحداث قديمة
 * جداً (قبل أن يحمل الحدث المنتج) تصل بصفر رغم وجود كميات — نعرضها شرطة
 * بدل صفر يوهم أن السلة كانت فارغة.
 */
function productsLabel(row: AbandonedCartRow): string {
  if (row.distinctProducts === 0 && row.totalUnits > 0) return "—";
  return num(row.distinctProducts);
}

/**
 * القيمة وحدها تكذب: 1420 من آخر إضافة قد تكون 350 الآن. الشارة تُلازم
 * الرقم أينما ظهر، فلا يُقرأ مجرَّداً عن درجة اليقين به.
 */
function ValueSource({ source }: { source: AbandonedCartRow["valueSource"] }) {
  const confirmed = source === "checkout";
  return (
    <span
      title={
        confirmed
          ? "من حدث begin_checkout: المجموع الحيّ وقت فتح Checkout، ويعكس أي حذف سبقه."
          : "من آخر إضافة للسلة. الحذف لا يُسجَّل، فقد تكون السلة نزلت بعدها — هذا حدّ أعلى."
      }
      className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        confirmed
          ? "bg-brand-turquoise-tint text-brand-turquoise-dark"
          : "bg-amber-50 text-amber-800"
      }`}
    >
      {confirmed ? "مؤكَّدة" : "حدّ أعلى"}
    </span>
  );
}

function YesNo({ yes }: { yes: boolean }) {
  return (
    <span className={yes ? "font-semibold text-brand-turquoise-dark" : "text-neutral-400"}>
      {yes ? "نعم" : "لا"}
    </span>
  );
}

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
  compact,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "orange" | "turquoise";
  /** للمبالغ: خط أصغر حتى لا ينكسر "1.821,11 درهم" على سطرين. */
  compact?: boolean;
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
      <p className={`mt-1 font-bold tabular-nums ${compact ? "text-lg" : "text-2xl"} ${color}`}>
        {value}
      </p>
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

/** صفّ رقم صغير داخل بطاقة الهاتف. */
function MiniStat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[11px] leading-snug text-neutral-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${muted ? "text-neutral-500" : "text-neutral-800"}`}>
        {value}
      </p>
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

  // الحدّ الأدنى يأتي من الإعدادات: لو غيّرتَه غداً، يتبعه قسم السلات
  // المتروكة من تلقاء نفسه بلا لمس أي كود.
  const settings = await getSettings();

  const [totals, orders, daily, ordersDaily, sources, devices, browsers, abandoned] =
    await Promise.all([
      getAnalyticsTotals(range),
      getOrdersTotals(range),
      getAnalyticsDaily(range),
      getOrdersDaily(range),
      getAnalyticsSources(range),
      getAnalyticsByDevice(range),
      getAnalyticsByBrowser(range),
      getAbandonedCarts(range, settings.minOrderAmountMad),
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
        <br />
        كل الأرقام هنا تخصّ <span className="font-semibold">الموقع وحده</span>: طلبات واتساب
        والهاتف والمحل مبيعات حقيقية لكنها لم تمرّ بهذا القمع، فمكانها{" "}
        <Link href="/admin/reports" className="font-semibold text-brand-turquoise-dark underline">
          صفحة التقارير والأرباح
        </Link>
        .
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
              label="طلبات الموقع"
              value={num(orders.orders)}
              hint="من جدول الطلبات — الموقع وحده"
              accent="orange"
            />
            <StatCard
              label="الإيراد"
              value={formatMad(orders.revenueMad)}
              hint="طلبات الموقع وحدها"
              accent="orange"
              compact
            />
            <StatCard
              label="نسبة التحويل"
              value={pct(conversion)}
              hint="زائر ← طلب"
              accent="orange"
            />
            <StatCard label="متوسط قيمة الطلب" value={formatMad(aov)} hint="الإيراد ÷ الطلبات" compact />
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

          <SectionTitle
            note={`كل جلسة أضافت للسلة ولم يُسجَّل لها شراء. لم يعد للمتجر حدّ أدنى للطلب، فالمبلغ ${formatMad(settings.minOrderAmountMad)} يُستعمل هنا مِسطرةً لتمييز السلة الصغيرة من الكبيرة فقط — حتى تبقى المقارنة مع ما قبل إلغاء الحد ممكنة على نفس البيانات.`}
          >
            السلات المتروكة
          </SectionTitle>

          {abandoned.summary.abandoned === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center">
              <p className="text-sm font-semibold text-neutral-700">لا توجد سلة متروكة في هذه الفترة</p>
              <p className="mt-1 text-xs text-neutral-500">
                إمّا أن كل من أضاف للسلة أتمّ طلبه، أو لم يُضف أحد للسلة أصلاً.
              </p>
            </div>
          ) : (
            <>
              {/* الخلاصة في جملة واحدة — هذا ما يُقرأ على الهاتف قبل أي جدول. */}
              <p className="mt-3 rounded-xl border border-brand-orange/30 bg-brand-orange-tint p-3 text-sm leading-relaxed text-neutral-800">
                <span className="font-bold">{num(abandoned.summary.abandoned)}</span> شخصاً أضافوا
                للسلة ولم يشتروا:{" "}
                <span className="font-bold">{num(abandoned.summary.stoppedBelowMinimum)}</span>{" "}
                سلّتهم تحت {formatMad(settings.minOrderAmountMad)}،{" "}
                <span className="font-bold">{num(abandoned.summary.reachedMinimumNoCheckout)}</span>{" "}
                سلّتهم فوقه ولم يفتحوا Checkout، و
                <span className="font-bold">{num(abandoned.summary.reachedCheckoutNoPurchase)}</span>{" "}
                فتحوا Checkout ولم يشتروا.
              </p>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  label="أضافوا ولم يشتروا"
                  value={num(abandoned.summary.abandoned)}
                  hint="أشخاص (جلسات فريدة)"
                  accent="orange"
                />
                <StatCard
                  label={`سلّة تحت ${formatMad(settings.minOrderAmountMad)}`}
                  value={num(abandoned.summary.stoppedBelowMinimum)}
                  hint="ولم يفتحوا Checkout"
                />
                <StatCard
                  label={`سلّة فوق ${formatMad(settings.minOrderAmountMad)}`}
                  value={num(abandoned.summary.reachedMinimumNoCheckout)}
                  hint="ولم يفتحوا Checkout — أثمن ما نخسره"
                />
                <StatCard
                  label="فتحوا Checkout"
                  value={num(abandoned.summary.reachedCheckoutNoPurchase)}
                  hint="ولم يشتروا"
                  accent="orange"
                />
                <StatCard
                  label="القيمة المتروكة"
                  value={formatMad(abandoned.summary.abandonedValueMad)}
                  hint="حدّ أعلى — مجموع القيم المسجَّلة"
                  compact
                />
              </div>

              {/* تحذير الدقّة: يظهر فقط حين يوجد فارق تتبّع حقيقي. */}
              {purchaseGap > 0 && (
                <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  انتبه: هناك {num(purchaseGap)} طلباً حقيقياً بلا حدث شراء مُسجَّل في هذه الفترة، فقد
                  يظهر حتى {num(purchaseGap)} من هؤلاء هنا وهم قد اشتروا فعلاً. جدول الطلبات يبقى
                  المرجع النهائي — لا نُعوّض الفارق ولا نخترع حدثاً.
                </p>
              )}

              {/* الهاتف: بطاقة لكل سلة. */}
              <div className="mt-3 flex flex-col gap-2 lg:hidden">
                {abandoned.rows.map((row, index) => (
                  <div key={index} className="rounded-xl border border-neutral-200 bg-white p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-base font-bold tabular-nums text-brand-orange">
                          {formatMad(row.lastCartValueMad)}
                        </span>
                        <ValueSource source={row.valueSource} />
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          row.meetsMinimum
                            ? "bg-brand-turquoise-tint text-brand-turquoise-dark"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {row.meetsMinimum ? "سلة كبيرة" : "سلة صغيرة"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-2">
                      <MiniStat label="منتجات مختلفة" value={productsLabel(row)} />
                      <MiniStat label="مجموع الكميات" value={num(row.totalUnits)} />
                      <MiniStat label="مدة الجلسة" value={duration(row.sessionSeconds)} />
                      <MiniStat label="فتح السلة" value={row.sawCart ? "نعم" : "لا"} muted={!row.sawCart} />
                      <MiniStat
                        label="Checkout"
                        value={row.reachedCheckout ? "نعم" : "لا"}
                        muted={!row.reachedCheckout}
                      />
                      <MiniStat label="آخر حدث" value={EVENT_LABELS[row.lastEvent] ?? row.lastEvent} />
                    </div>
                    <p className="mt-2 border-t border-neutral-100 pt-2 text-[11px] leading-snug text-neutral-500">
                      {sourceLabel(row)} · {DEVICE_LABELS[row.deviceType ?? ""] ?? "جهاز غير معروف"} ·{" "}
                      {BROWSER_LABELS[row.browser ?? ""] ?? "متصفح غير معروف"} ·{" "}
                      <span dir="ltr">{whenLocal(row.lastAt)}</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* الحاسوب: جدول كامل. */}
              <div className="mt-3 hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white lg:block">
                <table className="w-full min-w-[62rem] text-sm">
                  <thead className="bg-neutral-50 text-xs text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 text-right font-semibold">آخر قيمة مسجّلة</th>
                      <th className="px-3 py-2 text-right font-semibold">حجم السلة</th>
                      <th className="px-3 py-2 text-right font-semibold">منتجات مختلفة</th>
                      <th className="px-3 py-2 text-right font-semibold">مجموع الكميات</th>
                      <th className="px-3 py-2 text-right font-semibold">فتح السلة</th>
                      <th className="px-3 py-2 text-right font-semibold">Checkout</th>
                      <th className="px-3 py-2 text-right font-semibold">آخر حدث</th>
                      <th className="px-3 py-2 text-right font-semibold">مدة الجلسة</th>
                      <th className="px-3 py-2 text-right font-semibold">المصدر / الحملة</th>
                      <th className="px-3 py-2 text-right font-semibold">الجهاز</th>
                      <th className="px-3 py-2 text-right font-semibold">المتصفح</th>
                      <th className="px-3 py-2 text-right font-semibold">آخر نشاط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abandoned.rows.map((row, index) => (
                      <tr key={index} className="border-t border-neutral-100">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="tabular-nums font-bold text-brand-orange">
                            {formatMad(row.lastCartValueMad)}
                          </span>{" "}
                          <ValueSource source={row.valueSource} />
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              row.meetsMinimum
                                ? "font-semibold text-brand-turquoise-dark"
                                : "text-neutral-500"
                            }
                          >
                            {row.meetsMinimum ? "كبيرة" : "صغيرة"}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{productsLabel(row)}</td>
                        <td className="px-3 py-2 tabular-nums">{num(row.totalUnits)}</td>
                        <td className="px-3 py-2">
                          <YesNo yes={row.sawCart} />
                        </td>
                        <td className="px-3 py-2">
                          <YesNo yes={row.reachedCheckout} />
                        </td>
                        <td className="px-3 py-2">{EVENT_LABELS[row.lastEvent] ?? row.lastEvent}</td>
                        <td className="px-3 py-2 tabular-nums">{duration(row.sessionSeconds)}</td>
                        <td className="px-3 py-2">{sourceLabel(row)}</td>
                        <td className="px-3 py-2 text-neutral-500">
                          {DEVICE_LABELS[row.deviceType ?? ""] ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-neutral-500">
                          {BROWSER_LABELS[row.browser ?? ""] ?? "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-neutral-500" dir="ltr">
                          {whenLocal(row.lastAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                <span className="font-semibold text-neutral-600">عن «آخر قيمة مسجّلة»:</span> حذف
                منتج من السلة لا يُسجَّل حدثاً، و<span dir="ltr">cart_view</span> لا يحمل قيمة. فمن
                فتح Checkout نأخذ المجموع الحيّ عندها (<ValueSource source="checkout" />)، ومن لم
                يفتحه فأحدث ما لدينا هو مجموع سلّته عند آخر إضافة (
                <ValueSource source="add_to_cart" />) — وقد يكون حذف بعدها. القيمة الثانية{" "}
                <span className="font-semibold text-neutral-600">حدّ أعلى</span> دائماً، لأن الحذف
                لا يرفع سلة: فمن هو تحت الحد الأدنى هنا تحته يقيناً، ومن بلغه قد يكون نزل عنه.
                <br />
                لا يحمل هذا القسم أي اسم أو هاتف أو عنوان — القياس الداخلي لا يخزّن شيئاً من ذلك
                أصلاً.
                {abandoned.truncated && ` معروضة أكبر ${num(abandoned.rows.length)} سلة قيمةً فقط.`}
              </p>
            </>
          )}

          <SectionTitle note="هذا الجدول يجيب عن السؤال: هل انخفضت الطلبات بسبب قلّة الزوّار أم بسبب مرحلة بعينها؟">
            حسب اليوم
          </SectionTitle>
          {/* الهاتف: بطاقة لكل يوم — الأرقام المهمة مرئية بلا أي تمرير جانبي. */}
          <div className="mt-3 flex flex-col gap-2 sm:hidden">
            {days.map((day) => {
              const row = daily.find((d) => d.day === day);
              const order = ordersByDay.get(day);
              const sessions = row?.sessions ?? 0;
              const dayOrders = order?.orders ?? 0;
              return (
                <div key={day} className="rounded-xl border border-neutral-200 bg-white p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold tabular-nums text-neutral-800" dir="ltr">
                      {day}
                    </span>
                    <span className="text-sm">
                      <span className="font-bold text-brand-orange">{num(dayOrders)} طلب</span>
                      <span className="text-neutral-500"> · {pct(rate(dayOrders, sessions))}</span>
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-2">
                    <MiniStat label="الزوّار" value={num(sessions)} />
                    <MiniStat label="شاهدوا منتجاً" value={num(row?.productViewSessions ?? 0)} />
                    <MiniStat label="أضافوا للسلة" value={num(row?.addToCartSessions ?? 0)} />
                    <MiniStat label="أحداث الإضافة" value={num(row?.addToCartEvents ?? 0)} muted />
                    <MiniStat label="Checkout" value={num(row?.checkoutSessions ?? 0)} />
                    <MiniStat label="الإيراد" value={formatMad(order?.revenueMad ?? 0)} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white sm:block">
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
          {/* الهاتف: بطاقة لكل مصدر. */}
          <div className="mt-3 flex flex-col gap-2 sm:hidden">
            {sources.length === 0 && (
              <p className="rounded-xl border border-neutral-200 bg-white p-4 text-center text-xs text-neutral-500">
                لا توجد مصادر مُسجَّلة بعد.
              </p>
            )}
            {sources.map((source, index) => (
              <div key={index} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="text-sm font-semibold text-neutral-800">
                  {source.utmSource ?? "مباشر"}
                  {source.utmMedium ? ` · ${source.utmMedium}` : ""}
                </p>
                <p className="text-[11px] leading-snug text-neutral-500">
                  {source.utmCampaign ?? "بلا حملة"}
                  {source.utmContent ? ` · ${source.utmContent}` : ""}
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2 border-t border-neutral-100 pt-2">
                  <MiniStat label="الزوّار" value={num(source.sessions)} />
                  <MiniStat label="للسلة" value={num(source.addToCartSessions)} />
                  <MiniStat label="Checkout" value={num(source.checkoutSessions)} />
                  <MiniStat label="شراء" value={num(source.purchaseEvents)} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white sm:block">
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
