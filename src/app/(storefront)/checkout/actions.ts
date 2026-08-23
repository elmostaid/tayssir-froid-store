"use server";

import { headers, cookies } from "next/headers";
import { runWebCheckout } from "@/lib/orders/webCheckout";
import type { CreateOrderResult, CreateOrderRequestContext } from "@/lib/orders/types";

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
    await readRequestContext()
  );
}
