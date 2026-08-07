import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAllProductsAdmin } from "@/lib/queries/adminProducts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المنتجات",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "مسودة", className: "bg-neutral-200 text-neutral-700" },
  published: { label: "منشور", className: "bg-green-100 text-green-700" },
  out_of_stock: { label: "غير متوفر", className: "bg-amber-100 text-amber-700" },
  archived: { label: "مؤرشف", className: "bg-neutral-200 text-neutral-500" },
};

// عتبة "مخزون منخفض" — تنبيه بصري فقط فلوحة الإدارة، لا يمس أي منطق طلب أو
// حجز مخزون حقيقي.
const LOW_STOCK_THRESHOLD = 10;

export default async function AdminProductsPage() {
  // فحص مباشر هنا قبل أي استعلام — الـlayout الأب وحده لا يمنع تنفيذ هذه
  // الصفحة وجلب بياناتها (بما فيها ثمن الشراء) لأن Next.js يُنفّذ صفحة
  // الطفل بغض النظر عمّا يعرضه الـlayout فعلياً.
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }

  const products = await getAllProductsAdmin();

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

      {products.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">لا توجد منتجات بعد.</p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {products.map((product) => {
          const status = STATUS_LABELS[product.status] ?? {
            label: product.status,
            className: "bg-neutral-200 text-neutral-700",
          };
          return (
            <Link
              key={product.id}
              href={`/admin/products/${product.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-neutral-800">
                    {product.name_ar}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                    {status.label}
                  </span>
                </div>
                <p className="truncate text-xs text-neutral-500">
                  {product.category_name_ar} · SKU: <span dir="ltr">{product.sku}</span>
                </p>
              </div>
              <div className="shrink-0 text-left text-sm font-semibold text-neutral-800">
                {product.sale_price} د.م.
                <p
                  className={`text-xs font-normal ${
                    product.stock_quantity <= LOW_STOCK_THRESHOLD
                      ? "font-semibold text-red-600"
                      : "text-neutral-500"
                  }`}
                >
                  المخزون: {product.stock_quantity}
                  {product.stock_quantity <= LOW_STOCK_THRESHOLD && product.stock_quantity > 0
                    ? " ⚠️ منخفض"
                    : ""}
                  {product.stock_quantity <= 0 ? " ⚠️ نفد" : ""}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
