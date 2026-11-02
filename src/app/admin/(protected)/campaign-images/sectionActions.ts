"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { TransactionSql } from "postgres";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { ALLOWED_IMAGE_TYPES, EXT_BY_TYPE } from "@/lib/storage/imageValidation";
import { isRemoteStorageConfigured } from "@/lib/storage/remoteStorage";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { revalidateCatalog } from "@/lib/queries/catalogCache";
import {
  SECTION_IMAGE_PATH_RE,
  SECTION_SETTINGS_KEY,
  SECTION_SIZE,
  findSectionSlot,
  isSectionImageUrl,
  parseSectionConfig,
  partFamily,
  sectionImageFolder,
  sectionPagePath,
  type SectionEntry,
  type SectionSlot,
} from "@/lib/campaignSections";

/**
 * اختيار منتجات أقسام /washing-machines و/water-heaters من لوحة «صور الحملات».
 *
 * كل التعديلات على صفّ إعدادات واحد (`campaign_section_products`) داخل
 * معاملة بقفل الصفّ، فلا يُضيع تعديلان متزامنان أحدهما الآخر. لا يُكتب
 * شيء في المنتجات ولا في صورها.
 */

const BUCKET = "product-images";

export type SectionActionResult = { error: string | null };

export type SectionCandidate = {
  id: number;
  name: string;
  sku: string;
  price: string;
  family: string;
  units: number;
  status: string;
  stock: number;
};

async function requireOwner(): Promise<string | null> {
  const admin = await getAdminUser();
  if (!admin) return "غير مصرَّح بهذا الإجراء.";
  if (!isOwnerAdmin(admin)) return "هذا الإجراء مقصور على صاحب الحساب (Admin).";
  return null;
}

function afterChange(slot: SectionSlot) {
  revalidateCatalog();
  revalidatePath(sectionPagePath(slot));
  revalidatePath("/admin/campaign-images");
}

type Tx = TransactionSql;

/** يقرأ القسم بقفل، يطبّق التعديل، ويكتب — أو يُرجع رسالة رفض بلا كتابة. */
async function mutateSection(
  slot: SectionSlot,
  change: (entries: SectionEntry[], tx: Tx) => Promise<SectionEntry[] | string>
): Promise<SectionActionResult> {
  try {
    const outcome = await sql.begin(async (tx) => {
      await tx`
        insert into public.settings (key, value) values (${SECTION_SETTINGS_KEY}, '{}'::jsonb)
        on conflict (key) do nothing
      `;
      const [row] = await tx<{ value: unknown }[]>`
        select value from public.settings where key = ${SECTION_SETTINGS_KEY} for update
      `;
      const config = parseSectionConfig(row?.value);
      const next = await change(config[slot.key] ?? [], tx);
      if (typeof next === "string") return next;
      config[slot.key] = next;
      await tx`update public.settings set value = ${sql.json(config)} where key = ${SECTION_SETTINGS_KEY}`;
      return null;
    });
    if (outcome) return { error: outcome };
  } catch (error) {
    console.error("campaign sections: تعذّر الحفظ", error);
    return { error: "تعذّر الحفظ حالياً بسبب مشكلة تقنية." };
  }
  afterChange(slot);
  return { error: null };
}

/** منتج ظاهر في تصنيف القسم نفسه، مع صنفه. */
async function productInSlot(tx: Tx | typeof sql, slot: SectionSlot, productId: number) {
  const [row] = await tx<{ id: number; name_ar: string }[]>`
    select p.id, p.name_ar from public.products p
    join public.categories c on c.id = p.category_id
    where p.id = ${productId} and c.slug = ${slot.categorySlug}
      and p.status in ('published', 'out_of_stock')
  `;
  return row ?? null;
}

export async function addSectionProduct(slotKey: string, productId: number): Promise<SectionActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };

  return mutateSection(slot, async (entries, tx) => {
    if (entries.length >= SECTION_SIZE) return `القسم ممتلئ (${SECTION_SIZE} منتجات). أزل منتجاً أولاً.`;
    if (entries.some((entry) => entry.productId === productId)) return "هذا المنتج موجود في القسم.";
    const product = await productInSlot(tx, slot, productId);
    if (!product) return "هذا المنتج ليس من هذا النوع أو غير منشور.";
    const family = partFamily(product.name_ar);
    if (entries.length) {
      const others = await tx<{ id: number; name_ar: string }[]>`
        select id, name_ar from public.products where id in ${tx(entries.map((entry) => entry.productId))}
      `;
      const clash = others.find((other) => partFamily(other.name_ar) === family);
      if (clash) return `يوجد «${family}» في هذا القسم (${clash.name_ar}). القاعدة: قطعة واحدة من كل صنف.`;
    }
    return [...entries, { productId }];
  });
}

export async function removeSectionProduct(slotKey: string, productId: number): Promise<SectionActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  return mutateSection(slot, async (entries) => entries.filter((entry) => entry.productId !== productId));
}

export async function moveSectionProduct(
  slotKey: string,
  productId: number,
  rank: number
): Promise<SectionActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  if (!Number.isInteger(rank) || rank < 1) return { error: "أدخل رقم مرتبة صحيح (1 أو أكثر)." };
  return mutateSection(slot, async (entries) => {
    const index = entries.findIndex((entry) => entry.productId === productId);
    if (index === -1) return "هذا المنتج ليس في القسم.";
    const next = [...entries];
    const [moved] = next.splice(index, 1);
    next.splice(Math.min(rank, next.length + 1) - 1, 0, moved);
    return next;
  });
}

/** بحث داخل تصنيف القسم وحده، مع الصنف وعدد الوحدات المطلوبة. */
export async function searchSectionProducts(slotKey: string, query: string): Promise<SectionCandidate[] | { error: string }> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  const pattern = `%${query.trim().slice(0, 60)}%`;
  const rows = await sql<{ id: number; name_ar: string; sku: string; sale_price: string; status: string; stock_quantity: number; units: number }[]>`
    select p.id, p.name_ar, p.sku, p.sale_price::text, p.status, p.stock_quantity,
      coalesce((select sum(oi.quantity) from public.order_items oi join public.orders o on o.id = oi.order_id
        where oi.product_id = p.id and o.status not in ('cancelled', 'returned')), 0)::int as units
    from public.products p join public.categories c on c.id = p.category_id
    where c.slug = ${slot.categorySlug} and p.status in ('published', 'out_of_stock')
      and (p.name_ar ilike ${pattern} or p.sku ilike ${pattern})
    order by units desc, p.sort_order asc
    limit 30
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name_ar,
    sku: row.sku,
    price: row.sale_price,
    family: partFamily(row.name_ar),
    units: row.units,
    status: row.status,
    stock: row.stock_quantity,
  }));
}

// ─── صورة العرض لمنتج داخل القسم ─────────────────────────────────────────

export async function createSectionImageUploadTarget(
  slotKey: string,
  productId: number,
  contentType: string
): Promise<{ error: string | null; token?: string; objectPath?: string }> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };
  const ext = ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number]) ? EXT_BY_TYPE[contentType] : null;
  if (!ext) return { error: "صيغة الصورة غير مدعومة. استعمل JPG أو PNG أو WEBP." };
  if (!(await productInSlot(sql, slot, productId))) return { error: "هذا المنتج ليس من هذا النوع." };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };
  const objectPath = `${sectionImageFolder(slot, productId)}/${randomUUID()}.${ext}`;
  const { data, error } = await client.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) return { error: "تعذّر تحضير رفع الصورة. حاول مرة أخرى." };
  return { error: null, token: data.token, objectPath: data.path };
}

export async function commitSectionImage(
  slotKey: string,
  productId: number,
  objectPath: string
): Promise<SectionActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  const folder = sectionImageFolder(slot, productId);
  if (!SECTION_IMAGE_PATH_RE.test(objectPath) || !objectPath.startsWith(`${folder}/`)) {
    return { error: "مسار الصورة غير صالح." };
  }
  if (!isRemoteStorageConfigured()) return { error: "رفع الصور غير مُفعَّل في هذه البيئة." };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { error: "تعذّر الاتصال بمخزن الصور." };
  const filename = objectPath.slice(folder.length + 1);
  const { data: listing, error: listError } = await client.storage.from(BUCKET).list(folder, { search: filename });
  if (listError || !listing?.some((entry) => entry.name === filename)) {
    return { error: "لم نجد الصورة المرفوعة. أعد المحاولة." };
  }
  const url = client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
  if (!isSectionImageUrl(url, slot, productId)) return { error: "رابط الصورة غير صالح." };

  // منتج تلقائي يُثبَّت في القسم مع صورته: صورة العرض تخصّ اختياراً يدوياً.
  return mutateSection(slot, async (entries, tx) => {
    const exists = entries.some((entry) => entry.productId === productId);
    if (!exists) {
      if (entries.length >= SECTION_SIZE) return `القسم ممتلئ (${SECTION_SIZE} منتجات). أزل منتجاً أولاً.`;
      if (!(await productInSlot(tx, slot, productId))) return "هذا المنتج ليس من هذا النوع.";
      return [...entries, { productId, image: url }];
    }
    return entries.map((entry) => (entry.productId === productId ? { ...entry, image: url } : entry));
  });
}

export async function resetSectionImage(slotKey: string, productId: number): Promise<SectionActionResult> {
  const denied = await requireOwner();
  if (denied) return { error: denied };
  const slot = findSectionSlot(slotKey);
  if (!slot) return { error: "قسم غير معروف." };
  return mutateSection(slot, async (entries) =>
    entries.map((entry) => (entry.productId === productId ? { productId: entry.productId } : entry))
  );
}
