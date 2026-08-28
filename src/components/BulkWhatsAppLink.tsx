import { buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * رابط التفاوض على الكميات الكبيرة عبر واتساب.
 *
 * مستقل تماماً عن نمط التسعير (show_bulk_whatsapp عمود منفصل): يمكن تفعيله
 * على منتج بثمن واحد كما على منتج بثلاثة مستويات. ولا يمنع إطلاقاً الشراء
 * المباشر من الموقع — هو رابط إضافي بجانب الثمن، لا بديل عن زر السلة.
 *
 * ملاحظة: هذا غير رابط "استفسار عبر واتساب" العام الموجود أصلاً في صفحة
 * المنتج؛ ذاك لم يتغيّر ويبقى ظاهراً كما هو لكل المنتجات.
 */
export function BulkWhatsAppLink({
  whatsappNumber,
  productName,
  sku,
}: {
  whatsappNumber: string;
  productName: string;
  sku: string;
}) {
  const href = buildWhatsAppLink(
    whatsappNumber,
    `مرحباً، باغي كمية كبيرة من: ${productName} (${sku}). شنو هو الثمن الخاص؟`
  );

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-whatsapp-dark hover:underline"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.36 5.07L2 22l5.11-1.34A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 18c-1.6 0-3.1-.43-4.4-1.19l-.32-.19-3.03.8.81-2.95-.2-.3A7.95 7.95 0 0 1 4 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8Z" />
      </svg>
      باغي كمية كبيرة؟ تواصل معنا عبر واتساب لثمن خاص
    </a>
  );
}
