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
