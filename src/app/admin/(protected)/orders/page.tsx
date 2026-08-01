import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { listAdminOrders, ORDER_STATUSES, type OrderStatus } from "@/lib/queries/adminOrders";
import { formatMad } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "الطلبات" };

const STATUS_LABELS: Record<OrderStatus, { label: string; className: string }> = {
  new: { label: "جديد", className: "bg-brand-orange/10 text-brand-orange-dark" },
  contacted: { label: "تم التواصل", className: "bg-blue-100 text-blue-700" },
  confirmed: { label: "مؤكَّد", className: "bg-brand-turquoise-tint text-brand-turquoise-dark" },
  preparing: { label: "قيد التحضير", className: "bg-amber-100 text-amber-700" },
  ready: { label: "جاهز للشحن", className: "bg-purple-100 text-purple-700" },
  shipped: { label: "تم الشحن", className: "bg-indigo-100 text-indigo-700" },
  delivered: { label: "تم التسليم", className: "bg-green-100 text-green-700" },
  returned: { label: "مرتجَع", className: "bg-neutral-200 text-neutral-700" },
  cancelled: { label: "ملغى", className: "bg-red-100 text-red-700" },
};

type Props = {
  searchParams: Promise<{ q?: string; status?: string; city?: string; from?: string; to?: string }>;
};

export default async function AdminOrdersPage({ searchParams }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  const { q, status, city, from, to } = await searchParams;
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
      <h1 className="text-xl font-bold text-neutral-800">الطلبات</h1>

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
              {STATUS_LABELS[s].label}
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
          {orders.map((order) => {
            const s = STATUS_LABELS[order.status] ?? STATUS_LABELS.new;
            return (
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
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${s.className}`}>
                      {s.label}
                    </span>
                  </div>
                  <p className="truncate text-xs text-neutral-500">
                    {order.customerName} · {order.customerCity} ·{" "}
                    <span dir="ltr">{order.customerPhone}</span>
                  </p>
                </div>
                <div className="shrink-0 text-left text-sm font-semibold text-neutral-800">
                  {formatMad(order.itemsSubtotal)}
                  <p className="text-xs font-normal text-neutral-500">
                    {new Date(order.createdAt).toLocaleDateString("ar-MA")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
