import { sql } from "@/lib/db";
import { isValidQuantity } from "@/lib/cart/cartMath";
import type { OrderLine } from "@/lib/orders/orderLines";
import type { CreateOrderFieldError } from "@/lib/orders/types";
import type { CatalogProduct, CatalogProductVariant } from "@/lib/types";

/**
 * تحويل طلبات السطور إلى سطور جاهزة للكتابة: أسعار وأسماء وتكاليف، كلها
 * **من قاعدة البيانات** لا من المتصفح.
 *
 * وحدة واحدة يستعملها ثلاثة مسارات (طلب الموقع، الطلب اليدوي، تعديل طلب
 * قائم) بدل ثلاث نسخ تنحرف مع الوقت. ما يختلف بينها قواعدُ لا منطق، فمُرِّرت
 * كخيارات صريحة يُقرأ من اسمها ماذا يتساهل كل مسار ولماذا.
 */

export type LineRequest = {
  productId: number;
  variantId: number | null;
  quantity: number;
  /** ثمن بيع خاص لهذا الطلب. يُتجاهَل ما لم يُسمح به صراحةً. */
  unitPriceOverride?: number | null;
};

export type ResolveLinesOptions = {
  /**
   * طلبات واتساب والهاتف تُبرَم بالكلام: "خذها بـ280 بدل 320". السماح
   * بالثمن الخاص هنا هو الفرق بين تسجيل البيع كما وقع فعلاً وبين تزوير
   * الأرقام لتوافق قائمة الأسعار.
   */
  allowPriceOverride: boolean;
  /**
   * الكمية الدنيا ومضاعفاتها قاعدة **بيع بالجملة على الموقع**، لا قانون
   * طبيعة. المدير الذي باع قطعة واحدة في المحل يسجّل الواقع.
   */
  enforceQuantityRules: boolean;
  /**
   * حالة "غير متوفر" تُخفي المنتج عن زبائن الموقع؛ لا معنى لها حين يكون
   * البيع قد **وقع فعلاً**. المخزون نفسه يبقى محمياً على أي حال بالحجز
   * الذرّي في orderLines.reserveStock — فلا يصير سالباً أبداً.
   */
  enforceAvailability: boolean;
};

export const WEBSITE_LINE_RULES: ResolveLinesOptions = {
  allowPriceOverride: false,
  enforceQuantityRules: true,
  enforceAvailability: true,
};

export const MANUAL_LINE_RULES: ResolveLinesOptions = {
  allowPriceOverride: true,
  enforceQuantityRules: false,
  enforceAvailability: false,
};

export type ResolvedLines = {
  lines: OrderLine[];
  errors: CreateOrderFieldError[];
};

export async function resolveOrderLines(
  items: LineRequest[],
  options: ResolveLinesOptions
): Promise<ResolvedLines> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const variantIds = [
    ...new Set(items.map((item) => item.variantId).filter((id): id is number => id !== null)),
  ];

  const products = await sql<CatalogProduct[]>`
    select * from public.catalog_products where id = any(${productIds})
  `;
  const variants =
    variantIds.length > 0
      ? await sql<CatalogProductVariant[]>`
          select * from public.catalog_product_variants where id = any(${variantIds})
        `
      : [];

  const purchasePriceRows = await sql<{ id: number; purchase_price: string | null }[]>`
    select id, purchase_price from public.products where id = any(${productIds})
  `;
  const variantPurchasePriceRows =
    variantIds.length > 0
      ? await sql<{ id: number; purchase_price_override: string | null }[]>`
          select id, purchase_price_override from public.product_variants where id = any(${variantIds})
        `
      : [];

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const purchasePriceById = new Map(purchasePriceRows.map((p) => [p.id, p.purchase_price]));
  const variantPurchasePriceById = new Map(
    variantPurchasePriceRows.map((v) => [v.id, v.purchase_price_override])
  );

  const lines: OrderLine[] = [];
  const errors: CreateOrderFieldError[] = [];

  for (const item of items) {
    const fieldKey = `item:${item.productId}:${item.variantId ?? "base"}`;
    const product = productById.get(item.productId);

    if (!product) {
      errors.push({
        field: fieldKey,
        message: "أحد المنتجات في سلتك لم يعد متوفراً. الرجاء إزالته من السلة.",
      });
      continue;
    }

    let effectivePrice = Number(product.sale_price);
    let effectiveMinQty = product.min_order_qty;
    let effectiveIncrement = product.qty_increment;
    let effectiveStock = product.stock_quantity;
    let variantName: string | null = null;

    if (item.variantId !== null) {
      const variant = variantById.get(item.variantId);
      if (!variant || variant.product_id !== item.productId) {
        errors.push({
          field: fieldKey,
          message: `النوع المختار من "${product.name_ar}" لم يعد متوفراً. الرجاء اختيار نوع آخر.`,
        });
        continue;
      }
      effectivePrice = Number(variant.sale_price);
      effectiveMinQty = variant.min_order_qty;
      effectiveIncrement = variant.qty_increment;
      effectiveStock = variant.stock_quantity;
      variantName = variant.variant_name;
    }

    if (options.enforceAvailability) {
      if (product.status === "out_of_stock") {
        errors.push({
          field: fieldKey,
          message: `"${product.name_ar}" غير متوفر للطلب حالياً. الرجاء إزالته من السلة.`,
        });
        continue;
      }
      if (effectiveStock <= 0) {
        errors.push({
          field: fieldKey,
          message: `"${product.name_ar}" نفدت كميته حالياً. الرجاء إزالته من السلة.`,
        });
        continue;
      }
    }

    if (options.enforceQuantityRules) {
      if (!isValidQuantity(item.quantity, effectiveMinQty, effectiveIncrement)) {
        errors.push({
          field: fieldKey,
          message: `الكمية المطلوبة من "${product.name_ar}" غير صحيحة (الحد الأدنى ${effectiveMinQty}، بمضاعفات ${effectiveIncrement}).`,
        });
        continue;
      }
    } else if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push({
        field: fieldKey,
        message: `الكمية المطلوبة من "${product.name_ar}" يجب أن تكون عدداً صحيحاً أكبر من صفر.`,
      });
      continue;
    }

    if (options.allowPriceOverride && item.unitPriceOverride != null) {
      const override = Number(item.unitPriceOverride);
      if (!Number.isFinite(override) || override < 0) {
        errors.push({
          field: fieldKey,
          message: `ثمن البيع الخاص لـ"${product.name_ar}" غير صالح.`,
        });
        continue;
      }
      effectivePrice = override;
    }

    // ثمن الشراء الفعلي وقت الطلب: أولوية لـvariant.purchase_price_override
    // إن وُجد، وإلا product.purchase_price — يُخزَّن كـsnapshot ثابت فـ
    // order_items ولا يتأثر بأي تعديل لاحق على ثمن الشراء (انظر
    // adminReports.ts للاستهلاك).
    const rawPurchasePrice =
      item.variantId !== null
        ? (variantPurchasePriceById.get(item.variantId) ??
          purchasePriceById.get(item.productId) ??
          null)
        : (purchasePriceById.get(item.productId) ?? null);

    lines.push({
      productId: product.id,
      variantId: item.variantId,
      nameSnapshot: variantName ? `${product.name_ar} — ${variantName}` : product.name_ar,
      skuSnapshot: product.sku,
      unitPrice: effectivePrice,
      quantity: item.quantity,
      lineTotal: effectivePrice * item.quantity,
      purchasePriceSnapshot: rawPurchasePrice === null ? null : Number(rawPurchasePrice),
    });
  }

  return { lines, errors };
}
