"use client";

import { useState, useTransition, type ReactNode } from "react";
import { loadMoreProducts } from "@/app/(storefront)/loadMoreProducts";

/**
 * زر "عرض المزيد من المنتجات" أسفل شبكة الصفحة الرئيسية.
 *
 * الدفعة الأولى تُصيَّر من الخادم مع الصفحة نفسها (فلا ينتظر الزائر أي
 * JavaScript ليرى منتجات)، وهذا المكوّن يضيف الدفعات التالية فقط عند الطلب.
 * الكروت الإضافية تأتي مُصيَّرة من الخادم عبر loadMoreProducts، فهي نفس
 * ProductCard بالضبط بنفس زر الإضافة للسلة.
 *
 * الحالة كلها محلية هنا: لا تحديث للمسار ولا إعادة تصيير للصفحة، فلا يُمسّ
 * أي تخزين مؤقّت قائم.
 */
export function LoadMoreProducts({
  initialOffset,
  pageSize,
  initialHasMore,
}: {
  initialOffset: number;
  pageSize: number;
  initialHasMore: boolean;
}) {
  const [cards, setCards] = useState<ReactNode[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadMoreProducts(offset, pageSize);
        setCards((previous) => [...previous, ...result.cards]);
        setOffset(result.nextOffset);
        setHasMore(result.hasMore);
      } catch {
        // فشل الشبكة أو الخادم لا يُفرِّغ ما عُرض أصلاً — المنتجات الظاهرة
        // تبقى كما هي ويُعرض للزائر خيار إعادة المحاولة.
        setFailed(true);
      }
    });
  }

  return (
    <>
      {cards.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {cards}
        </div>
      )}

      {failed && (
        <p className="mt-3 text-center text-sm text-red-600">
          تعذّر تحميل المزيد. حاول مرة أخرى.
        </p>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="flex min-h-11 items-center justify-center rounded-full border border-brand-turquoise px-6 py-2.5 text-sm font-semibold text-brand-turquoise-dark transition-colors hover:bg-brand-turquoise-tint disabled:opacity-60"
          >
            {isPending ? "جارٍ التحميل…" : "عرض المزيد من المنتجات"}
          </button>
        </div>
      )}
    </>
  );
}
