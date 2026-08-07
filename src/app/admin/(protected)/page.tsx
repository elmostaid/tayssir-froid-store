import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getDashboardOrderStats, getRecentAdminOrders } from "@/lib/queries/adminOrders";
import { getLowStockProductsAdmin, countLowStockProductsAdmin } from "@/lib/queries/adminProducts";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE_CLASSES, type OrderStatus } from "@/lib/orders/orderStatus";
import { formatMad } from "@/lib/format";

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

  const [stats, recentOrders, lowStockProducts, lowStockCount] = await Promise.all([
    getDashboardOrderStats(),
    getRecentAdminOrders(5),
    getLowStockProductsAdmin(5),
    countLowStockProductsAdmin(),
  ]);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">لوحة التحكم</h1>

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

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href="/admin/categories"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">التصنيفات</h2>
          <p className="mt-1 text-sm text-neutral-500">
            إضافة وتعديل التصنيفات والتصنيفات الفرعية
          </p>
        </Link>
        <Link
          href="/admin/products"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">المنتجات</h2>
          <p className="mt-1 text-sm text-neutral-500">
            إضافة وتعديل المنتجات، الأسعار، المخزون، والصور
          </p>
        </Link>
        <Link
          href="/admin/customers"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">الزبائن</h2>
          <p className="mt-1 text-sm text-neutral-500">
            قائمة الزبائن حسب طلباتهم، تواصل مباشر عبر واتساب أو اتصال
          </p>
        </Link>
        <Link
          href="/admin/reports"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">التقارير والأرباح</h2>
          <p className="mt-1 text-sm text-neutral-500">
            الربح الإجمالي، أفضل المنتجات مبيعاً، تفصيل الطلبات المسلَّمة
          </p>
        </Link>
        <Link
          href="/admin/settings"
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-brand-turquoise"
        >
          <h2 className="text-base font-semibold text-neutral-800">الإعدادات</h2>
          <p className="mt-1 text-sm text-neutral-500">
            الحد الأدنى للطلب، مصاريف التوصيل، واتساب، واستقبال الطلبات
          </p>
        </Link>
      </div>
    </div>
  );
}
