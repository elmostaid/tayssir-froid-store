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

/**
 * حالة السطر داخل الطلب. المخزون يُخصم لـ"reserved" وحدها، والباقي يبقى
 * ظاهراً في اللوحة باسمه وكميته وسببه بدل أن يختفي أو يُسقِط الطلب كلَّه.
 */
export type LineStatus = "reserved" | "out_of_stock" | "invalid";

export type RejectedLine = {
  line: OrderLine;
  status: Exclude<LineStatus, "reserved">;
  reason: string;
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

export async function insertOrderItem(
  trx: Trx,
  orderId: number,
  line: OrderLine,
  status: LineStatus = "reserved",
  reason: string | null = null
): Promise<void> {
  await trx`
    insert into public.order_items (
      order_id, product_id, variant_id, product_name_snapshot,
      sku_snapshot, unit_price_snapshot, quantity, line_total, purchase_price_snapshot,
      line_status, line_status_reason
    ) values (
      ${orderId}, ${line.productId}, ${line.variantId}, ${line.nameSnapshot},
      ${line.skuSnapshot}, ${line.unitPrice}, ${line.quantity}, ${line.lineTotal},
      ${line.purchasePriceSnapshot}, ${status}, ${reason}
    )
  `;
}

/**
 * حجز بلا رمي: يُرجع هل نجح الحجز.
 * reserveStock يُسقط المعاملة كلَّها عند النقص، وهو الصواب للطلب اليدوي
 * وتعديل الطلب. أما طلب الموقع فلا يجوز أن يضيع كلُّه لأجل سطر واحد.
 */
export async function tryReserveStock(
  trx: Trx,
  line: Pick<OrderLine, "productId" | "variantId" | "nameSnapshot">,
  quantity: number
): Promise<boolean> {
  if (quantity <= 0) return false;
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
  return decremented.length > 0;
}

/**
 * كتابة سطور طلب الموقع بحالة لكل سطر.
 *
 * الطلب يُحفظ كما اختاره الزبون كاملاً: ما تَوفّر يُحجز مخزونه، وما لم
 * يتوفّر يُكتب بحالته وسببه بلا خصم. `alreadyRejected` سطور رُفضت قبل
 * الوصول إلى المخزون (كمية دون الحدّ الأدنى مثلاً) — تُكتب هي أيضاً حتى لا
 * تختفي سلعة اختارها الزبون من أمام عين الموظّف.
 */
export async function writeWebsiteOrderLines(
  trx: Trx,
  orderId: number,
  lines: OrderLine[],
  alreadyRejected: RejectedLine[] = []
): Promise<{ reserved: OrderLine[]; rejected: RejectedLine[] }> {
  const reserved: OrderLine[] = [];
  const rejected: RejectedLine[] = [...alreadyRejected];

  for (const line of lines) {
    if (await tryReserveStock(trx, line, line.quantity)) {
      await insertOrderItem(trx, orderId, line, "reserved");
      await recordStockMovement(trx, line, orderId, -line.quantity, "order_created");
      reserved.push(line);
    } else {
      await insertOrderItem(
        trx, orderId, line, "out_of_stock",
        `الكمية المطلوبة (${line.quantity}) غير متوفرة في المخزون وقت الطلب.`
      );
      rejected.push({
        line,
        status: "out_of_stock",
        reason: `الكمية المطلوبة (${line.quantity}) غير متوفرة في المخزون وقت الطلب.`,
      });
    }
  }

  for (const entry of alreadyRejected) {
    await insertOrderItem(trx, orderId, entry.line, entry.status, entry.reason);
  }

  return { reserved, rejected };
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
