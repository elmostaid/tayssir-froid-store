import { formatMad } from "@/lib/format";
import {
  computeOrderProfit,
  PROFIT_REALIZATION_LABELS,
  type OrderProfitLine,
} from "@/lib/orders/orderProfit";

/**
 * «ربح الطلبية» — قسمٌ للعرض وحده داخل صفحة الطلب.
 *
 * **مكوّن خادم عمداً، ولا يصير مكوّن عميل أبداً.** ثمن الشراء سرّي (محميّ
 * بـRLS في القاعدة، ومعزول بـserver-only في مسار الـfallback المحلي)؛ لو
 * صار هذا الملف `"use client"` لانتقلت التكلفة إلى حزمة المتصفح. ما يُرسَل
 * إلى العميل من هنا هو نصُّ الأرقام المحسوبة لا مدخلاتها.
 *
 * الحساب مشتقٌّ وقت كل قراءة من `order_items` الحالية، فتعديل المدير
 * للكميات أو الأثمنة ينعكس فوراً بلا كتابة ولا عمود محفوظ ولا مزامنة.
 *
 * ولا شيء هنا يدخل صفحة التقارير: هذه متابعةٌ لطلبٍ واحد، وتلك محاسبةُ
 * الطلبات المسلَّمة وحدها.
 */

/** «غير معروف» ليست صفراً — نكتبها بالحرف بدل رقمٍ لا سند له. */
function Unknown({ hint }: { hint: string }) {
  return (
    <span className="text-xs font-semibold text-amber-700">
      غير معروف <span className="font-normal text-neutral-500">— {hint}</span>
    </span>
  );
}

export function OrderProfitPanel({
  status,
  lines,
  deliveryFee,
  actualDeliveryCost,
}: {
  status: string;
  lines: OrderProfitLine[];
  deliveryFee: string | number | null;
  actualDeliveryCost: string | number | null;
}) {
  const profit = computeOrderProfit({ status, lines, deliveryFee, actualDeliveryCost });
  const notASale = profit.realization === "not_a_sale";

  // الملغاة والراجعة تُعرَض بأرقامها كاملةً لا مشطوبةً ولا مصفَّرة: الربح
  // الذي كان سيتحقّق معلومةٌ تستحق البقاء. الرمادي والوسم يقولان إنه لم يقع.
  const amountTone = notASale ? "text-neutral-400" : "text-neutral-800";

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">ربح الطلبية</h2>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            profit.realization === "realized"
              ? "bg-brand-turquoise-tint text-brand-turquoise-dark"
              : profit.realization === "expected"
                ? "bg-amber-100 text-amber-800"
                : "bg-neutral-100 text-neutral-500"
          }`}
        >
          {PROFIT_REALIZATION_LABELS[profit.realization]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-neutral-600">مجموع بيع المنتجات</dt>
        <dd className={`text-left tabular-nums ${amountTone}`}>{formatMad(profit.salesMad)}</dd>

        <dt className="text-neutral-600">تكلفة شراء المنتجات</dt>
        <dd className="text-left tabular-nums">
          {profit.cogsMad === null ? (
            <Unknown hint={`${profit.linesWithoutCost} سطراً بلا ثمن شراء`} />
          ) : (
            <span className={amountTone}>{formatMad(profit.cogsMad)}</span>
          )}
        </dd>

        <dt className="border-t border-neutral-200 pt-1.5 font-semibold text-neutral-800">
          الربح الخام
        </dt>
        <dd className="border-t border-neutral-200 pt-1.5 text-left tabular-nums">
          {profit.grossProfitMad === null ? (
            <Unknown hint="التكلفة ناقصة" />
          ) : (
            <span
              className={`text-base font-bold ${
                notASale
                  ? "text-neutral-400"
                  : profit.grossProfitMad < 0
                    ? "text-red-700"
                    : "text-brand-turquoise-dark"
              }`}
            >
              {formatMad(profit.grossProfitMad)}
            </span>
          )}
        </dd>

        <dt className="border-t border-dashed border-neutral-200 pt-1.5 text-neutral-600">
          التوصيل المحصَّل من الزبون
        </dt>
        <dd className="border-t border-dashed border-neutral-200 pt-1.5 text-left tabular-nums text-neutral-500">
          {formatMad(profit.deliveryCollectedMad)}
        </dd>

        <dt className="text-neutral-600">تكلفة التوصيل الفعلية</dt>
        <dd className="text-left tabular-nums">
          {profit.deliveryCostMad === null ? (
            <span className="text-xs font-semibold text-amber-700">
              غير مسجَّلة <span className="font-normal text-neutral-500">— لم تُدخَل بعد</span>
            </span>
          ) : (
            <span className="text-neutral-500">{formatMad(profit.deliveryCostMad)}</span>
          )}
        </dd>

        <dt className="border-t border-neutral-200 pt-1.5 font-semibold text-neutral-800">
          الربح بعد المصاريف المعروفة
        </dt>
        <dd className="border-t border-neutral-200 pt-1.5 text-left tabular-nums">
          {profit.netProfitMad === null ? (
            <Unknown
              hint={
                profit.grossProfitMad === null
                  ? "التكلفة ناقصة"
                  : "تكلفة التوصيل غير مسجَّلة"
              }
            />
          ) : (
            <span
              className={`text-base font-bold ${
                notASale
                  ? "text-neutral-400"
                  : profit.netProfitMad < 0
                    ? "text-red-700"
                    : "text-brand-turquoise-dark"
              }`}
            >
              {formatMad(profit.netProfitMad)}
            </span>
          )}
        </dd>
      </dl>

      <div className="mt-3 flex flex-col gap-1 border-t border-neutral-200 pt-2 text-[11px] leading-relaxed">
        {notASale && (
          <p className="font-semibold text-neutral-600">
            هذا الطلب {status === "cancelled" ? "ملغى" : "راجع"} — الأرقام أعلاه هي الربح الذي
            كان سيتحقّق، ولا تُحتسَب بيعاً في التقارير.
          </p>
        )}
        {profit.realization === "expected" && (
          <p className="text-neutral-500">
            ربحٌ متوقَّع لا محقَّق: لا يدخل التقارير حتى يُسلَّم الطلب.
          </p>
        )}
        {profit.excludedLines > 0 && (
          <p className="text-amber-700">
            {profit.excludedLines} من السطور غير محجوزة ({formatMad(profit.excludedSalesMad)})
            ومستثناة من البيع أعلاه — لم تُخصَم من المخزون ولن تخرج من المحل.
          </p>
        )}
        {profit.isEstimate && (
          <p className="text-amber-700">
            تقديري: {profit.linesEstimated} من السطور بلا ثمن شراء محفوظ وقت الطلب، فاستُعمل ثمن
            الشراء الحالي — وقد يكون تغيّر منذ ذلك الحين.
          </p>
        )}
        {profit.linesWithoutCost > 0 && (
          <p className="font-semibold text-amber-800">
            {profit.linesWithoutCost} من السطور بلا أي ثمن شراء معروف — لا نفترض صفراً، فالربح
            يبقى غير معروف حتى يُسجَّل الثمن.
          </p>
        )}
        {profit.deliveryCostMad === null && (
          <p className="text-neutral-500">
            سجّل تكلفة التوصيل الفعلية أسفل قسم المنتجات ليكتمل الربح بعد المصاريف.
          </p>
        )}
        <p className="text-neutral-400">
          للمتابعة الداخلية فقط. التقارير تحسب الطلبات المسلَّمة وحدها، وهذا الرقم لا يُضاف إليها.
        </p>
      </div>
    </div>
  );
}
