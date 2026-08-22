"use client";

import { useState, useTransition, type ReactNode } from "react";
import { loadMoreProducts, type LoadMoreFilters } from "@/app/(storefront)/loadMoreProducts";

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
  filters,
  gridClassName,
}: {
  initialOffset: number;
  pageSize: number;
  initialHasMore: boolean;
  /** تصنيف/بحث/ترتيب — للصفحة الرئيسية تُترك فارغة. */
  filters?: LoadMoreFilters;
  /** شبكة الكروت الإضافية — يجب أن تطابق شبكة الصفحة حتى لا تختلف الأعمدة بعد الضغط. */
  gridClassName?: string;
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
        const result = await loadMoreProducts(offset, pageSize, filters);
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
        <div className={gridClassName ?? "mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"}>
          {cards}
        </div>
      )}

      {failed && (
        <p className="mt-3 text-center text-sm text-red-600">
          تعذّر تحميل المزيد. حاول مرة أخرى.
        </p>
      )}

      {/* زرّ بعرض الشاشة تقريباً وارتفاع إبهام: كان صغيراً ومحاطاً بفراغ
          فلا يُلاحَظ على الهاتف، وهو الطريق الوحيد لبقية المنتجات بعد أول
          24. يظهر مباشرة تحت آخر صفّ. */}
      {hasMore && (
        <div className="mt-4 px-1">
          <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl border-2 border-brand-turquoise bg-brand-turquoise-tint px-6 text-lg font-bold text-brand-turquoise-dark transition-colors hover:bg-brand-turquoise hover:text-white disabled:opacity-60 sm:mx-auto sm:max-w-md"
          >
            {isPending ? "جارٍ التحميل…" : "عرض المزيد من المنتجات"}
          </button>
        </div>
      )}
    </>
  );
}
