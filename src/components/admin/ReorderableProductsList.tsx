"use client";

import { useMemo, useState } from "react";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";
import { moveProductUp, moveProductDown, moveProductToRank } from "@/app/admin/(protected)/products/actions";
import type { ImageActionState, UploadTargetState } from "@/app/admin/(protected)/products/imageActions";
import type { AdminProduct, AdminProductImage } from "@/lib/queries/adminProducts";
import { ProductQuickEditRow } from "@/components/admin/ProductQuickEditRow";

export type ProductRowConfig = {
  productId: number;
  action: (prevState: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  images: AdminProductImage[];
  createUploadTargetAction: (contentType: string) => Promise<UploadTargetState>;
  commitPrimaryUploadAction: (objectPath: string) => Promise<ImageActionState>;
  commitAdditionalUploadAction: (objectPath: string, altText: string | null) => Promise<ImageActionState>;
  imagesWithActions: {
    image: AdminProductImage;
    setPrimaryAction: () => Promise<{ error: string | null }>;
    deleteAction: () => Promise<{ error: string | null }>;
  }[];
};

// تُبقي قائمة المنتجات ديناميكية بالكامل من جهة العميل: "↑"/"↓"/"نقل" تُحدِّث
// ترتيب المنتجات فوراً من القيمة المُرجَعة من Server Action مباشرة (updated:
// {id, sort_order}[])، بلا أي إعادة جلب/عرض لكامل الصفحة (لا revalidatePath
// ولا router.refresh هنا) — فقط استعلام قاعدة البيانات الحقيقي (طلب واحد)
// ثم تحديث محلي فوري للواجهة. أول تحميل للصفحة (initialProducts) يبقى من
// الخادم كما هو دائماً (بيانات حقيقية وصحيحة من أول عرض).
export function ReorderableProductsList({
  initialProducts,
  rowConfigs,
  imageUrlByPath,
  canUploadImages,
}: {
  initialProducts: AdminProduct[];
  rowConfigs: ProductRowConfig[];
  imageUrlByPath: Record<string, string>;
  canUploadImages: boolean;
}) {
  const [products, setProducts] = useState(initialProducts);
  const configById = useMemo(() => {
    const map = new Map<number, ProductRowConfig>();
    for (const config of rowConfigs) map.set(config.productId, config);
    return map;
  }, [rowConfigs]);

  // يُطبَّق بعد أي نقل ناجح ("↑"/"↓"/"نقل"): يُحدِّث sort_order للمنتجات
  // المتأثرة فقط (كلها من نفس category_id دائماً)، ثم يُعيد ترتيب تلك الحصة
  // فقط ضمن المصفوفة المحلية حسب sort_order الجديد — بقية المنتجات (تصنيفات
  // أخرى) بلا أي تغيير فموقعها أو بياناتها.
  function applyReorder(categoryId: number, updated: { id: number; sort_order: number }[]) {
    if (updated.length === 0) return;
    setProducts((prev) => {
      const bySortOrder = new Map(updated.map((u) => [u.id, u.sort_order]));
      const next = prev.map((p) => (bySortOrder.has(p.id) ? { ...p, sort_order: bySortOrder.get(p.id)! } : p));

      const indices: number[] = [];
      for (let i = 0; i < next.length; i++) {
        if (next[i].category_id === categoryId) indices.push(i);
      }
      if (indices.length === 0) return next;

      const start = indices[0];
      const end = indices[indices.length - 1];
      const slice = next.slice(start, end + 1).sort((a, b) => a.sort_order - b.sort_order);
      next.splice(start, slice.length, ...slice);
      return next;
    });
  }

  if (products.length === 0) {
    return <p className="mt-6 text-sm text-neutral-500">لا توجد منتجات مطابقة.</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {products.map((product, index) => {
        const config = configById.get(product.id);
        if (!config) return null;
        // products مرتَّبة أصلاً حسب category_id ثم sort_order (من الخادم
        // أول مرة، ومن applyReorder بعد ذلك) — منتجات نفس التصنيف متتالية
        // دائماً، فمقارنة الجار السابق/اللاحق فنفس المصفوفة كافية لتحديد
        // أول/آخر منتج داخل تصنيفه.
        const isFirstInCategory = index === 0 || products[index - 1].category_id !== product.category_id;
        const isLastInCategory =
          index === products.length - 1 || products[index + 1].category_id !== product.category_id;

        return (
          <ProductQuickEditRow
            key={product.id}
            product={product}
            action={config.action}
            images={config.images}
            imageUrlByPath={imageUrlByPath}
            canUploadImages={canUploadImages}
            createUploadTargetAction={config.createUploadTargetAction}
            commitPrimaryUploadAction={config.commitPrimaryUploadAction}
            commitAdditionalUploadAction={config.commitAdditionalUploadAction}
            imagesWithActions={config.imagesWithActions}
            isFirstInCategory={isFirstInCategory}
            isLastInCategory={isLastInCategory}
            onMoveUp={async () => {
              const result = await moveProductUp(product.id);
              if (!result.error && result.updated) applyReorder(product.category_id, result.updated);
              return { error: result.error };
            }}
            onMoveDown={async () => {
              const result = await moveProductDown(product.id);
              if (!result.error && result.updated) applyReorder(product.category_id, result.updated);
              return { error: result.error };
            }}
            onMoveToRank={async (rank: number) => {
              const result = await moveProductToRank(product.id, rank);
              if (!result.error && result.updated) applyReorder(product.category_id, result.updated);
              return { error: result.error };
            }}
          />
        );
      })}
    </div>
  );
}
