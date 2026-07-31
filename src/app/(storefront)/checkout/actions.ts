"use server";

import { createOrder } from "@/lib/orders/createOrder";
import type { CreateOrderResult, CartItemInput } from "@/lib/orders/types";

export type CheckoutState = CreateOrderResult | { ok: null };

export async function submitOrder(
  _prevState: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  let items: CartItemInput[] = [];
  try {
    const raw = JSON.parse(String(formData.get("cartItems") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error("cartItems ليست مصفوفة");
    items = raw.map((entry) => ({
      productId: Number(entry.productId),
      variantId: entry.variantId === null || entry.variantId === undefined
        ? null
        : Number(entry.variantId),
      quantity: Number(entry.quantity),
    }));
  } catch (error) {
    console.error("submitOrder: تعذّر قراءة محتوى السلة", error);
    return {
      ok: false,
      errors: [
        {
          field: "items",
          message: "تعذّر قراءة محتوى السلة. الرجاء إعادة تحميل الصفحة والمحاولة مرة أخرى.",
        },
      ],
    };
  }

  return createOrder({
    items,
    customer: {
      fullName: String(formData.get("fullName") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      city: String(formData.get("city") ?? ""),
      address: String(formData.get("address") ?? ""),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
}
