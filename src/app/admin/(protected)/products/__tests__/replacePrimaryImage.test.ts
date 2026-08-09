import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { sql } from "@/lib/db";

// نفس نمط quickUpdateProduct.test.ts: getAdminUser() تحتاج جلسة Supabase
// Auth حقيقية غير متاحة فبيئة الاختبار — نُحاكيها هنا.
const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { replacePrimaryImage } = await import(
  "@/app/admin/(protected)/products/imageActions"
);

const ADMIN_USER = { id: "test-admin", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff", email: "staff@local", role: "staff" as const };

// PNG 1×1 بكسل صالح فعلياً (وليس مجرد بايتات عشوائية) — يمرّ من validateImageFile
// (image/png) ويثبت أن الملف الجديد يُكتب على القرص بمحتوى حقيقي قابل للقراءة.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const OLD_IMAGE_BYTES = Buffer.from(PNG_1X1_BASE64, "base64");
const NEW_IMAGE_BYTES = Buffer.from(PNG_1X1_BASE64, "base64");

function pngFile(name: string): File {
  return new File([NEW_IMAGE_BYTES], name, { type: "image/png" });
}

let productId: number;
let originalImageId: number;
const OLD_STORAGE_PATH_SUFFIX = "old-test-primary.png";
let oldAbsPath: string;

beforeAll(async () => {
  const [category] = await sql<{ id: number }[]>`select id from public.categories order by id limit 1`;
  const [product] = await sql<{ id: number }[]>`
    insert into public.products (
      sku, slug, category_id, name_ar, unit_label,
      min_order_qty, qty_increment, purchase_price, sale_price, stock_quantity, status
    ) values (
      'TEST-FIXTURE-CHANGEIMG', 'test-fixture-changeimg', ${category.id},
      'منتج اختبار تغيير الصورة', 'قطعة', 3, 1, 55.00, 99.00, 40, 'published'
    )
    on conflict (sku) do update set
      purchase_price = 55.00, sale_price = 99.00, stock_quantity = 40,
      min_order_qty = 3, status = 'published'
    returning id
  `;
  productId = product.id;

  await sql`delete from public.product_images where product_id = ${productId}`;

  const storagePath = `product-images/${productId}/${OLD_STORAGE_PATH_SUFFIX}`;
  oldAbsPath = path.join(process.cwd(), "public", storagePath);
  await fs.mkdir(path.dirname(oldAbsPath), { recursive: true });
  await fs.writeFile(oldAbsPath, OLD_IMAGE_BYTES);

  const [image] = await sql<{ id: number }[]>`
    insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
    values (${productId}, ${storagePath}, 'صورة اختبار قديمة', 1, true)
    returning id
  `;
  originalImageId = image.id;
});

afterEach(async () => {
  // إعادة الحالة الأصلية بين الاختبارات (نفس أسلوب quickUpdateProduct.test.ts).
  await sql`
    update public.products set
      name_ar = 'منتج اختبار تغيير الصورة', purchase_price = 55.00, sale_price = 99.00,
      stock_quantity = 40, min_order_qty = 3, status = 'published'
    where id = ${productId}
  `;
});

afterAll(async () => {
  const rows = await sql<{ storage_path: string }[]>`
    select storage_path from public.product_images where product_id = ${productId}
  `;
  for (const row of rows) {
    const abs = path.join(process.cwd(), "public", row.storage_path);
    await fs.unlink(abs).catch(() => {});
  }
  await sql`delete from public.product_images where product_id = ${productId}`;
  await sql`delete from public.products where sku = 'TEST-FIXTURE-CHANGEIMG'`;
});

describe("replacePrimaryImage — تغيير الصورة الرئيسية بخطوة واحدة", () => {
  test("Staff: يُرفَض الإجراء ولا يتغيّر أي شيء (لا الصورة ولا الملف)", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);

    const fd = new FormData();
    fd.set("file", pngFile("staff-attempt.png"));
    const result = await replacePrimaryImage(productId, { error: null }, fd);

    expect(result.error).toBeTruthy();
    expect(result.success).toBeFalsy();

    const rows = await sql<{ id: number; storage_path: string; is_primary: boolean }[]>`
      select id, storage_path, is_primary from public.product_images where product_id = ${productId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(originalImageId);
    expect(rows[0].storage_path).toContain(OLD_STORAGE_PATH_SUFFIX);
    await expect(fs.access(oldAbsPath)).resolves.toBeUndefined();
  });

  test("Admin: يرفض ملفاً بصيغة غير مدعومة (validation) بلا أي تغيير", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const fd = new FormData();
    fd.set("file", new File([Buffer.from("not an image")], "x.txt", { type: "text/plain" }));
    const result = await replacePrimaryImage(productId, { error: null }, fd);

    expect(result.error).toBeTruthy();
    const rows = await sql<{ id: number }[]>`
      select id from public.product_images where product_id = ${productId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(originalImageId);
  });

  test("Admin: يبدّل الصورة الرئيسية بنجاح — نفس السجل، صورة واحدة رئيسية، الملف الجديد على القرص، والقديم يُحذف، وبقية بيانات المنتج بلا تغيير", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);

    const fd = new FormData();
    fd.set("file", pngFile("new-primary.png"));
    const result = await replacePrimaryImage(productId, { error: null }, fd);

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    const rows = await sql<
      { id: number; storage_path: string; is_primary: boolean }[]
    >`select id, storage_path, is_primary from public.product_images where product_id = ${productId}`;

    // سجل واحد بالضبط، ونفس id السابق (تحديث فمكانه، وليس سجلاً جديداً) —
    // يضمن عدم وجود أي سجل "رئيسية" مكرر.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(originalImageId);
    expect(rows[0].is_primary).toBe(true);
    expect(rows[0].storage_path).not.toContain(OLD_STORAGE_PATH_SUFFIX);
    expect(rows[0].storage_path.startsWith(`product-images/${productId}/`)).toBe(true);

    // الملف الجديد فعلاً مكتوب على القرص بنفس نظام storage الحالي، وبنفس المحتوى.
    const newAbsPath = path.join(process.cwd(), "public", rows[0].storage_path);
    const written = await fs.readFile(newAbsPath);
    expect(written.equals(NEW_IMAGE_BYTES)).toBe(true);

    // الملف القديم حُذف فعلياً من التخزين (لا صور يتيمة متراكمة).
    await expect(fs.access(oldAbsPath)).rejects.toThrow();

    // بقية بيانات المنتج لم تتغيّر إطلاقاً.
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
    expect(product.name_ar).toBe("منتج اختبار تغيير الصورة");
    expect(Number(product.sale_price)).toBe(99);
    expect(Number(product.purchase_price)).toBe(55);
    expect(product.stock_quantity).toBe(40);
    expect(product.min_order_qty).toBe(3);
    expect(product.status).toBe("published");

    // لا منتج مكرر أُنشئ.
    const productCount = await sql<{ count: number }[]>`
      select count(*)::int as count from public.products where sku = 'TEST-FIXTURE-CHANGEIMG'
    `;
    expect(productCount[0].count).toBe(1);
  });
});
