"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { formatMad, formatMinOrderAmount } from "@/lib/format";
import { cartItemKey, cartItemLineTotal, cartItemUnitPrice } from "@/lib/cart/cartMath";
import { isValidMoroccanPhone } from "@/lib/phone";
import { buildOrderWhatsAppMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { submitOrder, type CheckoutState } from "@/app/(storefront)/checkout/actions";
import { trackInitiateCheckout, trackPurchase } from "@/lib/pixel/fbq";

const SAVE_ORDER_MAX_ATTEMPTS = 3;
const SAVE_ORDER_RETRY_DELAYS_MS = [800, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// يعيد المحاولة فقط على فشل تقني عام (مشكلة اتصال بقاعدة البيانات مثلاً) —
// وليس على أخطاء تحقق/منطق (سعر خاطئ، مخزون غير كافٍ، حد أدنى...) التي لن
// تتغيّر نتيجتها بإعادة المحاولة بنفس البيانات. idempotencyKey الثابتة عبر
// المحاولات تمنع أي طلب مكرر حتى لو نجحت محاولة سابقة قبل وصول جوابها.
// إن فشلت كل المحاولات، نُسجّل خطأً واضحاً فـlogs الخادم بدل إخفاء المشكلة
// بالكامل — هذا يبقى العلامة الوحيدة على أن طلباً وصل عبر واتساب دون أن
// يُسجَّل بلوحة الإدارة، إلى أن يُصلَح سبب الفشل.
// نفس منطق إعادة المحاولة بالضبط (بلا أي تعديل) — الإضافة الوحيدة هنا هي
// إرجاع نتيجة submitOrder بدل تجاهلها، ليقدر handleSubmit وحده أن يقرر
// إطلاق Purchase (Meta Pixel) فقط عند نجاح حقيقي مؤكَّد من قاعدة البيانات
// (result.ok === true)، لا بمجرد الضغط على الزر. لا تأثير على قرار
// إعادة المحاولة نفسه، ولا على مسار واتساب، ولا على أي منطق طلب/مخزون.
async function saveOrderWithRetry(formData: FormData): Promise<CheckoutState | null> {
  let lastFailure: unknown = null;
  let lastResult: CheckoutState | null = null;

  for (let attempt = 1; attempt <= SAVE_ORDER_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await submitOrder({ ok: null }, formData);
      if (result.ok !== false) {
        return result;
      }
      lastResult = result;
      const isGenericFailure = result.errors.some((err) => err.field === "general");
      if (!isGenericFailure) {
        console.error(
          "submitOrder (خلفية، لا تؤثر على واتساب): فشل تحقق/منطق غير قابل لإعادة المحاولة",
          result.errors
        );
        return result;
      }
      lastFailure = result.errors;
    } catch (err) {
      lastFailure = err;
    }

    if (attempt < SAVE_ORDER_MAX_ATTEMPTS) {
      await delay(SAVE_ORDER_RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  console.error(
    `submitOrder (خلفية): فشل حفظ الطلب نهائياً بعد ${SAVE_ORDER_MAX_ATTEMPTS} محاولات — ` +
      "الطلب وصل عبر واتساب لكنه لم يُسجَّل في لوحة الإدارة، يلزم تسجيله يدوياً وفحص سبب الفشل",
    lastFailure
  );
  return lastResult;
}

// إتمام الطلب يفتح رسالة واتساب جاهزة بمعلومات الزبون والمنتجات مباشرة —
// هذا هو المسار الذي يراه الزبون فعلياً ولا يتغيّر أبداً بنجاح الحفظ أو
// فشله. بالتوازي (وليس بدلاً عن ذلك)، نحاول حفظ نفس الطلب في نظام الطلبات
// الحقيقي (رقم طلب، لوحة إدارة، بون تحضير) عبر submitOrder — بأفضل مجهود:
// إن فشل الاتصال بقاعدة البيانات لأي سبب، لا نُظهر أي خطأ للزبون ولا نغيّر
// رسالة واتساب أو وجهتها، فقط نُسجّل الفشل في الخادم للتصحيح لاحقاً.
export function CheckoutClient({
  minOrderAmountMad,
  deliveryFeePerCartonMad,
  whatsappNumber,
  storeName,
  codEnabled,
}: {
  minOrderAmountMad: number;
  deliveryFeePerCartonMad: number;
  whatsappNumber: string;
  storeName: string;
  codEnabled: boolean;
}) {
  const { items, subtotal, isHydrated, clearCart } = useCart();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const hasTrackedInitiateCheckout = useRef(false);
  const hasTrackedPurchase = useRef(false);

  const belowMinimum = subtotal < minOrderAmountMad;

  // InitiateCheckout: مرة واحدة فقط عند بدء Checkout فعلياً (السلة محمَّلة
  // من localStorage وغير فارغة) — الـref يمنع أي تكرار حتى لو أُعيد رندر
  // المكوّن عدة مرات (كتابة فالحقول مثلاً) قبل أن يصل الزبون لنهاية الفورم.
  useEffect(() => {
    if (hasTrackedInitiateCheckout.current) return;
    if (!isHydrated || items.length === 0) return;
    hasTrackedInitiateCheckout.current = true;
    trackInitiateCheckout({
      items: items.map((item) => ({ sku: item.sku, quantity: item.quantity, price: cartItemUnitPrice(item) })),
      value: subtotal,
      eventId: crypto.randomUUID(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, items.length]);

  const whatsappHref = useMemo(() => {
    if (items.length === 0) return null;
    const message = buildOrderWhatsAppMessage({
      storeName,
      customer: { fullName, phone, city, address, notes },
      items,
      subtotal,
    });
    return buildWhatsAppLink(whatsappNumber, message);
  }, [storeName, whatsappNumber, fullName, phone, city, address, notes, items, subtotal]);

  if (!isHydrated) {
    return (
      <p className="mx-auto max-w-xl px-4 py-10 text-sm text-neutral-500">
        جارٍ التحميل…
      </p>
    );
  }

  if (items.length === 0 && !sent) {
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

  if (sent) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-bold text-neutral-800">
          تم فتح واتساب لإرسال طلبك
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          إذا لم يفتح واتساب تلقائياً، اضغط على الزر أدناه لإرسال الطلب. سنتواصل
          معكم لتأكيد الطلب والمجموع النهائي شامل التوصيل.
        </p>
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block rounded-full bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white"
          >
            فتح واتساب الآن
          </a>
        )}
        <div className="mt-4">
          <Link href="/" className="text-sm font-semibold text-brand-turquoise-dark underline">
            العودة إلى الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!codEnabled) {
      setError(
        "استقبال الطلبات الجديدة متوقف مؤقتاً. الرجاء التواصل معنا عبر واتساب مباشرة."
      );
      return;
    }
    if (belowMinimum) {
      setError(
        `المجموع الحالي (${formatMad(subtotal)}) أقل من الحد الأدنى للطلب (${formatMinOrderAmount(
          minOrderAmountMad
        )})، دون احتساب التوصيل. أضف منتجات أخرى للوصول إلى الحد الأدنى.`
      );
      return;
    }
    if (!isValidMoroccanPhone(phone)) {
      setError("رقم الهاتف غير صحيح. يجب أن يكون رقماً مغربياً صالحاً (مثال: 0612345678).");
      return;
    }
    if (!fullName.trim() || !city.trim() || !address.trim()) {
      setError("الرجاء تعبئة جميع الحقول الإجبارية.");
      return;
    }

    const message = buildOrderWhatsAppMessage({
      storeName,
      customer: { fullName, phone, city, address, notes },
      items,
      subtotal,
    });
    const link = buildWhatsAppLink(whatsappNumber, message);

    // محاولة حفظ الطلب فنظام الطلبات الحقيقي (رقم طلب + بون تحضير) بأفضل
    // مجهود، قبل التوجه لواتساب — بانتظار انتهائها (نجحت أو فشلت) لضمان
    // أكبر فرصة لإتمام الحفظ قبل أن يغادر المتصفح الصفحة، دون أن يرى الزبون
    // أي أثر لنجاحها أو فشلها. idempotencyKey ثابتة عبر كل المحاولات، فحتى
    // لو نجحت محاولة سابقة قبل أن يصلنا الجواب (خطأ شبكة مثلاً)، لن يتكرر
    // الطلب أبداً — نفس الطلب فقط يُعاد إرجاعه.
    setIsSubmitting(true);
    const formData = new FormData();
    formData.set(
      "cartItems",
      JSON.stringify(
        items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        }))
      )
    );
    formData.set("fullName", fullName);
    formData.set("phone", phone);
    formData.set("city", city);
    formData.set("address", address);
    formData.set("notes", notes);
    formData.set("idempotencyKey", idempotencyKey);

    const saveResult = await saveOrderWithRetry(formData);

    // Purchase: فقط بعد نجاح حقيقي مؤكَّد من قاعدة البيانات (createOrder
    // أرجعت ok:true فعلاً)، وليس بمجرد الضغط على "إرسال الطلب" — طلب فشل
    // حفظه (مشكلة اتصال مثلاً) لا يُطلِق Purchase أبداً، رغم أن رسالة
    // واتساب تُرسَل فكلتا الحالتين (سلوك واتساب بلا أي تغيير). event_id هو
    // idempotencyKey نفسه (ثابت عبر كل محاولات إعادة الحفظ لنفس الطلب)،
    // ليُستعمَل لاحقاً كـevent_id لنفس الحدث عبر Conversions API فـ
    // deduplication. الـref يمنع أي إطلاق مزدوج حتى لو استُدعيت handleSubmit
    // مرتين (نقر مزدوج سريع قبل تعطيل الزر).
    if (saveResult?.ok === true && !hasTrackedPurchase.current) {
      hasTrackedPurchase.current = true;
      trackPurchase({
        items: items.map((item) => ({ sku: item.sku, quantity: item.quantity, price: cartItemUnitPrice(item) })),
        value: subtotal,
        eventId: idempotencyKey,
      });
    }

    clearCart();
    setSent(true);
    window.location.href = link;
  }

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
                {formatMad(cartItemLineTotal(item))}
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

      {!codEnabled && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>
            استقبال الطلبات الجديدة متوقف مؤقتاً. الرجاء التواصل معنا عبر
            واتساب مباشرة لإتمام طلبكم.
          </p>
          {whatsappHref && (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold underline">
              تواصل معنا عبر واتساب
            </a>
          )}
        </div>
      )}

      {belowMinimum && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>
            المجموع الحالي ({formatMad(subtotal)}) أقل من الحد الأدنى للطلب (
            {formatMinOrderAmount(minOrderAmountMad)}).
          </p>
          <Link href="/cart" className="mt-1 inline-block font-semibold underline">
            العودة للسلة لتعديلها
          </Link>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            الاسم الكامل *
          </span>
          <input
            name="fullName"
            required
            maxLength={100}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
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
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            رقم مغربي يبدأ بـ 06 أو 07 أو 05 (أو +212)، مثال: 0612345678
          </span>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            المدينة *
          </span>
          <input
            name="city"
            required
            maxLength={100}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
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
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-700">
            ملاحظات (اختياري)
          </span>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
          />
        </label>

        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
          طريقة الدفع: الدفع عند الاستلام فقط. يمكنك معاينة السلعة عند
          الاستلام قبل الأداء. سيُرسَل طلبك عبر واتساب مباشرة لفريقنا لتأكيده.
        </p>

        <button
          type="submit"
          disabled={isSubmitting || !codEnabled}
          className="mt-1 rounded-full bg-brand-orange px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {isSubmitting ? "جارٍ الإرسال…" : "إرسال الطلب عبر واتساب"}
        </button>
      </form>
    </div>
  );
}
