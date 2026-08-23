import { createOrder } from "@/lib/orders/createOrder";
import { revalidateCatalog } from "@/lib/queries/catalogCache";
import type {
  CartItemInput,
  CreateOrderResult,
  CreateOrderRequestContext,
} from "@/lib/orders/types";

/**
 * مسار إنشاء طلب الزبون من الموقع، في مكان واحد.
 *
 * يستدعيه طرفان: Server Action القديمة (تبقى لاختبارات دورة الطلب)، ومسار
 * /api/orders الذي يستعمله المتصفح. السبب في وجود المسار أصلاً أن طلب
 * Server Action يُقطع حين يغادر الزبون الصفحة إلى واتساب، فيضيع الطلب؛ أما
 * fetch عادي فيقبل `keepalive` ويُكمل بعد المغادرة. ولأن الاثنين يجب أن
 * ينشئا الطلب بنفس الطريقة تماماً، المنطق هنا لا هناك.
 */

export type WebCheckoutInput = {
  cartItems: unknown;
  fullName: unknown;
  phone: unknown;
  city: unknown;
  address: unknown;
  notes: unknown;
  idempotencyKey: unknown;
};

const UNREADABLE_CART: CreateOrderResult = {
  ok: false,
  errors: [
    {
      field: "items",
      message: "تعذّر قراءة محتوى السلة. الرجاء إعادة تحميل الصفحة والمحاولة مرة أخرى.",
    },
  ],
};

function parseItems(raw: unknown): CartItemInput[] | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) => ({
      productId: Number(entry.productId),
      variantId:
        entry.variantId === null || entry.variantId === undefined
          ? null
          : Number(entry.variantId),
      quantity: Number(entry.quantity),
    }));
  } catch {
    return null;
  }
}

export async function runWebCheckout(
  input: WebCheckoutInput,
  requestContext?: CreateOrderRequestContext
): Promise<CreateOrderResult> {
  const items = parseItems(input.cartItems);
  if (!items) {
    console.error("runWebCheckout: تعذّر قراءة محتوى السلة");
    return UNREADABLE_CART;
  }

  const result = await createOrder({
    items,
    customer: {
      fullName: String(input.fullName ?? ""),
      phone: String(input.phone ?? ""),
      city: String(input.city ?? ""),
      address: String(input.address ?? ""),
      notes: String(input.notes ?? "").trim() || null,
    },
    idempotencyKey: String(input.idempotencyKey ?? ""),
    requestContext,
  });

  // كل طلب ناجح يُنقص المخزون فعلياً، فنُبطل ذاكرة الكتالوج ليرى الزبون
  // التالي الكمية الصحيحة. الحماية الحقيقية من البيع الزائد تبقى شرط
  // stock_quantity داخل UPDATE نفسه، لا هذا السطر.
  if (result.ok) revalidateCatalog();

  return result;
}
