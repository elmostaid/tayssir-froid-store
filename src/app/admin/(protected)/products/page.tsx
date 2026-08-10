import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import {
  listProductsAdmin,
  getImagesForProductsAdmin,
  type AdminProductImage,
} from "@/lib/queries/adminProducts";
import { getAllCategoriesAdmin } from "@/lib/queries/adminCategories";
import { canWriteProductImages } from "@/lib/storage/productImages";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { quickUpdateProduct, moveProductUp, moveProductDown } from "@/app/admin/(protected)/products/actions";
import {
  createImageUploadTarget,
  commitPrimaryImage,
  commitAdditionalImage,
  setPrimaryImage,
  deleteProductImage,
} from "@/app/admin/(protected)/products/imageActions";
import { ProductQuickEditRow } from "@/components/admin/ProductQuickEditRow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المنتجات",
};

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "كل الحالات" },
  { value: "published", label: "منشور" },
  { value: "draft", label: "مسودة" },
  { value: "out_of_stock", label: "غير متوفر" },
  { value: "archived", label: "مؤرشف" },
];

type Props = {
  searchParams: Promise<{ q?: string; category?: string; status?: string; lowStock?: string }>;
};

export default async function AdminProductsPage({ searchParams }: Props) {
  // فحص مباشر هنا قبل أي استعلام — الـlayout الأب وحده لا يمنع تنفيذ هذه
  // الصفحة وجلب بياناتها (بما فيها ثمن الشراء) لأن Next.js يُنفّذ صفحة
  // الطفل بغض النظر عمّا يعرضه الـlayout فعلياً.
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  // هذه الصفحة نفسها (وليس فقط ثمن الشراء داخلها) مقصورة على Owner/Admin —
  // ليست ضمن قائمة صلاحيات Staff الصريحة (طلبات فقط).
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const { q, category, status, lowStock } = await searchParams;
  const categoryId = category ? Number(category) : undefined;
  const validStatus =
    status === "published" || status === "draft" || status === "out_of_stock" || status === "archived"
      ? status
      : undefined;

  const [products, categories] = await Promise.all([
    listProductsAdmin({
      query: q,
      categoryId: Number.isInteger(categoryId) ? categoryId : undefined,
      status: validStatus,
      lowStockOnly: lowStock === "1",
    }),
    getAllCategoriesAdmin(),
  ]);

  // جلب دفعة واحدة لصور كل المنتجات المعروضة — مُغلَّف بـtry/catch عمداً: أي
  // خطأ هنا (اتصال قاعدة بيانات، عمود مفقود...) يجب ألا يُسقط صفحة
  // /admin/products بأكملها؛ يكفي أن تظهر بطاقات المنتجات بلا صور مؤقتاً.
  let allImages: AdminProductImage[] = [];
  try {
    allImages = await getImagesForProductsAdmin(products.map((p) => p.id));
  } catch (err) {
    console.error("getImagesForProductsAdmin failed — rendering /admin/products without images", err);
  }
  const imagesByProductId = new Map<number, AdminProductImage[]>();
  for (const img of allImages) {
    const list = imagesByProductId.get(img.product_id);
    if (list) list.push(img);
    else imagesByProductId.set(img.product_id, [img]);
  }

  // نفس الحل الآمن ضد صورة معطوبة (broken image): نحل رابط كل صورة من جهة
  // الخادم (fs.access محلياً، وإلا getPublicUrl من Supabase Storage الحقيقي)
  // ونمرّره جاهزاً للمكوّن — resolveProductImageUrls لا ترمي أي استثناء أبداً.
  const imageUrlByPath = await resolveProductImageUrls(allImages.map((img) => img.storage_path));

  const canUpload = canWriteProductImages();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-800">المنتجات</h1>
        <Link
          href="/admin/products/new"
          className="rounded-full bg-brand-orange px-4 py-2 text-sm font-semibold text-white"
        >
          + منتج جديد
        </Link>
      </div>

      <form
        action="/admin/products"
        method="GET"
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="بحث بالاسم أو SKU"
          className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-turquoise focus:outline-none"
        />
        <select
          name="category"
          defaultValue={category ?? ""}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent_id ? `— ${c.name_ar}` : c.name_ar}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={validStatus ?? ""}
          className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 px-3 text-sm">
          <input type="checkbox" name="lowStock" value="1" defaultChecked={lowStock === "1"} />
          مخزون منخفض فقط
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white"
        >
          فلترة
        </button>
      </form>

      <p className="mt-3 text-sm text-neutral-500">{products.length} منتج</p>

      {products.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">لا توجد منتجات مطابقة.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {products.map((product, index) => {
            const productImages = imagesByProductId.get(product.id) ?? [];
            // listProductsAdmin مرتَّبة أصلاً حسب category_id ثم sort_order —
            // منتجات نفس التصنيف متتالية دائماً، فمقارنة الجار السابق/اللاحق
            // فنفس المصفوفة كافية لتحديد أول/آخر منتج داخل تصنيفه (لتعطيل
            // "↑"/"↓" فحدود التصنيف بلا استعلام إضافي).
            const isFirstInCategory =
              index === 0 || products[index - 1].category_id !== product.category_id;
            const isLastInCategory =
              index === products.length - 1 || products[index + 1].category_id !== product.category_id;
            return (
              <ProductQuickEditRow
                key={product.id}
                product={product}
                action={quickUpdateProduct.bind(null, product.id)}
                images={productImages}
                imageUrlByPath={imageUrlByPath}
                canUploadImages={canUpload}
                createUploadTargetAction={createImageUploadTarget.bind(null, product.id)}
                commitPrimaryUploadAction={commitPrimaryImage.bind(null, product.id)}
                commitAdditionalUploadAction={commitAdditionalImage.bind(null, product.id)}
                imagesWithActions={productImages.map((image) => ({
                  image,
                  setPrimaryAction: setPrimaryImage.bind(null, image.id, product.id),
                  deleteAction: deleteProductImage.bind(null, image.id, product.id),
                }))}
                isFirstInCategory={isFirstInCategory}
                isLastInCategory={isLastInCategory}
                moveUpAction={moveProductUp.bind(null, product.id)}
                moveDownAction={moveProductDown.bind(null, product.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
