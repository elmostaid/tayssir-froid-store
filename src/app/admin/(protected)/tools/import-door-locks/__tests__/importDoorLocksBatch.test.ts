import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { sql } from "@/lib/db";
import { DOOR_LOCK_IMPORT_PRODUCTS } from "@/lib/doorLockImportBatch";

const getAdminUserMock = vi.fn();
vi.mock("@/lib/auth/requireAdmin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/requireAdmin")>(
    "@/lib/auth/requireAdmin"
  );
  return { ...actual, getAdminUser: getAdminUserMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { importDoorLocksBatch } = await import(
  "@/app/admin/(protected)/tools/import-door-locks/actions"
);

const ADMIN_USER = { id: "test-admin-doorlock-tool", email: "admin@local", role: "admin" as const };
const STAFF_USER = { id: "test-staff-doorlock-tool", email: "staff@local", role: "staff" as const };

// نُبقي أربعة أسطر (001-024) كما هي دائماً (تحاكي "المنتجات الموجودة أصلاً
// التي يجب ألا تُلمَس")، ونحذف الأربعة الأخيرة (025-028) مؤقتاً لمحاكاة
// "منتجات ناقصة يجب إضافتها فقط" — بيانات حقيقية من الدفعة نفسها، قابلة
// لإعادة الإدخال بأمان عبر نفس الأداة التي نختبرها.
const MISSING_SKUS = ["TF-AWM-025", "TF-AWM-026", "TF-AWM-027", "TF-AWM-028"];
const KEPT_SKUS = DOOR_LOCK_IMPORT_PRODUCTS.map((p) => p.sku).filter((s) => !MISSING_SKUS.includes(s));

let keptSnapshotBefore: { sku: string; id: number; created_at: string }[] = [];

beforeAll(async () => {
  // نتأكد أولاً أن كل الدفعة (28) موجودة فعلاً محلياً (كما تركتها الجلسات
  // السابقة فهذا المشروع)، حتى يكون سيناريو "الحذف الجزئي" واقعياً ومضبوطاً.
  for (const product of DOOR_LOCK_IMPORT_PRODUCTS) {
    await sql`
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
    `;
    const [row] = await sql<{ id: number }[]>`select id from public.products where sku = ${product.sku}`;
    for (const image of product.images) {
      await sql`
        insert into public.product_images (product_id, storage_path, alt_text_ar, sort_order, is_primary)
        select ${row.id}, ${image.path}, ${image.alt}, ${image.sortOrder}, ${image.isPrimary}
        where not exists (
          select 1 from public.product_images where product_id = ${row.id} and storage_path = ${image.path}
        )
      `;
    }
  }

  // ثم نحذف الأربعة الأخيرة عمداً لمحاكاة "ناقصة" — cascade يحذف صورها معهم.
  await sql`delete from public.products where sku = any(${MISSING_SKUS})`;

  keptSnapshotBefore = await sql<{ sku: string; id: number; created_at: string }[]>`
    select sku, id, created_at::text from public.products where sku = any(${KEPT_SKUS}) order by sku
  `;
  expect(keptSnapshotBefore.length).toBe(KEPT_SKUS.length);
});

afterAll(async () => {
  // نعيد الوضع كما كان (الدفعة الكاملة موجودة) — الأداة نفسها idempotent
  // فلن تُنشئ أي تكرار حتى لو أُعيد تشغيلها بعد هذا.
  for (const product of DOOR_LOCK_IMPORT_PRODUCTS) {
    await sql`
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
    `;
  }
});

describe("importDoorLocksBatch — صلاحيات", () => {
  test("Staff: يُرفَض، لا شيء يتغيّر", async () => {
    getAdminUserMock.mockResolvedValueOnce(STAFF_USER);
    const result = await importDoorLocksBatch();
    expect(result.error).not.toBeNull();
    expect(result.summary).toBeNull();
  });
});

describe("importDoorLocksBatch — إضافة الناقص فقط، بلا لمس الموجود", () => {
  test("الأربعة الناقصة (025-028) تُضاف، والباقي (24) يُعتبر موجوداً مسبقاً بلا أي إدراج", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await importDoorLocksBatch();
    expect(result.error).toBeNull();
    expect(result.summary).not.toBeNull();
    expect(result.summary!.productsPresent).toBe(28);
    expect(result.summary!.productsTarget).toBe(28);
    expect(result.summary!.failures).toEqual([]);

    for (const sku of MISSING_SKUS) {
      const row = result.rows.find((r) => r.sku === sku);
      expect(row?.productOutcome).toBe("inserted");
      expect(row?.error).toBeNull();
    }
    for (const sku of KEPT_SKUS) {
      const row = result.rows.find((r) => r.sku === sku);
      expect(row?.productOutcome).toBe("already_existed");
    }
  });

  test("كل صور الأربعة الناقصة أُضيفت أيضاً (84 صورة إجمالاً محسوبة على الدفعة)", async () => {
    const totalImages = DOOR_LOCK_IMPORT_PRODUCTS.reduce((n, p) => n + p.images.length, 0);
    const dbCount = await sql<{ count: number }[]>`
      select count(*)::int as count from public.product_images pi
      join public.products p on p.id = pi.product_id
      where p.sku = any(${DOOR_LOCK_IMPORT_PRODUCTS.map((p) => p.sku)})
    `;
    expect(dbCount[0].count).toBe(totalImages);
  });

  test("الـ24 منتجاً الموجودة مسبقاً بقيت بنفس id ونفس created_at — لم تُلمَس إطلاقاً", async () => {
    const keptSnapshotAfter = await sql<{ sku: string; id: number; created_at: string }[]>`
      select sku, id, created_at::text from public.products where sku = any(${KEPT_SKUS}) order by sku
    `;
    expect(keptSnapshotAfter).toEqual(keptSnapshotBefore);
  });

  test("تشغيل الأداة مرة ثانية: لا شيء يُضاف (idempotent بالكامل)", async () => {
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    const result = await importDoorLocksBatch();
    expect(result.error).toBeNull();
    expect(result.summary!.productsPresent).toBe(28);
    expect(result.summary!.imagesPresent).toBe(84);
    expect(result.summary!.imagesTarget).toBe(84);
    expect(result.summary!.failures).toEqual([]);
  });
});

describe("importDoorLocksBatch — لا يمسّ أي منتج آخر خارج الدفعة", () => {
  test("عدد المنتجات الإجمالي فقاعدة البيانات لا يتغيّر بعد إعادة تشغيل الأداة على دفعة مكتملة أصلاً", async () => {
    const before = await sql<{ count: number }[]>`select count(*)::int as count from public.products`;
    getAdminUserMock.mockResolvedValueOnce(ADMIN_USER);
    await importDoorLocksBatch();
    const after = await sql<{ count: number }[]>`select count(*)::int as count from public.products`;
    expect(after[0].count).toBe(before[0].count);
  });
});
