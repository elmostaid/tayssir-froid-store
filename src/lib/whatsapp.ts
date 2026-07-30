// رقم واتساب Tayssir Froid بصيغة دولية بدون علامة + (كما يتطلبه رابط wa.me)
const WHATSAPP_NUMBER = "212722083458";

export function buildWhatsAppLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function buildProductWhatsAppLink(productName: string, sku: string): string {
  return buildWhatsAppLink(`مرحباً، أريد الاستفسار عن المنتج: ${productName} (${sku})`);
}
