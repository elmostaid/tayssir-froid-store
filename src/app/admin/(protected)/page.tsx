import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getDashboardOrderStats, getRecentAdminOrders } from "@/lib/queries/adminOrders";
import { getLowStockProductsAdmin, countLowStockProductsAdmin } from "@/lib/queries/adminProducts";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE_CLASSES, type OrderStatus } from "@/lib/orders/orderStatus";
import { formatMad } from "@/lib/format";
import { getDashboardSummary, type DayCounters } from "@/lib/queries/adminDashboardSummary";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "لوحة التحكم",
};

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


/** فرق اليوم عن أمس: سهم وعدد، بلا نسب مئوية تُضخّم فرقاً بين 1 و2. */
function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  const diff = today - yesterday;
  if (diff === 0) {
    return <span className="text-[11px] text-neutral-400">= أمس ({yesterday})</span>;
  }
  return (
    <span className={`text-[11px] font-semibold ${diff > 0 ? "text-green-700" : "text-red-600"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} عن أمس ({yesterday})
    </span>
  );
}

/**
 * بطاقة اليوم: رقم، ومقارنة بأمس، ورابط إلى تفصيلها في لوحة التحليلات.
 * الضغط عليها يفتح نفس المدى (اليوم) هناك، فلا ينقطع خيط السؤال.
 */
function TodayCard({
  label,
  href,
  today,
  yesterday,
  format,
  accent,
}: {
  label: string;
  href: string;
  today: number;
  yesterday: number;
  format?: (value: number) => string;
  accent?: "orange" | "turquoise";
}) {
  const color =
    accent === "orange"
      ? "text-brand-orange"
      : accent === "turquoise"
        ? "text-brand-turquoise-dark"
        : "text-neutral-800";
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-3 transition-colors hover:border-brand-turquoise"
    >
      <p className="text-xs leading-snug text-neutral-500">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>
        {format ? format(today) : today.toLocaleString("en-US")}
      </p>
      <Delta today={today} yesterday={yesterday} />
    </Link>
  );
}

/** نسبة التحويل من طلبات الموقع وحدها — هي وحدها ما يمكن أن يتحوّل عن زيارة. */
function conversion(day: DayCounters): number {
  return day.sessions === 0 ? 0 : (day.websiteOrders / day.sessions) * 100;
}

const STATUS_ORDER: OrderStatus[] = [
  "new",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
];

export default async function AdminDashboardPage() {
  // فحص إضافي هنا (وليس فقط في admin/(protected)/layout.tsx) لأن Next.js
  // App Router يُنفّذ صفحة الطفل بغض النظر عن اختيار الـlayout الأب عرضها
  // من عدمه — الحماية الحقيقية يجب أن تكون في كل صفحة على حدة أيضاً.
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  // لوحة التحكم الرئيسية (مبيعات، أرباح غير مباشرة عبر روابط، مخزون منخفض
  // عبر كل المنتجات) مقصورة على Owner/Admin — Staff يُعاد توجيهه لصفحته
  // الافتراضية بدل ارتداد فارغ.
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const [stats, recentOrders, lowStockProducts, lowStockCount, summary] = await Promise.all([
    getDashboardOrderStats(),
    getRecentAdminOrders(5),
    getLowStockProductsAdmin(5),
    countLowStockProductsAdmin(),
    getDashboardSummary(),
  ]);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">لوحة التحكم</h1>

      <section className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-neutral-800">اليوم في سطر</h2>
          <Link
            href="/admin/analytics?range=today"
            className="text-xs font-semibold text-brand-turquoise-dark hover:underline"
          >
            كل التفاصيل ←
          </Link>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          الزوّار والقمع من قياس الموقع؛ الطلبات والمبيعات من كل المصادر (الموقع وواتساب والهاتف
          والمحل). نسبة التحويل من طلبات الموقع وحدها، لأنها وحدها ما يتحوّل عن زيارة.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TodayCard
            label="زوّار اليوم"
            href="/admin/analytics?range=today"
            today={summary.today.sessions}
            yesterday={summary.yesterday.sessions}
            accent="turquoise"
          />
          <TodayCard
            label="شاهدوا منتجاً"
            href="/admin/analytics?range=today"
            today={summary.today.productViewSessions}
            yesterday={summary.yesterday.productViewSessions}
          />
          <TodayCard
            label="أضافوا للسلة"
            href="/admin/analytics?range=today"
            today={summary.today.addToCartSessions}
            yesterday={summary.yesterday.addToCartSessions}
          />
          <TodayCard
            label="وصلوا Checkout"
            href="/admin/analytics?range=today"
            today={summary.today.checkoutSessions}
            yesterday={summary.yesterday.checkoutSessions}
          />
          <TodayCard
            label="الطلبات (كل المصادر)"
            href="/admin/orders"
            today={summary.today.orders}
            yesterday={summary.yesterday.orders}
            accent="orange"
          />
          <TodayCard
            label="المبيعات"
            href="/admin/reports?range=today"
            today={summary.today.salesMad}
            yesterday={summary.yesterday.salesMad}
            format={formatMad}
            accent="orange"
          />
          <TodayCard
            label="نسبة التحويل"
            href="/admin/analytics?range=today"
            today={Math.round(conversion(summary.today) * 10) / 10}
            yesterday={Math.round(conversion(summary.yesterday) * 10) / 10}
            format={(value) => `${value}%`}
          />
          <TodayCard
            label="السلات المتروكة"
            href="/admin/analytics?range=today"
            today={summary.today.abandonedCarts}
            yesterday={summary.yesterday.abandonedCarts}
          />
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="طلبات اليوم" value={String(stats.ordersToday)} />
        <StatCard label="مبيعات اليوم" value={formatMad(stats.salesTodayMad)} accent />
        <StatCard label="منتجات مخزونها منخفض" value={String(lowStockCount)} />
        <StatCard label="مبيعات آخر 7 أيام" value={formatMad(stats.sales7DaysMad)} accent />
        <StatCard label="مبيعات الشهر الحالي" value={formatMad(stats.salesThisMonthMad)} accent />
      </div>

      {/* المبيعات هنا = مجموع قيمة المنتجات (items_subtotal) للطلبات غير
          الملغاة وغير الراجعة فقط — انظر التعليق الكامل فـ
          getDashboardOrderStats (adminOrders.ts) لشرح هذا الاختيار. */}
      <p className="mt-2 text-xs text-neutral-400">
        المبيعات المعروضة لا تشمل الطلبات الملغاة أو الراجعة.
      </p>

      <h2 className="mt-6 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        الطلبات حسب الحالة
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-xl border border-neutral-200 bg-white p-3">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs ${ORDER_STATUS_BADGE_CLASSES[status]}`}
            >
              {ORDER_STATUS_LABELS[status]}
            </span>
            <p className="mt-1.5 text-lg font-bold text-neutral-800">
              {stats.countsByStatus[status]}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
              أحدث الطلبات
            </h2>
            <Link href="/admin/orders" className="text-xs text-brand-turquoise-dark hover:underline">
              كل الطلبات
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">لا توجد طلبات بعد.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {recentOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-xs font-semibold text-neutral-800">
                        {order.orderNumber}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ORDER_STATUS_BADGE_CLASSES[order.status]}`}
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </div>
                    <p className="truncate text-xs text-neutral-500">{order.customerName}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-neutral-800">
                    {formatMad(order.itemsSubtotal)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
              منتجات مخزونها منخفض
            </h2>
            <Link href="/admin/products" className="text-xs text-brand-turquoise-dark hover:underline">
              كل المنتجات
            </Link>
          </div>
          {lowStockProducts.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">لا يوجد منتج بمخزون منخفض حالياً.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {lowStockProducts.map((product) => (
                <Link
                  key={product.id}
                  href={`/admin/products/${product.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800">{product.name_ar}</p>
                    <p className="text-xs text-neutral-500" dir="ltr">
                      {product.sku}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                    {product.stock_quantity <= 0 ? "نفد" : `${product.stock_quantity} متبقي`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* اختصارات عملية — كل الأقسام صارت متاحة أصلاً من قائمة لوحة الإدارة
          (الدرج الجانبي فـAdminHeader)، فهذا القسم لا يكرّرها كدليل عام، بل
          إجراءات محدَّدة مرتبطة مباشرة ببيانات حقيقية أعلاه (العدّادات) أو
          بمهمة يومية شائعة (إضافة منتج). */}
      <h2 className="mt-6 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        اختصارات سريعة
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Link
          href="/admin/orders?status=new"
          className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">الطلبات الجديدة</span>
          {stats.countsByStatus.new > 0 && (
            <span className="shrink-0 rounded-full bg-brand-orange px-2 py-0.5 text-xs font-bold text-white">
              {stats.countsByStatus.new}
            </span>
          )}
        </Link>
        <Link
          href="/admin/orders"
          className="flex items-center rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">كل الطلبات</span>
        </Link>
        <Link
          href="/admin/products?lowStock=1"
          className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">مخزون منخفض</span>
          {lowStockCount > 0 && (
            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
              {lowStockCount}
            </span>
          )}
        </Link>
        <Link
          href="/admin/products/new"
          className="flex items-center rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">+ إضافة منتج</span>
        </Link>
        <Link
          href="/admin/customers"
          className="flex items-center rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">الزبائن</span>
        </Link>
        <Link
          href="/admin/reports"
          className="flex items-center rounded-xl border border-neutral-200 bg-white p-4 hover:border-brand-turquoise"
        >
          <span className="text-sm font-semibold text-neutral-800">التقارير والأرباح</span>
        </Link>
      </div>
    </div>
  );
}
