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
import {
  linkOriginByLeadId,
  linkOriginByReference,
  manualOrderConsent,
  OriginReferenceError,
} from "@/lib/orders/originReference";
import { sendDeferredPurchase } from "@/lib/pixel/sendDeferredPurchase";
import { CLICK_ID_KEYS } from "@/lib/privacy/attribution";

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
 *  • **لا حدث قياس داخلي، وPurchase بقناته الحقيقية فقط.** هذا البيع لم يمرّ
 *    بالموقع، فلا يدخل قمع «زائر ← طلب». أما Meta فتعرفه بيعةَ `chat`/
 *    `phone_call`/`physical_store` — لا بيعة موقع أبداً — وبشرطين:
 *    موافقة (موروثة من مرجع Q-/W- أو مُصرَّح بها)، ومفتاح
 *    `META_OFFLINE_PURCHASES_ENABLED`. انظر sendDeferredPurchase.ts.
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
   * الزيارة التي جاءت منها الطلبية: مرجع يلصقه المدير من المحادثة (Q-/W-)،
   * أو lead محدَّد عند التحويل. غيابها ⇒ طلبية بلا مصدر معروف — لا يُفترَض.
   */
  origin?: { reference?: string | null; leadId?: number | null };
  /**
   * المدير يصرّح بأنه سأل الزبون فوافق على مشاركة بيانات البيعة (الهاتف
   * مُشفَّراً) مع Meta. لا يُفترَض أبداً: الافتراضي false.
   */
  adConsentDeclared?: boolean;
};

export type ManualOrderResult =
  | { ok: true; orderId: number; orderNumber: string; publicReference: string }
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

  try {
    const created = await sql.begin(async (trx) => {
      // `confirmed_at` يُكتب هنا لا في أول تغيير حالة لاحق: الطلب اليدوي
      // يُنشأ **مؤكَّداً أصلاً** (البائع كلّم الزبون قبل أن يُسجّله)، فلحظة
      // التأكيد هي لحظة الإنشاء. وكان العمود يبقى فارغاً حتى يلمس أحدٌ
      // الحالة من جديد — وهو ما كشفه الطلب 177: بيعةٌ مؤكَّدة بلا لحظة
      // تأكيد، أي بلا `event_time` صحيح لو احتاجها أي قياس لاحق.
      const [order] = await trx<{ id: number; order_number: string; public_reference: string }[]>`
        insert into public.orders (
          customer_name, customer_phone, customer_city, customer_address,
          customer_notes, items_subtotal, delivery_fee, actual_delivery_cost,
          final_total, status, source, confirmed_at
        ) values (
          ${input.customer.fullName.trim()}, ${normalizedPhone}, ${input.customer.city.trim()},
          ${input.customer.address.trim()}, ${input.customer.notes?.trim() || null},
          ${subtotal}, ${deliveryFee}, ${actualDeliveryCost},
          ${subtotal + deliveryFee}, 'confirmed', ${input.source}, now()
        )
        returning id, order_number, public_reference
      `;

      await writeNewOrderLines(trx, order.id, lines);

      // الربط بالزيارة داخل نفس المعاملة: مرجع خاطئ يُلغي الطلبية كاملة
      // (لا مخزون محجوز ولا رقم مستهلك) بدل طلبية بإسناد ناقص.
      const origin = input.origin?.leadId
        ? await linkOriginByLeadId(trx, order.id, input.origin.leadId)
        : await linkOriginByReference(trx, order.id, input.origin?.reference);
      const consent = manualOrderConsent(origin, input.adConsentDeclared === true);
      // بلا موافقة موروثة: لا هوية، ولا معرّفات نقر — تبقى UTM وحدها.
      const stripClickIds = (value: unknown) =>
        value && typeof value === "object" && !consent.copyIdentity
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([key]) => !(CLICK_ID_KEYS as readonly string[]).includes(key)
              )
            )
          : value;
      if (origin || consent.adConsent !== "unknown") {
        await trx`
          update public.orders set
            origin_reference = ${origin?.reference ?? null},
            attribution_first = ${origin?.attributionFirst ? trx.json(stripClickIds(origin.attributionFirst) as never) : null},
            attribution_last = ${origin?.attributionLast ? trx.json(stripClickIds(origin.attributionLast) as never) : null},
            capi_identity = ${consent.copyIdentity && origin?.capiIdentity ? trx.json(origin.capiIdentity as never) : null},
            ad_consent = ${consent.adConsent},
            ad_consent_source = ${consent.source}
          where id = ${order.id}
        `;
      }

      await trx`
        insert into public.order_status_history (order_id, status, note, changed_by)
        values (
          ${order.id}, 'confirmed',
          ${`طلب مسجَّل يدوياً — المصدر: ${ORDER_SOURCE_LABELS[input.source]}`},
          ${input.createdByEmail}
        )
      `;

      return order;
    });

    // البيعة مؤكَّدة منذ إنشائها: تُرسَل الآن — أو تُرفض بسببها (لا موافقة،
    // المفتاح مُطفأ) دون أي أثر. `await` لا `void`: دالة serverless قد
    // تتجمّد بعد الجواب، ولا ترمي أبداً، فلا خطر على الطلبية المحفوظة.
    await sendDeferredPurchase(created.id);

    return {
      ok: true,
      orderId: created.id,
      orderNumber: created.order_number,
      publicReference: created.public_reference,
    };
  } catch (error) {
    if (error instanceof OriginReferenceError) {
      return { ok: false, errors: [{ field: "originReference", message: error.message }] };
    }
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
