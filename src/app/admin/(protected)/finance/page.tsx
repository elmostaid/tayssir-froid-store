import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import { getFinanceSummary, resolvePeriod, shiftPeriodKey } from "@/lib/settlements/financeSummary";

export const dynamic = "force-dynamic";
export const metadata = { title: "الوضع المالي" };

/**
 * الوضع المالي الحقيقي — صاحب الحساب وحده. كل رقم هنا من فاتورة شركة توصيل،
 * أو من مبلغ أدخله المالك من البنك، أو من مصروف سجّله. لا تقدير يدخل الربح:
 * ما لا نعرفه بالضبط يُعَدّ ويُعرَض على حدة. التفاصيل في financeSummary.ts.
 */

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const mad = (cents: number) => formatMad(cents / 100);

function Tile({ label, value, tone, note }: { label: string; value: string; tone?: "good" | "bad" | "wait"; note?: string }) {
  const color =
    tone === "good" ? "text-green-800" : tone === "bad" ? "text-red-700" : tone === "wait" ? "text-amber-800" : "text-neutral-800";
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${color}`}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{note}</p>}
    </div>
  );
}

function Row({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "border-t border-neutral-200 pt-2 font-bold" : ""}`}>
      <dt className="text-sm text-neutral-700">{label}</dt>
      <dd className={`text-sm tabular-nums ${value < 0 || (minus && value > 0) ? "text-red-700" : ""}`}>
        {minus && value > 0 ? `− ${mad(value)}` : mad(value)}
      </dd>
    </div>
  );
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const sp = await searchParams;
  const period = resolvePeriod(one(sp.m));
  const f = await getFinanceSummary(period);
  const { cash, realized, returns, expenses } = f;
  const monthly = period.key !== "all";

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <h1 className="text-xl font-bold text-neutral-800">الوضع المالي</h1>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        غير الأرقام الحقيقية: فواتير شركات التوصيل، الفلوس اللي سجلتي وصولها للبنك، والمصاريف اللي سجلتي.
        أي طلبية ناقصها رقم حقيقي ما كتدخلش فالربح — كتبان بوحدها لتحت.
      </p>

      <nav className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white p-2 text-sm">
        {monthly ? (
          <Link href={`/admin/finance?m=${shiftPeriodKey(period.key, -1)}`} className="min-h-11 px-3 py-2.5 font-semibold text-brand-turquoise-dark">
            → الشهر اللي فات
          </Link>
        ) : (
          <span />
        )}
        <span className="font-bold text-neutral-800">{period.label}</span>
        {monthly ? (
          <Link href={`/admin/finance?m=${shiftPeriodKey(period.key, 1)}`} className="min-h-11 px-3 py-2.5 font-semibold text-brand-turquoise-dark">
            الشهر الجاي ←
          </Link>
        ) : (
          <Link href="/admin/finance" className="min-h-11 px-3 py-2.5 font-semibold text-brand-turquoise-dark">
            هاد الشهر
          </Link>
        )}
      </nav>
      {monthly && (
        <p className="mt-1 text-center text-xs">
          <Link href="/admin/finance?m=all" className="text-neutral-500 underline">
            شوف منذ البداية
          </Link>
        </p>
      )}

      {/* ── الفلوس ── */}
      <section className="mt-4">
        <h2 className="text-base font-bold text-neutral-800">الفلوس</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Tile
            label={monthly ? "وصلات للبنك هاد الشهر" : "وصلات للبنك"}
            value={mad(cash.bankReceivedCents)}
            tone="good"
            note={`${cash.bankReceivedInvoices} فاتورة`}
          />
          <Tile
            label="مازال عند شركات التوصيل"
            value={mad(cash.owedCents)}
            tone="wait"
            note={`${cash.owedInvoices.length} فاتورة ما وصلاتش فلوسها (رصيد اليوم)`}
          />
        </div>

        {cash.owedInvoices.length > 0 && (
          <details className="mt-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-neutral-700">الفواتير اللي مازال ما خلصاتش</summary>
            <ul className="mt-2 divide-y divide-neutral-100">
              {cash.owedInvoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/admin/settlements/${i.id}`} className="font-semibold text-brand-turquoise-dark underline" dir="ltr">
                    {i.carrierLabel} {i.number}
                  </Link>
                  <span className="text-xs text-neutral-500">{i.date ?? "—"}</span>
                  <span className="font-bold tabular-nums">{mad(i.netCents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {cash.bankDifferences.length > 0 && (
          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p className="font-semibold">فرق بين صافي الفاتورة واللي وصل للبنك:</p>
            <ul className="mt-1 space-y-1">
              {cash.bankDifferences.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/settlements/${d.id}`} className="underline" dir="ltr">
                    {d.number}
                  </Link>{" "}
                  — الصافي {mad(d.netCents)}، وصل {mad(d.receivedCents)} (فرق {mad(d.netCents - d.receivedCents)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-2 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-600">
          <p className="font-semibold text-neutral-700">
            {cash.shippedNoInvoice.count} طلبية مُرسَلة بلا فاتورة توصيل بعد · {mad(cash.shippedNoInvoice.expectedCents)} متوقَّعة
          </p>
          <p className="mt-0.5">
            هادي ماشي فلوس مؤكدة: ممكن ترجع. كتولي حقيقية غير ملي توصل فاتورتها.
            {cash.shippedNoInvoice.oldestOrderDay && <> أقدم وحدة من {cash.shippedNoInvoice.oldestOrderDay}.</>}
          </p>
        </div>
      </section>

      {/* ── الربح ── */}
      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-base font-bold text-neutral-800">الربح الحقيقي {monthly ? `— ${period.label}` : ""}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {realized.orders.length} طلبية مسلّمة بفاتورة{monthly ? " (بتاريخ الفاتورة)" : ""}.
        </p>
        <dl className="mt-3">
          <Row label="المبيعات (السلعة)" value={realized.salesCents} />
          <Row label="ثمن شراء السلعة" value={realized.cogsCents} minus />
          <Row label="التوصيل اللي خلّصو الزبناء" value={realized.deliveryChargedCents} />
          <Row label="التوصيل الحقيقي (من الفواتير)" value={realized.deliveryRealCents} minus />
          <Row label="ربح الطلبيات" value={realized.profitCents} strong />
          <div className="mb-1 rounded-lg bg-neutral-50 px-2 text-xs">
            <div className="flex justify-between py-1 text-green-800">
              <span>منها فلوسها وصلات للبنك</span>
              <span className="tabular-nums">{mad(realized.bankedProfitCents)}</span>
            </div>
            <div className="flex justify-between py-1 text-amber-800">
              <span>منها فلوسها مازال عند شركة التوصيل</span>
              <span className="tabular-nums">{mad(realized.pendingProfitCents)}</span>
            </div>
          </div>
          <Row label={`خسائر الرجعات (${returns.items.length})`} value={returns.lossCents} minus />
          <Row label="الإشهار المسجَّل" value={expenses.advertisingCents} minus />
          <Row label="مصاريف أخرى مسجلة" value={expenses.totalCents - expenses.advertisingCents} minus />
        </dl>
        {/* بلا مصروف إشهار مسجَّل، الصافي أكبر من الحقيقة: ما يبانش «مؤكَّد» بالأخضر. */}
        <div
          className={`mt-3 rounded-xl p-3 text-center ${
            f.netCents < 0
              ? "bg-red-50 text-red-800"
              : expenses.advertisingCents === 0
                ? "border border-amber-300 bg-amber-50 text-amber-900"
                : "bg-green-50 text-green-900"
          }`}
        >
          <p className="text-xs">
            {expenses.advertisingCents === 0 ? "الربح الصافي — ناقص: الإشهار ما مسجلش" : "الربح الصافي المحقَّق"}
          </p>
          <p className="text-2xl font-bold tabular-nums">{mad(f.netCents)}</p>
          {realized.pendingProfitCents > 0 && (
            <p className="mt-1 text-[11px]">
              منو {mad(realized.pendingProfitCents)} مازال عند شركة التوصيل (ما وصلش للبنك)
            </p>
          )}
        </div>
        {expenses.advertisingCents === 0 && (
          <p className="mt-2 text-xs text-amber-800">
            ما كاين حتى مصروف إشهار مسجَّل {monthly ? "هاد الشهر" : ""} — زيدو من{" "}
            <Link href="/admin/expenses" className="font-semibold underline">
              المصاريف
            </Link>{" "}
            باش يكون الصافي صحيح.
          </p>
        )}
        {expenses.byCategory.length > 0 && (
          <details className="mt-2 text-xs text-neutral-600">
            <summary className="cursor-pointer select-none font-semibold">تفصيل المصاريف</summary>
            <ul className="mt-1 space-y-0.5">
              {expenses.byCategory.map((e) => (
                <li key={e.category} className="flex justify-between">
                  <span>{e.label}</span>
                  <span className="tabular-nums">{mad(e.cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {(realized.excluded.length > 0 || f.deliveredWithoutInvoice > 0) && (
        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-xs text-amber-900">
          <h2 className="text-sm font-bold">ما دخلاتش فالربح</h2>
          {realized.excluded.length > 0 && (
            <ul className="mt-2 space-y-1">
              {realized.excluded.map((e, i) => (
                <li key={`${e.orderId}-${i}`}>
                  {e.orderId > 0 ? (
                    <Link href={`/admin/orders/${e.orderId}`} className="font-semibold underline">
                      {e.orderNumber}
                    </Link>
                  ) : (
                    e.orderNumber
                  )}{" "}
                  — {e.reason}
                </li>
              ))}
            </ul>
          )}
          {f.deliveredWithoutInvoice > 0 && (
            <p className="mt-2">
              {f.deliveredWithoutInvoice} طلبية معلَّمة «مسلَّمة» بلا فاتورة توصيل (كل الأوقات): تكلفة توصيلها ماشي
              من فاتورة، فربحها ما داخلش.
            </p>
          )}
        </section>
      )}

      {returns.items.length > 0 && (
        <section className="mt-4 rounded-xl border border-red-200 bg-white p-4">
          <h2 className="text-base font-bold text-neutral-800">الرجعات</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {returns.items.map((r, i) => (
              <li key={`${r.invoiceNumber}-${r.orderId}-${i}`} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {r.orderId ? (
                    <Link href={`/admin/orders/${r.orderId}`} className="font-semibold text-brand-turquoise-dark underline">
                      {r.orderNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <span className="block text-[11px] text-neutral-500" dir="ltr">
                    {r.invoiceNumber} · {r.invoiceDate}
                  </span>
                  {!r.statusChanged && (
                    <span className="block text-[11px] text-amber-700">الحالة مازال ما تبدلاتش لـ«راجعة»</span>
                  )}
                </span>
                <span className="font-bold tabular-nums text-red-700">− {mad(r.lossCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {realized.orders.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-base font-bold text-neutral-800">ربح كل طلبية</h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {realized.orders.map((o) => (
              <li key={o.orderId} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/orders/${o.orderId}`} className="font-bold text-brand-turquoise-dark underline">
                    {o.orderNumber}
                  </Link>
                  <span className={`font-bold tabular-nums ${o.profitCents < 0 ? "text-red-700" : "text-green-800"}`}>
                    {mad(o.profitCents)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  تحصّل {mad(o.collectedCents)} · السلعة {mad(o.cogsCents)} · توصيل {mad(o.deliveryRealCents)} ·{" "}
                  <span dir="ltr">{o.invoiceNumber}</span>
                </p>
                <p className={`text-[11px] font-semibold ${o.banked ? "text-green-800" : "text-amber-700"}`}>
                  {o.banked ? "الفلوس وصلات للبنك" : "الفلوس مازال عند شركة التوصيل"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
