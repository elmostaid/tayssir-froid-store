import { sql } from "@/lib/db";
import { isValidMoroccanPhone, normalizePhone } from "@/lib/phone";
import {
  StockConflictError,
  sumLines,
  writeNewOrderLines,
} from "@/lib/orders/orderLines";
import { MANUAL_LINE_RULES, resolveOrderLines, type LineRequest } from "@/lib/orders/resolveLines";
import { isManualOrderSource, ORDER_SOURCE_LABELS, type OrderSource } from "@/lib/orders/orderSource";
import { MAX_DELIVERY_COST_MAD } from "@/lib/orders/deliveryCost";
import { belowCostMessage, findBelowCostLines } from "@/lib/orders/belowCost";
import type { CreateOrderFieldError } from "@/lib/orders/types";
import { isValidIdempotencyKey } from "@/lib/orders/manualOrderKey";

/**
 * تسجيل بيع وقع **خارج الموقع**: واتساب، هاتف، أو في المحل.
 *
 * يُنشئ طلباً عادياً تماماً — نفس الجدول، نفس ترقيم TF-2026-XXXX (من trigger
 * في قاعدة البيانات)، نفس حجز المخزون الذرّي، نفس لقطة ثمن الشراء التي
 * تُبنى عليها الأرباح. الفرق كله في عمود `source` وفي أربع قواعد لا تنطبق
 * على بيع أُبرم بالكلام:
 *
 *  • **لا حدّ أدنى للطلب.** الحدّ قاعدة تسويقية للموقع؛ زبون اشترى بـ300
 *    درهم على واتساب اشترى فعلاً، ورفض تسجيله يعني إخفاء بيع حقيقي.
 *  • **لا تحديد معدّل بالهاتف.** ذلك درع ضد إغراق آلي من الإنترنت، ولا معنى
 *    له خلف تسجيل دخول إداري.
 *  • **لا Purchase إلى Meta ولا CAPI ولا حدث قياس داخلي.** هذا البيع لم يمرّ
 *    بالموقع، فحسبانه تحويلاً إعلانياً كذبٌ يُفسد نسبة التحويل وتقييم
 *    الحملات معاً.
 *  • **لا إشعار "طلب جديد".** المدير هو من كتبه للتو.
 *
 * والحالة `confirmed` لا `new`: هذا الطلب مُتَّفق عليه مع الزبون قبل إدخاله
 * أصلاً، فبدؤه من طابور "جديد" يعني انتظار تأكيدٍ وقع منذ زمن.
 */

export type ManualOrderInput = {
  customer: {
    fullName: string;
    phone: string;
    city: string;
    address: string;
    notes?: string | null;
  };
  source: OrderSource;
  items: LineRequest[];
  deliveryFee: number;
  /**
   * ما دفعناه لشركة التوصيل. اختياري — تُترَك NULL («غير مسجَّلة») حين لا
   * تُعرَف بعد، وهي الحالة الغالبة وقت إنشاء الطلب: فاتورة شركة التوصيل
   * تصل بعد التسليم. تُسجَّل لاحقاً من صفحة الطلب.
   */
  actualDeliveryCost?: number | null;
  /** بريد المدير — يُسجَّل في تاريخ الحالة، لا في بيانات الزبون. */
  createdByEmail: string;
  /**
   * إقرار صريح بالبيع تحت التكلفة. بدونه يُرفَض الطلب الذي يحمل سطراً
   * خاسراً — انظر lib/orders/belowCost.ts.
   */
  acknowledgeBelowCost?: boolean;
  /**
   * مفتاح تفرّد يُولّده المتصفّح **قبل أول محاولة حفظ** ويبقى ثابتاً حتى
   * تُعرَف النتيجة — انظر lib/orders/manualOrderKey.ts.
   *
   * اختياري في النوع لا في الواقع: مسار الإدارة يُرسله دائماً، والمسارات
   * القديمة (استيراد، تحويل Lead بحارسه الذرّي) تعمل بدونه كما كانت. حين
   * يغيب لا يوجد حرس تفرّد — وهو السلوك السابق بحرفه، لا انحدار جديد.
   */
  idempotencyKey?: string | null;
};

export type ManualOrderResult =
  | {
      ok: true;
      orderId: number;
      orderNumber: string;
      publicReference: string;
      /**
       * `true` يعني: هذه المحاولة **لم تُنشئ شيئاً** — المفتاح مستعمل
       * أصلاً، والطلبية المُعادة هي المحفوظة سابقاً.
       *
       * تمييزها ضروري لا تجميلي: النجاح الصامت كان سيجعل المدير يظنّ أن
       * تعديلاته في هذه المحاولة حُفظت، وهي **لم تُحفظ ولن تُحفظ** — فإدخال
       * الطلبية محروس بـ`do nothing`، فلا يُحدِّث شيئاً بحكم بنائه.
       */
      replayed: boolean;
    }
  | { ok: false; errors: CreateOrderFieldError[] };

function validateCustomer(input: ManualOrderInput): CreateOrderFieldError[] {
  const errors: CreateOrderFieldError[] = [];
  const { fullName, phone, city, address, notes } = input.customer;

  if (!fullName?.trim()) errors.push({ field: "fullName", message: "اسم الزبون مطلوب." });
  else if (fullName.trim().length > 100)
    errors.push({ field: "fullName", message: "اسم الزبون طويل جداً (100 حرف كحد أقصى)." });

  if (!phone?.trim()) errors.push({ field: "phone", message: "رقم الهاتف مطلوب." });
  else if (!isValidMoroccanPhone(phone))
    errors.push({ field: "phone", message: "رقم الهاتف غير صالح (رقم مغربي يبدأ بـ06 أو 07 أو 05)." });

  if (!city?.trim()) errors.push({ field: "city", message: "المدينة مطلوبة." });
  else if (city.trim().length > 100)
    errors.push({ field: "city", message: "اسم المدينة طويل جداً." });

  if (!address?.trim()) errors.push({ field: "address", message: "العنوان مطلوب." });
  else if (address.trim().length > 300)
    errors.push({ field: "address", message: "العنوان طويل جداً (300 حرف كحد أقصى)." });

  if (notes && notes.trim().length > 500)
    errors.push({ field: "notes", message: "الملاحظة طويلة جداً (500 حرف كحد أقصى)." });

  if (!isManualOrderSource(input.source))
    errors.push({ field: "source", message: "مصدر الطلب غير صالح." });

  if (!Number.isFinite(input.deliveryFee) || input.deliveryFee < 0)
    errors.push({ field: "deliveryFee", message: "مصاريف التوصيل غير صالحة." });

  const actualCost = input.actualDeliveryCost;
  if (
    actualCost !== undefined &&
    actualCost !== null &&
    (!Number.isFinite(actualCost) || actualCost < 0 || actualCost > MAX_DELIVERY_COST_MAD)
  )
    errors.push({ field: "actualDeliveryCost", message: "تكلفة التوصيل الفعلية غير صالحة." });

  if (!Array.isArray(input.items) || input.items.length === 0)
    errors.push({ field: "items", message: "أضف منتجاً واحداً على الأقل." });

  return errors;
}

export async function createManualOrder(input: ManualOrderInput): Promise<ManualOrderResult> {
  const structuralErrors = validateCustomer(input);
  if (structuralErrors.length > 0) return { ok: false, errors: structuralErrors };

  const { lines, errors } = await resolveOrderLines(input.items, MANUAL_LINE_RULES);
  if (errors.length > 0) return { ok: false, errors };
  if (lines.length === 0) {
    return { ok: false, errors: [{ field: "items", message: "أضف منتجاً واحداً على الأقل." }] };
  }

  // الحارس قبل أي كتابة: لا طلب، ولا حجز مخزون، ولا صفّ واحد.
  if (!input.acknowledgeBelowCost) {
    const belowCost = findBelowCostLines(lines);
    if (belowCost.length > 0) {
      return { ok: false, errors: [{ field: "belowCost", message: belowCostMessage(belowCost) }] };
    }
  }

  const subtotal = sumLines(lines);
  const deliveryFee = input.deliveryFee;
  // undefined و null كلاهما «غير مسجَّلة» — لا صفر.
  const actualDeliveryCost = input.actualDeliveryCost ?? null;
  const normalizedPhone = normalizePhone(input.customer.phone);

  // مفتاح مشوَّه يُرفَض قبل أي كتابة بدل أن يُكتب NULL بصمت فيضيع الحرس
  // كله. والغياب التام مسموح (المسارات القديمة) — انظر manualOrderKey.ts.
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && !isValidIdempotencyKey(idempotencyKey)) {
    return {
      ok: false,
      errors: [{ field: "general", message: "مفتاح الطلب غير صالح. أعد تحميل الصفحة وحاول مرة أخرى." }],
    };
  }

  try {
    const created = await sql.begin(async (trx) => {
      // `confirmed_at` يُكتب هنا لا في أول تغيير حالة لاحق: الطلب اليدوي
      // يُنشأ **مؤكَّداً أصلاً** (البائع كلّم الزبون قبل أن يُسجّله)، فلحظة
      // التأكيد هي لحظة الإنشاء. وكان العمود يبقى فارغاً حتى يلمس أحدٌ
      // الحالة من جديد — وهو ما كشفه الطلب 177: بيعةٌ مؤكَّدة بلا لحظة
      // تأكيد، أي بلا `event_time` صحيح لو احتاجها أي قياس لاحق.
      // `on conflict … do nothing` هو الحرس كله، وهو **ذرّي في القاعدة** لا
      // في الكود: لا فحص «هل موجود؟» قبله يمكن أن يسبقه نداءٌ ثانٍ بين
      // الفحص والإدخال. ونفس النمط المستعمل في createOrder.ts:252 لمسار
      // الموقع منذ البداية — لا بنية جديدة ولا Migration: العمود
      // `idempotency_key` والفهرس `orders_idempotency_key_key` (UNIQUE)
      // موجودان أصلاً في الإنتاج وفي القاعدة المحلية.
      //
      // و`do nothing` لا `do update` مقصود بحرفه: إعادة إرسال نفس المفتاح
      // بمحتوى مختلف **لا تُعدّل الطلبية المحفوظة إطلاقاً**. فالطلبية
      // المنفَّذة لا يُغيّرها مفتاحها.
      const inserted = await trx<{ id: number; order_number: string; public_reference: string }[]>`
        insert into public.orders (
          customer_name, customer_phone, customer_city, customer_address,
          customer_notes, items_subtotal, delivery_fee, actual_delivery_cost,
          final_total, status, source, confirmed_at, idempotency_key
        ) values (
          ${input.customer.fullName.trim()}, ${normalizedPhone}, ${input.customer.city.trim()},
          ${input.customer.address.trim()}, ${input.customer.notes?.trim() || null},
          ${subtotal}, ${deliveryFee}, ${actualDeliveryCost},
          ${subtotal + deliveryFee}, 'confirmed', ${input.source}, now(), ${idempotencyKey}
        )
        on conflict (idempotency_key) do nothing
        returning id, order_number, public_reference
      `;

      if (inserted.length > 0) {
        const order = inserted[0];

        // الحجز داخل **نفس** المعاملة: فإن لم يُنشأ صفّ الطلبية لم يُخصَم
        // شيء، وإن فشل الحجز تراجع الطلبية معه. لا نصف طلبية ولا خصم يتيم.
        await writeNewOrderLines(trx, order.id, lines);

        await trx`
          insert into public.order_status_history (order_id, status, note, changed_by)
          values (
            ${order.id}, 'confirmed',
            ${`طلب مسجَّل يدوياً — المصدر: ${ORDER_SOURCE_LABELS[input.source]}`},
            ${input.createdByEmail}
          )
        `;

        return { ...order, replayed: false };
      }

      // تعارض على المفتاح: الطلبية محفوظة أصلاً. هذا هو المسار الذي يُنقذ
      // الحالة المقصودة بالضبط — نجح COMMIT ثم انقطع الاتصال قبل وصول
      // الإقرار، فأعاد المدير المحاولة. نُعيد الطلبية القائمة بلا كتابة
      // صفّ واحد وبلا لمس المخزون.
      const existing = await trx<{ id: number; order_number: string; public_reference: string }[]>`
        select id, order_number, public_reference from public.orders
        where idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (!existing[0]) return null;
      return { ...existing[0], replayed: true };
    });

    // `null` يعني تعارضاً على المفتاح بلا طلبية مقابلة — مستحيل منطقياً
    // (الفهرس فريد والمعاملة واحدة)، لكن ابتلاعه كنجاح كان سيُرجع طلبية
    // غير موجودة. نفشل صريحاً بدل أن نكذب.
    if (!created) {
      console.error("createManualOrder: تعارض على مفتاح التفرّد بلا طلبية مقابلة");
      return {
        ok: false,
        errors: [{ field: "general", message: "تعذّر حفظ الطلب بسبب مشكلة تقنية. حاول مرة أخرى." }],
      };
    }

    return {
      ok: true,
      orderId: created.id,
      orderNumber: created.order_number,
      publicReference: created.public_reference,
      replayed: created.replayed,
    };
  } catch (error) {
    if (error instanceof StockConflictError) {
      return {
        ok: false,
        errors: [
          {
            field: `item:${error.line.productId}:${error.line.variantId ?? "base"}`,
            message: `المخزون المتوفر من "${error.line.nameSnapshot}" لا يكفي للكمية المطلوبة. عدّل الكمية أو صحّح المخزون أولاً.`,
          },
        ],
      };
    }
    console.error("createManualOrder: خطأ غير متوقع", error);
    return {
      ok: false,
      errors: [{ field: "general", message: "تعذّر حفظ الطلب بسبب مشكلة تقنية. حاول مرة أخرى." }],
    };
  }
}
