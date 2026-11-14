import { sql } from "@/lib/db";
import type { WhatsappLeadDetail } from "@/lib/queries/whatsappLeads";
import type { ImportedItemDraft, ImportedOrderDraft } from "@/lib/orders/importOrder";

/**
 * تحويل سجل whatsapp_lead إلى نفس شكل "مسودّة البون" (ImportedOrderDraft)
 * التي تُبنى أصلاً من قراءة بون واتساب يدوياً (importOrder.ts) — بلا أي
 * تكرار لمنطق العرض: ManualOrderForm يعرض هذه المسودّة بنفس الحقول
 * والمحرّر تماماً (OrderLinesEditor)، فقط مصدرها مختلف.
 *
 * الاسم/الهاتف/المدينة تبقى فارغة عمداً: تلك معلومات يُعطيها الزبون داخل
 * محادثة واتساب بعد هذه اللحظة، والمدير يكتبها هو حين يضغط "تحويل إلى
 * طلب" وقد حصل عليها فعلاً. **لا إنشاء طلب هنا** — فقط تجهيز المسودّة؛
 * الإنشاء الفعلي يمرّ حصراً عبر createManualOrder بعد مراجعة المدير
 * وتأكيده، تماماً كمسار استيراد البون.
 */
export async function draftFromWhatsappLead(lead: WhatsappLeadDetail): Promise<ImportedOrderDraft> {
  const productIds = [
    ...new Set(lead.items.map((item) => item.productId).filter((id): id is number => id !== null)),
  ];

  const liveProducts =
    productIds.length > 0
      ? await sql<{ id: number; stock_quantity: number; purchase_price: string | null }[]>`
          select id, stock_quantity, purchase_price from public.products where id = any(${productIds})
        `
      : [];
  const liveById = new Map(liveProducts.map((p) => [p.id, p]));

  // منتج حُذف من الكتالوج بين الضغطة والتحويل (نادر) لا يمكن إضافته لسطر
  // OrderLinesEditor (يتطلّب productId حقيقياً) — يُستبعَد هنا، والمدير
  // يراه في تفاصيل السلة الأصلية ويضيفه يدوياً إن لزم.
  const items: ImportedItemDraft[] = lead.items
    .filter((item): item is typeof item & { productId: number } => item.productId !== null)
    .map((item) => {
      const live = liveById.get(item.productId);
      return {
        sku: item.sku,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        purchasePrice: live?.purchase_price != null ? Number(live.purchase_price) : null,
        stockQuantity: live?.stock_quantity ?? 0,
        priceFromCatalog: false,
      };
    });

  return {
    customerName: "",
    phone: "",
    city: "",
    address: "",
    notes: `تحويل من طلب واتساب ${lead.reference}`,
    source: "whatsapp",
    deliveryFee: 0,
    actualDeliveryCost: null,
    items,
  };
}
