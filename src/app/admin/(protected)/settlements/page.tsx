import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import { computeOrderProfit } from "@/lib/orders/orderProfit";
import type { OrderVerdict } from "@/lib/settlements/matching";
import { computeBoard, listInvoices, loadProfitLines } from "@/lib/settlements/settlementStore";
import { ApplyButton, SelectAll } from "@/components/admin/settlements/SelectionControls";
import { SafeActionForm } from "@/components/admin/settlements/SafeActionForm";
import { UploadInvoiceForm } from "@/components/admin/settlements/UploadInvoiceForm";
import { applySettlementsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "تسويات التوصيل" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const mad = (cents: number) => formatMad(cents / 100);

function ConfidenceBadge({ v }: { v: OrderVerdict }) {
  return v.confidence === "high" ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
      ثقة عالية
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      ثقة متوسطة
    </span>
  );
}

function OrderLine({
  v,
  profit,
  input,
}: {
  v: OrderVerdict;
  profit: number | null;
  input?: { name: string; checked: boolean };
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/admin/orders/${v.order.id}`}
          className="font-bold text-brand-turquoise-dark underline-offset-2 hover:underline"
        >
          {v.order.orderNumber}
        </Link>
        {(v.kind === "ready" || v.kind === "decide") && <ConfidenceBadge v={v} />}
      </div>
      <p className="mt-1 text-xs text-neutral-600">
        {v.parcels.length} كرطونة · محصَّل {mad(v.codCents)}
        {v.order.finalTotalCents !== null && v.codCents !== v.order.finalTotalCents && (
          <> من {mad(v.order.finalTotalCents)}</>
        )}
      </p>
      <p className="text-xs text-neutral-600">
        التوصيل: <span className="font-semibold tabular-nums">{mad(v.feeCents)}</span>
        {v.order.deliveryFeeCents !== null && (
          <span className="text-neutral-400"> (الزبون خلّص {mad(v.order.deliveryFeeCents)})</span>
        )}
      </p>
      {profit !== null && (
        <p className="text-xs">
          الربح بعد التوصيل:{" "}
          <span className={`font-bold tabular-nums ${profit < 0 ? "text-red-700" : "text-brand-turquoise-dark"}`}>
            {formatMad(profit)}
          </span>
        </p>
      )}
      {v.reasons.length > 0 && (
        <ul className="mt-1 list-disc ps-4 text-xs text-amber-800">
          {v.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {(v.kind === "ready" || v.kind === "decide") && v.confidenceNotes.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-800">{v.confidenceNotes.join(" ")}</p>
      )}
      {(v.kind === "ready" || v.kind === "decide") && (
        <details className="mt-1 text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none">علاش تطابقات؟</summary>
          <ul className="mt-1 list-disc ps-4">
            {v.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {v.parcels.some((p) => p.invoiceId !== v.parcels[0].invoiceId) && (
        <p className="mt-1 text-[11px] text-neutral-500">
          كرطونات من {new Set(v.parcels.map((p) => p.invoiceNumber)).size} فواتير.
        </p>
      )}
    </div>
  );
  if (!input) return <li className="flex gap-3 border-t border-neutral-100 py-3 first:border-t-0">{body}</li>;
  return (
    <li className="border-t border-neutral-100 first:border-t-0">
      <label className="flex cursor-pointer gap-3 py-3">
        <input
          type="checkbox"
          name={input.name}
          value={v.order.id}
          defaultChecked={input.checked}
          className="mt-1 h-5 w-5 shrink-0 accent-brand-turquoise"
        />
        {body}
      </label>
    </li>
  );
}

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const sp = await searchParams;
  const [board, invoices] = await Promise.all([computeBoard(), listInvoices()]);

  const ready = board.orders.filter((v) => v.kind === "ready");
  const decide = board.orders.filter((v) => v.kind === "decide");
  const waiting = board.orders.filter((v) => v.kind === "waiting");
  const blocked = board.orders.filter((v) => v.kind === "blocked");

  const profitLines = await loadProfitLines([...ready, ...decide].map((v) => v.order.id));
  const profitOf = (v: OrderVerdict): number | null => {
    const lines = profitLines.get(v.order.id) ?? [];
    const p = computeOrderProfit({
      status: "delivered",
      lines: lines.map((l) => ({
        quantity: l.quantity,
        unitPrice: l.unit_price_snapshot,
        purchasePriceSnapshot: l.purchase_price_snapshot,
        currentPurchasePrice: l.current_purchase_price,
        lineStatus: l.line_status,
      })),
      deliveryFee: v.order.deliveryFeeCents === null ? null : v.order.deliveryFeeCents / 100,
      actualDeliveryCost: v.feeCents / 100,
    });
    return p.netProfitMad;
  };

  const readyProfit = ready.map(profitOf);
  const readyHigh = ready.filter((v) => v.confidence === "high").length;
  const readyProfitKnown = readyProfit.every((p) => p !== null);
  const readyTotals = {
    cod: ready.reduce((s, v) => s + v.codCents, 0),
    fee: ready.reduce((s, v) => s + v.feeCents, 0),
    profit: readyProfit.reduce<number>((s, p) => s + (p ?? 0), 0),
  };

  const error = one(sp.error);
  const problems = one(sp.problems);
  const applied = one(sp.applied);
  const uploaded = one(sp.uploaded);

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <h1 className="text-xl font-bold text-neutral-800">تسويات التوصيل</h1>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        ارفع فاتورة BigDelivery النهائية (PDF من «Factures»)، راجع الملخص، واضغط «طبّق». الطلبيات
        المكتملة كتولي «مسلّمة» وكتتسجل تكلفة التوصيل الحقيقية. ما كيتصيفط والو لـMeta، والمخزون
        والأثمنة ما كيتبدلوش.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">{error}</p>
          {problems && (
            <ul className="mt-1 list-disc ps-5 text-xs">
              {problems.split("\n").map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {uploaded && !error && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {one(sp.kind) === "reactivated" ? "الفاتورة رجعات محسوبة من جديد." : "الفاتورة تسجلات ومجاميعها مضبوطة."}{" "}
          {one(sp.dup) && one(sp.dup) !== "0" && <>({one(sp.dup)} كرطونة كانت محسوبة من قبل وما تعاودتش.) </>}
          ما تبدلت حتى طلبية — راجع الملخص لتحت.
          {problems && (
            <ul className="mt-1 list-disc ps-5 text-xs text-amber-800">
              {problems.split("\n").map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {one(sp.notice) === "already" && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          هاد الفاتورة سبق رفعها — ما تحسباتش جوج مرات.{" "}
          <Link href={`/admin/settlements/${one(sp.invoice)}`} className="font-semibold underline">
            شوفها
          </Link>
        </div>
      )}
      {one(sp.notice) === "none" && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          ما اخترتي حتى طلبية.
        </div>
      )}
      {applied && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          تطبّقات على {applied} طلبية.
          {one(sp.skipped) && one(sp.skipped) !== "0" && (
            <> {one(sp.skipped)} ما تطبقاتش حيت تبدلات حالتها من بعد العرض.</>
          )}
        </div>
      )}

      <UploadInvoiceForm />

      <SafeActionForm action={applySettlementsAction} className="mt-4">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-base font-bold text-neutral-800">
            جاهزة للتطبيق <span className="text-neutral-400">({ready.length})</span>
          </h2>
          {ready.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">ما كاين حتى طلبية مكتملة دابا.</p>
          ) : (
            <>
              <dl className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-neutral-50 p-2 text-center text-xs">
                <div>
                  <dt className="text-neutral-500">المحصَّل</dt>
                  <dd className="font-bold tabular-nums">{mad(readyTotals.cod)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">التوصيل</dt>
                  <dd className="font-bold tabular-nums">{mad(readyTotals.fee)}</dd>
                </div>
                <div>
                  <dt className="text-neutral-500">الربح بعد التوصيل</dt>
                  <dd className="font-bold tabular-nums text-brand-turquoise-dark">
                    {formatMad(readyTotals.profit)}
                    {!readyProfitKnown && "*"}
                  </dd>
                </div>
              </dl>
              {!readyProfitKnown && (
                <p className="mt-1 text-[11px] text-amber-700">* بعض الطلبيات ناقصها ثمن الشراء، ما دخلاتش فالمجموع.</p>
              )}
              <p className="mt-2 text-xs text-neutral-600">
                {readyHigh} بثقة عالية (معلَّمة) · {ready.length - readyHigh} بثقة متوسطة (ما معلَّماش — راجعها
                واختارها).
              </p>
              <div className="mt-2">
                <SelectAll name="ready" label={`اختار جميع الجاهزة (${ready.length})`} />
              </div>
              <ul className="mt-2">
                {ready.map((v, i) => (
                  <OrderLine key={v.order.id} v={v} profit={readyProfit[i]} input={{ name: "ready", checked: v.preselect }} />
                ))}
              </ul>
            </>
          )}
        </section>

        {decide.length > 0 && (
          <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <h2 className="text-base font-bold text-neutral-800">
              تحتاج قرارك <span className="text-neutral-400">({decide.length})</span>
            </h2>
            <p className="mt-1 text-xs text-neutral-600">
              الأرقام متطابقة ولكن كاين شي حاجة خاصك تشوفها. ما كتطبقش إلا إلا علّمتي عليها.
            </p>
            <ul className="mt-2">
              {decide.map((v) => (
                <OrderLine key={v.order.id} v={v} profit={profitOf(v)} input={{ name: "approve", checked: false }} />
              ))}
            </ul>
          </section>
        )}

        {(ready.length > 0 || decide.length > 0) && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
            <ApplyButton />
          </div>
        )}
      </SafeActionForm>

      {waiting.length > 0 && (
        <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" open={waiting.length <= 5}>
          <summary className="cursor-pointer text-base font-bold text-neutral-800">
            كتسنى كرطونات أخرى <span className="text-neutral-400">({waiting.length})</span>
          </summary>
          <ul className="mt-2">
            {waiting.map((v) => (
              <OrderLine key={v.order.id} v={v} profit={null} />
            ))}
          </ul>
        </details>
      )}

      {blocked.length > 0 && (
        <section className="mt-4 rounded-xl border border-red-200 bg-white p-4">
          <h2 className="text-base font-bold text-neutral-800">
            خاصها تصحيح بيدك <span className="text-neutral-400">({blocked.length})</span>
          </h2>
          <p className="mt-1 text-xs text-neutral-600">ما كتطبقش من هنا. افتح الطلبية وصحّحها.</p>
          <ul className="mt-2">
            {blocked.map((v) => (
              <OrderLine key={v.order.id} v={v} profit={null} />
            ))}
          </ul>
        </section>
      )}

      {board.parcelGroups.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-base font-bold text-neutral-800">
            كرطونات بلا طلبية مؤكدة{" "}
            <span className="text-neutral-400">({board.parcelGroups.reduce((s, g) => s + g.parcels.length, 0)})</span>
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {board.parcelGroups.map((g) => (
              <li key={g.parcels.map((p) => p.id).join("-")} className="py-3 text-xs">
                <p className="font-semibold text-neutral-700">{g.reason}</p>
                {g.parcels.map((p) => (
                  <p key={p.id} className="mt-1 text-neutral-600">
                    {p.trackingCode} · {p.city ?? "—"} · {mad(p.codCents)} · هاتف …{p.phoneKey?.slice(-4)} ·{" "}
                    {p.invoiceNumber}
                  </p>
                ))}
                {g.candidates.length > 0 && (
                  <p className="mt-1">
                    {g.candidates.map((c) => (
                      <Link key={c.id} href={`/admin/orders/${c.id}`} className="me-2 font-semibold text-brand-turquoise-dark underline">
                        {c.orderNumber}
                      </Link>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-base font-bold text-neutral-800">الفواتير</h2>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">مازال ما رفعتي حتى فاتورة.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/admin/settlements/${inv.id}`}
                  className={`block rounded-xl border p-3 ${
                    inv.status === "rolled_back" ? "border-neutral-200 bg-neutral-50 opacity-70" : "border-neutral-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-neutral-800" dir="ltr">
                      {inv.invoiceNumber}
                    </span>
                    {inv.status === "rolled_back" ? (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                        متراجَع عنها
                      </span>
                    ) : inv.bankReceivedAt ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
                        الفلوس وصلات
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        الفلوس ما وصلاتش
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-neutral-600">
                    {inv.carrierLabel} · {inv.invoiceDate ?? "—"} · {inv.parcelCount} كرطونة ({inv.settledParcels} مسوّاة) ·
                    الصافي <span className="font-semibold tabular-nums">{formatMad(inv.totalNet)}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
