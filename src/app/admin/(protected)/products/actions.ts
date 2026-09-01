"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { productSchema, variantSchema, productQuickEditSchema } from "@/lib/validation/product";
import { flattenZodErrors } from "@/lib/validation/zodErrors";
import { isProductSlugTaken, isSkuTakenByOtherProduct } from "@/lib/queries/adminProducts";
import { computeSkuPrefixForCategory, findMaxSkuNumber } from "@/lib/products/skuGeneration";
import { revalidateCatalog } from "@/lib/queries/catalogCache";

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin)." as const;

export type ProductFormState = {
  error: string | null;
  success?: boolean;
  fieldErrors?: Record<string, string>;
};

function parseProductForm(formData: FormData) {
  const purchasePriceRaw = formData.get("purchasePrice");
  return productSchema.safeParse({
    sku: formData.get("sku"),
    slug: formData.get("slug"),
    categoryId: Number(formData.get("categoryId")),
    nameAr: formData.get("nameAr"),
    nameFr: formData.get("nameFr") || undefined,
    descriptionAr: formData.get("descriptionAr") || undefined,
    technicalSpecs: formData.get("technicalSpecs") || undefined,
    unitLabel: formData.get("unitLabel") || "قطعة",
    minOrderQty: Number(formData.get("minOrderQty") || 1),
    qtyIncrement: Number(formData.get("qtyIncrement") || 1),
    purchasePrice:
      purchasePriceRaw && String(purchasePriceRaw).trim() !== ""
        ? Number(purchasePriceRaw)
        : null,
    salePrice: Number(formData.get("salePrice") || 0),
    stockQuantity: Number(formData.get("stockQuantity") || 0),
    status: formData.get("status"),
  });
}

/**
 * توليد SKU فريد تلقائياً لمنتج جديد حسب تصنيفه — بلا حاجة للمستخدم لتخمين
 * آخر رقم مستعمل. منطق اختيار البادئة والرقم التالي مشترك مع bulkActions.ts
 * (انظر lib/products/skuGeneration.ts). فحص uniqueness هنا (isSkuTakenByOtherProduct)
 * دفاعي فقط لعرض اقتراح فوري فالفورم — الفحص الحاسم والوحيد الملزم يبقى
 * فـcreateProduct نفسها وقت الحفظ الفعلي.
 */
export async function generateProductSku(
  categoryId: number
): Promise<{ sku: string } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  if (!Number.isInteger(categoryId) || categoryId < 1) {
    return { error: "اختر تصنيفاً صحيحاً أولاً." };
  }

  const prefixResult = await computeSkuPrefixForCategory(categoryId);
  if ("error" in prefixResult) return prefixResult;
  const { prefix } = prefixResult;

  const maxNumber = await findMaxSkuNumber(prefix);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const candidate = `${prefix}-${String(maxNumber + attempt).padStart(3, "0")}`;
    if (!(await isSkuTakenByOtherProduct(candidate))) {
      return { sku: candidate };
    }
  }

  return { error: "تعذّر توليد SKU فريد تلقائياً، الرجاء إدخاله يدوياً." };
}

export async function createProduct(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من البيانات المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (await isSkuTakenByOtherProduct(parsed.data.sku)) {
    return { error: "SKU مستعمل من منتج آخر.", fieldErrors: { sku: "مستعمل من قبل" } };
  }
  if (await isProductSlugTaken(parsed.data.slug)) {
    return { error: "الرابط مستعمل من منتج آخر.", fieldErrors: { slug: "مستعمل من قبل" } };
  }

  // منتج جديد يُضاف فآخر الترتيب اليدوي داخل تصنيفه (وليس sort_order=0
  // الافتراضي الذي يعني "الأول") — لا يُزيح أي منتج موجود من مكانه.
  const inserted = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, name_fr, description_ar, technical_specs,
      unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
      stock_quantity, status, sort_order
    ) values (
      ${parsed.data.sku}, ${parsed.data.slug}, ${parsed.data.categoryId}, ${parsed.data.nameAr},
      ${parsed.data.nameFr || null}, ${parsed.data.descriptionAr || null}, ${parsed.data.technicalSpecs || null},
      ${parsed.data.unitLabel}, ${parsed.data.minOrderQty}, ${parsed.data.qtyIncrement},
      ${parsed.data.purchasePrice}, ${parsed.data.salePrice}, ${parsed.data.stockQuantity}, ${parsed.data.status},
      coalesce((select max(sort_order) from public.products where category_id = ${parsed.data.categoryId}), 0) + 1
    )
    returning id
  `;

  // قبل redirect() لا بعده: redirect يرمي استثناءً للتحكم فلا يُنفَّذ شيء
  // بعده إطلاقاً.
  revalidateCatalog();
  revalidatePath("/admin/products");
  redirect(`/admin/products/${inserted[0].id}`);
}

export async function updateProduct(
  productId: number,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من البيانات المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (await isSkuTakenByOtherProduct(parsed.data.sku, productId)) {
    return { error: "SKU مستعمل من منتج آخر.", fieldErrors: { sku: "مستعمل من قبل" } };
  }
  if (await isProductSlugTaken(parsed.data.slug, productId)) {
    return { error: "الرابط مستعمل من منتج آخر.", fieldErrors: { slug: "مستعمل من قبل" } };
  }

  await sql`
    update public.products set
      sku = ${parsed.data.sku},
      slug = ${parsed.data.slug},
      category_id = ${parsed.data.categoryId},
      name_ar = ${parsed.data.nameAr},
      name_fr = ${parsed.data.nameFr || null},
      description_ar = ${parsed.data.descriptionAr || null},
      technical_specs = ${parsed.data.technicalSpecs || null},
      unit_label = ${parsed.data.unitLabel},
      min_order_qty = ${parsed.data.minOrderQty},
      qty_increment = ${parsed.data.qtyIncrement},
      purchase_price = ${parsed.data.purchasePrice},
      sale_price = ${parsed.data.salePrice},
      stock_quantity = ${parsed.data.stockQuantity},
      status = ${parsed.data.status},
      -- نقل المنتج إلى تصنيف آخر يأخذ معه رقم مرتبته القديم، وذلك الرقم
      -- يخصّ التصنيف القديم لا الجديد: منتج كان المرتبة 3 يهبط وسط تصنيف
      -- جديد فوق منتج يحمل نفس الرقم 3 أصلاً، فيصير للتصنيف رقمان
      -- متساويان ويفصل بينهما created_at وحده — أي ترتيب لم يطلبه المدير.
      -- الصواب نفس قاعدة المنتج الجديد: يُضاف فآخر الترتيب ولا يُزيح أحداً،
      -- والمدير ينقله بعدها بخانة "المرتبة" إن شاء. (فـUPDATE، الأعمدة على
      -- يمين التعيين تحمل القيم **قبل** التحديث، فالمقارنة هنا بين التصنيف
      -- القديم والجديد فعلاً.)
      sort_order = case
        when category_id = ${parsed.data.categoryId} then sort_order
        else coalesce(
          (select max(sibling.sort_order) from public.products sibling
            where sibling.category_id = ${parsed.data.categoryId}), 0) + 1
      end
    where id = ${productId}
  `;

  // أي تعديل يمسّ ما يراه الزبون يجب أن يُبطل وسم الكتالوج، وإلا خُدِّم من
  // الذاكرة المؤقّتة حتى 60 ثانية (CATALOG_REVALIDATE_SECONDS) فيبدو للمدير
  // أن الحفظ لم يقع أصلاً. أزرار الترتيب كانت تستدعيه منذ البداية، أما
  // مسارا الحفظ هذان (نموذج المنتج الكامل والتعديل السريع) فلم يكونا —
  // فثمن أو حالة أو تصنيف يُحفظ من اللوحة ولا يتغيّر شيء فالمتجر فوراً.
  revalidateCatalog();
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

function parseVariantForm(formData: FormData) {
  const salePriceRaw = formData.get("salePriceOverride");
  const minQtyRaw = formData.get("minOrderQtyOverride");
  const incrementRaw = formData.get("qtyIncrementOverride");

  return variantSchema.safeParse({
    variantName: formData.get("variantName"),
    salePriceOverride:
      salePriceRaw && String(salePriceRaw).trim() !== "" ? Number(salePriceRaw) : null,
    stockQuantity: Number(formData.get("stockQuantity") || 0),
    minOrderQtyOverride: minQtyRaw && String(minQtyRaw).trim() !== "" ? Number(minQtyRaw) : null,
    qtyIncrementOverride:
      incrementRaw && String(incrementRaw).trim() !== "" ? Number(incrementRaw) : null,
    isActive: formData.get("isActive") === "on",
    sortOrder: Number(formData.get("sortOrder") || 0),
  });
}

export async function createVariant(
  productId: number,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = parseVariantForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من بيانات المتغير.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  try {
    await sql`
      insert into public.product_variants (
        product_id, variant_name, sale_price_override, stock_quantity,
        min_order_qty_override, qty_increment_override, is_active, sort_order
      ) values (
        ${productId}, ${parsed.data.variantName}, ${parsed.data.salePriceOverride},
        ${parsed.data.stockQuantity}, ${parsed.data.minOrderQtyOverride},
        ${parsed.data.qtyIncrementOverride}, ${parsed.data.isActive}, ${parsed.data.sortOrder}
      )
    `;
  } catch {
    return { error: "تعذّر إضافة المتغير (قد يكون الاسم مكرراً لنفس المنتج)." };
  }

  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

export async function updateVariant(
  variantId: number,
  productId: number,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = parseVariantForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من بيانات المتغير.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  try {
    await sql`
      update public.product_variants set
        variant_name = ${parsed.data.variantName},
        sale_price_override = ${parsed.data.salePriceOverride},
        stock_quantity = ${parsed.data.stockQuantity},
        min_order_qty_override = ${parsed.data.minOrderQtyOverride},
        qty_increment_override = ${parsed.data.qtyIncrementOverride},
        is_active = ${parsed.data.isActive},
        sort_order = ${parsed.data.sortOrder}
      where id = ${variantId} and product_id = ${productId}
    `;
  } catch {
    return { error: "تعذّر تعديل المتغير (قد يكون الاسم مكرراً لنفس المنتج)." };
  }

  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

export async function deleteVariant(
  variantId: number,
  productId: number
): Promise<{ error: string | null }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  await sql`delete from public.product_variants where id = ${variantId} and product_id = ${productId}`;
  revalidatePath(`/admin/products/${productId}`);
  return { error: null };
}

function parseQuickEditForm(formData: FormData) {
  const purchasePriceRaw = formData.get("purchasePrice");
  return productQuickEditSchema.safeParse({
    salePrice: Number(formData.get("salePrice")),
    purchasePrice:
      purchasePriceRaw && String(purchasePriceRaw).trim() !== "" ? Number(purchasePriceRaw) : null,
    stockQuantity: Number(formData.get("stockQuantity")),
    minOrderQty: Number(formData.get("minOrderQty")),
    status: formData.get("status"),
  });
}

// التعديل السريع من قائمة /admin/products مباشرة (بدون فتح المنتج): ثمن
// البيع، ثمن الشراء، المخزون، أقل كمية للطلب، ونشر/إخفاء (status). كل صف
// منتج نموذج (form) مستقل بـServer Action خاص به — حفظ منتج لا يرسل أو
// يمس حقول أي منتج آخر فـنفس الصفحة (لا "ضياع تعديلات" متبادل).
//
// تعديل المخزون هنا يمر عبر نفس منطق stock_movements الموجود (وليس تحديثاً
// صامتاً): نقرأ الكمية الحالية بقفل صف (for update) داخل معاملة واحدة،
// نحسب الفرق (delta) الفعلي، ونسجّله بسبب 'manual_adjustment' (نفس قيمة
// reason المستعملة أصلاً فـstock_movements منذ migration
// 20260801000000_orders_admin_phase13) — فقط إن تغيّرت الكمية فعلاً.
export async function quickUpdateProduct(
  productId: number,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const parsed = parseQuickEditForm(formData);
  if (!parsed.success) {
    return { error: "تحقق من القيم المدخلة.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  try {
    await sql.begin(async (trx) => {
      const [current] = await trx<{ stock_quantity: number }[]>`
        select stock_quantity from public.products where id = ${productId} for update
      `;
      if (!current) throw new Error("PRODUCT_NOT_FOUND");

      await trx`
        update public.products set
          sale_price = ${parsed.data.salePrice},
          purchase_price = ${parsed.data.purchasePrice},
          stock_quantity = ${parsed.data.stockQuantity},
          min_order_qty = ${parsed.data.minOrderQty},
          status = ${parsed.data.status}
        where id = ${productId}
      `;

      const stockDelta = parsed.data.stockQuantity - current.stock_quantity;
      if (stockDelta !== 0) {
        await trx`
          insert into public.stock_movements (
            product_id, variant_id, order_id, quantity_delta, reason
          ) values (
            ${productId}, null, null, ${stockDelta}, 'manual_adjustment'
          )
        `;
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return { error: "المنتج غير موجود." };
    }
    console.error("quickUpdateProduct: خطأ غير متوقع", error);
    return { error: "تعذّر حفظ التعديل حالياً بسبب مشكلة تقنية." };
  }

  revalidateCatalog();
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}`);
  return { error: null, success: true };
}

// ترتيب المنتجات يدوياً داخل كل تصنيف — أزرار "↑ طلّع"/"↓ هبّط" وخانة
// "المرتبة" + زر "نقل" فـ/admin/products. كل الدوال الثلاث تُحدِّث sort_order
// فقط؛ لا حقل آخر (الاسم/الثمن/المخزون/الصور/SKU/الحالة) يُلمَس، ولا منتج من
// تصنيف آخر يتأثر (كل الاستعلامات مقصورة دائماً على category_id لنفس
// المنتج). كل نتيجة تُرجع قائمة الصفوف التي تغيّر ترتيبها فعلياً (id +
// sort_order الجديد) بدل الاعتماد على revalidatePath لإعادة جلب الصفحة
// كاملة — الواجهة (ReorderableProductsList) تُحدِّث ترتيبها محلياً وفوراً من
// هذه القيمة مباشرة، بلا reload.
export type ReorderUpdate = { id: number; sort_order: number };
export type ReorderResult = { error: string | null; updated?: ReorderUpdate[] };

async function swapProductSortOrder(
  productId: number,
  direction: "up" | "down"
): Promise<ReorderResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  const [current] = await sql<{ category_id: number }[]>`
    select category_id from public.products where id = ${productId}
  `;
  if (!current) return { error: null };

  // نفس ترتيب العرض الحقيقي بالضبط (catalog.ts وlistProductsAdmin):
  // sort_order تصاعدياً، ثم created_at تنازلياً كـfallback ثابت للتساوي.
  const ordered = await sql<{ id: number; sort_order: number }[]>`
    select id, sort_order from public.products
    where category_id = ${current.category_id}
    order by sort_order asc, created_at desc, id desc
  `;

  const index = ordered.findIndex((p) => p.id === productId);
  if (index === -1) return { error: null };

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) {
    return { error: null };
  }

  const currentEntry = ordered[index];
  const neighbor = ordered[neighborIndex];

  await sql.begin(async (tx) => {
    await tx`update public.products set sort_order = ${neighbor.sort_order} where id = ${currentEntry.id}`;
    await tx`update public.products set sort_order = ${currentEntry.sort_order} where id = ${neighbor.id}`;
  });

  // صفحة التصنيف للزبون force-dynamic أصلاً فلا تحتاج revalidatePath
  // لتُحدَّث فعلياً عند أي زيارة/تحميل جديد — لكن نُنعشها بنفس النمط
  // المعتمد أصلاً فـimageActions.ts لتفادي أي عرض من ذاكرة تنقّل جانب
  // العميل (client-side router cache) إن كانت مفتوحة أصلاً فتبويب آخر.
  // عمداً بلا revalidatePath("/admin/products"): هذا كان يفرض إعادة جلب/عرض
  // كامل قائمة المنتجات فـلوحة الإدارة عند كل ضغطة (بطيء)، بينما الواجهة
  // الآن تُحدَّث فوراً من القيمة المُرجَعة أدناه بلا أي طلب إضافي.
  revalidatePath("/", "layout");
  revalidateCatalog();

  return {
    error: null,
    updated: [
      { id: currentEntry.id, sort_order: neighbor.sort_order },
      { id: neighbor.id, sort_order: currentEntry.sort_order },
    ],
  };
}

export async function moveProductUp(productId: number): Promise<ReorderResult> {
  return swapProductSortOrder(productId, "up");
}

export async function moveProductDown(productId: number): Promise<ReorderResult> {
  return swapProductSortOrder(productId, "down");
}

// نقل منتج مباشرة إلى مرتبة مطلوبة داخل تصنيفه (خانة "المرتبة" + زر "نقل"):
// بدل تكرار "↑"/"↓" عشرات المرات (بطيء، عشرات الطلبات المنفصلة)، عملية
// واحدة فقاعدة البيانات: استعلام UPDATE وحيد (مع CTEs) يقفل صفوف التصنيف
// (FOR UPDATE، لمنع تعارض نقلين متزامنين فنفس التصنيف)، يحسب مرتبة كل منتج
// الحالية عبر row_number() بنفس ترتيب العرض الحقيقي، يُثبِّت المرتبة الهدف
// بين 1 والعدد الكلي للتصنيف (clamp)، ثم يزيح فقط المنتجات الواقعة بين
// المرتبة القديمة والجديدة بمقدار واحد (لإفساح/إغلاق الفراغ) — كل هذا فسطر
// UPDATE واحد، بلا حلقة JS ولا استعلامات منفصلة متعددة. النتيجة: ترتيب
// 1..N متصل بلا تكرار ولا فراغات داخل نفس التصنيف فقط، بلا أي تأثير على أي
// تصنيف آخر.
export async function moveProductToRank(
  productId: number,
  targetRankRaw: number
): Promise<ReorderResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR };

  if (!Number.isInteger(targetRankRaw) || targetRankRaw < 1) {
    return { error: "أدخل رقم مرتبة صحيح (1 أو أكثر)." };
  }

  const [current] = await sql<{ category_id: number }[]>`
    select category_id from public.products where id = ${productId}
  `;
  if (!current) return { error: null };

  const updated = await sql<ReorderUpdate[]>`
    with locked as (
      select id from public.products where category_id = ${current.category_id} for update
    ),
    current_list as (
      select p.id, p.sort_order,
        row_number() over (order by p.sort_order asc, p.created_at desc, p.id desc) as rn,
        count(*) over () as total
      from public.products p
      join locked l on l.id = p.id
    ),
    old_rank as (
      select rn, total from current_list where id = ${productId}
    ),
    target as (
      select least(greatest(${targetRankRaw}::int, 1), total) as rank from old_rank
    )
    update public.products p
    set sort_order = case
      when cl.id = ${productId} then (select rank from target)
      when cl.rn < (select rn from old_rank) and cl.rn >= (select rank from target) then cl.rn + 1
      when cl.rn > (select rn from old_rank) and cl.rn <= (select rank from target) then cl.rn - 1
      else cl.rn
    end
    from current_list cl
    where p.id = cl.id
      and cl.sort_order is distinct from (
        case
          when cl.id = ${productId} then (select rank from target)
          when cl.rn < (select rn from old_rank) and cl.rn >= (select rank from target) then cl.rn + 1
          when cl.rn > (select rn from old_rank) and cl.rn <= (select rank from target) then cl.rn - 1
          else cl.rn
        end
      )
    returning p.id, p.sort_order
  `;

  revalidatePath("/", "layout");
  revalidateCatalog();

  return { error: null, updated };
}
