"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "@/components/CartProvider";
import { formatMad } from "@/lib/format";
import { cartItemKey } from "@/lib/cart/cartMath";
import { isValidMoroccanPhone } from "@/lib/phone";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import {
  buildConfirmedOrderMessage,
  buildRescueOrderMessage,
  orderReferenceFromKey,
} from "@/lib/orders/orderMessage";
import type { CheckoutState } from "@/app/(storefront)/checkout/actions";
import { trackInitiateCheckout, trackPurchase } from "@/lib/pixel/fbq";
import { trackAnalyticsEvent } from "@/lib/analytics/track";
import { trackGaBeginCheckout, trackGaPurchase, type GaItem } from "@/lib/ga/ecommerce";
import type { CartItem } from "@/lib/cart/types";

/**
 * أقصى ما ننتظره تأكيد حفظ الطلب قبل أن نخرج بالزبون إلى واتساب.
 *
 * كان الكود ينتظر الحفظ كاملاً (3 محاولات بفواصل 800ms و2000ms) قبل
 * التحويل. مع connect_timeout=5s وstatement_timeout=8s فـdb.ts، أسوأ حالة
 * تُبقي الزبون أمام «جارٍ الإرسال…» نحو 27 ثانية — وقاعدة Production تُخطئ
 * فعلاً بـCONNECT_TIMEOUT تحت الحِمل. الآن الحفظ يبدأ ولا نرتبط بمصيره:
 * إن تأكّد داخل هذه المهلة أرسلنا رسالة مختصرة برقم الطلب، وإلا خرجنا
 * فوراً برسالة تحمل الطلبية نفسها. الحفظ يُكمل في الخلفية بفضل keepalive.
 */
const SAVE_CONFIRM_TIMEOUT_MS = 2500;

/** علامة "انتهت المهلة" — تميّزها عن جواب فشل حقيقي من الخادم. */
const TIMED_OUT = Symbol("timed-out");

/**
 * سطر سلة → منتج كما يفهمه GA4. مُشتق واحد يستعمله begin_checkout و
 * purchase معاً، فيستحيل أن تفترق قائمة المنتجات بين الحدثين.
 */
function toGaItem(item: CartItem): GaItem {
  return {
    sku: item.sku,
    name: item.name,
    price: item.unitPrice,
    quantity: item.quantity,
    variant: item.variantName,
  };
}

// إتمام الطلب يفتح رسالة واتساب جاهزة بمعلومات الزبون والمنتجات مباشرة —
// هذا هو المسار الذي يراه الزبون فعلياً ولا يتغيّر أبداً بنجاح الحفظ أو
// فشله. بالتوازي (وليس بدلاً عن ذلك)، نحاول حفظ نفس الطلب في نظام الطلبات
// الحقيقي (رقم طلب، لوحة إدارة، بون تحضير) عبر submitOrder — بأفضل مجهود:
// إن فشل الاتصال بقاعدة البيانات لأي سبب، لا نُظهر أي خطأ للزبون ولا نغيّر
// رسالة واتساب أو وجهتها، فقط نُسجّل الفشل في الخادم للتصحيح لاحقاً.
export function CheckoutClient({
  deliveryFeePerCartonMad,
  whatsappNumber,
  storeName,
  codEnabled,
}: {
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

  // InitiateCheckout: مرة واحدة فقط عند بدء Checkout فعلياً (السلة محمَّلة
  // من localStorage وغير فارغة) — الـref يمنع أي تكرار حتى لو أُعيد رندر
  // المكوّن عدة مرات (كتابة فالحقول مثلاً) قبل أن يصل الزبون لنهاية الفورم.
  useEffect(() => {
    if (hasTrackedInitiateCheckout.current) return;
    if (!isHydrated || items.length === 0) return;
    hasTrackedInitiateCheckout.current = true;
    trackInitiateCheckout({
      items: items.map((item) => ({ sku: item.sku, quantity: item.quantity, price: item.unitPrice })),
      value: subtotal,
      eventId: crypto.randomUUID(),
    });
    // القياس الداخلي، بنفس الشرط ونفس الـref بالضبط — سطر مضاف لا يغيّر أي
    // منطق قائم أعلاه.
    trackAnalyticsEvent("begin_checkout", { cartValue: subtotal });
    // GA4، تحت نفس الشرط ونفس الـref بالضبط — فلا يمكن أن يُرسَل مرتين.
    trackGaBeginCheckout({ items: items.map(toGaItem), value: subtotal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, items.length]);

  // رابط احتياطي مسقوف الطول: يظهر في شاشة "تم الإرسال" وحين يكون استقبال
  // الطلبات موقوفاً. كان يستعمل السرد الكامل، فيبلغ عشرات الكيلوبايتات في
  // السلات الكبيرة — وهو نفس الرابط الذي كان يفشل فتحه.
  const [sentHref, setSentHref] = useState<string | null>(null);
  const whatsappHref = useMemo(() => {
    if (items.length === 0) return null;
    return buildWhatsAppLink(
      whatsappNumber,
      buildRescueOrderMessage({
        storeName,
        customer: { fullName, phone, city, address, notes },
        reference: orderReferenceFromKey(idempotencyKey),
        items,
        subtotal,
        whatsappNumber,
      })
    );
  }, [storeName, whatsappNumber, fullName, phone, city, address, notes, items, subtotal, idempotencyKey]);

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
        {(sentHref ?? whatsappHref) && (
          <a
            href={sentHref ?? whatsappHref ?? undefined}
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
    if (!isValidMoroccanPhone(phone)) {
      setError("رقم الهاتف غير صحيح. يجب أن يكون رقماً مغربياً صالحاً (مثال: 0612345678).");
      return;
    }
    // العنوان ليس ضمن هذا الشرط: الاسم والهاتف والمدينة تكفي لتأكيد الطلب،
    // ومكان التسليم يُتَّفق عليه في المكالمة. كان فرضُه يوقف الزبون عند آخر
    // حقل قبل واتساب.
    if (!fullName.trim() || !city.trim()) {
      setError("الرجاء تعبئة جميع الحقول الإجبارية.");
      return;
    }

    setIsSubmitting(true);

    const customer = { fullName, phone, city, address, notes };
    const reference = orderReferenceFromKey(idempotencyKey);

    // رابط جاهز قبل أي اتصال بالخادم: يحمل الطلبية نفسها بصيغة مضغوطة. لو
    // انهار كل ما بعده، الزبون يخرج بهذا ولا تضيع طلبيته.
    let link = buildWhatsAppLink(
      whatsappNumber,
      buildRescueOrderMessage({ storeName, customer, reference, items, subtotal, whatsappNumber })
    );

    try {
      // نبدأ الحفظ ولا نُعلّق مصير الزبون عليه. keepalive هو المهمّ هنا: مع
      // Server Action كان الطلب يُقطع لحظة مغادرة الصفحة إلى واتساب فيضيع؛
      // بهذا يتكفّل المتصفح بإتمامه بعد اختفاء الصفحة.
      const savePromise = fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          cartItems: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          fullName,
          phone,
          city,
          address,
          notes,
          idempotencyKey,
        }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);

      const outcome = await Promise.race([
        savePromise,
        new Promise<typeof TIMED_OUT>((resolve) =>
          window.setTimeout(() => resolve(TIMED_OUT), SAVE_CONFIRM_TIMEOUT_MS)
        ),
      ]);

      const confirmed =
        outcome !== TIMED_OUT && outcome && (outcome as CheckoutState).ok === true
          ? (outcome as Extract<CheckoutState, { ok: true }>)
          : null;

      if (confirmed) {
        // الطلب محفوظ ومعروف برقمه — لا داعي لسرد المنتجات على واتساب.
        link = buildWhatsAppLink(
          whatsappNumber,
          buildConfirmedOrderMessage({
            storeName,
            customer,
            reference,
            orderNumber: confirmed.orderNumber,
            items,
            subtotal,
            whatsappNumber,
            needsReview: confirmed.needsReview === true,
          })
        );

        // Purchase: على طلب محفوظ فعلاً فقط، لا على مجرد ضغطة زر — نفس
        // القاعدة السابقة بلا تغيير. event_id يبقى idempotencyKey لأجل
        // deduplication مع Conversions API.
        // طلب فيه سطر ينتظر مراجعة مخزون ليس بيعاً مكتملاً.
        if (!hasTrackedPurchase.current && confirmed.needsReview !== true) {
          hasTrackedPurchase.current = true;
          try {
            trackPurchase({
              items: items.map((item) => ({
                sku: item.sku,
                quantity: item.quantity,
                price: item.unitPrice,
              })),
              value: subtotal,
              eventId: idempotencyKey,
            });
          } catch (err) {
            console.error("trackPurchase فشل — لا يؤثّر على الطلب", err);
          }
          try {
            trackAnalyticsEvent(
              "purchase",
              {
                orderRef: confirmed.publicReference,
                orderValue: subtotal,
                cartValue: subtotal,
                quantity: items.reduce((sum, item) => sum + item.quantity, 0),
              },
              { immediate: true }
            );
          } catch (err) {
            console.error("قياس purchase فشل — لا يؤثّر على الطلب", err);
          }
          // GA4، داخل نفس الحارس بالضبط: طلب محفوظ فعلاً، وغير موقوف
          // للمراجعة، ومرة واحدة لكل طلب. transaction_id هو المرجع العام
          // للطلب نفسه — نفس الرقم الظاهر في لوحة الإدارة.
          try {
            trackGaPurchase({
              transactionId: confirmed.publicReference,
              items: items.map(toGaItem),
              value: subtotal,
            });
          } catch (err) {
            console.error("GA4 purchase فشل — لا يؤثّر على الطلب", err);
          }
        }
      } else {
        console.error(
          `الطلب ${reference}: لم يتأكّد الحفظ قبل الخروج إلى واتساب — ` +
            "أُرسلت نسخة إنقاذ بمحتوى الطلبية، والحفظ يُكمل في الخلفية."
        );
      }
    } catch (err) {
      // لا شيء هنا يُبرِّر حبس الزبون أو إظهار صفحة خطأ له.
      console.error("خطأ غير متوقّع أثناء إرسال الطلب — نخرج بنسخة الإنقاذ", err);
    }

    setSentHref(link);
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
                {formatMad(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-sm font-bold">
          <span>مجموع المنتجات</span>
          <span className="text-brand-orange">{formatMad(subtotal)}</span>
        </div>
        {/* نفس المربّع ونفس مكانه وألوانه وحجمه — النصّ وحده تغيّر.
            الثمن يبقى مقروءاً من الإعدادات لا مكتوباً في الكود، حتى لا
            يكذب هذا السطر على الزبون إن غيّر المالك السعر لاحقاً. يُعرض
            رقماً صحيحاً («30 درهم») لا بخانتين عشريتين، لأن هذه جملة
            تسويقية قصيرة لا سطر فاتورة. */}
        <p className="mt-2 rounded-lg bg-brand-turquoise-tint px-3 py-2 text-xs text-brand-turquoise-dark">
          🚚 التوصيل {Math.round(deliveryFeePerCartonMad)} درهم فقط للكرطونة.
          <br />
          يمكن جمع منتجات مختلفة في نفس الكرطونة، والكرطونة يمكن أن تحمل حتى
          2000 درهم من السلع.
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
            العنوان الكامل (اختياري)
          </span>
          <textarea
            name="address"
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
