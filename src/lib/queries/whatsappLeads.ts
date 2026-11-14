import { sql } from "@/lib/db";

// استعلامات لوحة إدارة "طلبات واتساب" فقط — لا تُستعمل خارج مسارات /admin.

export type WhatsappLeadStatus = "whatsapp_pending" | "converted" | "abandoned";

export type WhatsappLeadItem = {
  productId: number | null;
  variantId: number | null;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type WhatsappLeadListItem = {
  id: number;
  reference: string;
  status: WhatsappLeadStatus;
  itemsSubtotal: string;
  itemCount: number;
  createdAt: string;
  convertedOrderId: number | null;
};

export type WhatsappLeadDetail = WhatsappLeadListItem & {
  items: WhatsappLeadItem[];
  attributionFirst: unknown;
  attributionLast: unknown;
};

export async function listWhatsappLeads(params: {
  status?: WhatsappLeadStatus;
} = {}): Promise<WhatsappLeadListItem[]> {
  const rows = await sql<
    {
      id: number;
      reference: string;
      status: WhatsappLeadStatus;
      items_subtotal: string;
      item_count: number;
      created_at: string;
      converted_order_id: number | null;
    }[]
  >`
    select
      id, reference, status, items_subtotal,
      jsonb_array_length(items) as item_count,
      created_at, converted_order_id
    from public.whatsapp_leads
    where ${params.status ? sql`status = ${params.status}` : sql`true`}
    order by created_at desc
    limit 200
  `;

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    itemsSubtotal: row.items_subtotal,
    itemCount: row.item_count,
    createdAt: row.created_at,
    convertedOrderId: row.converted_order_id,
  }));
}

export async function countPendingWhatsappLeads(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.whatsapp_leads where status = 'whatsapp_pending'
  `;
  return row?.count ?? 0;
}

export async function getWhatsappLeadById(id: number): Promise<WhatsappLeadDetail | null> {
  const rows = await sql<
    {
      id: number;
      reference: string;
      status: WhatsappLeadStatus;
      items: WhatsappLeadItem[];
      items_subtotal: string;
      created_at: string;
      converted_order_id: number | null;
      attribution_first: unknown;
      attribution_last: unknown;
    }[]
  >`
    select id, reference, status, items, items_subtotal, created_at,
           converted_order_id, attribution_first, attribution_last
    from public.whatsapp_leads
    where id = ${id}
  `;
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    itemsSubtotal: row.items_subtotal,
    itemCount: row.items.length,
    createdAt: row.created_at,
    convertedOrderId: row.converted_order_id,
    items: row.items,
    attributionFirst: row.attribution_first,
    attributionLast: row.attribution_last,
  };
}

export type WhatsappInquiryListItem = {
  reference: string;
  kind: "general" | "product";
  productSku: string | null;
  pagePath: string | null;
  utmCampaign: string | null;
  adConsent: string;
  convertedOrderId: number | null;
  convertedOrderNumber: string | null;
  createdAt: string;
};

/**
 * آخر الاستفسارات (Q-) — ليجد المدير المرجع حتى لو حذفه الزبون من رسالته:
 * الوقت والصفحة والمنتج تكفي لمطابقة محادثة. لا هاتف ولا اسم هنا: الاستفسار
 * لا يحملهما أصلاً.
 */
export async function listRecentWhatsappInquiries(limit = 50): Promise<WhatsappInquiryListItem[]> {
  const rows = await sql<
    {
      reference: string;
      kind: "general" | "product";
      product_sku: string | null;
      page_path: string | null;
      utm_campaign: string | null;
      ad_consent: string;
      converted_order_id: number | null;
      order_number: string | null;
      created_at: string;
    }[]
  >`
    select q.reference, q.kind, q.product_sku, q.page_path,
           coalesce(q.attribution_last->>'utmCampaign', q.attribution_first->>'utmCampaign') as utm_campaign,
           q.ad_consent, q.converted_order_id, o.order_number, q.created_at
    from public.whatsapp_inquiries q
    left join public.orders o on o.id = q.converted_order_id
    order by q.created_at desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    reference: r.reference,
    kind: r.kind,
    productSku: r.product_sku,
    pagePath: r.page_path,
    utmCampaign: r.utm_campaign,
    adConsent: r.ad_consent,
    convertedOrderId: r.converted_order_id,
    convertedOrderNumber: r.order_number,
    createdAt: r.created_at,
  }));
}
