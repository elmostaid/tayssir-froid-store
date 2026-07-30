import { sql } from "@/lib/db";
import { getSettings } from "@/lib/queries/settings";
import { isValidMoroccanPhone, normalizePhone } from "@/lib/phone";
import { isValidQuantity } from "@/lib/cart/cartMath";
import type { CatalogProduct, CatalogProductVariant } from "@/lib/types";
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
  }

  if (!input.customer.phone?.trim() || !isValidMoroccanPhone(input.customer.phone)) {
    errors.push({
      field: "phone",
      message: "رقم الهاتف غير صحيح. يجب أن يكون رقماً مغربياً صالحاً (مثال: 0612345678).",
    });
  }

  if (!input.customer.city?.trim()) {
    errors.push({ field: "city", message: "المدينة إجبارية." });
  }

  if (!input.customer.address?.trim()) {
    errors.push({ field: "address", message: "العنوان إجباري." });
  }

  if (!input.idempotencyKey?.trim()) {
    errors.push({ field: "general", message: "طلب غير صالح، الرجاء إعادة تحميل الصفحة." });
  }

  return errors;
}

type ValidatedLineItem = {
  productId: number;
  variantId: number | null;
  nameSnapshot: string;
  skuSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const structuralErrors = validateStructure(input);
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors };
  }

  try {
    const settings = await getSettings();

    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const variantIds = [
      ...new Set(
        input.items
          .map((item) => item.variantId)
          .filter((id): id is number => id !== null)
      ),
    ];

    // إعادة جلب المنتجات والمتغيرات من قاعدة البيانات مباشرة — لا نثق أبداً
    // بالسعر أو المخزون أو الحد الأدنى القادم من المتصفح.
    const products = await sql<CatalogProduct[]>`
      select * from public.catalog_products where id = any(${productIds})
    `;
    const variants =
      variantIds.length > 0
        ? await sql<CatalogProductVariant[]>`
            select * from public.catalog_product_variants where id = any(${variantIds})
          `
        : [];

    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));

    const lineItems: ValidatedLineItem[] = [];
    const itemErrors: CreateOrderFieldError[] = [];

    for (const item of input.items) {
      const fieldKey = `item:${item.productId}:${item.variantId ?? "base"}`;
      const product = productById.get(item.productId);

      if (!product) {
        itemErrors.push({
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
          itemErrors.push({
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

      if (effectiveStock <= 0) {
        itemErrors.push({
          field: fieldKey,
          message: `"${product.name_ar}" نفدت كميته حالياً. الرجاء إزالته من السلة.`,
        });
        continue;
      }

      if (!isValidQuantity(item.quantity, effectiveMinQty, effectiveIncrement)) {
        itemErrors.push({
          field: fieldKey,
          message: `الكمية المطلوبة من "${product.name_ar}" غير صحيحة (الحد الأدنى ${effectiveMinQty}، بمضاعفات ${effectiveIncrement}).`,
        });
        continue;
      }

      lineItems.push({
        productId: product.id,
        variantId: item.variantId,
        nameSnapshot: variantName ? `${product.name_ar} — ${variantName}` : product.name_ar,
        skuSnapshot: product.sku,
        unitPrice: effectivePrice,
        quantity: item.quantity,
        lineTotal: effectivePrice * item.quantity,
      });
    }

    if (itemErrors.length > 0) {
      return { ok: false, errors: itemErrors };
    }

    const subtotal = lineItems.reduce((sum, line) => sum + line.lineTotal, 0);

    if (subtotal < settings.minOrderAmountMad) {
      return {
        ok: false,
        errors: [
          {
            field: "items",
            message: `المجموع الحالي (${subtotal.toFixed(2)} درهم) أقل من الحد الأدنى للطلب (${settings.minOrderAmountMad} درهم)، دون احتساب التوصيل. أضف منتجات أخرى للوصول إلى الحد الأدنى.`,
          },
        ],
      };
    }

    const normalizedPhone = normalizePhone(input.customer.phone);

    const publicReference = await sql.begin(async (trx) => {
      const inserted = await trx<{ id: number; public_reference: string }[]>`
        insert into public.orders (
          customer_name, customer_phone, customer_city, customer_address,
          customer_notes, items_subtotal, status, source, idempotency_key
        ) values (
          ${input.customer.fullName.trim()}, ${normalizedPhone}, ${input.customer.city.trim()},
          ${input.customer.address.trim()}, ${input.customer.notes?.trim() || null},
          ${subtotal}, 'new', 'website', ${input.idempotencyKey}
        )
        on conflict (idempotency_key) do nothing
        returning id, public_reference
      `;

      if (inserted.length > 0) {
        const orderId = inserted[0].id;

        for (const line of lineItems) {
          await trx`
            insert into public.order_items (
              order_id, product_id, variant_id, product_name_snapshot,
              sku_snapshot, unit_price_snapshot, quantity, line_total
            ) values (
              ${orderId}, ${line.productId}, ${line.variantId}, ${line.nameSnapshot},
              ${line.skuSnapshot}, ${line.unitPrice}, ${line.quantity}, ${line.lineTotal}
            )
          `;
        }

        await trx`
          insert into public.order_status_history (order_id, status, note)
          values (${orderId}, 'new', 'طلب جديد من الموقع')
        `;

        return inserted[0].public_reference;
      }

      // تعارض على idempotency_key => نفس الطلب أُرسل مسبقاً (ضغط مزدوج على
      // الزر مثلاً). نُعيد مرجع الطلب الموجود أصلاً بدل إنشاء طلب مكرر.
      const existing = await trx<{ public_reference: string }[]>`
        select public_reference from public.orders
        where idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      return existing[0]?.public_reference ?? null;
    });

    if (!publicReference) {
      console.error("createOrder: فشل الحصول على مرجع الطلب بعد الإدخال");
      return GENERIC_ERROR;
    }

    return { ok: true, publicReference };
  } catch (error) {
    console.error("createOrder: خطأ غير متوقع أثناء إنشاء الطلب", error);
    return GENERIC_ERROR;
  }
}
