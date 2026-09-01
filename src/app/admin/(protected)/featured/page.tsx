import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { listFeaturedAdmin } from "@/lib/queries/adminFeatured";
import { HOME_FEATURED_LIMIT } from "@/lib/queries/catalog";
import { resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";
import { FeaturedManager } from "@/components/admin/FeaturedManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "الأكثر طلباً",
};

export default async function AdminFeaturedPage() {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/admin/login");
  }
  if (!isOwnerAdmin(admin)) {
    redirect("/admin/orders");
  }

  const featured = await listFeaturedAdmin();
  // القسم يقرأ من catalog_products، فمنتج مسودة أو مؤرشف لا يصل الزبون حتى
  // لو كان مختاراً هنا. فالصفحة الرئيسية تتراجع للقائمة التلقائية ما لم يكن
  // **منتج ظاهر واحد على الأقل** فالقائمة — لا مجرّد صفّ فالجدول.
  const visibleCount = featured.filter(
    (product) => product.status === "published" || product.status === "out_of_stock"
  ).length;
  const imageUrlByPath = await resolveProductImageUrls(
    featured
      .map((product) => product.primary_image_path)
      .filter((path): path is string => Boolean(path))
  );

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">الأكثر طلباً</h1>
      <p className="mt-2 text-sm text-neutral-600">
        القسم الأول الذي يراه الزائر فالصفحة الرئيسية، بعد العنوان مباشرة. اختر
        المنتجات ورتّبها بالأرقام — 1 يظهر أولاً. الحد الأقصى {HOME_FEATURED_LIMIT}{" "}
        منتجاً.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        هذا الترتيب مستقل تماماً عن ترتيب المنتجات داخل تصنيفاتها فـ«المنتجات» —
        تغييره هنا لا يُحرّك أي منتج من مكانه فصفحة تصنيفه.
      </p>

      <FeaturedManager
        featured={featured}
        imageUrlByPath={imageUrlByPath}
        usingFallback={visibleCount === 0}
      />
    </div>
  );
}
