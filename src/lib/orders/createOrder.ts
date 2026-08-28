import { sql } from "@/lib/db";
import { getSettings } from "@/lib/queries/settings";
import { isValidMoroccanPhone, normalizePhone } from "@/lib/phone";
import { isValidQuantity } from "@/lib/cart/cartMath";
import {
  resolveLineTotal,
  resolveUnitPrice,
  resolveVariantPricing,
  roundMoney,
  toTierPricing,
} from "@/lib/pricing/tierPricing";
import { isRateLimited } from "@/lib/orders/rateLimit";
import { notifyNewOrder } from "@/lib/notifications/notifyNewOrder";
import { sendCapiEvent } from "@/lib/pixel/capi";
import { toInternationalDigits } from "@/lib/phone";
import { getSiteUrl } from "@/lib/siteUrl";
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

type ValidatedLineItem = {
  productId: number;
  variantId: number | null;
  nameSnapshot: string;
  skuSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  purchasePriceSnapshot: number | null;
};

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

    // ثمن الشراء سري ولا يظهر فـcatalog_products/catalog_product_variants (انظر
    // supabase/migrations/20260730000002_security.sql) — نجلبه هنا من الجداول
    // الأصلية مباشرة (اتصال خادم مباشر عبر DATABASE_URL، ليس عبر anon key/
    // PostgREST) فقط لتخزين "صورة مجمَّدة" (snapshot) وقت إنشاء الطلب.
    const purchasePriceRows = await sql<{ id: number; purchase_price: string | null }[]>`
      select id, purchase_price from public.products where id = any(${productIds})
    `;
    const variantPurchasePriceRows =
      variantIds.length > 0
        ? await sql<{ id: number; purchase_price_override: string | null }[]>`
            select id, purchase_price_override from public.product_variants where id = any(${variantIds})
          `
        : [];

    const purchasePriceById = new Map(purchasePriceRows.map((p) => [p.id, p.purchase_price]));
    const variantPurchasePriceById = new Map(
      variantPurchasePriceRows.map((v) => [v.id, v.purchase_price_override])
    );

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

      // سلَّم الأثمنة يُبنى من صف قاعدة البيانات المُعاد جلبه للتو، لا من أي
      // شيء أرسله المتصفح — المتصفح لا يرسل أثماناً أصلاً (انظر
      // CartItemInput: productId/variantId/quantity فقط).
      let effectivePricing = toTierPricing(product);
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
        effectivePricing = resolveVariantPricing(
          effectivePricing,
          variant.sale_price,
          variant.has_price_override
        );
        effectiveMinQty = variant.min_order_qty;
        effectiveIncrement = variant.qty_increment;
        effectiveStock = variant.stock_quantity;
        variantName = variant.variant_name;
      }

      if (product.status === "out_of_stock") {
        itemErrors.push({
          field: fieldKey,
          message: `"${product.name_ar}" غير متوفر للطلب حالياً. الرجاء إزالته من السلة.`,
        });
        continue;
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

      // ثمن الشراء الفعلي وقت الطلب: أولوية لـvariant.purchase_price_override
      // إن وُجد، وإلا product.purchase_price — يُخزَّن كـsnapshot ثابت فـ
      // order_items ولا يتأثر بأي تعديل لاحق على ثمن الشراء (انظر
      // adminReports.ts للاستهلاك).
      const rawPurchasePrice =
        item.variantId !== null
          ? (variantPurchasePriceById.get(item.variantId) ?? purchasePriceById.get(item.productId) ?? null)
          : (purchasePriceById.get(item.productId) ?? null);
      const purchasePriceSnapshot = rawPurchasePrice === null ? null : Number(rawPurchasePrice);

      // نفس دالة التسعير المستعملة في صفحة المنتج والسلَّة وCheckout بالضبط —
      // فيستحيل أن يختلف الثمن المحفوظ في الطلب عمّا رآه الزبون، ما دامت
      // بيانات المنتج لم تتغيّر بينهما. الثمن المُجمَّد (unit_price_snapshot)
      // هو دائماً ثمن المستوى المطبَّق فعلاً على الكمية المطلوبة.
      const unitPrice = resolveUnitPrice(effectivePricing, item.quantity);

      lineItems.push({
        productId: product.id,
        variantId: item.variantId,
        nameSnapshot: variantName ? `${product.name_ar} — ${variantName}` : product.name_ar,
        skuSnapshot: product.sku,
        unitPrice,
        quantity: item.quantity,
        lineTotal: resolveLineTotal(effectivePricing, item.quantity),
        purchasePriceSnapshot,
      });
    }

    if (itemErrors.length > 0) {
      return { ok: false, errors: itemErrors };
    }

    const subtotal = roundMoney(lineItems.reduce((sum, line) => sum + line.lineTotal, 0));

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

    let stockConflict: CreateOrderFieldError | null = null;

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

        for (const line of lineItems) {
          // حجز المخزون: إنقاص فوري وذَرّي (atomic) عند إنشاء الطلب — الشرط
          // "stock_quantity >= quantity" داخل UPDATE نفسه يمنع أي سباق (race
          // condition) بين طلبين متزامنين على نفس القطعة، ويمنع مخزوناً
          // سالباً دون الحاجة لقفل يدوي منفصل.
          const decremented = line.variantId
            ? await trx<{ id: number }[]>`
                update public.product_variants
                set stock_quantity = stock_quantity - ${line.quantity}
                where id = ${line.variantId} and stock_quantity >= ${line.quantity}
                returning id
              `
            : await trx<{ id: number }[]>`
                update public.products
                set stock_quantity = stock_quantity - ${line.quantity}
                where id = ${line.productId} and stock_quantity >= ${line.quantity}
                returning id
              `;

          if (decremented.length === 0) {
            stockConflict = {
              field: `item:${line.productId}:${line.variantId ?? "base"}`,
              message: `الكمية المطلوبة من "${line.nameSnapshot}" لم تعد متوفرة بالكامل في المخزون الآن. الرجاء تعديل الكمية أو إزالة المنتج.`,
            };
            throw new Error("STOCK_CONFLICT");
          }

          await trx`
            insert into public.order_items (
              order_id, product_id, variant_id, product_name_snapshot,
              sku_snapshot, unit_price_snapshot, quantity, line_total,
              purchase_price_snapshot
            ) values (
              ${orderId}, ${line.productId}, ${line.variantId}, ${line.nameSnapshot},
              ${line.skuSnapshot}, ${line.unitPrice}, ${line.quantity}, ${line.lineTotal},
              ${line.purchasePriceSnapshot}
            )
          `;

          await trx`
            insert into public.stock_movements (
              product_id, variant_id, order_id, quantity_delta, reason
            ) values (
              ${line.productId}, ${line.variantId}, ${orderId}, ${-line.quantity}, 'order_created'
            )
          `;
        }

        await trx`
          insert into public.order_status_history (order_id, status, note)
          values (${orderId}, 'new', 'طلب جديد من الموقع')
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
      if (error instanceof Error && error.message === "STOCK_CONFLICT") return null;
      throw error;
    });

    if (stockConflict) {
      return { ok: false, errors: [stockConflict] };
    }

    if (!result) {
      console.error("createOrder: فشل الحصول على مرجع الطلب بعد الإدخال");
      return GENERIC_ERROR;
    }

    if (result.isNew) {
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

    return { ok: true, publicReference: result.publicReference };
  } catch (error) {
    console.error("createOrder: خطأ غير متوقع أثناء إنشاء الطلب", error);
    return GENERIC_ERROR;
  }
}
