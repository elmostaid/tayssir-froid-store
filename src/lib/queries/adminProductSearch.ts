import { sql } from "@/lib/db";

/**
 * بحث المنتجات لنموذج الطلب اليدوي: بالاسم أو بالـSKU.
 *
 * يُرجع ثمن البيع الحالي ليملأ النموذج تلقائياً، والمخزون ليرى المدير ما
 * لديه قبل أن يَعِد الزبون، وثمن الشراء ليُحسَب الربح المتوقَّع قبل الحفظ.
 *
 * ثمن الشراء سرّي: لا يخرج من هنا إلا عبر إجراء يتحقّق من Owner/Admin أولاً
 * (نفس بوابة صفحة التقارير التي تعرضه أصلاً)، ولا يصل أي واجهة يراها زبون
 * أو Staff. والمحفوظ في الطلب يبقى دائماً ما يقرأه الخادم وقت الحفظ، لا ما
 * يرسله المتصفح.
 */

export type ProductSearchResult = {
  id: number;
  sku: string;
  name: string;
  salePriceMad: number;
  stockQuantity: number;
  minOrderQty: number;
  unitLabel: string;
  isOutOfStock: boolean;
  /** null يعني: لا ثمن شراء مسجَّل — الربح غير معروف، ولا يُخمَّن. */
  purchasePriceMad: number | null;
};

export async function searchProductsForOrder(
  term: string,
  limit = 12
): Promise<ProductSearchResult[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${trimmed}%`;
  const rows = await sql<
    {
      id: number;
      sku: string;
      name_ar: string;
      sale_price: string;
      stock_quantity: number;
      min_order_qty: number;
      unit_label: string;
      status: string;
      purchase_price: string | null;
    }[]
  >`
    select id, sku, name_ar, sale_price, stock_quantity, min_order_qty, unit_label, status, purchase_price
    from public.products
    where sku ilike ${pattern} or name_ar ilike ${pattern}
    order by
      -- مطابقة SKU حرفياً أولاً: المدير الذي يكتب SKU كاملاً يعرف ما يريد.
      case when lower(sku) = lower(${trimmed}) then 0 else 1 end,
      stock_quantity > 0 desc,
      name_ar
    limit ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name_ar,
    salePriceMad: Number(r.sale_price),
    stockQuantity: r.stock_quantity,
    minOrderQty: r.min_order_qty,
    unitLabel: r.unit_label,
    isOutOfStock: r.status === "out_of_stock",
    purchasePriceMad: r.purchase_price === null ? null : Number(r.purchase_price),
  }));
}

/**
 * سطور طلب قائم بالشكل الذي يحتاجه محرّر السطور: مع المخزون الحالي والكمية
 * المحجوزة لهذا الطلب وثمن الشراء.
 *
 * `reservedQuantity` هو ما يجعل المحرّر يعرض «المتاح» بصدق: المخزون الظاهر
 * في جدول المنتجات **بعد** أن حجز هذا الطلب كميته، فالمتاح لتعديل هذا السطر
 * تحديداً = المخزون الحالي + ما يحجزه هو أصلاً.
 *
 * ثمن الشراء هنا هو الحالي لا لقطة الطلب: هذا الرقم للمعاينة قبل الحفظ،
 * وما يُخزَّن فعلاً يقرؤه الخادم وقت الحفظ (انظر resolveLines).
 */
export async function getEditableOrderLines(orderId: number): Promise<
  Array<{
    productId: number;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    purchasePrice: number | null;
    stockQuantity: number;
    reservedQuantity: number;
  }>
> {
  const rows = await sql<
    {
      product_id: number | null;
      sku_snapshot: string;
      product_name_snapshot: string;
      quantity: number;
      unit_price_snapshot: string;
      purchase_price: string | null;
      stock_quantity: number | null;
      line_status: string;
    }[]
  >`
    select
      oi.product_id, oi.sku_snapshot, oi.product_name_snapshot, oi.quantity,
      oi.unit_price_snapshot, oi.line_status, p.purchase_price, p.stock_quantity
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    where oi.order_id = ${orderId}
    order by oi.id
  `;

  // سطر فقد منتجه (حُذف المنتج لاحقاً) لا يمكن إعادة حجزه ولا تسعيره من
  // مصدر موثوق، فنستبعده من المحرّر بدل عرضه بحالة نصف صالحة.
  return rows
    .filter((r): r is typeof r & { product_id: number } => r.product_id !== null)
    .map((r) => ({
      productId: r.product_id,
      sku: r.sku_snapshot,
      name: r.product_name_snapshot,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price_snapshot),
      purchasePrice: r.purchase_price === null ? null : Number(r.purchase_price),
      stockQuantity: r.stock_quantity ?? 0,
      // السطر غير المحجوز لا يمسك شيئاً من المخزون. اعتبارُ كميته محجوزة
      // كان يجعل المحرّر يعرض «المتاح» أكبر مما هو، فيَعِد المديرَ بكمية
      // لن يجدها عند الحفظ.
      reservedQuantity: r.line_status === "reserved" ? r.quantity : 0,
    }));
}
