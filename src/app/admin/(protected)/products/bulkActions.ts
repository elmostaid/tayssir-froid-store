"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { computeSkuPrefixForCategory, findMaxSkuNumber } from "@/lib/products/skuGeneration";
import { PRODUCT_STATUSES } from "@/lib/validation/product";
import { revalidateCatalog } from "@/lib/queries/catalogCache";

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin)." as const;

// التنبيه المطلوب يُلحَق تلقائياً بوصف كل منتج يُضاف عبر "إضافة مجموعة
// منتجات" — بالإضافة إلى وصف مشترك اختياري يكتبه المدير مرة واحدة للدفعة
// كلها (مثلاً وصف تقني عام لهذه المجموعة).
const COMPATIBILITY_NOTICE =
  "المرجو مقارنة شكل القطعة، الفيشة، عدد الأطراف ومواضع التثبيت مع القطعة الأصلية قبل الطلب.";

export type BulkProductInput = {
  categoryId: number;
  nameAr: string;
  purchasePrice: number | null;
  salePrice: number;
  minOrderQty: number;
  qtyIncrement: number;
  stockQuantity: number;
  status: (typeof PRODUCT_STATUSES)[number];
  descriptionAr: string;
};

export type BulkProductResult =
  | { outcome: "success"; productId: number; sku: string; slug: string }
  | { outcome: "duplicate"; reason: string }
  | { outcome: "error"; error: string };

function validateBulkInput(input: BulkProductInput): string | null {
  if (!Number.isInteger(input.categoryId) || input.categoryId < 1) {
    return "اختر تصنيفاً صحيحاً.";
  }
  const nameAr = input.nameAr.trim();
  if (!nameAr) return "اسم المنتج أو رقم الموديل إجباري.";
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

  const nameAr = input.nameAr.trim();

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

  const sharedNotice = input.descriptionAr.trim();
  const description = sharedNotice
    ? `${sharedNotice}\n\n${COMPATIBILITY_NOTICE}`
    : COMPATIBILITY_NOTICE;

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
        return { outcome: "success", productId: inserted[0].id, sku, slug };
      }
      // لا صفّ أُدخل: تعارض حقيقي (سباق مع طلب آخر متزامن استهلك هذا الرقم
      // بين قراءتنا والإدخال) — نجرّب الرقم التالي.
    } catch {
      return { outcome: "error", error: "تعذّر حفظ المنتج. حاول مرة أخرى." };
    }
  }

  return { outcome: "error", error: "تعذّر توليد SKU فريد بعد عدة محاولات. حاول مرة أخرى." };
}
