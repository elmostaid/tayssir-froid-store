import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { sql } from "@/lib/db";

// نفس نمط الاختبارات الأخرى فهذا الملف: getAdminUser() تحتاج جلسة Supabase Auth
// حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا فقط.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setPrimaryImage, deleteProductImage } = await import(
  "@/app/admin/(protected)/products/imageActions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

const IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function fileExists(absPath: string): Promise<boolean> {
  return fs.access(absPath).then(
    () => true,
    () => false
  );
}

let productId: number;
let primaryImageId: number;
let secondaryImageId: number;
const PRIMARY_SUFFIX = "fixture-primary.png";
const SECONDARY_SUFFIX = "fixture-secondary.png";
let primaryAbsPath: string;
let secondaryAbsPath: string;

async function currentImages() {
  return sql<{ id: number; storage_path: string; is_primary: boolean }[]>`
    select id, storage_path, is_primary from public.product_images
    where product_id = ${productId} order by sort_order asc
  `;
}

async function assertProductFieldsUnchanged() {
  const [product] = await sql<
    {
      name_ar: string;
      sale_price: string;
      purchase_price: string;
      stock_quantity: number;
      min_order_qty: number;
      status: string;
    }[]
  >`
    select name_ar, sale_price, purchase_price, stock_quantity, min_order_qty, status
    from public.products where id = ${productId}
  `;
  expect(product.name_ar).toBe("منتج اختبار لوحة الصور");
  expect(Number(product.sale_price)).toBe(120);
  expect(Number(product.purchase_price)).toBe(70);
  expect(product.stock_quantity).toBe(25);
  expect(product.min_order_qty).toBe(2);
  expect(product.status).toBe("published");

  const productCount = await sql<{ count: number }[]>`
    select count(*)::int as count from public.products where sku = 'TEST-FIXTURE-IMAGESPANEL'
  `;
  expect(productCount[0].count).toBe(1);
}

// اثنتان من صور المنتج القديمة (محلية داخل public/، بنفس الاتفاقية القديمة
// قبل نظام Supabase Storage المباشر) — تُنشآن مباشرة كـfixture بدل المرور
// عبر مسار الرفع الفعلي (الرفع المباشر إلى Supabase مُختبَر بشكل كامل
// ومنفصل فـchangePrimaryImageDirectUpload.test.ts)، لاختبار setPrimaryImage
// وdeleteProductImage فقط هنا.
beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-IMAGESPANEL', 'test-fixture-imagespanel', ${category.id},
      'منتج اختبار لوحة الصور', 'قطعة', 2, 1, 70.00, 120.00, 25, 'published'
    )
    on conflict (sku) do update set
      purchase_price = 70.00, sale_price = 120.00, stock_quantity = 25,
      min_order_qty = 2, status = 'published'
    returning id
  `;
  productId = product.id;

  await sql`delete from public.product_images where product_id = ${productId}`;

  const primaryStoragePath = `product-images/${productId}/${PRIMARY_SUFFIX}`;
  primaryAbsPath = path.join(process.cwd(), "public", primaryStoragePath);
  await fs.mkdir(path.dirname(primaryAbsPath), { recursive: true });
  await fs.writeFile(primaryAbsPath, IMAGE_BYTES);

  const secondaryStoragePath = `product-images/${productId}/${SECONDARY_SUFFIX}`;
  secondaryAbsPath = path.join(process.cwd(), "public", secondaryStoragePath);
  await fs.writeFile(secondaryAbsPath, IMAGE_BYTES);

  const [primary] = await sql<{ id: number }[]>`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${primaryStoragePath}, 'الصورة الرئيسية الأصلية', 1, true)
    returning id
  `;
  primaryImageId = primary.id;

  const [secondary] = await sql<{ id: number }[]>`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${secondaryStoragePath}, 'صورة إضافية أصلية', 2, false)
    returning id
  `;
  secondaryImageId = secondary.id;
});

afterEach(async () => {
  // إعادة الحالة الأصلية بين الاختبارات.
  await sql`
    update public.products set
      name_ar = 'منتج اختبار لوحة الصور', purchase_price = 70.00, sale_price = 120.00,
      stock_quantity = 25, min_order_qty = 2, status = 'published'
    where id = ${productId}
  `;
});

afterAll(async () => {
  const rows = await sql<{ storage_path: string }[]>`
    select storage_path from public.product_images where product_id = ${productId}
  `;
  for (const row of rows) {
    await fs.unlink(path.join(process.cwd(), "public", row.storage_path)).catch(() => {});
  }
  await sql`delete from public.product_images where product_id = ${productId}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-IMAGESPANEL'`;
});

describe("لوحة صور المنتج — اجعلها رئيسية / حذف (بلا علاقة بمسار الرفع نفسه)", () => {
  test("Staff: يُرفض setPrimaryImage وdeleteProductImage معاً بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);

    const setPrimaryResult = await setPrimaryImage(secondaryImageId, productId);
    expect(setPrimaryResult.error).toBeTruthy();

    const deleteResult = await deleteProductImage(secondaryImageId, productId);
    expect(deleteResult.error).toBeTruthy();

    const rows = await currentImages();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.is_primary)).toHaveLength(1);
    expect(rows.find((r) => r.id === primaryImageId)?.is_primary).toBe(true);
  });

  test("Admin: تحويل الصورة الإضافية إلى رئيسية — القديمة تصبح غير رئيسية، وصورة رئيسية واحدة بالضبط", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);

    const result = await setPrimaryImage(secondaryImageId, productId);
    expect(result.error).toBeNull();

    const after = await currentImages();
    expect(after).toHaveLength(2);
    const primaryRows = after.filter((r) => r.is_primary);
    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0].id).toBe(secondaryImageId);

    const oldPrimary = after.find((r) => r.id === primaryImageId);
    expect(oldPrimary?.is_primary).toBe(false);

    await assertProductFieldsUnchanged();

    // نعيد الحالة إلى الصورة الأصلية رئيسية من جديد لبقية الاختبارات.
    await setPrimaryImage(primaryImageId, productId);
    const restored = await currentImages();
    expect(restored.filter((r) => r.is_primary)).toHaveLength(1);
    expect(restored.find((r) => r.id === primaryImageId)?.is_primary).toBe(true);
  });

  test("Admin: حذف صورة إضافية يحذفها من القاعدة والملف من القرص، ولا يمس الصورة الرئيسية", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);

    expect(await fileExists(secondaryAbsPath)).toBe(true);

    const result = await deleteProductImage(secondaryImageId, productId);
    expect(result.error).toBeNull();

    const after = await currentImages();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(primaryImageId);
    expect(after[0].is_primary).toBe(true);

    expect(await fileExists(secondaryAbsPath)).toBe(false);
    expect(await fileExists(primaryAbsPath)).toBe(true);

    await assertProductFieldsUnchanged();
  });
});
