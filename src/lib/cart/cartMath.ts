import type { CartItem } from "@/lib/cart/types";

export function cartItemKey(productId: number, variantId: number | null): string {
  return `${productId}:${variantId ?? "base"}`;
}

export function computeSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
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
