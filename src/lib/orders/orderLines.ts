import type { Sql, TransactionSql } from "postgres";

/**
 * السطر الواحد كما يُكتب في قاعدة البيانات، بعد أن حُسم سعره وتكلفته.
 * `unitPrice` **ليس** بالضرورة سعر المنتج الحالي: طلب واتساب قد يحمل ثمناً
 * خاصاً اتُّفق عليه، وهذا بالضبط ما يجعل `unit_price_snapshot` عموداً لكل
 * سطر لا مجرّد نسخة من جدول المنتجات.
 */
export type OrderLine = {
  productId: number;
  variantId: number | null;
  nameSnapshot: string;
  skuSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  purchasePriceSnapshot: number | null;
};

/** يُرمى داخل المعاملة حين لا يكفي المخزون، فتتراجع كاملةً. */
export class StockConflictError extends Error {
  constructor(readonly line: Pick<OrderLine, "productId" | "variantId" | "nameSnapshot">) {
    super("STOCK_CONFLICT");
    this.name = "StockConflictError";
  }
}

type Trx = TransactionSql<Record<string, unknown>> | Sql<Record<string, unknown>>;

/**
 * حجز المخزون لكمية موجبة، ذرّياً.
 *
 * الشرط `stock_quantity >= quantity` **داخل UPDATE نفسه** هو الحماية كلها:
 * لا قفل يدوي، ولا قراءة-ثم-كتابة يمكن أن يتسلّل بينهما طلب آخر. صفر صفوف
 * راجعة تعني أن الكمية لم تعد متوفرة، فنرمي ونتراجع.
 *
 * تُستعمَل من ثلاثة مواضع بنفس الضمانة: طلب الموقع، الطلب اليدوي، وزيادة
 * كمية سطر في طلب قائم.
 */
export async function reserveStock(
  trx: Trx,
  line: Pick<OrderLine, "productId" | "variantId" | "nameSnapshot">,
  quantity: number
): Promise<void> {
  if (quantity <= 0) return;

  const decremented = line.variantId
    ? await trx<{ id: number }[]>`
        update public.product_variants
        set stock_quantity = stock_quantity - ${quantity}
        where id = ${line.variantId} and stock_quantity >= ${quantity}
        returning id
      `
    : await trx<{ id: number }[]>`
        update public.products
        set stock_quantity = stock_quantity - ${quantity}
        where id = ${line.productId} and stock_quantity >= ${quantity}
        returning id
      `;

  if (decremented.length === 0) throw new StockConflictError(line);
}

/** إرجاع كمية إلى المخزون. لا شرط هنا: الزيادة لا تُنتج مخزوناً سالباً. */
export async function releaseStock(
  trx: Trx,
  target: { productId: number | null; variantId: number | null },
  quantity: number
): Promise<void> {
  if (quantity <= 0) return;

  if (target.variantId) {
    await trx`
      update public.product_variants set stock_quantity = stock_quantity + ${quantity}
      where id = ${target.variantId}
    `;
  } else if (target.productId) {
    await trx`
      update public.products set stock_quantity = stock_quantity + ${quantity}
      where id = ${target.productId}
    `;
  }
}

/** حركة مخزون واحدة. `delta` سالب عند الحجز وموجب عند الإرجاع. */
export async function recordStockMovement(
  trx: Trx,
  target: { productId: number | null; variantId: number | null },
  orderId: number,
  delta: number,
  reason: "order_created" | "order_cancelled" | "order_returned" | "manual_adjustment"
): Promise<void> {
  if (delta === 0) return;
  await trx`
    insert into public.stock_movements (product_id, variant_id, order_id, quantity_delta, reason)
    values (${target.productId}, ${target.variantId}, ${orderId}, ${delta}, ${reason})
  `;
}

export async function insertOrderItem(trx: Trx, orderId: number, line: OrderLine): Promise<void> {
  await trx`
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot,
      sku_snapshot, unit_price_snapshot, quantity, line_total, purchase_price_snapshot
    ) values (
      ${orderId}, ${line.productId}, ${line.variantId}, ${line.nameSnapshot},
      ${line.skuSnapshot}, ${line.unitPrice}, ${line.quantity}, ${line.lineTotal},
      ${line.purchasePriceSnapshot}
    )
  `;
}

/**
 * كتابة سطور طلب جديد كاملةً: حجز المخزون، ثم السطر، ثم حركة المخزون —
 * بهذا الترتيب لكل سطر. الترتيب مقصود: لا نكتب سطراً لم نحجز مخزونه.
 */
export async function writeNewOrderLines(
  trx: Trx,
  orderId: number,
  lines: OrderLine[]
): Promise<void> {
  for (const line of lines) {
    await reserveStock(trx, line, line.quantity);
    await insertOrderItem(trx, orderId, line);
    await recordStockMovement(trx, line, orderId, -line.quantity, "order_created");
  }
}

/** مجموع السلع من السطور — مصدر واحد للحساب في كل المسارات. */
export function sumLines(lines: Pick<OrderLine, "lineTotal">[]): number {
  return lines.reduce((sum, line) => sum + line.lineTotal, 0);
}
