import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ORDER_SOURCE_BADGE_CLASSES, orderSourceLabel } from "@/lib/orders/orderSource";
import { listAdminOrders, ORDER_STATUSES, type OrderStatus } from "@/lib/queries/adminOrders";
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGE_CLASSES } from "@/lib/orders/orderStatus";
import { formatMad } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "الطلبات" };

type Props = {
  searchParams: Promise<{ q?: string; status?: string; city?: string; from?: string; to?: string; deleted?: string }>;
};

export default async function AdminOrdersPage({ searchParams }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  const owner = isOwnerAdmin(admin);

  const { q, status, city, from, to, deleted } = await searchParams;
  const validStatus = ORDER_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;

  const orders = await listAdminOrders({
    query: q,
    status: validStatus,
    city,
    dateFrom: from,
    dateTo: to,
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-800">الطلبات</h1>
        {owner && (
          <Link
            href="/admin/orders/new"
            className="min-h-11 rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white"
          >
            + إضافة طلب يدوي / واتساب
          </Link>
        )}
      </div>

      {/* رسالة نجاح بعد حذف طلب — القائمة أدناه مُعاد جلبها أصلاً
          (force-dynamic + revalidatePath)، فما يظهر هنا هو الحالة بعد الحذف. */}
      {deleted && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
          تم حذف الطلب <span dir="ltr">{deleted}</span> نهائياً.
        </p>
      )}

      <form action="/admin/orders" method="GET" className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="رقم الطلب، الهاتف أو اسم الزبون"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        <select
          name="status"
          defaultValue={validStatus ?? ""}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">كل الحالات</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="city"
          defaultValue={city}
          placeholder="المدينة"
          className="min-h-11 w-32 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <input type="date" name="from" defaultValue={from} className="min-h-11 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        <input type="date" name="to" defaultValue={to} className="min-h-11 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        <button type="submit" className="min-h-11 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white">
          فلترة
        </button>
      </form>

      <p className="mt-3 text-sm text-neutral-500">{orders.length} طلب</p>

      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">لا توجد طلبات مطابقة.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/admin/orders/${order.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm font-semibold text-neutral-800">
                    {order.orderNumber}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ORDER_STATUS_BADGE_CLASSES[order.status]}`}
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                  {/* الموقع هو الأصل الصامت؛ نُظهر الوسم لما جاء من قناة أخرى. */}
                  {order.source !== "website" && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                        ORDER_SOURCE_BADGE_CLASSES[
                          order.source as keyof typeof ORDER_SOURCE_BADGE_CLASSES
                        ] ?? "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {orderSourceLabel(order.source)}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-neutral-500">
                  {order.customerName} · {order.customerCity} ·{" "}
                  <span dir="ltr">{order.customerPhone}</span>
                </p>
              </div>
              <div className="shrink-0 text-left text-sm font-semibold text-neutral-800">
                {formatMad(order.itemsSubtotal)}
                <p className="text-xs font-normal text-neutral-500">
                  {new Date(order.createdAt).toLocaleString("ar-MA")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
