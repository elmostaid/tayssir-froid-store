import { sql } from "@/lib/db";

// قراءة آمنة فقط: لا نلمس هنا purchase_price ولا أي جدول آخر غير orders/order_items،
// ولا نعرض شيئاً سوى ما أدخله الزبون نفسه وملخص منتجاته.

export type OrderSummary = {
  publicReference: string;
  status: string;
  customerName: string;
  customerCity: string;
  itemsSubtotal: string;
  createdAt: string;
};

export type OrderLineSummary = {
  productNameSnapshot: string;
  skuSnapshot: string;
  unitPriceSnapshot: string;
  quantity: number;
  lineTotal: string;
};

export async function getOrderByPublicReference(
  reference: string
): Promise<OrderSummary | null> {
  const rows = await sql<OrderSummary[]>`
    select
      public_reference as "publicReference",
      status,
      customer_name as "customerName",
      customer_city as "customerCity",
      items_subtotal as "itemsSubtotal",
      created_at as "createdAt"
    from public.orders
    where public_reference = ${reference}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function getOrderItemsByPublicReference(
  reference: string
): Promise<OrderLineSummary[]> {
  return sql<OrderLineSummary[]>`
    select
      oi.product_name_snapshot as "productNameSnapshot",
      oi.sku_snapshot as "skuSnapshot",
      oi.unit_price_snapshot as "unitPriceSnapshot",
      oi.quantity,
      oi.line_total as "lineTotal"
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.public_reference = ${reference}
    order by oi.id asc
  `;
}
