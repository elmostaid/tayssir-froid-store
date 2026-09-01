"use server";

import { runWebCheckout } from "@/lib/orders/webCheckout";
import { readOrderRequestContext } from "@/lib/orders/requestContext";
import type { CreateOrderResult } from "@/lib/orders/types";

export type CheckoutState = CreateOrderResult | { ok: null };

export async function submitOrder(
  _prevState: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  // المنطق كله في runWebCheckout، يشاركه مسار /api/orders الذي يستعمله
  // المتصفح فعلياً (يقبل keepalive فيبقى حياً بعد مغادرة الزبون). تبقى هذه
  // الدالة لأن اختبارات دورة الطلب تدخل من هنا.
  return runWebCheckout(
    {
      cartItems: formData.get("cartItems"),
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      city: formData.get("city"),
      address: formData.get("address"),
      notes: formData.get("notes"),
      idempotencyKey: formData.get("idempotencyKey"),
    },
    await readOrderRequestContext()
  );
}
