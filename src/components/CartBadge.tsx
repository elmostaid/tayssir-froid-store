"use client";

import Link from "next/link";
import { useCart } from "@/components/CartProvider";

/**
 * زرّ السلة في الترويسة — وهو في هذا الموقع **باب إتمام الطلب**، لا أيقونة.
 *
 * ## لماذا تغيّر شكله
 *
 * كان شارةً رمادية بإطار مكتوباً فيها «السلة» فقط، بينما زرّ واتساب حدّها
 * دائرةٌ خضراء مملوءة — أي أن العنصر الملوّن الوحيد في الترويسة كان يقود
 * إلى محادثة عامة بلا سلة ولا معلومات زبون. والقياس في 30 يوماً: من 228
 * جلسةً أضافت للسلة، **131** غابت بلا إتمام طلب وبلا سلة واتساب وبلا طلب.
 *
 * فالآن اللون البرتقالي (لون الشراء في هذا الموقع، ونفس لون شريط «إتمام
 * الطلب» أسفل الشاشة) صار للسلة، والنصّ يقول وظيفتها لا اسمها: على الهاتف
 * سطران («السلة» + العدد، ثم «لإتمام الطلب»)، وعلى الحاسوب «الدخول للسلة
 * لإتمام الطلب».
 *
 * ## لماذا سطران على الهاتف، لا سطر واحد
 *
 * قياسٌ على متصفّح حقيقي: الترويسة على 320px كانت **تسحق الشعار** إلى 31px
 * من أصل 90 (وإلى 71px على 360px) لأن مجموع عناصرها يفوق عرض الشاشة أصلاً.
 * فإضافة «لإتمام الطلب» في سطر واحد كانت ستزيد السحق. السطران يضعان النصّ
 * داخل نفس عرض الشارة القديمة تقريباً، فيربح الشعار مساحةً بدل أن يخسرها.
 *
 * العدّاد نفسه لم يتغيّر ميكانيكياً: نفس `data-cart-count` ونفس `hidden`
 * ونفس `suppressHydrationWarning` — لأن السكريبت المبكّر
 * (lib/cart/earlyAdd.ts) يكتب فيه مباشرة قبل وصول React، ولا يعرف سواه.
 */
export function CartBadge() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      aria-label={
        itemCount > 0
          ? `الدخول للسلة لإتمام الطلب — ${itemCount} قطعة`
          : "الدخول للسلة لإتمام الطلب"
      }
      className="relative inline-flex min-h-11 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-orange px-2.5 py-1 text-white shadow-sm transition-colors hover:bg-brand-orange-dark sm:flex-row sm:gap-2 sm:rounded-full sm:px-4 sm:py-2"
    >
      <span className="flex items-center gap-1 whitespace-nowrap text-xs font-bold leading-none sm:gap-2 sm:text-sm">
        <span className="sm:hidden">السلة</span>
        <span className="hidden sm:inline">الدخول للسلة لإتمام الطلب</span>
        {/*
          العدّاد موجود دائماً في HTML ومخفيّ حين يكون صفراً، بدل أن يُركَّب
          عند أول إضافة. السبب: السكريبت المبكّر (lib/cart/earlyAdd.ts) يحدّث
          هذا العنصر مباشرة قبل وصول React، ولا يستطيع إنشاء عنصر غير موجود.
          `hidden` يكفي للإخفاء: preflight يعطيه display:none !important، فلا
          يغلبه inline-flex. و suppressHydrationWarning لأن العدد قد يكون
          تغيّر فعلاً قبل الترطيب — وهذا هو المقصود لا خطأ.
        */}
        <span
          data-cart-count
          hidden={itemCount === 0}
          suppressHydrationWarning
          className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-brand-orange sm:h-5 sm:min-w-5 sm:text-xs"
        >
          {itemCount}
        </span>
      </span>
      {/* سطر الوظيفة — على الهاتف وحده، لأن نصّ الحاسوب يحملها كاملةً. */}
      <span className="mt-1 whitespace-nowrap text-[10px] font-semibold leading-none text-white/95 sm:hidden">
        لإتمام الطلب
      </span>
    </Link>
  );
}
