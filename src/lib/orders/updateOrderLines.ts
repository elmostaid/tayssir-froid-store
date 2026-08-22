import { sql } from "@/lib/db";
import { RESTOCKING_STATUSES } from "@/lib/orders/orderStatus";
import {
  StockConflictError,
  insertOrderItem,
  recordStockMovement,
  releaseStock,
  reserveStock,
  sumLines,
  type OrderLine,
} from "@/lib/orders/orderLines";
import { MANUAL_LINE_RULES, resolveOrderLines, type LineRequest } from "@/lib/orders/resolveLines";
import type { CreateOrderFieldError } from "@/lib/orders/types";
import type { OrderStatus } from "@/lib/orders/orderStatus";

/**
 * تعديل سطور طلب قائم: إضافة منتج، حذفه، تغيير كميته أو ثمن بيعه.
 *
 * الحالة الواقعية التي بُني لأجلها: زبون طلب من الموقع بـ1200 درهم، ثم زاد
 * قطعة بـ300 على واتساب. بونٌ ثانٍ يعني طلبين في التقارير وزبوناً واحداً في
 * الحقيقة؛ فنعدّل نفس الطلب ليصير 1500.
 *
 * ── المخزون: بالفرق وحده، لا بالكمية الكاملة ────────────────────────────
 * الطلب حجز كميته عند إنشائه. فالتعديل يقارن الحالة الجديدة بالقديمة لكل
 * (منتج، متغيّر) ويطبّق **الفرق فقط**: من 3 إلى 5 يحجز 2، ومن 5 إلى 2
 * يُرجع 3، والحذف يُرجع الكمية كاملةً. إعادة تطبيق الكمية الكاملة كانت
 * ستخصم مرتين — وهذا بالضبط ما يمنعه هذا الحساب.
 *
 * ولأن الطلب الملغى أو الراجع **أُرجع مخزونه أصلاً**، فأي تعديل فوقه يخصم
 * من مخزون لم يُحجز قط. لذلك يُمنع التعديل عليهما منعاً باتاً — لا كتحفّظ
 * تصميمي بل لأنه الطريق الوحيد المتبقّي إلى خصم مزدوج.
 *
 * ── لماذا نُعيد كتابة كل السطور ─────────────────────────────────────────
 * نحذف سطور الطلب ونكتبها من جديد داخل نفس المعاملة، بعد أن نكون قد حسبنا
 * فروق المخزون من الحالة القديمة. أبسط من مطابقة سطر بسطر، ونتيجته نفسها
 * بالضبط، والمعاملة تجعل الخطوتين ذرّيتين معاً.
 */

export type UpdateOrderLinesInput = {
  orderId: number;
  items: LineRequest[];
  /** null تعني: اترك مصاريف التوصيل كما هي. */
  deliveryFee: number | null;
  changedByEmail: string;
};

export type UpdateOrderLinesResult =
  | {
      ok: true;
      itemsSubtotal: number;
      deliveryFee: number;
      finalTotal: number;
    }
  | { ok: false; errors: CreateOrderFieldError[] };

/** مفتاح الهوية للمخزون: نفس المنتج بنفس المتغيّر هو نفس القطعة. */
const stockKey = (productId: number | null, variantId: number | null) =>
  `${productId ?? "none"}:${variantId ?? "base"}`;

function error(field: string, message: string): UpdateOrderLinesResult {
  return { ok: false, errors: [{ field, message }] };
}

export async function updateOrderLines(
  input: UpdateOrderLinesInput
): Promise<UpdateOrderLinesResult> {
  if (!Number.isInteger(input.orderId) || input.orderId <= 0) {
    return error("general", "الطلب غير صالح.");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return error("items", "لا يمكن ترك الطلب بلا منتجات. احذف الطلب بدل تفريغه.");
  }
  if (input.deliveryFee !== null && (!Number.isFinite(input.deliveryFee) || input.deliveryFee < 0)) {
    return error("deliveryFee", "مصاريف التوصيل غير صالحة.");
  }

  const { lines, errors } = await resolveOrderLines(input.items, MANUAL_LINE_RULES);
  if (errors.length > 0) return { ok: false, errors };

  // ندمج السطور المكرَّرة لنفس القطعة: سطران لنفس المنتج يعنيان كمية واحدة
  // مجموعة، وإلا حسبنا فرق المخزون مرتين على نفس المفتاح.
  const merged = new Map<string, OrderLine>();
  for (const line of lines) {
    const key = stockKey(line.productId, line.variantId);
    const existing = merged.get(key);
    if (existing && existing.unitPrice === line.unitPrice) {
      existing.quantity += line.quantity;
      existing.lineTotal = existing.unitPrice * existing.quantity;
    } else if (existing) {
      return error(
        `item:${line.productId}:${line.variantId ?? "base"}`,
        `"${line.nameSnapshot}" مُكرَّر بثمنين مختلفين. وحّد السطر بثمن واحد.`
      );
    } else {
      merged.set(key, { ...line });
    }
  }
  const nextLines = [...merged.values()];

  try {
    const totals = await sql.begin(async (trx) => {
      // قفل صفّ الطلب: يمنع تعديلين متزامنين من حساب فرقين من نفس الحالة
      // القديمة، وهو نفس الأسلوب المستعمَل في الإلغاء والإرجاع.
      const [order] = await trx<{ status: OrderStatus; delivery_fee: string | null }[]>`
        select status, delivery_fee from public.orders where id = ${input.orderId} for update
      `;
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (RESTOCKING_STATUSES.includes(order.status)) throw new Error("ORDER_RESTOCKED");

      const previous = await trx<
        { product_id: number | null; variant_id: number | null; quantity: number }[]
      >`
        select product_id, variant_id, quantity from public.order_items
        where order_id = ${input.orderId}
      `;

      const before = new Map<string, number>();
      for (const item of previous) {
        const key = stockKey(item.product_id, item.variant_id);
        before.set(key, (before.get(key) ?? 0) + item.quantity);
      }

      const after = new Map<string, number>();
      for (const line of nextLines) {
        after.set(stockKey(line.productId, line.variantId), line.quantity);
      }

      // الفرق لكل قطعة، على اتحاد المفتاحين حتى لا يفوتنا سطر محذوف.
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
        if (delta === 0) continue;

        const [productPart, variantPart] = key.split(":");
        const productId = productPart === "none" ? null : Number(productPart);
        const variantId = variantPart === "base" ? null : Number(variantPart);
        const target = { productId, variantId };

        if (delta > 0) {
          const line =
            nextLines.find((l) => stockKey(l.productId, l.variantId) === key) ?? null;
          await reserveStock(
            trx,
            {
              productId: productId ?? 0,
              variantId,
              nameSnapshot: line?.nameSnapshot ?? "منتج",
            },
            delta
          );
        } else {
          await releaseStock(trx, target, -delta);
        }

        // إشارة مقلوبة عمداً: `delta` تغيّرُ كمية **الطلب**، بينما
        // quantity_delta في stock_movements تغيّرُ **المخزون** — وهما
        // متعاكسان دائماً. زيادة الطلب 2 تعني نقص المخزون 2، تماماً كما
        // يسجّل الطلب الجديد ‎-quantity‎ لا ‎+quantity‎.
        //
        // و manual_adjustment هو السبب الصادق: مدير غيّر الطلب. البديلان
        // ('order_created' و'order_cancelled') يعنيان حدثين لم يقعا، وكانا
        // سيُفسدان أي قراءة لاحقة لسجلّ المخزون.
        await recordStockMovement(trx, target, input.orderId, -delta, "manual_adjustment");
      }

      await trx`delete from public.order_items where order_id = ${input.orderId}`;
      for (const line of nextLines) {
        await insertOrderItem(trx, input.orderId, line);
      }

      const itemsSubtotal = sumLines(nextLines);
      const deliveryFee =
        input.deliveryFee ?? (order.delivery_fee === null ? null : Number(order.delivery_fee));
      const finalTotal = deliveryFee === null ? null : itemsSubtotal + deliveryFee;

      await trx`
        update public.orders
        set items_subtotal = ${itemsSubtotal},
            delivery_fee = ${deliveryFee},
            final_total = ${finalTotal}
        where id = ${input.orderId}
      `;

      await trx`
        insert into public.order_status_history (order_id, status, note, changed_by)
        values (
          ${input.orderId}, ${order.status},
          ${`تعديل محتوى الطلب — المجموع الجديد ${itemsSubtotal.toFixed(2)} درهم`},
          ${input.changedByEmail}
        )
      `;

      return { itemsSubtotal, deliveryFee: deliveryFee ?? 0, finalTotal: finalTotal ?? itemsSubtotal };
    });

    return { ok: true, ...totals };
  } catch (err) {
    if (err instanceof StockConflictError) {
      return error(
        `item:${err.line.productId}:${err.line.variantId ?? "base"}`,
        `المخزون المتوفر من "${err.line.nameSnapshot}" لا يكفي للزيادة المطلوبة. صحّح المخزون أو أنقص الكمية.`
      );
    }
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      return error("general", "الطلب غير موجود.");
    }
    if (err instanceof Error && err.message === "ORDER_RESTOCKED") {
      return error(
        "general",
        "لا يمكن تعديل طلب ملغى أو راجع: مخزونه أُرجع بالفعل، وأي تعديل الآن سيخصمه مرتين."
      );
    }
    console.error("updateOrderLines: خطأ غير متوقع", err);
    return error("general", "تعذّر حفظ التعديل بسبب مشكلة تقنية. حاول مرة أخرى.");
  }
}
