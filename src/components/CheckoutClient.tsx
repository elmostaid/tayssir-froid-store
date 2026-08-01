"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/CartProvider";
import { submitOrder, type CheckoutState } from "@/app/(storefront)/checkout/actions";
import { formatMad } from "@/lib/format";
import { cartItemKey } from "@/lib/cart/cartMath";

const initialState: CheckoutState = { ok: null };

export function CheckoutClient({
  deliveryFeePerCartonMad,
}: {
  deliveryFeePerCartonMad: number;
}) {
  const { items, subtotal, isHydrated, clearCart } = useCart();
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, formAction, isPending] = useActionState(submitOrder, initialState);

  useEffect(() => {
    if (state.ok === true) {
      clearCart();
      router.push(`/order/${state.publicReference}`);
    }
  }, [state, clearCart, router]);

  const cartItemsJson = useMemo(
    () =>
      JSON.stringify(
        items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        }))
      ),
    [items]
  );

  if (!isHydrated) {
    return (
      <p className="mx-auto max-w-xl px-4 py-10 text-sm text-neutral-500">
        جارٍ التحميل…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-bold text-neutral-800">سلتك فارغة</h1>
        <Link
          href="/"
          className="mt-4 inline-block rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white"
        >
          العودة إلى الرئيسية
        </Link>
      </div>
    );
  }

  const errors = state.ok === false ? state.errors : [];
  const fieldMessage = (field: string) =>
    errors.find((e) => e.field === field)?.message;
  const itemErrors = errors.filter(
    (e) => e.field === "items" || e.field.startsWith("item:")
  );
  const generalError = errors.find((e) => e.field === "general");

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="border-r-4 border-brand-turquoise pr-3 text-xl font-bold text-neutral-800">
        إتمام الطلب
      </h1>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">ملخص الطلب</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-700">
          {items.map((item) => (
            <li
              key={cartItemKey(item.productId, item.variantId)}
              className="flex items-center justify-between"
            >
              <span>
                {item.name}
                {item.variantName && ` — ${item.variantName}`} × {item.quantity}
              </span>
              <span className="font-medium">
                {formatMad(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-sm font-bold">
          <span>مجموع المنتجات</span>
          <span className="text-brand-orange">{formatMad(subtotal)}</span>
        </div>
        <p className="mt-2 rounded-lg bg-brand-turquoise-tint px-3 py-2 text-xs text-brand-turquoise-dark">
          هذا المجموع لا يشمل التوصيل. مصاريف التوصيل ({formatMad(deliveryFeePerCartonMad)}{" "}
          لكل كرطونة) ستُحسب بعد تجهيز الطلب وتحديد عدد الكرطونات من طرف
          فريقنا، وسنتواصل معكم لتأكيد المجموع النهائي قبل الشحن.
        </p>
      </div>

      {itemErrors.length > 0 && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {itemErrors.map((e, i) => (
            <p key={i}>{e.message}</p>
          ))}
          <Link href="/cart" className="mt-1 inline-block font-semibold underline">
            العودة للسلة لتعديلها
          </Link>
        </div>
      )}

      {generalError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {generalError.message}
        </p>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="cartItems" value={cartItemsJson} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            الاسم الكامل *
          </span>
          <input
            name="fullName"
            required
            maxLength={100}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          {fieldMessage("fullName") && (
            <span className="mt-1 block text-xs text-red-600">
              {fieldMessage("fullName")}
            </span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            رقم الهاتف *
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="0612345678"
            required
            pattern="^(?:\+212|0)[5-7]\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}$"
            title="رقم هاتف مغربي صالح، مثال: 0612345678"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            رقم مغربي يبدأ بـ 06 أو 07 أو 05 (أو +212)، مثال: 0612345678
          </span>
          {fieldMessage("phone") && (
            <span className="mt-1 block text-xs text-red-600">
              {fieldMessage("phone")}
            </span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            المدينة *
          </span>
          <input
            name="city"
            required
            maxLength={100}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          {fieldMessage("city") && (
            <span className="mt-1 block text-xs text-red-600">
              {fieldMessage("city")}
            </span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            العنوان الكامل *
          </span>
          <textarea
            name="address"
            required
            rows={2}
            maxLength={300}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          {fieldMessage("address") && (
            <span className="mt-1 block text-xs text-red-600">
              {fieldMessage("address")}
            </span>
          )}
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            ملاحظات (اختياري)
          </span>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          {fieldMessage("notes") && (
            <span className="mt-1 block text-xs text-red-600">
              {fieldMessage("notes")}
            </span>
          )}
        </label>

        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
          طريقة الدفع: الدفع عند الاستلام فقط. يمكنك معاينة السلعة عند
          الاستلام قبل الأداء. هذا طلب أولي في انتظار تأكيد فريقنا.
        </p>

        <button
          type="submit"
          disabled={isPending}
          className="mt-1 rounded-full bg-brand-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {isPending ? "جارٍ الإرسال…" : "إرسال الطلب"}
        </button>
      </form>
    </div>
  );
}
