import type { CartItem } from "@/lib/cart/types";
import { resolveLineTotal, resolveUnitPrice, roundMoney } from "@/lib/pricing/tierPricing";

export function cartItemKey(productId: number, variantId: number | null): string {
  return `${productId}:${variantId ?? "base"}`;
}

/**
 * ثمن الوحدة المطبَّق فعلياً على هذا السطر بكميته الحالية.
 *
 * لا يُقرأ item.unitPrice مباشرة في أي مكان للعرض — يمر كل شيء من هنا، حتى
 * يتغيّر الثمن تلقائياً بمجرد تغيّر الكمية (9 → 10 يخفّض الثمن فوراً،
 * و10 → 9 يُرجعه) في السلة وصفحة المنتج وCheckout بنفس الحساب بالضبط.
 *
 * عنصر سلَّة قديم (محفوظ في localStorage قبل هذه الميزة) لا يحمل pricing،
 * فنرجع لثمنه المخزَّن كما هو — سلوكه القديم بلا كسر.
 */
export function cartItemUnitPrice(item: CartItem): number {
  if (!item.pricing) return item.unitPrice;
  return resolveUnitPrice(item.pricing, item.quantity);
}

export function cartItemLineTotal(item: CartItem): number {
  if (!item.pricing) return roundMoney(item.unitPrice * item.quantity);
  return resolveLineTotal(item.pricing, item.quantity);
}

export function computeSubtotal(items: CartItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + cartItemLineTotal(item), 0));
}

export function meetsMinimumOrder(subtotal: number, minOrderAmount: number): boolean {
  return subtotal >= minOrderAmount;
}

/**
 * يُقرِّب كمية مطلوبة إلى أقرب قيمة صالحة: لا تقل عن الكمية الدنيا،
 * وتكون دائماً الكمية الدنيا + مضاعف صحيح من درجة الزيادة.
 * مثال: minOrderQty=5, qtyIncrement=5 → القيم الصالحة: 5, 10, 15...
 */
export function snapQuantity(
  quantity: number,
  minOrderQty: number,
  qtyIncrement: number
): number {
  const safeMin = Math.max(1, minOrderQty);
  const safeIncrement = Math.max(1, qtyIncrement);

  if (quantity <= safeMin) return safeMin;

  const steps = Math.round((quantity - safeMin) / safeIncrement);
  return safeMin + steps * safeIncrement;
}

export function isValidQuantity(
  quantity: number,
  minOrderQty: number,
  qtyIncrement: number
): boolean {
  const safeMin = Math.max(1, minOrderQty);
  const safeIncrement = Math.max(1, qtyIncrement);

  if (quantity < safeMin) return false;
  return (quantity - safeMin) % safeIncrement === 0;
}
