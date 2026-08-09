import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { sql } from "@/lib/db";

// نفس نمط replacePrimaryImage.test.ts: getAdminUser() تحتاج جلسة Supabase Auth
// حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا فقط.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { uploadProductImage, setPrimaryImage, deleteProductImage } = await import(
  "@/app/admin/(protected)/products/imageActions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const IMAGE_BYTES = Buffer.from(PNG_1X1_BASE64, "base64");

function pngFile(name: string): File {
  return new File([IMAGE_BYTES], name, { type: "image/png" });
}

async function fileExists(absPath: string): Promise<boolean> {
  return fs.access(absPath).then(
    () => true,
    () => false
  );
}

let productId: number;
let primaryImageId: number;
const PRIMARY_SUFFIX = "fixture-primary.png";
let primaryAbsPath: string;

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

  const storagePath = `product-images/${productId}/${PRIMARY_SUFFIX}`;
  primaryAbsPath = path.join(process.cwd(), "public", storagePath);
  await fs.mkdir(path.dirname(primaryAbsPath), { recursive: true });
  await fs.writeFile(primaryAbsPath, IMAGE_BYTES);

  const [image] = await sql<{ id: number }[]>`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${storagePath}, 'الصورة الرئيسية الأصلية', 1, true)
    returning id
  `;
  primaryImageId = image.id;
});

afterEach(async () => {
  // إعادة الحالة الأصلية بين الاختبارات (نفس أسلوب replacePrimaryImage.test.ts).
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

describe("لوحة صور المنتج الكاملة — إضافة/تحويل لرئيسية/حذف صورة إضافية", () => {
  test("Staff: يُرفض uploadProductImage وsetPrimaryImage وdeleteProductImage معاً بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValue(STAFF_USER);

    const fd = new FormData();
    fd.set("file", pngFile("staff-upload.png"));
    const uploadResult = await uploadProductImage(productId, { error: null }, fd);
    expect(uploadResult.error).toBeTruthy();
    expect(uploadResult.success).toBeFalsy();

    const setPrimaryResult = await setPrimaryImage(primaryImageId, productId);
    expect(setPrimaryResult.error).toBeTruthy();

    const deleteResult = await deleteProductImage(primaryImageId, productId);
    expect(deleteResult.error).toBeTruthy();

    const rows = await currentImages();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(primaryImageId);
    expect(rows[0].is_primary).toBe(true);
  });

  test("Admin: إضافة صورة جديدة (is_primary=false) لا تغيّر الصورة الرئيسية الحالية", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);

    const fd = new FormData();
    fd.set("file", pngFile("new-secondary.png"));
    const result = await uploadProductImage(productId, { error: null }, fd);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    const rows = await currentImages();
    expect(rows).toHaveLength(2);

    const primaryRows = rows.filter((r) => r.is_primary);
    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0].id).toBe(primaryImageId);
    expect(primaryRows[0].storage_path).toContain(PRIMARY_SUFFIX);

    const secondary = rows.find((r) => !r.is_primary);
    expect(secondary).toBeTruthy();
    const secondaryAbsPath = path.join(process.cwd(), "public", secondary!.storage_path);
    const written = await fs.readFile(secondaryAbsPath);
    expect(written.equals(IMAGE_BYTES)).toBe(true);

    await assertProductFieldsUnchanged();
  });

  test("Admin: تحويل الصورة الإضافية إلى رئيسية — القديمة تصبح غير رئيسية، وصورة رئيسية واحدة بالضبط", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);

    const before = await currentImages();
    const secondaryImage = before.find((r) => !r.is_primary);
    expect(secondaryImage).toBeTruthy();

    const result = await setPrimaryImage(secondaryImage!.id, productId);
    expect(result.error).toBeNull();

    const after = await currentImages();
    expect(after).toHaveLength(2);
    const primaryRows = after.filter((r) => r.is_primary);
    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0].id).toBe(secondaryImage!.id);

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

    const before = await currentImages();
    const secondaryImage = before.find((r) => !r.is_primary);
    expect(secondaryImage).toBeTruthy();
    const secondaryAbsPath = path.join(process.cwd(), "public", secondaryImage!.storage_path);
    expect(await fileExists(secondaryAbsPath)).toBe(true);

    const result = await deleteProductImage(secondaryImage!.id, productId);
    expect(result.error).toBeNull();

    const after = await currentImages();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(primaryImageId);
    expect(after[0].is_primary).toBe(true);
    expect(after.filter((r) => r.is_primary)).toHaveLength(1);

    expect(await fileExists(secondaryAbsPath)).toBe(false);
    expect(await fileExists(primaryAbsPath)).toBe(true);

    await assertProductFieldsUnchanged();
  });

  // يُحاكي عطل الإنتاج الحقيقي بعد commit 3f4c00c: على Vercel بلا Supabase
  // Storage مُهيَّأ، uploadProductImage كانت تحاول الكتابة على نظام ملفات
  // للقراءة فقط. الآن يجب أن تفشل برسالة واضحة فوراً، بلا أي تغيير فالقاعدة
  // أو الملفات، وبلا استثناء غير مُعالَج قد يُسقط الصفحة لاحقاً.
  test("Admin: على Vercel بلا تخزين سحابي مُهيَّأ، uploadProductImage تفشل برسالة واضحة بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValue(ADMIN_USER);
    const originalVercel = process.env.VERCEL;
    const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalSupabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VERCEL = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const before = await currentImages();

      const fd = new FormData();
      fd.set("file", pngFile("wont-be-saved.png"));
      const result = await uploadProductImage(productId, { error: null }, fd);

      expect(result.success).toBeFalsy();
      expect(result.error).toBeTruthy();
      expect(result.error).not.toBe("تعذّر حفظ الصورة. حاول مرة أخرى.");

      const after = await currentImages();
      expect(after).toEqual(before);
      await assertProductFieldsUnchanged();
    } finally {
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
      if (originalSupabaseUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
      if (originalSupabaseAnon !== undefined)
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseAnon;
      if (originalServiceRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
    }
  });
});
