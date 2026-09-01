"use server";

import { revalidatePath } from "next/cache";
import type { Sql, TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { revalidateCatalog } from "@/lib/queries/catalogCache";
import { HOME_FEATURED_LIMIT } from "@/lib/queries/catalog";
import {
  searchFeaturableProducts,
  type FeaturableProduct,
} from "@/lib/queries/adminFeatured";

// إدارة قسم «الأكثر طلباً» فالصفحة الرئيسية: اختيار المنتجات وترتيبها
// بالأرقام. كل الإجراءات هنا تكتب فـhome_featured_products وحده — **لا
// تلمس products.sort_order إطلاقاً**، فترتيب المنتج داخل تصنيفه (صفحة
// التصنيف و«جميع المنتجات») يبقى كما ضبطه المدير من /admin/products.

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin).";

export type FeaturedActionResult = { error: string | null };

async function requireOwner(): Promise<string | null> {
  const admin = await getAdminUser();
  if (!admin) return "غير مصرَّح بهذا الإجراء.";
  if (!isOwnerAdmin(admin)) return OWNER_ONLY_ERROR;
  return null;
}

// بعد كل تغيير: إبطال وسم الكتالوج (فيرى الزبون القائمة الجديدة فوراً بلا
// انتظار مهلة الستين ثانية) ثم إنعاش صفحة اللوحة نفسها.
function afterChange(): void {
  revalidateCatalog();
  revalidatePath("/admin/featured");
  revalidatePath("/", "layout");
}

type Trx = TransactionSql<Record<string, unknown>> | Sql<Record<string, unknown>>;

/**
 * ترقيم القائمة 1..N من جديد فعبارة واحدة، بترتيبها الحالي.
 *
 * تُستدعى بعد كل إضافة/حذف، فلا تبقى فجوات (1، 2، 5) ولا تكرار — الرقم
 * الذي يراه المدير هو رتبة المنتج فعلاً، لا قيمة داخلية.
 */
async function renumber(tx: Trx): Promise<void> {
  await tx`
    update public.home_featured_products f
    set position = ranked.rn
    from (
      select product_id, row_number() over (order by position asc, product_id asc) as rn
      from public.home_featured_products
    ) ranked
    where f.product_id = ranked.product_id
      and f.position is distinct from ranked.rn
  `;
}

/** إضافة منتج إلى آخر القائمة. لا يُزيح أي منتج مختار من مرتبته. */
export async function addFeaturedProduct(
  productId: number
): Promise<FeaturedActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };

  try {
    const inserted = await sql.begin(async (tx) => {
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from public.home_featured_products
      `;
      if (count >= HOME_FEATURED_LIMIT) return false;

      // القراءة من public.products هي ما يضمن ألا نُدخل معرّفاً لمنتج غير
      // موجود ونصطدم بالمفتاح الأجنبي كخطأ تقني بدل رسالة مفهومة.
      const rows = await tx<{ product_id: number }[]>`
        insert into public.home_featured_products (product_id, position)
        select p.id, coalesce((select max(position) from public.home_featured_products), 0) + 1
        from public.products p
        where p.id = ${productId}
        on conflict (product_id) do nothing
        returning product_id
      `;
      if (rows.length > 0) await renumber(tx);
      return rows.length > 0;
    });

    if (!inserted) {
      return {
        error: `تعذّرت الإضافة: القائمة ممتلئة (${HOME_FEATURED_LIMIT} منتجاً كحد أقصى)، أو المنتج مضاف أصلاً، أو لم يعد موجوداً.`,
      };
    }
  } catch (error) {
    console.error("addFeaturedProduct: خطأ غير متوقع", error);
    return { error: "تعذّرت إضافة المنتج حالياً بسبب مشكلة تقنية." };
  }

  afterChange();
  return { error: null };
}

/** إخراج منتج من القسم. المنتج نفسه لا يُمسّ بأي شكل. */
export async function removeFeaturedProduct(
  productId: number
): Promise<FeaturedActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };

  try {
    await sql.begin(async (tx) => {
      await tx`delete from public.home_featured_products where product_id = ${productId}`;
      await renumber(tx);
    });
  } catch (error) {
    console.error("removeFeaturedProduct: خطأ غير متوقع", error);
    return { error: "تعذّر حذف المنتج من القسم حالياً بسبب مشكلة تقنية." };
  }

  afterChange();
  return { error: null };
}

/**
 * نقل منتج إلى مرتبة مطلوبة (خانة الرقم + «نقل»).
 *
 * نفس منطق moveProductToRank فـproducts/actions.ts: المرتبة تُثبَّت بين 1
 * والعدد الكلي، ولا يتحرّك إلا ما بين المرتبة القديمة والجديدة — بقية
 * القائمة تبقى بترتيبها. الفارق أن هذا يكتب فـhome_featured_products لا
 * فـproducts.
 */
export async function moveFeaturedToRank(
  productId: number,
  targetRank: number
): Promise<FeaturedActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };

  if (!Number.isInteger(targetRank) || targetRank < 1) {
    return { error: "أدخل رقم مرتبة صحيح (1 أو أكثر)." };
  }

  try {
    await sql.begin(async (tx) => {
      await tx`
        with locked as (
          select product_id from public.home_featured_products order by product_id for update
        ),
        current_list as (
          select f.product_id,
            row_number() over (order by f.position asc, f.product_id asc) as rn,
            count(*) over () as total
          from public.home_featured_products f
          join locked l on l.product_id = f.product_id
        ),
        old_rank as (
          select rn, total from current_list where product_id = ${productId}
        ),
        target as (
          select least(greatest(${targetRank}::int, 1), total) as rank from old_rank
        )
        update public.home_featured_products f
        set position = case
          when cl.product_id = ${productId} then (select rank from target)
          when cl.rn < (select rn from old_rank) and cl.rn >= (select rank from target) then cl.rn + 1
          when cl.rn > (select rn from old_rank) and cl.rn <= (select rank from target) then cl.rn - 1
          else cl.rn
        end
        from current_list cl
        where f.product_id = cl.product_id
      `;
    });
  } catch (error) {
    console.error("moveFeaturedToRank: خطأ غير متوقع", error);
    return { error: "تعذّر تغيير الترتيب حالياً بسبب مشكلة تقنية." };
  }

  afterChange();
  return { error: null };
}

/** بحث المنتجات لإضافتها — يُستدعى من الواجهة عند الكتابة فخانة البحث. */
export async function searchProductsToFeature(
  query: string
): Promise<{ error: string | null; products: FeaturableProduct[] }> {
  const denied = await requireOwner();
  if (denied) return { error: denied, products: [] };

  try {
    return { error: null, products: await searchFeaturableProducts(query) };
  } catch (error) {
    console.error("searchProductsToFeature: خطأ غير متوقع", error);
    return { error: "تعذّر البحث حالياً بسبب مشكلة تقنية.", products: [] };
  }
}
