import { sql } from "@/lib/db";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/orderStatus";

// استعلامات لوحة إدارة الطلبات فقط — لا تُستعمل خارج مسارات /admin. لا تلمس
// عمود purchase_price ولا أي بيانات أخرى غير الطلبات نفسها.

export { ORDER_STATUSES };
export type { OrderStatus };

export type AdminOrderListItem = {
  id: number;
  orderNumber: string;
  publicReference: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  itemsSubtotal: string;
  createdAt: string;
};

export type AdminOrderDetail = AdminOrderListItem & {
  customerAddress: string;
  customerNotes: string | null;
  cartonCount: number | null;
  deliveryFee: string | null;
  finalTotal: string | null;
};

export type AdminOrderItem = {
  id: number;
  productId: number | null;
  variantId: number | null;
  productNameSnapshot: string;
  skuSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
  unitLabel: string | null;
};

export type AdminOrderStatusHistoryEntry = {
  status: string;
  note: string | null;
  changedBy: string | null;
  changedAt: string;
};

export type AdminOrderFilters = {
  query?: string;
  status?: OrderStatus;
  city?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function listAdminOrders(
  filters: AdminOrderFilters = {}
): Promise<AdminOrderListItem[]> {
  const { query, status, city, dateFrom, dateTo } = filters;
  const pattern = query?.trim() ? `%${query.trim()}%` : null;

  const rows = await sql<
    {
      id: number;
      order_number: string;
      public_reference: string;
      status: OrderStatus;
      customer_name: string;
      customer_phone: string;
      customer_city: string;
      items_subtotal: string;
      created_at: string;
    }[]
  >`
    select id, order_number, public_reference, status, customer_name,
      customer_phone, customer_city, items_subtotal, created_at
    from public.orders
    where (${pattern}::text is null
        or order_number ilike ${pattern}
        or public_reference ilike ${pattern}
        or customer_phone ilike ${pattern}
        or customer_name ilike ${pattern})
      and (${status ?? null}::text is null or status = ${status ?? null})
      and (${city?.trim() || null}::text is null or customer_city ilike ${city ? `%${city.trim()}%` : null})
      and (${dateFrom ?? null}::date is null or created_at >= ${dateFrom ?? null}::date)
      and (${dateTo ?? null}::date is null or created_at < (${dateTo ?? null}::date + interval '1 day'))
    order by
      case status when 'new' then 0 else 1 end asc,
      created_at desc
  `;

  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    publicReference: r.public_reference,
    status: r.status,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerCity: r.customer_city,
    itemsSubtotal: r.items_subtotal,
    createdAt: r.created_at,
  }));
}

export async function countNewOrders(): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from public.orders where status = 'new'
  `;
  return rows[0]?.count ?? 0;
}

// آخر N طلب (بدون فلترة)، لعرض مختصر في Dashboard — استعلام منفصل عن
// listAdminOrders() (المُستعملة في /admin/orders الكاملة بلا حد أقصى) بدل
// إضافة limit اختياري هناك، حتى لا يتغيّر سلوك تلك الدالة المستعملة أصلاً.
export async function getRecentAdminOrders(limit: number): Promise<AdminOrderListItem[]> {
  const rows = await sql<
    {
      id: number;
      order_number: string;
      public_reference: string;
      status: OrderStatus;
      customer_name: string;
      customer_phone: string;
      customer_city: string;
      items_subtotal: string;
      created_at: string;
    }[]
  >`
    select id, order_number, public_reference, status, customer_name,
      customer_phone, customer_city, items_subtotal, created_at
    from public.orders
    order by created_at desc
    limit ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    publicReference: r.public_reference,
    status: r.status,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerCity: r.customer_city,
    itemsSubtotal: r.items_subtotal,
    createdAt: r.created_at,
  }));
}

export type DashboardOrderStats = {
  ordersToday: number;
  // "مبيعات" هنا = مجموع items_subtotal (قيمة المنتجات وقت الطلب، متوفرة
  // دائماً فور إنشاء الطلب) للطلبات التي ليست ملغاة ولا راجعة فقط — هذا هو
  // "المُحقَّق/النهائي" المطلوب صراحة استبعاد الملغى والراجع منه. لا نستعمل
  // final_total لأنه يبقى NULL لأغلب الطلبات حتى يُحدِّد المدير مصاريف
  // التوصيل يدوياً لاحقاً (لا يصلح كأساس لمؤشر لحظي)، ولا نشترط status =
  // 'delivered' لأن ذلك مقياس مختلف تماماً ("الإيراد المُسلَّم فعلياً")
  // لم يُطلَب هنا صراحة — فقط استبعاد الملغى/الراجع.
  salesTodayMad: string;
  sales7DaysMad: string;
  salesThisMonthMad: string;
  countsByStatus: Record<OrderStatus, number>;
};

export async function getDashboardOrderStats(): Promise<DashboardOrderStats> {
  const [row] = await sql<
    {
      orders_today: number;
      sales_today: string;
      sales_7d: string;
      sales_month: string;
      count_new: number;
      count_confirmed: number;
      count_preparing: number;
      count_shipped: number;
      count_delivered: number;
      count_cancelled: number;
      count_returned: number;
    }[]
  >`
    select
      count(*) filter (where created_at >= current_date) ::int as orders_today,
      coalesce(sum(items_subtotal) filter (
        where created_at >= current_date and status not in ('cancelled', 'returned')
      ), 0) as sales_today,
      coalesce(sum(items_subtotal) filter (
        where created_at >= current_date - interval '6 days' and status not in ('cancelled', 'returned')
      ), 0) as sales_7d,
      coalesce(sum(items_subtotal) filter (
        where created_at >= date_trunc('month', current_date) and status not in ('cancelled', 'returned')
      ), 0) as sales_month,
      count(*) filter (where status = 'new')::int as count_new,
      count(*) filter (where status = 'confirmed')::int as count_confirmed,
      count(*) filter (where status = 'preparing')::int as count_preparing,
      count(*) filter (where status = 'shipped')::int as count_shipped,
      count(*) filter (where status = 'delivered')::int as count_delivered,
      count(*) filter (where status = 'cancelled')::int as count_cancelled,
      count(*) filter (where status = 'returned')::int as count_returned
    from public.orders
  `;

  return {
    ordersToday: row?.orders_today ?? 0,
    salesTodayMad: row?.sales_today ?? "0",
    sales7DaysMad: row?.sales_7d ?? "0",
    salesThisMonthMad: row?.sales_month ?? "0",
    countsByStatus: {
      new: row?.count_new ?? 0,
      confirmed: row?.count_confirmed ?? 0,
      preparing: row?.count_preparing ?? 0,
      shipped: row?.count_shipped ?? 0,
      delivered: row?.count_delivered ?? 0,
      cancelled: row?.count_cancelled ?? 0,
      returned: row?.count_returned ?? 0,
    },
  };
}

export async function getAdminOrderById(id: number): Promise<AdminOrderDetail | null> {
  const rows = await sql<
    {
      id: number;
      order_number: string;
      public_reference: string;
      status: OrderStatus;
      customer_name: string;
      customer_phone: string;
      customer_city: string;
      customer_address: string;
      customer_notes: string | null;
      items_subtotal: string;
      carton_count: number | null;
      delivery_fee: string | null;
      final_total: string | null;
      created_at: string;
    }[]
  >`
    select id, order_number, public_reference, status, customer_name,
      customer_phone, customer_city, customer_address, customer_notes,
      items_subtotal, carton_count, delivery_fee, final_total, created_at
    from public.orders where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    orderNumber: row.order_number,
    publicReference: row.public_reference,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerCity: row.customer_city,
    customerAddress: row.customer_address,
    customerNotes: row.customer_notes,
    itemsSubtotal: row.items_subtotal,
    cartonCount: row.carton_count,
    deliveryFee: row.delivery_fee,
    finalTotal: row.final_total,
    createdAt: row.created_at,
  };
}

export async function getAdminOrderItems(orderId: number): Promise<AdminOrderItem[]> {
  // وحدة البيع (قطعة/متر/طقم...) ليست جزءاً من الصورة المجمَّدة (snapshot)
  // في order_items، فنجلبها بأفضل مجهود من المنتج الحالي (LEFT JOIN)؛ تبقى
  // فارغة فقط إذا حُذف المنتج نهائياً لاحقاً.
  const rows = await sql<
    {
      id: number;
      product_id: number | null;
      variant_id: number | null;
      product_name_snapshot: string;
      sku_snapshot: string;
      unit_price_snapshot: string;
      quantity: number;
      line_total: string;
      unit_label: string | null;
    }[]
  >`
    select oi.id, oi.product_id, oi.variant_id, oi.product_name_snapshot, oi.sku_snapshot,
      oi.unit_price_snapshot, oi.quantity, oi.line_total, p.unit_label
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.order_id = ${orderId}
    order by oi.id asc
  `;

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    variantId: r.variant_id,
    productNameSnapshot: r.product_name_snapshot,
    skuSnapshot: r.sku_snapshot,
    unitPriceSnapshot: r.unit_price_snapshot,
    quantity: r.quantity,
    lineTotal: r.line_total,
    unitLabel: r.unit_label,
  }));
}

export async function getAdminOrderStatusHistory(
  orderId: number
): Promise<AdminOrderStatusHistoryEntry[]> {
  const rows = await sql<
    { status: string; note: string | null; changed_by: string | null; changed_at: string }[]
  >`
    select status, note, changed_by, changed_at
    from public.order_status_history where order_id = ${orderId} order by changed_at asc
  `;
  return rows.map((r) => ({
    status: r.status,
    note: r.note,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  }));
}
