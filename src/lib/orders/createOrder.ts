import { sql } from "@/lib/db";
import { getSettings } from "@/lib/queries/settings";
import { isValidMoroccanPhone, normalizePhone } from "@/lib/phone";
import { isRateLimited } from "@/lib/orders/rateLimit";
import {
  StockConflictError,
  sumLines,
  writeWebsiteOrderLines,
  type OrderLine,
  type RejectedLine,
} from "@/lib/orders/orderLines";
import { resolveOrderLines, WEBSITE_LINE_RULES } from "@/lib/orders/resolveLines";
import { notifyNewOrder } from "@/lib/notifications/notifyNewOrder";
import { sendCapiEvent } from "@/lib/pixel/capi";
import { toInternationalDigits } from "@/lib/phone";
import { getSiteUrl } from "@/lib/siteUrl";
import type {
  CreateOrderFieldError,
  CreateOrderInput,
  CreateOrderResult,
} from "@/lib/orders/types";

const GENERIC_ERROR: CreateOrderResult = {
  ok: false,
  errors: [
    {
      field: "general",
      message:
        "تعذّر إرسال الطلب حالياً بسبب مشكلة تقنية مؤقتة. الرجاء المحاولة مرة أخرى بعد قليل، أو التواصل معنا عبر واتساب.",
    },
  ],
};

function validateStructure(input: CreateOrderInput): CreateOrderFieldError[] {
  const errors: CreateOrderFieldError[] = [];

  if (!input.items || input.items.length === 0) {
    errors.push({ field: "items", message: "السلة فارغة." });
  }

  if (!input.customer.fullName?.trim()) {
    errors.push({ field: "fullName", message: "الاسم الكامل إجباري." });
  } else if (input.customer.fullName.trim().length > 100) {
    errors.push({ field: "fullName", message: "الاسم طويل جداً (100 حرف كحد أقصى)." });
  }

  if (!input.customer.phone?.trim() || !isValidMoroccanPhone(input.customer.phone)) {
    errors.push({
      field: "phone",
      message: "رقم الهاتف غير صحيح. يجب أن يكون رقماً مغربياً صالحاً (مثال: 0612345678).",
    });
  }

  if (!input.customer.city?.trim()) {
    errors.push({ field: "city", message: "المدينة إجبارية." });
  } else if (input.customer.city.trim().length > 100) {
    errors.push({ field: "city", message: "اسم المدينة طويل جداً (100 حرف كحد أقصى)." });
  }

  if (!input.customer.address?.trim()) {
    errors.push({ field: "address", message: "العنوان إجباري." });
  } else if (input.customer.address.trim().length > 300) {
    errors.push({ field: "address", message: "العنوان طويل جداً (300 حرف كحد أقصى)." });
  }

  if (input.customer.notes && input.customer.notes.trim().length > 500) {
    errors.push({ field: "notes", message: "الملاحظات طويلة جداً (500 حرف كحد أقصى)." });
  }

  if (!input.idempotencyKey?.trim()) {
    errors.push({ field: "general", message: "طلب غير صالح، الرجاء إعادة تحميل الصفحة." });
  }

  return errors;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const structuralErrors = validateStructure(input);
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors };
  }

  if (isValidMoroccanPhone(input.customer.phone) && isRateLimited(normalizePhone(input.customer.phone))) {
    return {
      ok: false,
      errors: [
        {
          field: "general",
          message:
            "تم إرسال عدة طلبات في وقت قصير من هذا الرقم. الرجاء الانتظار قليلاً قبل إعادة المحاولة، أو التواصل معنا عبر واتساب.",
        },
      ],
    };
  }

  try {
    const settings = await getSettings();

    // دفاع إضافي (defense-in-depth) وليس الحماية الأساسية — الزبون العادي
    // يُمنَع فعلياً من الوصول لهنا أصلاً لأن CheckoutClient نفسه يُعطِّل زر
    // الإرسال ولا يبني رابط واتساب حين تكون الطلبات متوقفة (انظر
    // CheckoutClient.tsx). هذا الفحص هنا يحمي فقط من استدعاء مباشر لـ
    // submitOrder متجاوزاً الواجهة (مثلاً عبر إعادة إرسال نموذج قديم).
    if (!settings.codEnabled) {
      return {
        ok: false,
        errors: [
          {
            field: "general",
            message: "استقبال الطلبات الجديدة متوقف مؤقتاً. الرجاء التواصل معنا عبر واتساب.",
          },
        ],
      };
    }

    // نفس المُحلِّل الذي يستعمله الطلب اليدوي وتعديل الطلب، بقواعد الموقع:
    // لا ثمن خاص، والكمية الدنيا ومضاعفاتها مُلزِمة، والتوفّر مُلزِم.
    const {
      lines: lineItems,
      errors: itemErrors,
      rejected: preRejected,
    } = await resolveOrderLines(
      input.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      WEBSITE_LINE_RULES
    );

    if (itemErrors.length > 0) {
      return { ok: false, errors: itemErrors };
    }

    // كل السطور مرفوضة: لا معنى لطلب فارغ.
    if (lineItems.length === 0) {
      return {
        ok: false,
        errors: preRejected.length > 0
          ? preRejected.map((r) => ({ field: `item:${r.line.productId}:base`, message: r.reason }))
          : [{ field: "items", message: "السلة فارغة." }],
      };
    }

    const subtotal = sumLines(lineItems);

    // حُذف حاجز الحد الأدنى للطلب عمداً: كان يمنع زبوناً اختار فعلاً ما
    // يريد من إتمام طلبه، وهو أكبر نزيف في مسار الشراء. الكمية الدنيا لكل
    // منتج تبقى مطبَّقة كما هي (انظر resolveLines)، والأسعار والمخزون
    // كذلك — الملغى هو الحدّ الإجمالي وحده.

    const normalizedPhone = normalizePhone(input.customer.phone);

    let stockConflict: CreateOrderFieldError | null = null;
    let outcome: { reserved: OrderLine[]; rejected: RejectedLine[] } | null = null;
    const readOutcome = () => outcome as { reserved: OrderLine[]; rejected: RejectedLine[] } | null;

    const result = await sql.begin(async (trx) => {
      const inserted = await trx<{ id: number; public_reference: string; order_number: string }[]>`
        insert into public.orders (
          customer_name, customer_phone, customer_city, customer_address,
          customer_notes, items_subtotal, status, source, idempotency_key
        ) values (
          ${input.customer.fullName.trim()}, ${normalizedPhone}, ${input.customer.city.trim()},
          ${input.customer.address.trim()}, ${input.customer.notes?.trim() || null},
          ${subtotal}, 'new', 'website', ${input.idempotencyKey}
        )
        on conflict (idempotency_key) do nothing
        returning id, public_reference, order_number
      `;

      if (inserted.length > 0) {
        const orderId = inserted[0].id;

        // الطلب يُحفظ كما اختاره الزبون كاملاً: ما تَوفّر يُحجز مخزونه،
        // وما لم يتوفّر يُكتب بحالته وسببه بلا خصم. سطر واحد ناقص لم يعد
        // يُسقط 154 سطراً كما كان يحدث.
        const written = await writeWebsiteOrderLines(trx, orderId, lineItems, preRejected);
        outcome = written;

        const note =
          written.rejected.length > 0
            ? `طلب جديد من الموقع — ${written.rejected.length} منتجاً يحتاج مراجعة مخزون`
            : "طلب جديد من الموقع";
        if (written.rejected.length > 0) {
          await trx`update public.orders set status = 'needs_review' where id = ${orderId}`;
        }

        await trx`
          insert into public.order_status_history (order_id, status, note)
          values (${orderId}, ${written.rejected.length > 0 ? "needs_review" : "new"}, ${note})
        `;

        return {
          id: orderId,
          publicReference: inserted[0].public_reference,
          orderNumber: inserted[0].order_number,
          isNew: true as const,
        };
      }

      // تعارض على idempotency_key => نفس الطلب أُرسل مسبقاً (ضغط مزدوج على
      // الزر مثلاً). نُعيد مرجع الطلب الموجود أصلاً بدل إنشاء طلب مكرر ودون
      // إعادة حجز المخزون مرة ثانية.
      const existing = await trx<{ id: number; public_reference: string; order_number: string }[]>`
        select id, public_reference, order_number from public.orders
        where idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      if (!existing[0]) return null;
      return {
        id: existing[0].id,
        publicReference: existing[0].public_reference,
        orderNumber: existing[0].order_number,
        isNew: false as const,
      };
    }).catch((error) => {
      if (error instanceof StockConflictError) {
        stockConflict = {
          field: `item:${error.line.productId}:${error.line.variantId ?? "base"}`,
          message: `الكمية المطلوبة من "${error.line.nameSnapshot}" لم تعد متوفرة بالكامل في المخزون الآن. الرجاء تعديل الكمية أو إزالة المنتج.`,
        };
        return null;
      }
      throw error;
    });

    if (stockConflict) {
      return { ok: false, errors: [stockConflict] };
    }

    if (!result) {
      console.error("createOrder: فشل الحصول على مرجع الطلب بعد الإدخال");
      return GENERIC_ERROR;
    }

    // طلب فيه سطر يحتاج مراجعة ليس بيعاً مكتملاً: لا Purchase له.
    const needsReview = (readOutcome()?.rejected.length ?? 0) > 0;

    if (result.isNew && !needsReview) {
      const siteUrl = getSiteUrl();
      const base = siteUrl ?? "";
      // إشعار "أفضل مجهود": لا ننتظره (fire-and-forget) ولا يمكن أبداً أن
      // يمحو الطلب المحفوظ فعلاً إذا فشل — انظر notifyNewOrder.
      void notifyNewOrder({
        orderNumber: result.orderNumber,
        publicReference: result.publicReference,
        customerName: input.customer.fullName.trim(),
        customerPhone: normalizedPhone,
        city: input.customer.city.trim(),
        itemsSubtotal: subtotal.toFixed(2),
        itemsCount: lineItems.length,
        adminOrderUrl: `${base}/admin/orders/${result.id}`,
        pickingSlipUrl: `${base}/admin/orders/${result.id}/picking-slip.pdf`,
      });

      // Meta Conversions API — Purchase: نفس "أفضل مجهود" بالضبط (fire-and-
      // forget، لا يرمي أبداً، ولا يؤثِّر على نتيجة الطلب). result.isNew وحده
      // (وليس مجرد نجاح createOrder) يضمن إرسالها مرة واحدة فقط للطلب
      // الحقيقي — إعادة محاولة بنفس idempotencyKey (ضغط مزدوج على الزر
      // مثلاً) ترجع نفس الطلب الموجود بلا إرسال ثانٍ هنا (وبلا حتى حاجة
      // لذلك: event_id ثابت = idempotencyKey نفسه يضمن أن Meta نفسها تعتبر
      // أي إرسال مكرر بنفس القيمة نفس الحدث، وليس Purchase ثانياً).
      void sendCapiEvent({
        eventName: "Purchase",
        eventId: input.idempotencyKey,
        eventSourceUrl: input.requestContext?.eventSourceUrl,
        userData: {
          phone: toInternationalDigits(normalizedPhone),
          clientIpAddress: input.requestContext?.clientIpAddress,
          clientUserAgent: input.requestContext?.clientUserAgent,
          fbp: input.requestContext?.fbp,
          fbc: input.requestContext?.fbc,
        },
        customData: {
          content_ids: lineItems.map((line) => line.skuSnapshot),
          content_type: "product",
          currency: "MAD",
          value: subtotal,
          num_items: lineItems.reduce((sum, line) => sum + line.quantity, 0),
          contents: lineItems.map((line) => ({
            id: line.skuSnapshot,
            quantity: line.quantity,
            item_price: line.unitPrice,
          })),
        },
      });
    }

    return {
      ok: true,
      needsReview,
      rejectedLines: (readOutcome()?.rejected ?? []).map((r) => ({
        name: r.line.nameSnapshot,
        sku: r.line.skuSnapshot,
        quantity: r.line.quantity,
        reason: r.reason,
      })),
      publicReference: result.publicReference,
      // رقم الطلب المقروء — تحتاجه رسالة واتساب لتُحيل الفريق إلى اللوحة
      // بدل سرد المنتجات، فلم يعد يكفي أن يبقى داخل المعاملة.
      orderNumber: result.orderNumber,
    };
  } catch (error) {
    console.error("createOrder: خطأ غير متوقع أثناء إنشاء الطلب", error);
    return GENERIC_ERROR;
  }
}
