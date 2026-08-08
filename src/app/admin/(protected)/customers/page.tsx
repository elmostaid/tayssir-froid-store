import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import {
  listAdminCustomers,
  type AdminCustomerSort,
} from "@/lib/queries/adminCustomers";
import { formatMad } from "@/lib/format";
import { toInternationalDigits } from "@/lib/phone";

export const dynamic = "force-dynamic";

export const metadata = { title: "الزبائن" };

const SORT_LABELS: Record<AdminCustomerSort, string> = {
  last_order: "آخر طلب",
  orders_count: "عدد الطلبات",
  purchase_value: "قيمة المشتريات",
};

type Props = {
  searchParams: Promise<{ q?: string; sort?: string }>;
};

export default async function AdminCustomersPage({ searchParams }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const { q, sort } = await searchParams;
  const validSort: AdminCustomerSort =
    sort === "orders_count" || sort === "purchase_value" ? sort : "last_order";

  const customers = await listAdminCustomers({ query: q, sort: validSort });

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">الزبائن</h1>
      <p className="mt-1 text-xs text-neutral-500">
        مجمَّعة تلقائياً من الطلبات حسب رقم الهاتف — لا يوجد زبون مكرَّر لنفس الرقم.
      </p>

      <form action="/admin/customers" method="GET" className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="الاسم أو رقم الهاتف"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        <select
          name="sort"
          defaultValue={validSort}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              الفرز حسب: {label}
            </option>
          ))}
        </select>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white">
          فلترة
        </button>
      </form>

      <p className="mt-3 text-sm text-neutral-500">{customers.length} زبون</p>

      {customers.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">لا يوجد زبائن مطابقون.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {customers.map((customer) => (
            <div
              key={customer.phone}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-800">{customer.name}</p>
                  <p className="text-xs text-neutral-500">
                    <span dir="ltr">{customer.phone}</span> · {customer.city}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-neutral-500">
                  آخر طلب: {new Date(customer.lastOrderAt).toLocaleDateString("ar-MA")}
                </p>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-neutral-50 p-2">
                  <dt className="text-neutral-500">عدد الطلبات</dt>
                  <dd className="mt-0.5 font-bold text-neutral-800">{customer.ordersCount}</dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2">
                  <dt className="text-neutral-500">طلبات مسلَّمة</dt>
                  <dd className="mt-0.5 font-bold text-neutral-800">
                    {customer.deliveredOrdersCount}
                  </dd>
                </div>
                <div className="rounded-lg bg-neutral-50 p-2">
                  <dt className="text-neutral-500">قيمة المسلَّم</dt>
                  <dd className="mt-0.5 font-bold text-brand-orange">
                    {formatMad(customer.deliveredTotalMad)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/admin/orders?q=${encodeURIComponent(customer.phone)}`}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
                >
                  عرض طلباته
                </a>
                <a
                  href={`https://wa.me/${toInternationalDigits(customer.phone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-whatsapp bg-whatsapp/10 px-3 py-2 text-xs font-semibold text-whatsapp-dark"
                >
                  واتساب
                </a>
                <a
                  href={`tel:+${toInternationalDigits(customer.phone)}`}
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
                >
                  اتصال
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
