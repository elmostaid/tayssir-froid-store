import { sql } from "@/lib/db";

// "زبون" هنا ليس جدولاً منفصلاً — لا يوجد جدول customers في المخطط، فكل ما
// نعرفه عن الزبائن هو ما تكرَّر عبر جدول orders نفسه. نجمّع الطلبات حسب
// customer_phone (المعرّف الوحيد المستقر — الاسم قد يُكتب بصيغ مختلفة قليلاً
// بين طلب وآخر لنفس الشخص) في استعلام تجميع واحد (GROUP BY)، بلا أي حلقة
// استعلامات لكل زبون (لا N+1).

export type AdminCustomer = {
  phone: string;
  name: string;
  city: string;
  ordersCount: number;
  deliveredOrdersCount: number;
  deliveredTotalMad: string;
  lastOrderAt: string;
};

export type AdminCustomerSort = "last_order" | "orders_count" | "purchase_value";

export type AdminCustomerFilters = {
  query?: string;
  sort?: AdminCustomerSort;
};

export async function listAdminCustomers(
  filters: AdminCustomerFilters = {}
): Promise<AdminCustomer[]> {
  const { query, sort = "last_order" } = filters;
  const pattern = query?.trim() ? `%${query.trim()}%` : null;

  const orderBy =
    sort === "orders_count"
      ? sql`order by orders_count desc, last_order_at desc`
      : sort === "purchase_value"
        ? sql`order by delivered_total desc, last_order_at desc`
        : sql`order by last_order_at desc`;

  const rows = await sql<
    {
      customer_phone: string;
      customer_name: string;
      customer_city: string;
      orders_count: number;
      delivered_orders_count: number;
      delivered_total: string;
      last_order_at: string;
    }[]
  >`
    select
      customer_phone,
      -- آخر اسم/مدينة استُعملا فعلياً (أحدث طلب لنفس الرقم)، بلا استعلام
      -- إضافي منفصل — array_agg مرتَّب تنازلياً والعنصر الأول منه.
      (array_agg(customer_name order by created_at desc))[1] as customer_name,
      (array_agg(customer_city order by created_at desc))[1] as customer_city,
      count(*)::int as orders_count,
      count(*) filter (where status = 'delivered')::int as delivered_orders_count,
      coalesce(sum(items_subtotal) filter (where status = 'delivered'), 0) as delivered_total,
      max(created_at) as last_order_at
    from public.orders
    where customer_phone in (
      -- البحث يحدّد "أي زبون يطابق" (رقمه أو أي اسم استعمله فأي طلب)، ثم
      -- نجمّع كل طلباته هو بالكامل — وليس فقط الطلبات المطابقة حرفياً، وإلا
      -- انخفض عدد/قيمة طلباته خطأً لمجرد اختلاف بسيط فكتابة الاسم بين طلب
      -- وآخر لنفس الشخص.
      select distinct customer_phone from public.orders
      where ${pattern}::text is null
        or customer_phone ilike ${pattern}
        or customer_name ilike ${pattern}
    )
    group by customer_phone
    ${orderBy}
  `;

  return rows.map((r) => ({
    phone: r.customer_phone,
    name: r.customer_name,
    city: r.customer_city,
    ordersCount: r.orders_count,
    deliveredOrdersCount: r.delivered_orders_count,
    deliveredTotalMad: r.delivered_total,
    lastOrderAt: r.last_order_at,
  }));
}
