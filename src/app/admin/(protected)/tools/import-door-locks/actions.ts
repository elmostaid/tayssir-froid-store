"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { DOOR_LOCK_IMPORT_PRODUCTS } from "@/lib/doorLockImportBatch";

const OWNER_ONLY_ERROR = "هذا الإجراء مقصور على صاحب الحساب (Admin)." as const;

export type DoorLockImportRowResult = {
  sku: string;
  productOutcome: "inserted" | "already_existed";
  imagesInserted: number;
  imagesAlreadyExisted: number;
  error: string | null;
};

export type DoorLockImportSummary = {
  productsInserted: number;
  productsAlreadyExisted: number;
  imagesInserted: number;
  imagesAlreadyExisted: number;
  failures: number;
};

export type DoorLockImportResult = {
  error: string | null;
  rows: DoorLockImportRowResult[];
  summary: DoorLockImportSummary | null;
};

/**
 * أداة إدارية مؤقتة: تُدرج نفس دفعة الـ28 قفل باب + 84 صورة الموجودة أصلاً
 * فـ supabase/migrations/20260813000000_import_door_lock_products.sql
 * (نفس البيانات حرفياً، عبر src/lib/doorLockImportBatch.ts — مُستخرجة
 * ومُتحقَّق منها آلياً من ذلك الملف، انظر تعليقه) — لكن من داخل لوحة
 * الإدارة بضغطة واحدة، بدل نسخ/لصق SQL يدوياً فSupabase SQL Editor.
 *
 * تستعمل نفس اتصال قاعدة البيانات العادي (sql من @/lib/db، نفس القناة التي
 * تكتب بها كل صفحات/أفعال الإدارة الأخرى) — لا حاجة لأي كلمة سر أو
 * service-role key منفصلة، ولا صلاحية جديدة غير الموجودة أصلاً
 * (Owner/Admin فقط، نفس فحص كل الأدوات الحساسة الأخرى).
 *
 * Idempotent بصرامة: INSERT فعلي بـon conflict do nothing (وليس فحصاً
 * مسبقاً فقط) لكل منتج — أي SKU موجود مسبقاً (TF-AWM-001 إلى 004 حالياً)
 * يُتخطّى بلا أي لمس لبياناته، ونفس الشيء لكل صورة عبر NOT EXISTS. تشغيل
 * الأداة عدة مرات لا يُنشئ أي تكرار أبداً — يمكن الضغط على الزر أكثر من مرة
 * بأمان.
 */
export async function importDoorLocksBatch(): Promise<DoorLockImportResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء.", rows: [], summary: null };
  if (!isOwnerAdmin(admin)) return { error: OWNER_ONLY_ERROR, rows: [], summary: null };

  const rows: DoorLockImportRowResult[] = [];

  for (const product of DOOR_LOCK_IMPORT_PRODUCTS) {
    try {
      const inserted = await sql<{ id: number }[]>`
        insert into public.products (
          sku, slug, category_id, name_ar, description_ar,
          unit_label, min_order_qty, qty_increment, purchase_price, sale_price,
          stock_quantity, status, sort_order
        ) values (
          ${product.sku}, ${product.slug}, ${product.categoryId}, ${product.nameAr}, ${product.descriptionAr},
          ${product.unitLabel}, ${product.minOrderQty}, ${product.qtyIncrement}, ${product.purchasePrice}, ${product.salePrice},
          ${product.stockQuantity}, ${product.status}, ${product.sortOrder}
        )
        on conflict (sku) do nothing
        returning id
      `;

      let productId: number;
      let productOutcome: "inserted" | "already_existed";
      if (inserted[0]) {
        productId = inserted[0].id;
        productOutcome = "inserted";
      } else {
        const existing = await sql<{ id: number }[]>`
          select id from public.products where sku = ${product.sku} limit 1
        `;
        if (!existing[0]) {
          rows.push({
            sku: product.sku,
            productOutcome: "already_existed",
            imagesInserted: 0,
            imagesAlreadyExisted: 0,
            error: "تعارض غير متوقَّع: لم يُدرَج ولم يوجد صف موجود بنفس SKU.",
          });
          continue;
        }
        productId = existing[0].id;
        productOutcome = "already_existed";
      }

      let imagesInserted = 0;
      let imagesAlreadyExisted = 0;
      for (const image of product.images) {
        const imageInserted = await sql<{ id: number }[]>`
          insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
          select ${productId}, ${image.path}, ${image.alt}, ${image.sortOrder}, ${image.isPrimary}
          where not exists (
            select 1 from public.product_images
            where product_id = ${productId} and storage_path = ${image.path}
          )
          returning id
        `;
        if (imageInserted[0]) imagesInserted += 1;
        else imagesAlreadyExisted += 1;
      }

      rows.push({ sku: product.sku, productOutcome, imagesInserted, imagesAlreadyExisted, error: null });
    } catch (error) {
      rows.push({
        sku: product.sku,
        productOutcome: "already_existed",
        imagesInserted: 0,
        imagesAlreadyExisted: 0,
        error: error instanceof Error ? error.message : "خطأ غير متوقَّع.",
      });
    }
  }

  const summary: DoorLockImportSummary = {
    productsInserted: rows.filter((r) => r.productOutcome === "inserted" && !r.error).length,
    productsAlreadyExisted: rows.filter((r) => r.productOutcome === "already_existed" && !r.error).length,
    imagesInserted: rows.reduce((n, r) => n + r.imagesInserted, 0),
    imagesAlreadyExisted: rows.reduce((n, r) => n + r.imagesAlreadyExisted, 0),
    failures: rows.filter((r) => r.error !== null).length,
  };

  revalidatePath("/admin/products");
  revalidatePath("/", "layout");

  return { error: null, rows, summary };
}
