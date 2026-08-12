"use server";

import { headers, cookies } from "next/headers";
import { createOrder } from "@/lib/orders/createOrder";
import type { CreateOrderResult, CartItemInput, CreateOrderRequestContext } from "@/lib/orders/types";

export type CheckoutState = CreateOrderResult | { ok: null };

// بيانات اختيارية بحتة لتحسين جودة مطابقة Meta CAPI (انظر createOrder.ts) —
// أفضل مجهود فقط: أي فشل هنا (بيئة اختبار بلا سياق طلب حقيقي مثلاً) يُنتج
// undefined بلا أي استثناء، ولا يؤثِّر إطلاقاً على إنشاء الطلب نفسه.
async function readRequestContext(): Promise<CreateOrderRequestContext | undefined> {
  try {
    const headerList = await headers();
    const cookieStore = await cookies();
    const forwardedFor = headerList.get("x-forwarded-for");
    return {
      clientIpAddress: forwardedFor?.split(",")[0]?.trim() || headerList.get("x-real-ip") || undefined,
      clientUserAgent: headerList.get("user-agent") || undefined,
      fbp: cookieStore.get("_fbp")?.value,
      fbc: cookieStore.get("_fbc")?.value,
      eventSourceUrl: headerList.get("referer") || undefined,
    };
  } catch {
    return undefined;
  }
}

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
    requestContext: await readRequestContext(),
  });
}
