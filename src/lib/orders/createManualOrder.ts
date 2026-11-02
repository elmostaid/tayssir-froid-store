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
  type OrderOrigin,
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
  /**
   * مفتاح هذه **المحاولة** بعينها، يولّده نموذج الإنشاء مرّة واحدة عند فتحه
   * ويُعيده كما هو مع كل إعادة إرسال. يُحفظ في `orders.idempotency_key`
   * (فريد في قاعدة البيانات) — فإعادة الإرسال بعد انقطاعٍ ضاع فيه الجواب
   * تُرجع نفس الطلبية ولا تخصم المخزون مرّتين. غيابه ⇒ السلوك القديم.
   */
  idempotencyKey?: string | null;
};

/** فضاء أسماء منفصل عن مفاتيح طلبات الموقع في نفس العمود الفريد. */
const MANUAL_KEY_PREFIX = "manual:";

export function manualIdempotencyKey(raw: string | null | undefined): string | null {
  const key = raw?.trim();
  if (!key || !/^[A-Za-z0-9-]{16,100}$/.test(key)) return null;
  return MANUAL_KEY_PREFIX + key;
}

type ExistingOrder = { id: number; order_number: string; public_reference: string };

async function findByIdempotencyKey(key: string): Promise<ExistingOrder | null> {
  const [row] = await sql<ExistingOrder[]>`
    select id, order_number, public_reference from public.orders
    where idempotency_key = ${key}
    limit 1
  `;
  return row ?? null;
}

export type ManualOrderResult =
  | {
      ok: true;
      orderId: number;
      orderNumber: string;
      publicReference: string;
      /** المرجع المُدخَل لم يُربط (والطلبية سُجِّلت رغم ذلك) — السبب للمدير. */
      originWarning?: string | null;
      /** نفس المحاولة أُرسلت من قبل وحُفظت: هذه هي الطلبية الأولى نفسها. */
      duplicate?: boolean;
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
  const idempotencyKey = manualIdempotencyKey(input.idempotencyKey);

  // قبل أي تحقق: إن كانت هذه المحاولة قد حُفظت من قبل (ضاع جوابها في
  // انقطاع)، فالجواب الصحيح هو الطلبية نفسها — لا خطأ مخزون بسبب خصمٍ
  // قامت به هي نفسها، ولا طلبية ثانية.
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(idempotencyKey);
    if (existing) return existingOrderResult(existing);
  }

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

      // تعارض ⇒ إرسالٌ متزامن لنفس المحاولة سبق هذا إلى الحفظ (الإدراج
      // ينتظر قفل الفهرس الفريد حتى تُحسم المعاملة الأخرى). لا أسطر، ولا
      // خصم مخزون، ولا سجلّ حالة: الطلبية الأولى هي الجواب.
      if (!order) {
        const [existing] = await trx<ExistingOrder[]>`
          select id, order_number, public_reference from public.orders
          where idempotency_key = ${idempotencyKey}
          limit 1
        `;
        return { ...existing, originWarning: null, duplicate: true as const };
      }

      await writeNewOrderLines(trx, order.id, lines);

      // الربط بالزيارة **يساعد ولا يعرقل**: مرجع خاطئ أو مستعمل أو غير مسجَّل
      // لا يمنع تسجيل بيعة وقعت. الطلبية تُنشأ بلا ربط، والسبب يُكتب في سجلّ
      // حالتها ليراه المدير. ولا يُنسب أبداً لزيارة غيرها: الربط إمّا صحيح
      // كاملاً وإمّا لا ربط.
      //
      // داخل SAVEPOINT: أي خطأ في الربط (حتى خطأ قاعدة غير متوقَّع) يُلغي
      // الربط وحده، لا المعاملة ولا الطلبية.
      let origin: OrderOrigin | null = null;
      let originWarning: string | null = null;
      try {
        origin = await trx.savepoint((sp) =>
          input.origin?.leadId
            ? linkOriginByLeadId(sp, order.id, input.origin.leadId)
            : linkOriginByReference(sp, order.id, input.origin?.reference)
        );
      } catch (error) {
        if (error instanceof OriginReferenceError) {
          originWarning = error.message;
        } else {
          console.error("createManualOrder: تعذّر ربط المرجع — الطلبية تُنشأ بلا ربط", error);
          originWarning = "تعذّر ربط المرجع لسبب تقني — سُجِّلت الطلبية بلا ربط.";
        }
      }
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
          ${`طلب مسجَّل يدوياً — المصدر: ${ORDER_SOURCE_LABELS[input.source]}` +
            (originWarning ? ` — ⚠ المرجع لم يُربط: ${originWarning}` : "")},
          ${input.createdByEmail}
        )
      `;

      return { ...order, originWarning, duplicate: false as const };
    });

    if (created.duplicate) return existingOrderResult(created);

    // البيعة مؤكَّدة منذ إنشائها: تُرسَل الآن — أو تُرفض بسببها (لا موافقة،
    // المفتاح مُطفأ) دون أي أثر. `await` لا `void`: دالة serverless قد
    // تتجمّد بعد الجواب، ولا ترمي أبداً، فلا خطر على الطلبية المحفوظة.
    await sendDeferredPurchase(created.id);

    return {
      ok: true,
      orderId: created.id,
      orderNumber: created.order_number,
      publicReference: created.public_reference,
      originWarning: created.originWarning,
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

/**
 * نفس المحاولة حُفظت من قبل. إن ضاع جوابها في انقطاعٍ وقع **بعد** COMMIT،
 * فالمحاولة الأولى لم تبلغ إرسال البيعة أصلاً — فتُرسَل الآن لتلك الطلبية
 * نفسها. وهذا لا يُرسل مرّتين أبداً: `sendDeferredPurchase` يحجز الإرسال
 * ذرّياً (`meta_purchase_sent_at is null`)، فإن كان قد أُرسل لا يحدث شيء.
 */
async function existingOrderResult(order: ExistingOrder): Promise<ManualOrderResult> {
  await sendDeferredPurchase(order.id);
  return existingResult(order);
}

function existingResult(order: ExistingOrder): ManualOrderResult {
  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.order_number,
    publicReference: order.public_reference,
    originWarning: null,
    duplicate: true,
  };
}
