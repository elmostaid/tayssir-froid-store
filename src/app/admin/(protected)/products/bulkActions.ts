"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { computeSkuPrefixForCategory, findMaxSkuNumber } from "@/lib/products/skuGeneration";
import {
  buildAutoProductName,
  findMaxAutoNameNumber,
  getCategoryName,
} from "@/lib/products/autoProductName";
import { buildProductDescription } from "@/lib/products/descriptionTemplates";
import { PRODUCT_STATUSES } from "@/lib/validation/product";
import { revalidateCatalog } from "@/lib/queries/catalogCache";

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin)." as const;

export type BulkProductInput = {
  categoryId: number;
  /**
   * اسم المنتج كما كتبه صاحب المتجر. فارغ = يُولَّد تلقائياً من اسم التصنيف
   * ورقم تسلسلي (انظر autoProductName.ts) — صاحب المتجر لا يُجبَر على كتابة
   * اسم لكل قطعة.
   */
  nameAr: string;
  /**
   * ترتيب هذا المنتج داخل الدفعة (يبدأ من 0). يُستعمل فقط عند توليد الاسم
   * تلقائياً، ليأخذ كل منتج في نفس الدفعة رقماً مختلفاً حتى قبل أن يلتزم
   * سابقه في القاعدة.
   */
  autoNameIndex?: number;
  purchasePrice: number | null;
  salePrice: number;
  minOrderQty: number;
  qtyIncrement: number;
  stockQuantity: number;
  status: (typeof PRODUCT_STATUSES)[number];
  descriptionAr: string;
};

export type BulkProductResult =
  | { outcome: "success"; productId: number; sku: string; slug: string; nameAr: string }
  | { outcome: "duplicate"; reason: string }
  | { outcome: "error"; error: string };

function validateBulkInput(input: BulkProductInput): string | null {
  if (!Number.isInteger(input.categoryId) || input.categoryId < 1) {
    return "اختر تصنيفاً صحيحاً.";
  }
  // الاسم لم يعد إجبارياً: الفارغ يُولَّد تلقائياً لاحقاً من اسم التصنيف.
  const nameAr = input.nameAr.trim();
  if (nameAr.length > 150) return "الاسم طويل جداً (150 حرفاً كحد أقصى).";
  if (!Number.isFinite(input.salePrice) || input.salePrice < 0) return "ثمن البيع غير صالح.";
  if (
    input.purchasePrice !== null &&
    (!Number.isFinite(input.purchasePrice) || input.purchasePrice < 0)
  ) {
    return "ثمن الشراء غير صالح.";
  }
  if (!Number.isInteger(input.minOrderQty) || input.minOrderQty < 1) {
    return "أقل عدد للطلب يجب أن يكون 1 على الأقل.";
  }
  if (!Number.isInteger(input.qtyIncrement) || input.qtyIncrement < 1) {
    return "درجة الزيادة يجب أن تكون 1 على الأقل.";
  }
  if (!Number.isInteger(input.stockQuantity) || input.stockQuantity < 0) {
    return "الكمية يجب أن تكون 0 أو أكثر.";
  }
  if (!PRODUCT_STATUSES.includes(input.status)) return "حالة نشر غير صالحة.";
  return null;
}

/**
 * إنشاء منتج واحد ضمن دفعة "إضافة مجموعة منتجات" — يُستدعى من الواجهة مرة
 * واحدة لكل سطر، بالتتابع (وليس كلها دفعة واحدة)، حتى يعرض progress حقيقياً
 * ولأن هذا التتابع نفسه هو ما يضمن ترقيم SKU الصحيح للدفعة: كل استدعاء
 * يرى فعلياً منتجات الاستدعاءات السابقة الناجحة (بعد commit فعلي)، فلا
 * حاجة لحساب N رقماً مسبقاً.
 *
 * SKU يتبع نفس نمط generateProductSku (بادئة التصنيف + رقم تسلسلي)، وslug
 * يُشتَق مباشرة من SKU نفسه (sku.toLowerCase()) — وليس من الاسم العربي: لا
 * محاولة لترجمة/تفريغ حروف عربية لأن slugify() لا تدعم ذلك، وهذا يضمن أيضاً
 * تفرّد slug تلقائياً بما أن SKU فريد أصلاً (لا حاجة لفحص إضافي منفصل).
 * import_key (بمعنى مفتاح دفعة مستقر) مطابق لنفس القيمة أيضاً — لا عمود
 * منفصل فقاعدة البيانات لهذا المفهوم.
 *
 * الأمان تجاه التزامن الحقيقي (مديران يضيفان لنفس التصنيف فآن واحد): محاولة
 * INSERT فعلية بـ`on conflict do nothing` هي الفحص الحاسم (وليس فحص مسبق
 * فقط)، مع إعادة المحاولة برقم تالٍ عند أي تعارض حقيقي — حتى 10 محاولات.
 *
 * منتج بنفس الاسم موجود أصلاً فنفس التصنيف يُعتبر "مكرر" (outcome:
 * "duplicate") وليس خطأً: لا يُنشأ صفّ جديد ولا يُستهلَك رقم SKU من الدفعة.
 */
export async function createBulkProduct(input: BulkProductInput): Promise<BulkProductResult> {
  const admin = await getAdminUser();
  if (!admin) return { outcome: "error", error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { outcome: "error", error: OWNER_ONLY_ERROR };

  const validationError = validateBulkInput(input);
  if (validationError) return { outcome: "error", error: validationError };

  // اسم فارغ = يُولَّد الآن من اسم التصنيف ورقم تسلسلي يُكمِل ما هو موجود
  // فعلاً (لا يبدأ من 01 في كل دفعة، وإلا رُفضت كل دفعة تالية كمكرَّرة).
  // autoNameIndex يفصل منتجات نفس الدفعة عن بعضها قبل أن يلتزم أولها.
  let nameAr = input.nameAr.trim();
  let categoryName: string | null = null;
  if (!nameAr) {
    categoryName = await getCategoryName(input.categoryId);
    if (!categoryName) return { outcome: "error", error: "التصنيف غير موجود." };
    const base = await findMaxAutoNameNumber(input.categoryId, categoryName);
    nameAr = buildAutoProductName(categoryName, base + 1 + (input.autoNameIndex ?? 0));
  }

  const existing = await sql<{ id: number }[]>`
    select id from public.products
    where category_id = ${input.categoryId} and name_ar = ${nameAr}
    limit 1
  `;
  if (existing[0]) {
    return { outcome: "duplicate", reason: "يوجد منتج بنفس الاسم في هذا التصنيف مسبقاً." };
  }

  const prefixResult = await computeSkuPrefixForCategory(input.categoryId);
  if ("error" in prefixResult) return { outcome: "error", error: prefixResult.error };
  const { prefix } = prefixResult;

  const baseNumber = await findMaxSkuNumber(prefix);

  const [categoryRow] = await sql<{ slug: string }[]>`
    select slug from public.categories where id = ${input.categoryId} limit 1
  `;
  const description = buildProductDescription(input.descriptionAr, categoryRow?.slug ?? null);

  for (let attempt = 1; attempt <= 10; attempt++) {
    const sku = `${prefix}-${String(baseNumber + attempt).padStart(3, "0")}`;
    const slug = sku.toLowerCase();

    try {
      const inserted = await sql<{ id: number }[]>`
        insert into public.products (
          sku, slug, category_id, name_ar, description_ar,
          unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
          stock_quantity, status, sort_order
        ) values (
          ${sku}, ${slug}, ${input.categoryId}, ${nameAr}, ${description},
          'قطعة', ${input.minOrderQty}, ${input.qtyIncrement}, ${input.purchasePrice}, ${input.salePrice},
          ${input.stockQuantity}, ${input.status},
          coalesce((select max(sort_order) from public.products where category_id = ${input.categoryId}), 0) + 1
        )
        on conflict do nothing
        returning id
      `;
      if (inserted[0]) {
        revalidatePath("/admin/products");
        revalidatePath("/", "layout");
        revalidateCatalog();
        return { outcome: "success", productId: inserted[0].id, sku, slug, nameAr };
      }
      // لا صفّ أُدخل: تعارض حقيقي (سباق مع طلب آخر متزامن استهلك هذا الرقم
      // بين قراءتنا والإدخال) — نجرّب الرقم التالي.
    } catch {
      return { outcome: "error", error: "تعذّر حفظ المنتج. حاول مرة أخرى." };
    }
  }

  return { outcome: "error", error: "تعذّر توليد SKU فريد بعد عدة محاولات. حاول مرة أخرى." };
}

export type BulkPreviewPlan = {
  error?: string;
  categoryName?: string;
  categorySlug?: string;
  description?: string;
  /** أسماء ستُولَّد تلقائياً للأسطر بلا اسم، بترتيبها داخل الدفعة. */
  autoNames?: string[];
  /** أول SKU ستأخذه الدفعة، لعرضه في شاشة المراجعة. */
  firstSku?: string;
};

/**
 * يحسب — بلا أي كتابة في قاعدة البيانات — ما الذي سيحدث فعلاً عند الحفظ:
 * الأسماء التي ستُولَّد تلقائياً، أول SKU، والوصف النهائي. تستعمله شاشة
 * المراجعة قبل الحفظ حتى يرى صاحب المتجر النتيجة الحقيقية لا تخميناً.
 *
 * قراءة فقط: لا insert ولا update ولا حجز أرقام. لو أضاف مدير آخر منتجاً في
 * نفس اللحظة قد يتقدّم الترقيم فعلياً عند الحفظ — وهذا مقبول لأن التوليد
 * النهائي يقع في createBulkProduct نفسه، وهو المصدر الوحيد للحقيقة.
 */
export async function previewBulkPlan(
  categoryId: number,
  autoNameCount: number,
  sharedDescription: string
): Promise<BulkPreviewPlan> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };
  if (!Number.isInteger(categoryId) || categoryId < 1) return { error: "اختر تصنيفاً صحيحاً." };

  const [category] = await sql<{ name_ar: string; slug: string }[]>`
    select name_ar, slug from public.categories where id = ${categoryId} limit 1
  `;
  if (!category) return { error: "التصنيف غير موجود." };

  const base = await findMaxAutoNameNumber(categoryId, category.name_ar);
  const autoNames = Array.from({ length: Math.max(0, autoNameCount) }, (_, i) =>
    buildAutoProductName(category.name_ar, base + 1 + i)
  );

  const prefixResult = await computeSkuPrefixForCategory(categoryId);
  const firstSku =
    "error" in prefixResult
      ? undefined
      : `${prefixResult.prefix}-${String((await findMaxSkuNumber(prefixResult.prefix)) + 1).padStart(3, "0")}`;

  return {
    categoryName: category.name_ar,
    categorySlug: category.slug,
    description: buildProductDescription(sharedDescription, category.slug),
    autoNames,
    firstSku,
  };
}
