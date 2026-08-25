"use client";

import { useState, useTransition } from "react";
import { formatMad } from "@/lib/format";
import { searchProductsAction } from "@/app/admin/(protected)/orders/actions";
import type { ProductSearchResult } from "@/lib/queries/adminProductSearch";

/**
 * محرّر سطور الطلب — مشترك بين إنشاء طلب يدوي وتعديل طلب قائم، لأن العمل
 * واحد: ابحث عن منتج، اختره، حدّد كمية وثمناً، وشاهد المجموع يتحدّث.
 *
 * الثمن يُملأ تلقائياً من المنتج ويبقى قابلاً للتعديل: طلبات واتساب تُبرَم
 * بالكلام، وتسجيل ما اتُّفق عليه فعلاً أصدق من فرض قائمة الأسعار.
 *
 * الأرقام هنا **للمعاينة وحدها**. الخادم يُعيد قراءة كل شيء من قاعدة
 * البيانات عند الحفظ ولا يثق بأي رقم قادم من هذا النموذج — ثمن الشراء
 * خصوصاً يُقرأ هناك، فما يُعرض أدناه تقدير يساعد على القرار لا مصدر حساب.
 */

export type EditableLine = {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  /** null = لا ثمن شراء مسجَّل، فالربح غير معروف لهذا السطر. */
  purchasePrice: number | null;
  stockQuantity: number;
  /** الكمية المحجوزة أصلاً لهذا السطر في الطلب (0 لسطر جديد). */
  reservedQuantity: number;
};

function Money({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <span className={`tabular-nums ${muted ? "text-neutral-500" : "font-semibold text-neutral-800"}`}>
      {formatMad(value)}
    </span>
  );
}

export function OrderLinesEditor({
  initialLines,
  initialDeliveryFee,
  disabled = false,
  // صفحة تفاصيل الطلب تحمل أصلاً نموذجاً مستقلاً للتوصيل وحده. تسمية
  // مختلفة هنا تمنع أن يبدو الحقلان نفس الشيء مرتين على الشاشة نفسها.
  deliveryFeeLabel = "مصاريف التوصيل",
}: {
  initialLines: EditableLine[];
  initialDeliveryFee: number;
  disabled?: boolean;
  deliveryFeeLabel?: string;
}) {
  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const [deliveryFee, setDeliveryFee] = useState(initialDeliveryFee);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, startSearch] = useTransition();

  function runSearch(value: string) {
    setTerm(value);
    setSearchError(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const response = await searchProductsAction(value);
      if (response.ok) setResults(response.results);
      else {
        setResults([]);
        setSearchError(response.error);
      }
    });
  }

  function addProduct(product: ProductSearchResult) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity: Math.max(1, product.minOrderQty),
          unitPrice: product.salePriceMad,
          purchasePrice: product.purchasePriceMad,
          stockQuantity: product.stockQuantity,
          reservedQuantity: 0,
        },
      ];
    });
    setTerm("");
    setResults([]);
  }

  const patch = (productId: number, changes: Partial<EditableLine>) =>
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, ...changes } : line))
    );

  const remove = (productId: number) =>
    setLines((current) => current.filter((line) => line.productId !== productId));

  const itemsSubtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const knownCost = lines.reduce(
    (sum, line) => sum + (line.purchasePrice ?? 0) * line.quantity,
    0
  );
  const linesMissingCost = lines.filter((line) => line.purchasePrice === null);
  // البيع تحت التكلفة: نحسبه هنا للعرض، والخادم يفحصه من جديد ويرفض بدون
  // الإقرار مهما فعل المتصفح (lib/orders/belowCost.ts).
  const belowCost = lines
    .filter((line) => line.purchasePrice !== null && line.unitPrice < line.purchasePrice)
    .map((line) => ({
      ...line,
      lossPerUnit: (line.purchasePrice ?? 0) - line.unitPrice,
      lossTotal: ((line.purchasePrice ?? 0) - line.unitPrice) * line.quantity,
    }));
  const finalTotal = itemsSubtotal + deliveryFee;
  const grossProfit = itemsSubtotal - knownCost;

  return (
    <div className="flex flex-col gap-3">
      {/* البحث */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-neutral-700">
          ابحث عن منتج بالاسم أو الـSKU
        </label>
        <input
          type="search"
          value={term}
          disabled={disabled}
          onChange={(event) => runSearch(event.target.value)}
          placeholder="مثال: ضاغط، أو TF-RF-006"
          className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm disabled:bg-neutral-100"
        />
        {isSearching && <p className="mt-1 text-[11px] text-neutral-500">جارٍ البحث…</p>}
        {searchError && <p className="mt-1 text-[11px] text-red-600">{searchError}</p>}
        {results.length > 0 && (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
            {results.map((product) => (
              <li key={product.id} className="border-b border-neutral-100 last:border-0">
                <button
                  type="button"
                  onClick={() => addProduct(product)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-right hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-800">
                      {product.name}
                    </span>
                    <span className="block text-[11px] text-neutral-500" dir="ltr">
                      {product.sku}
                    </span>
                  </span>
                  <span className="shrink-0 text-left">
                    <span className="block text-sm font-semibold text-brand-orange">
                      {formatMad(product.salePriceMad)}
                    </span>
                    <span
                      className={`block text-[11px] ${
                        product.stockQuantity > 0 ? "text-neutral-500" : "text-red-600"
                      }`}
                    >
                      المخزون {product.stockQuantity}
                      {product.isOutOfStock ? " · موقوف على الموقع" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* السطور */}
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500">
          لم تُضف أي منتج بعد.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line) => {
            // المتاح لهذا السطر = المخزون الحالي + ما يحجزه الطلب أصلاً،
            // لأن تخفيض الكمية يُرجع الفرق قبل أن يُحجز الجديد.
            const available = line.stockQuantity + line.reservedQuantity;
            const overStock = line.quantity > available;
            return (
              <li key={line.productId} className="rounded-lg border border-neutral-200 bg-white p-3">
                <input type="hidden" name="productId" value={line.productId} />
                <input type="hidden" name="quantity" value={line.quantity} />
                <input type="hidden" name="unitPrice" value={line.unitPrice} />

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800">{line.name}</p>
                    <p className="text-[11px] text-neutral-500" dir="ltr">
                      {line.sku}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => remove(line.productId)}
                    className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    حذف
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="text-[11px] text-neutral-600">
                    <span className="mb-1 block">الكمية</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      disabled={disabled}
                      onChange={(event) =>
                        patch(line.productId, {
                          quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)),
                        })
                      }
                      className={`min-h-10 w-full rounded-lg border px-2 text-sm tabular-nums ${
                        overStock ? "border-red-400 bg-red-50" : "border-neutral-300"
                      }`}
                    />
                  </label>
                  <label className="text-[11px] text-neutral-600">
                    <span className="mb-1 block">ثمن البيع</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      disabled={disabled}
                      onChange={(event) =>
                        patch(line.productId, { unitPrice: Math.max(0, Number(event.target.value) || 0) })
                      }
                      className="min-h-10 w-full rounded-lg border border-neutral-300 px-2 text-sm tabular-nums"
                    />
                  </label>
                  <div className="text-[11px] text-neutral-600">
                    <span className="mb-1 block">المجموع</span>
                    <p className="min-h-10 pt-2">
                      <Money value={line.unitPrice * line.quantity} />
                    </p>
                  </div>
                  <div className="text-[11px] text-neutral-600">
                    <span className="mb-1 block">المتاح</span>
                    <p className={`min-h-10 pt-2 tabular-nums ${overStock ? "font-semibold text-red-600" : "text-neutral-500"}`}>
                      {available}
                    </p>
                  </div>
                </div>

                {overStock && (
                  <p className="mt-1 text-[11px] font-semibold text-red-600">
                    الكمية تتجاوز المتاح — سيُحفظ السطر بحالة «غير متوفر» بلا حجز مخزون،
                    وينتقل الطلب إلى «يحتاج مراجعة». باقي السطور تُحفظ عادياً.
                  </p>
                )}
                {line.purchasePrice !== null && line.unitPrice < line.purchasePrice && (
                  <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">
                    ثمن البيع أقل من ثمن الشراء: ستخسر{" "}
                    {formatMad(line.purchasePrice - line.unitPrice)} في القطعة الواحدة
                    {line.quantity > 1 && <> و{formatMad((line.purchasePrice - line.unitPrice) * line.quantity)} في هذا السطر</>}.
                  </p>
                )}
                {line.purchasePrice === null && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    لا ثمن شراء مسجَّل لهذا المنتج — ربح هذا السطر غير معروف.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* التوصيل والمجاميع */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        <label className="text-[11px] text-neutral-600">
          <span className="mb-1 block font-semibold">{deliveryFeeLabel}</span>
          <input
            type="number"
            name="deliveryFee"
            min={0}
            step="0.01"
            value={deliveryFee}
            disabled={disabled}
            onChange={(event) => setDeliveryFee(Math.max(0, Number(event.target.value) || 0))}
            className="min-h-10 w-32 rounded-lg border border-neutral-300 px-2 text-sm tabular-nums"
          />
        </label>

        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-neutral-600">مجموع السلع</dt>
          <dd className="text-left">
            <Money value={itemsSubtotal} />
          </dd>
          <dt className="text-neutral-600">التوصيل</dt>
          <dd className="text-left">
            <Money value={deliveryFee} muted />
          </dd>
          <dt className="font-semibold text-neutral-800">المجموع النهائي</dt>
          <dd className="text-left text-base font-bold tabular-nums text-brand-orange">
            {formatMad(finalTotal)}
          </dd>
          <dt className="border-t border-neutral-200 pt-1 text-neutral-600">تكلفة شراء السلع</dt>
          <dd className="border-t border-neutral-200 pt-1 text-left">
            <Money value={knownCost} muted />
          </dd>
          <dt className="text-neutral-600">الربح الخام (بلا توصيل)</dt>
          <dd className="text-left">
            <span className="tabular-nums font-bold text-brand-turquoise-dark">
              {formatMad(grossProfit)}
            </span>
          </dd>
        </dl>

        {belowCost.length > 0 && (
          <div className="mt-3 rounded-lg border-2 border-red-400 bg-red-50 p-3">
            <p className="text-sm font-bold text-red-700">
              {belowCost.length === 1 ? "منتج يُباع" : `${belowCost.length} منتجات تُباع`} تحت ثمن
              الشراء — مجموع الخسارة {formatMad(belowCost.reduce((sum, l) => sum + l.lossTotal, 0))}
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-700">
              {belowCost.map((line) => (
                <li key={line.productId}>
                  <span className="font-semibold">{line.name}</span>: بيع{" "}
                  {formatMad(line.unitPrice)} · شراء {formatMad(line.purchasePrice ?? 0)} — ستخسر{" "}
                  {formatMad(line.lossPerUnit)} في القطعة
                  {line.quantity > 1 && <> ({formatMad(line.lossTotal)} في السطر)</>}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-start gap-2 rounded-md bg-white p-2 text-xs font-semibold text-red-800">
              <input
                type="checkbox"
                name="acknowledgeBelowCost"
                disabled={disabled}
                className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
              />
              <span>أفهم أن هذا يُباع تحت التكلفة وأريد المتابعة</span>
            </label>
            <p className="mt-1 text-[11px] text-red-700">
              بدون هذا التأكيد لن يُحفظ الطلب ولن يتغيّر أي مخزون.
            </p>
          </div>
        )}

        {linesMissingCost.length > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
            {linesMissingCost.length} من السطور بلا ثمن شراء مسجَّل، فالتكلفة أعلاه ناقصة والربح
            الظاهر أكبر من الحقيقي. لا نُخمّن ثمناً غير موجود.
          </p>
        )}
        <p className="mt-1 text-[11px] text-neutral-500">
          التوصيل هنا ما يدفعه الزبون، لا ما يكلّفنا — لذلك لا يدخل الربح.
        </p>
      </div>
    </div>
  );
}
