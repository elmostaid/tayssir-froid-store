import { sql } from "@/lib/db";
import { isValidMoroccanPhone } from "@/lib/phone";
import { isManualOrderSource, ORDER_SOURCE_LABELS, type OrderSource } from "@/lib/orders/orderSource";

/**
 * قراءة «بون» واتساب من JSON وتحويله إلى مسودّة معروضة — **بلا إنشاء أي
 * طلب وبلا لمس المخزون.**
 *
 * الفصل بين القراءة والإنشاء هو كل الفكرة: ما يصل من محادثة واتساب قد يحمل
 * SKU مكتوباً بيد بشرية، أو كمية صفراً، أو ثمناً نُسخ خطأً. فنُطابق كل شيء
 * مع قاعدة البيانات ونعرض النتيجة كاملةً — بالتكلفة والربح — ليقرّرها إنسان
 * قبل أن يتحرّك رقم مخزون واحد. الإنشاء بعد ذلك يمرّ من نفس
 * createManualOrder المُختبَر، لا من مسار ثانٍ.
 *
 * الأسعار: `unit_price` في البون هو ما اتُّفق عليه مع الزبون فعلاً، فيُقبَل
 * كما هو. وإن غاب، يُملأ من سعر المنتج الحالي. أما التكلفة فتُقرأ من
 * القاعدة دائماً ولا تُقبَل من الملف إطلاقاً.
 */

export type ImportedItemDraft = {
  sku: string;
  productId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  /** null = لا ثمن شراء مسجَّل؛ ربح هذا السطر غير معروف. */
  purchasePrice: number | null;
  stockQuantity: number;
  /** true إذا كان الثمن مأخوذاً من المنتج لأن البون لم يذكره. */
  priceFromCatalog: boolean;
};

export type ImportedOrderDraft = {
  customerName: string;
  phone: string;
  city: string;
  address: string;
  notes: string;
  source: OrderSource;
  deliveryFee: number;
  items: ImportedItemDraft[];
};

export type ImportIssue = { field: string; message: string };

export type ImportResult =
  | { ok: true; draft: ImportedOrderDraft; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[] };

const MAX_ITEMS = 60;
const MAX_JSON_BYTES = 200_000;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** يقبل الرقم كرقم أو كنص ("45" أو "45.50") — البونات تأتي بالشكلين. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * الخطوة الأولى: هل النص JSON صالح أصلاً وبالشكل المتوقَّع؟
 * تُفصَل عن مطابقة المنتجات لأن خطأ الصياغة يستحقّ رسالة تقول أين هو.
 */
export function parseOrderJson(raw: string): { ok: true; value: unknown } | { ok: false; errors: ImportIssue[] } {
  const text = raw.trim();
  if (!text) return { ok: false, errors: [{ field: "json", message: "الصق بيانات البون أو ارفع الملف أولاً." }] };
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) {
    return { ok: false, errors: [{ field: "json", message: "الملف كبير جداً (الحد 200 كيلوبايت)." }] };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return {
      ok: false,
      errors: [{ field: "json", message: `الملف ليس JSON صالحاً${detail ? ` — ${detail}` : ""}.` }],
    };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: [{ field: "json", message: "المتوقَّع كائن JSON واحد يصف البون، لا قائمة ولا نصاً." }] };
  }
  return { ok: true, value };
}

/**
 * الخطوة الثانية: مطابقة كل SKU مع منتج حقيقي، والتحقّق من كل رقم.
 *
 * تُجمَع **كل** الأخطاء ثم تُعاد معاً: من يلصق بوناً فيه ثلاثة أخطاء يريد
 * رؤيتها الثلاثة، لا أن يُصلح واحداً ليُفاجأ بالتالي.
 */
export async function buildOrderDraft(input: unknown): Promise<ImportResult> {
  const record = input as Record<string, unknown>;
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];

  const customerName = asText(record.customer_name);
  const phone = asText(record.phone);
  const city = asText(record.city);
  const address = asText(record.address);
  const notes = asText(record.notes);

  if (!customerName) errors.push({ field: "customer_name", message: "اسم الزبون مفقود في البون." });
  if (!phone) errors.push({ field: "phone", message: "رقم الهاتف مفقود في البون." });
  else if (!isValidMoroccanPhone(phone))
    errors.push({ field: "phone", message: `رقم الهاتف "${phone}" غير صالح (رقم مغربي يبدأ بـ06 أو 07 أو 05).` });
  if (!city) errors.push({ field: "city", message: "المدينة مفقودة في البون." });
  if (!address) errors.push({ field: "address", message: "العنوان مفقود في البون." });

  const rawSource = asText(record.source) || "whatsapp";
  if (!isManualOrderSource(rawSource)) {
    errors.push({
      field: "source",
      message: `المصدر "${rawSource}" غير مقبول. المسموح: ${Object.entries(ORDER_SOURCE_LABELS)
        .filter(([key]) => key !== "website")
        .map(([key, label]) => `${key} (${label})`)
        .join("، ")}.`,
    });
  }

  const deliveryFeeRaw = record.delivery_fee ?? 0;
  const deliveryFee = asNumber(deliveryFeeRaw);
  if (deliveryFee === null || deliveryFee < 0) {
    errors.push({ field: "delivery_fee", message: "مصاريف التوصيل غير صالحة — المتوقَّع رقم أكبر من أو يساوي صفر." });
  }

  const rawItems = record.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    errors.push({ field: "items", message: "البون لا يحتوي على أي منتج." });
    return { ok: false, errors };
  }
  if (rawItems.length > MAX_ITEMS) {
    errors.push({ field: "items", message: `عدد المنتجات (${rawItems.length}) يتجاوز الحد المسموح (${MAX_ITEMS}).` });
    return { ok: false, errors };
  }

  // نجمع الأكواد أولاً ثم نجلبها باستعلام واحد بدل استعلام لكل سطر.
  const requested = rawItems.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      index,
      sku: asText(row.sku),
      quantity: asNumber(row.quantity),
      unitPrice: row.unit_price === undefined || row.unit_price === null ? null : asNumber(row.unit_price),
      hadPrice: row.unit_price !== undefined && row.unit_price !== null,
    };
  });

  // نبحث بالحروف الصغيرة: البون يُكتب بيد بشرية وقد يأتي الكود بأي حالة،
  // بينما الأكواد في القاعدة بحروف كبيرة. المطابقة تبقى دقيقة — lower() على
  // الطرفين، لا بحث جزئي.
  const skus = [...new Set(requested.map((r) => r.sku.toLowerCase()).filter(Boolean))];
  const products = skus.length
    ? await sql<
        {
          id: number;
          sku: string;
          name_ar: string;
          sale_price: string;
          purchase_price: string | null;
          stock_quantity: number;
        }[]
      >`
        select id, sku, name_ar, sale_price, purchase_price, stock_quantity
        from public.products where lower(sku) = any(${skus})
      `
    : [];

  // المطابقة غير حسّاسة لحالة الأحرف: البون يُكتب بيد بشرية.
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const items: ImportedItemDraft[] = [];

  for (const line of requested) {
    const where = `items[${line.index}]`;

    if (!line.sku) {
      errors.push({ field: where, message: `السطر رقم ${line.index + 1}: كود المنتج (sku) مفقود.` });
      continue;
    }
    const product = bySku.get(line.sku.toLowerCase());
    if (!product) {
      errors.push({ field: where, message: `الكود "${line.sku}" غير موجود في قاعدة البيانات.` });
      continue;
    }
    if (line.quantity === null || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      errors.push({
        field: where,
        message: `الكمية المطلوبة من "${product.name_ar}" غير صالحة — المتوقَّع عدد صحيح أكبر من صفر.`,
      });
      continue;
    }
    if (line.hadPrice && (line.unitPrice === null || line.unitPrice < 0)) {
      errors.push({ field: where, message: `ثمن البيع لـ"${product.name_ar}" غير صالح.` });
      continue;
    }

    // المخزون يُفحَص هنا للعرض والتحذير فقط؛ الحجز الذرّي الحقيقي يقع عند
    // الإنشاء، وهو وحده ما يمنع المخزون السالب.
    if (product.stock_quantity < line.quantity) {
      errors.push({
        field: where,
        message: `المخزون المتوفر من "${product.name_ar}" هو ${product.stock_quantity} فقط، والبون يطلب ${line.quantity}.`,
      });
      continue;
    }

    const catalogPrice = Number(product.sale_price);
    const unitPrice = line.hadPrice && line.unitPrice !== null ? line.unitPrice : catalogPrice;

    if (line.hadPrice && unitPrice !== catalogPrice) {
      warnings.push({
        field: where,
        message: `"${product.name_ar}": ثمن البون ${unitPrice} يختلف عن سعر المنتج ${catalogPrice}.`,
      });
    }
    if (product.purchase_price === null) {
      warnings.push({ field: where, message: `"${product.name_ar}": لا ثمن شراء مسجَّل، فربح هذا السطر غير معروف.` });
    }

    items.push({
      sku: product.sku,
      productId: product.id,
      name: product.name_ar,
      quantity: line.quantity,
      unitPrice,
      purchasePrice: product.purchase_price === null ? null : Number(product.purchase_price),
      stockQuantity: product.stock_quantity,
      priceFromCatalog: !line.hadPrice,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    draft: {
      customerName,
      phone,
      city,
      address,
      notes,
      source: rawSource as OrderSource,
      deliveryFee: deliveryFee ?? 0,
      items,
    },
  };
}
