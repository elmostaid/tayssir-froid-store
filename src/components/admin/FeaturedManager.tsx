"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addFeaturedProduct,
  moveFeaturedToRank,
  removeFeaturedProduct,
  searchProductsToFeature,
} from "@/app/admin/(protected)/featured/actions";
import type { FeaturableProduct, FeaturedProduct } from "@/lib/queries/adminFeatured";

/**
 * إدارة قسم «الأكثر طلباً» فالصفحة الرئيسية.
 *
 * جزآن: القائمة المختارة (ترتيب بالأرقام + إزالة)، وبحث لإضافة منتج جديد.
 * البحث هو واجهة الإضافة لأن الكتالوج يتجاوز 300 منتج — قائمة منسدلة بها
 * كلها غير قابلة للاستعمال على الهاتف.
 *
 * بعد كل تغيير ناجح: router.refresh() ليُعيد الخادم القائمة بترتيبها
 * الحقيقي من قاعدة البيانات، بدل محاكاة الترتيب محلياً. القائمة قصيرة
 * (24 كحد أقصى) فالتكلفة لا تُذكر، والمقابل أن ما يراه المدير هو ما هو
 * محفوظ فعلاً — لا تخمين واجهة قد يخالفه.
 */
export function FeaturedManager({
  featured,
  imageUrlByPath,
  usingFallback,
}: {
  featured: FeaturedProduct[];
  imageUrlByPath: Record<string, string>;
  /** لا اختيار يدوي بعد — الصفحة الرئيسية تعرض القائمة المقاسة تلقائياً. */
  usingFallback: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FeaturableProduct[] | null>(null);
  const [isSearching, startSearchTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startSearchTransition(async () => {
      const result = await searchProductsToFeature(query);
      if (result.error) {
        setError(result.error);
        return;
      }
      setResults(result.products);
    });
  }

  const busy = isPending || isSearching;

  return (
    <div className="mt-4 flex flex-col gap-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {usingFallback && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          لم تختر أي منتج بعد، فالصفحة الرئيسية تعرض القائمة التلقائية المبنية على
          الطلبات. أول منتج تضيفه هنا يُلغي القائمة التلقائية بالكامل.
        </p>
      )}

      <section>
        <h2 className="text-sm font-bold text-neutral-800">
          المنتجات المعروضة ({featured.length})
        </h2>

        {featured.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">القائمة فارغة.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {featured.map((product) => (
              <FeaturedRow
                key={product.product_id}
                product={product}
                imageUrl={
                  product.primary_image_path
                    ? imageUrlByPath[product.primary_image_path] ?? null
                    : null
                }
                busy={busy}
                onMoveToRank={(rank) => run(() => moveFeaturedToRank(product.product_id, rank))}
                onRemove={() => run(() => removeFeaturedProduct(product.product_id))}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-neutral-800">إضافة منتج</h2>
        <form onSubmit={handleSearch} className="mt-2 flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="اسم المنتج أو SKU"
            className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-3 text-sm"
          />
          <button
            type="submit"
            disabled={busy || query.trim() === ""}
            className="min-h-11 shrink-0 rounded-lg bg-brand-turquoise px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            بحث
          </button>
        </form>

        {results !== null && results.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">
            لا نتائج (المنتجات المضافة أصلاً لا تظهر هنا).
          </p>
        )}

        {results !== null && results.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {results.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2"
              >
                <Thumb
                  url={
                    product.primary_image_path
                      ? imageUrlByPath[product.primary_image_path] ?? null
                      : null
                  }
                  alt={product.name_ar}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-800">
                    {product.name_ar}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {product.category_name_ar} · {product.sale_price} د.م
                    {product.status !== "published" && " · غير منشور"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await addFeaturedProduct(product.id);
                      if (!result.error) {
                        setResults((prev) => prev?.filter((p) => p.id !== product.id) ?? null);
                      }
                      return result;
                    })
                  }
                  className="min-h-11 shrink-0 rounded-lg bg-brand-orange px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  إضافة
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
      {url && <Image src={url} alt={alt} fill sizes="56px" className="object-contain p-1" />}
    </span>
  );
}

function FeaturedRow({
  product,
  imageUrl,
  busy,
  onMoveToRank,
  onRemove,
}: {
  product: FeaturedProduct;
  imageUrl: string | null;
  busy: boolean;
  onMoveToRank: (rank: number) => void;
  onRemove: () => void;
}) {
  // خانة المرتبة قيمة نصية مستقلة (يكتب المدير بحرية)، تُزامَن من جديد كلما
  // تغيّرت المرتبة الحقيقية بعد أي نقل — نفس نمط ProductQuickEditRow.
  const [prevPosition, setPrevPosition] = useState(product.position);
  const [rankInput, setRankInput] = useState(String(product.position));
  const [rankError, setRankError] = useState<string | null>(null);
  if (product.position !== prevPosition) {
    setPrevPosition(product.position);
    setRankInput(String(product.position));
  }

  function handleMove() {
    const parsed = Number(rankInput);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setRankError("أدخل رقم مرتبة صحيح (1 أو أكثر).");
      return;
    }
    setRankError(null);
    onMoveToRank(parsed);
  }

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-2">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-turquoise-tint text-sm font-bold text-brand-turquoise-dark">
          {product.position}
        </span>
        <Thumb url={imageUrl} alt={product.name_ar} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/products/${product.product_id}`}
            className="block truncate text-sm font-semibold text-neutral-800 hover:underline"
          >
            {product.name_ar}
          </Link>
          <p className="truncate text-xs text-neutral-500">
            {product.category_name_ar} · {product.sale_price} د.م
          </p>
          {product.status !== "published" && (
            // منتج محجوز فالقسم لكنه لا يصل الزبون فعلاً — القسم يقرأ من
            // catalog_products التي تستثني المسودات والمؤرشف.
            <p className="text-xs font-semibold text-amber-700">
              غير منشور — لا يظهر للزبون فالصفحة الرئيسية
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <label className="text-xs text-neutral-600" htmlFor={`rank-${product.product_id}`}>
          المرتبة
        </label>
        <input
          id={`rank-${product.product_id}`}
          type="number"
          min={1}
          inputMode="numeric"
          value={rankInput}
          onChange={(e) => setRankInput(e.target.value)}
          className="min-h-11 w-20 rounded-lg border border-neutral-300 px-2 text-center text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={handleMove}
          className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm font-semibold text-neutral-700 disabled:opacity-50"
        >
          نقل
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 disabled:opacity-50"
        >
          إزالة
        </button>
      </div>

      {rankError && <p className="mt-1 text-xs text-red-700">{rankError}</p>}
    </li>
  );
}
