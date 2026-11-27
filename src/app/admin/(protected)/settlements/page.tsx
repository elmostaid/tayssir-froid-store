import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import { computeOrderProfit } from "@/lib/orders/orderProfit";
import type { OrderVerdict, ParcelGroupVerdict, VerdictIssue } from "@/lib/settlements/matching";
import { computeBoard, isQuickApprovable, listInvoices, loadProfitLines } from "@/lib/settlements/settlementStore";
import { ApplyButton, SelectAll } from "@/components/admin/settlements/SelectionControls";
import { PendingSubmit } from "@/components/admin/settlements/PendingSubmit";
import { SafeActionForm } from "@/components/admin/settlements/SafeActionForm";
import { UploadInvoiceForm } from "@/components/admin/settlements/UploadInvoiceForm";
import {
  acknowledgeWarningsAction,
  addExtraParcelsAction,
  applySettlementsAction,
  linkParcelsAction,
  unlinkParcelsAction,
} from "./actions";

/**
 * تسويات التوصيل — الشاشة المبسّطة (قرار المالك 2026-11-27):
 * ارفع → شوف الملخص → وافق. التفاصيل مخبية حتى تطلبها.
 *
 * ✅ مؤكدة: معلَّمة، بزر واحد.  🟡 موافقة سريعة: تكلفة يدوية/تقريب، بمجموع الفرق.
 * 🔴 خاصها نظرتك: سطر لكل وحدة.  ⏳ كتسنى · ❓ بلا طلبية · الفواتير: مطويين.
 * البنك فشاشة بوحدها (/admin/settlements/bank).
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "تسويات التوصيل" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const mad = (cents: number) => formatMad(cents / 100);
const signedMad = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${mad(Math.abs(cents))}`;

const ISSUE_LABEL: Record<VerdictIssue, string> = {
  rounding: "تقريب",
  manual_cost: "تكلفة يدوية",
  city_differ: "مدينة مختلفة",
  city_unknown: "المدينة ما تقارناتش",
  late: "تسجّلات متأخرة",
  manual_link: "ربط يدوي",
  status_not_shipped: "الحالة ماشي «مُرسَلة»",
  statement_warning: "الكشف كيتسنى موافقتك",
};

function Chip({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "red" | "sky" | "neutral" }) {
  const cls = {
    amber: "bg-amber-100 text-amber-900",
    red: "bg-red-100 text-red-800",
    sky: "bg-sky-100 text-sky-800",
    neutral: "bg-neutral-100 text-neutral-700",
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

/** التفاصيل التقنية (الأسباب، الأدلة، الكرطونات) — مخبية حتى تضغط. */
function Details({ v }: { v: OrderVerdict }) {
  return (
    <details className="mt-1 text-[11px] text-neutral-600">
      <summary className="cursor-pointer select-none text-neutral-500">التفاصيل</summary>
      {v.reasons.length > 0 && (
        <ul className="mt-1 list-disc ps-4 text-amber-900">
          {v.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {v.confidenceNotes.length > 0 && <p className="mt-1 text-amber-800">{v.confidenceNotes.join(" ")}</p>}
      {v.evidence.length > 0 && (
        <ul className="mt-1 list-disc ps-4">
          {v.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <p className="mt-1" dir="ltr">
        {v.parcels.map((p) => `${p.trackingCode} (${p.invoiceNumber})`).join(" · ")}
      </p>
    </details>
  );
}

function Line({
  v,
  profit,
  input,
  extra,
}: {
  v: OrderVerdict;
  profit: number | null;
  input?: { name: string; checked: boolean };
  extra?: React.ReactNode;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/admin/orders/${v.order.id}`} className="font-bold text-brand-turquoise-dark">
          {v.order.orderNumber}
        </Link>
        <span className="text-xs tabular-nums text-neutral-600">
          {mad(v.codCents)} · توصيل {mad(v.feeCents)}
          {profit !== null && (
            <>
              {" "}
              · ربح <span className={profit < 0 ? "text-red-700" : "font-semibold text-brand-turquoise-dark"}>{formatMad(profit)}</span>
            </>
          )}
        </span>
      </div>
      {extra}
      <Details v={v} />
    </div>
  );
  if (!input)
    return <li className="flex scroll-mb-28 gap-3 border-t border-neutral-100 py-2 first:border-t-0">{body}</li>;
  return (
    // scroll-mb: ملي المتصفح كيجيب السطر للشاشة (focus…)، كيوقف فوق زر «طبّق» المثبت ماشي تحتو.
    <li className="scroll-mb-28 border-t border-neutral-100 first:border-t-0">
      <label className="flex cursor-pointer gap-3 py-2">
        <input
          type="checkbox"
          name={input.name}
          value={v.order.id}
          defaultChecked={input.checked}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-turquoise"
        />
        {body}
      </label>
    </li>
  );
}

function Totals({ items }: { items: { label: string; value: string; strong?: boolean }[] }) {
  return (
    <dl className={`mt-2 grid gap-2 rounded-lg bg-white/70 p-2 text-center text-xs`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-neutral-500">{it.label}</dt>
          <dd className={`font-bold tabular-nums ${it.strong ? "text-brand-turquoise-dark" : ""}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const sp = await searchParams;
  // متتابعين (ماشي Promise.all): مجمّع الاتصالات صغير فـPreview/الإنتاج.
  const board = await computeBoard();
  const invoices = await listInvoices(400);

  const ready = board.orders.filter((v) => v.kind === "ready");
  const decide = board.orders.filter((v) => v.kind === "decide");
  const heldByStatement = decide.filter((v) => v.invoiceWarningPending);
  const quick = decide.filter((v) => isQuickApprovable(v));
  const quickCost = quick.filter((v) => v.issues.includes("manual_cost"));
  const quickRound = quick.filter((v) => !v.issues.includes("manual_cost"));
  const review = decide.filter((v) => !v.invoiceWarningPending && !isQuickApprovable(v));
  const returns = board.orders.filter((v) => v.kind === "return");
  const waiting = board.orders.filter((v) => v.kind === "waiting");
  const blocked = board.orders.filter((v) => v.kind === "blocked");
  const extraGroups = board.parcelGroups.filter((g) => g.extraFor);
  const loose = board.parcelGroups.filter((g) => !g.extraFor);

  const profitLines = await loadProfitLines([...ready, ...decide].map((v) => v.order.id));
  // الربح على اللي تحصّل فعلاً (فرق التقريب داخل)، بتكلفة الفاتورة.
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
    return p.netProfitMad === null ? null : p.netProfitMad + v.roundingCents / 100;
  };
  const sum = (list: OrderVerdict[]) => {
    const profits = list.map(profitOf);
    return {
      cod: list.reduce((s, v) => s + v.codCents, 0),
      fee: list.reduce((s, v) => s + v.feeCents, 0),
      profit: profits.reduce<number>((s, p) => s + (p ?? 0), 0),
      profitKnown: profits.every((p) => p !== null),
    };
  };
  const readyT = sum(ready);
  const readyUndocumented = ready.filter((v) => v.confidence !== "high").length;
  const costDiff = quickCost.reduce((s, v) => s + (v.feeCents - (v.order.actualDeliveryCostCents ?? 0)), 0);
  // الزايد والناقص بوحدهم: +1 و−1 ما كيتلاغاوش فالعرض (المجموع 0 كيخبّي الفرق).
  const roundPlus = quickRound.reduce((s, v) => s + Math.max(v.roundingCents, 0), 0);
  const roundMinus = quickRound.reduce((s, v) => s + Math.min(v.roundingCents, 0), 0);

  const pendingStatements = invoices.filter((i) => i.status === "active" && i.warnings.length > 0 && !i.warningsAcknowledgedAt);
  const unbanked = invoices.filter((i) => i.status === "active" && !i.bankReceivedAt && i.totalNet > 0);
  const nothingToApply = ready.length + quick.length + review.length + returns.length === 0;

  const error = one(sp.error);
  const problems = one(sp.problems);
  const applied = one(sp.applied);

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <div className="flex items-start justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-800">تسويات التوصيل</h1>
        <Link
          href="/admin/settlements/bank"
          className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
        >
          💰 البنك{unbanked.length > 0 && ` (${unbanked.length})`}
        </Link>
      </div>
      <p className="mt-1 text-xs text-neutral-500">ارفع الفواتير ← شوف الملخص ← وافق. ما كيتصيفط والو لـMeta.</p>

      {error && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
      {one(sp.uploaded) && !error && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          الفاتورة تسجلات. ما تبدلت حتى طلبية — راجع الملخص لتحت.
        </div>
      )}
      {one(sp.notice) === "already" && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          هاد الفاتورة سبق رفعها — ما تحسباتش جوج مرات.
        </div>
      )}
      {applied !== undefined && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800" data-testid="applied-banner">
          تطبّقات على {applied} طلبية.
          {one(sp.returned) && one(sp.returned) !== "0" && <> {one(sp.returned)} رجعة تسجلات خسارة.</>}
          {one(sp.skipped) && one(sp.skipped) !== "0" && <> {one(sp.skipped)} ما تطبقاتش حيت تبدلات من بعد العرض.</>}
        </div>
      )}
      {one(sp.extra) && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          تزادت تكلفة الكرطونة الزايدة ({mad(Number(one(sp.extraFee) ?? 0))}) على {one(sp.extra)}. المبيعات ما تبدلاتش.
        </div>
      )}
      {one(sp.linked) && !error && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          تربطات بـ{one(sp.linked)} — كتبان فـ«خاصها نظرتك».
        </div>
      )}
      {one(sp.notice) === "none" && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">ما اخترتي والو.</div>
      )}

      {/* كشوفات فيها فرق فالمجاميع: الموافقة هنا مباشرة، والتفاصيل فصفحة الكشف. */}
      {pendingStatements.map((inv) => {
        const held = heldByStatement.filter((v) => v.parcels.some((p) => p.invoiceId === inv.id)).length;
        return (
          <div key={inv.id} className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">
              <span dir="ltr">{inv.carrierLabel} {inv.invoiceNumber}</span>: فرق فالمجاميع
              {held > 0 && <> — {held} طلبية كتسنى</>}
            </p>
            <ul className="mt-1 list-disc ps-5 text-xs">
              {inv.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <SafeActionForm action={acknowledgeWarningsAction} className="mt-2 flex items-center gap-3">
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input type="hidden" name="back" value="list" />
              <PendingSubmit
                className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-bold text-white"
                pendingText="…"
              >
                شفت الفرق، وافق
              </PendingSubmit>
              <Link href={`/admin/settlements/${inv.id}`} className="text-xs font-semibold underline">
                الكشف
              </Link>
            </SafeActionForm>
          </div>
        );
      })}

      <UploadInvoiceForm />

      <SafeActionForm action={applySettlementsAction} className="mt-4 space-y-4">
        {/* ✅ مؤكدة */}
        <section className="rounded-xl border border-green-200 bg-green-50/50 p-4" data-testid="ready-card">
          <h2 className="text-base font-bold text-neutral-800">
            ✅ جاهزة ومؤكدة <span className="text-neutral-500">({ready.length})</span>
          </h2>
          {ready.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-500">ما كاين والو دابا.</p>
          ) : (
            <>
              <Totals
                items={[
                  { label: "المحصَّل", value: mad(readyT.cod) },
                  { label: "التوصيل", value: mad(readyT.fee) },
                  { label: "الربح", value: `${formatMad(readyT.profit)}${readyT.profitKnown ? "" : "*"}`, strong: true },
                ]}
              />
              <p className="mt-1 text-[11px] text-neutral-600">
                الهاتف والمبلغ بالسنتيم والتاريخ والمدينة متطابقين.
                {readyUndocumented > 0 && <> منها {readyUndocumented} عدد الكرطونات ما مسجلش (الاكتمال ما موثقش).</>}
                {!readyT.profitKnown && <> * ثمن الشراء ناقص فشي طلبيات.</>}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-neutral-600">شوف الطلبيات / حيّد شي وحدة</summary>
                <div className="mt-2">
                  <SelectAll name="ready" label={`الكل (${ready.length})`} />
                </div>
                <ul className="mt-1">
                  {ready.map((v) => (
                    <Line key={v.order.id} v={v} profit={profitOf(v)} input={{ name: "ready", checked: v.preselect }} />
                  ))}
                </ul>
              </details>
            </>
          )}
        </section>

        {/* 🟡 موافقة سريعة */}
        {quick.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4" data-testid="quick-card">
            <h2 className="text-base font-bold text-neutral-800">
              🟡 موافقة سريعة <span className="text-neutral-500">({quick.length})</span>
            </h2>
            <p className="mt-1 text-[11px] text-neutral-600">كلشي متطابق، غير فرق صغير. ما معلَّمينش — علّم المجموعة إلا وافقتي.</p>

            {quickCost.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-sm font-semibold text-neutral-800">
                  تكلفة التوصيل اليدوية ← تكلفة الفاتورة ({quickCost.length})
                </p>
                <p className="text-xs text-neutral-600">
                  مجموع الفرق: <span className="font-bold tabular-nums">{signedMad(costDiff)}</span> على التكلفة المسجلة.
                </p>
                <div className="mt-2">
                  <SelectAll name="quick_cost" label={`وافق على ${quickCost.length}`} />
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-neutral-500">الطلبيات</summary>
                  <ul>
                    {quickCost.map((v) => (
                      <Line
                        key={v.order.id}
                        v={v}
                        profit={profitOf(v)}
                        input={{ name: "quick_cost", checked: false }}
                        extra={
                          <p className="text-[11px] text-amber-900">
                            {mad(v.order.actualDeliveryCostCents ?? 0)} ← {mad(v.feeCents)}
                            {v.roundingCents !== 0 && <> · تقريب {signedMad(v.roundingCents)}</>}
                          </p>
                        }
                      />
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {quickRound.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-sm font-semibold text-neutral-800">فرق تقريب صغير ({quickRound.length})</p>
                <p className="text-xs text-neutral-600">
                  {roundPlus > 0 && (
                    <>
                      تحصّل زايد <span className="font-bold tabular-nums">{mad(roundPlus)}</span>
                    </>
                  )}
                  {roundPlus > 0 && roundMinus < 0 && " · "}
                  {roundMinus < 0 && (
                    <>
                      ناقص <span className="font-bold tabular-nums">{mad(-roundMinus)}</span>
                    </>
                  )}{" "}
                  — الربح كيتحسب على اللي تحصّل فعلاً.
                </p>
                <div className="mt-2">
                  <SelectAll name="quick_round" label={`وافق على ${quickRound.length}`} />
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-neutral-500">الطلبيات</summary>
                  <ul>
                    {quickRound.map((v) => (
                      <Line
                        key={v.order.id}
                        v={v}
                        profit={profitOf(v)}
                        input={{ name: "quick_round", checked: false }}
                        extra={<p className="text-[11px] text-amber-900">تقريب {signedMad(v.roundingCents)}</p>}
                      />
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </section>
        )}

        {/* 🔴 خاصها نظرتك */}
        {(review.length > 0 || returns.length > 0) && (
          <section className="rounded-xl border border-red-200 bg-white p-4" data-testid="review-card">
            <h2 className="text-base font-bold text-neutral-800">
              🔴 خاصها نظرتك <span className="text-neutral-500">({review.length + returns.length})</span>
            </h2>
            <p className="mt-1 text-[11px] text-neutral-600">وحدة بوحدة. ما كتطبّق إلا اللي علّمتي عليها.</p>
            <ul className="mt-1">
              {review.map((v) => (
                <Line
                  key={v.order.id}
                  v={v}
                  profit={profitOf(v)}
                  input={{ name: "approve", checked: false }}
                  extra={
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {v.issues.map((i) => (
                        <Chip key={i} tone={i === "manual_link" ? "sky" : "amber"}>
                          {ISSUE_LABEL[i]}
                        </Chip>
                      ))}
                    </p>
                  }
                />
              ))}
              {returns.map((v) => (
                <Line
                  key={v.order.id}
                  v={v}
                  profit={null}
                  input={{ name: "return", checked: false }}
                  extra={
                    <p className="mt-0.5">
                      <Chip tone="red">رجعة: {mad(v.feeCents)} خسارة</Chip>
                    </p>
                  }
                />
              ))}
            </ul>
          </section>
        )}

        {!nothingToApply && (
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
            <ApplyButton />
          </div>
        )}
      </SafeActionForm>

      {/* روابط يدوية: فك الربط خارج نموذج التطبيق (ما كيتداخلوش). */}
      {review.some((v) => v.manual) && (
        <details className="mt-3 rounded-xl border border-sky-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-neutral-700">
            فك ربط يدوي ({review.filter((v) => v.manual).length})
          </summary>
          <ul className="mt-1 divide-y divide-neutral-100">
            {review
              .filter((v) => v.manual)
              .map((v) => (
                <li key={v.order.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-xs">{v.order.orderNumber}</span>
                  <SafeActionForm action={unlinkParcelsAction}>
                    {v.parcels.map((p) => (
                      <input key={p.id} type="hidden" name="parcel" value={p.id} />
                    ))}
                    <button type="submit" className="min-h-11 px-2 text-xs font-semibold text-neutral-600 underline">
                      فك الربط
                    </button>
                  </SafeActionForm>
                </li>
              ))}
          </ul>
        </details>
      )}

      {extraGroups.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" data-testid="extra-card">
          <h2 className="text-base font-bold text-neutral-800">
            ➕ كرطونات زايدة لطلبيات مسوّاة <span className="text-neutral-500">({extraGroups.length})</span>
          </h2>
          <p className="mt-1 text-[11px] text-neutral-600">
            بلا تحصيل، مسلَّمة. كتزيد تكلفتها على نفس الطلبية — المبيعات والربح ما كيتعاودوش.
          </p>
          <ul className="mt-1 divide-y divide-neutral-100">
            {extraGroups.map((g) => (
              <ExtraRow key={g.parcels.map((p) => p.id).join("-")} g={g} />
            ))}
          </ul>
        </section>
      )}

      {(waiting.length > 0 || blocked.length > 0) && (
        <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <summary className="cursor-pointer text-base font-bold text-neutral-800">
            ⏳ كتسنى <span className="text-neutral-500">({waiting.length + blocked.length})</span>
          </summary>
          <p className="mt-1 text-[11px] text-neutral-600">
            ناقصها كرطونة، ولا خاصها تصحيح فصفحة الطلبية. ما كيتطبّق فيها والو.
          </p>
          <ul className="mt-1">
            {[...waiting, ...blocked].map((v) => (
              <Line
                key={v.order.id}
                v={v}
                profit={null}
                extra={<p className="text-[11px] text-amber-900">{v.reasons[0]}</p>}
              />
            ))}
          </ul>
        </details>
      )}

      {loose.length > 0 && (
        <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" data-testid="loose-card">
          <summary className="cursor-pointer text-base font-bold text-neutral-800">
            ❓ كرطونات بلا طلبية <span className="text-neutral-500">({loose.reduce((s, g) => s + g.parcels.length, 0)})</span>
          </summary>
          <p className="mt-1 text-[11px] text-neutral-600">
            الربط ماشي تطبيق: الطلبية كتبان من بعد فـ«خاصها نظرتك» بأدلتها.
          </p>
          <ul className="mt-1 divide-y divide-neutral-100">
            {loose.map((g) => (
              <LooseRow key={g.parcels.map((p) => p.id).join("-")} g={g} />
            ))}
          </ul>
        </details>
      )}

      <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <summary className="cursor-pointer text-base font-bold text-neutral-800">
          الفواتير <span className="text-neutral-500">({invoices.filter((i) => i.status === "active").length})</span>
        </summary>
        {invoices.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">مازال ما رفعتي حتى فاتورة.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/admin/settlements/${inv.id}`}
                  className={`flex items-center justify-between gap-2 py-2 text-xs ${inv.status === "rolled_back" ? "opacity-60" : ""}`}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-neutral-800" dir="ltr">
                      {inv.invoiceNumber}
                    </span>{" "}
                    <span className="text-neutral-500">
                      {inv.carrierLabel} · {inv.invoiceDate ?? "—"} · {inv.settledParcels}/{inv.parcelCount}
                    </span>
                  </span>
                  <span className="shrink-0">
                    {inv.status === "rolled_back" ? (
                      <Chip tone="neutral">متراجَع عنها</Chip>
                    ) : inv.bankReceivedAt ? (
                      <Chip tone="sky">💰 وصلات</Chip>
                    ) : (
                      <span className="tabular-nums text-neutral-600">{formatMad(inv.totalNet)}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function ExtraRow({ g }: { g: ParcelGroupVerdict }) {
  const fee = g.parcels.reduce((s, p) => s + p.feeCents, 0);
  const order = g.extraFor!;
  return (
    <li className="py-2 text-xs">
      <p>
        <Link href={`/admin/orders/${order.id}`} className="font-bold text-brand-turquoise-dark">
          {order.orderNumber}
        </Link>{" "}
        · {g.parcels.length} كرطونة · تكلفة {mad(fee)}
      </p>
      <details className="text-[11px] text-neutral-600">
        <summary className="cursor-pointer text-neutral-500">التفاصيل</summary>
        <p>{g.reason}</p>
        <p dir="ltr">{g.parcels.map((p) => `${p.trackingCode} (${p.invoiceNumber}) ${p.pickupDate ?? ""}`).join(" · ")}</p>
      </details>
      <SafeActionForm action={addExtraParcelsAction} className="mt-1">
        <input type="hidden" name="orderId" value={order.id} />
        {g.parcels.map((p) => (
          <input key={p.id} type="hidden" name="parcel" value={p.id} />
        ))}
        <PendingSubmit
          className="min-h-11 rounded-full border border-brand-turquoise px-4 text-sm font-semibold text-brand-turquoise-dark"
          pendingText="…"
        >
          زيد {mad(fee)} على {order.orderNumber}
        </PendingSubmit>
      </SafeActionForm>
    </li>
  );
}

function LooseRow({ g }: { g: ParcelGroupVerdict }) {
  return (
    <li className="py-2 text-xs">
      <p className="text-neutral-700">
        {g.parcels.length} كرطونة · {mad(g.parcels.reduce((s, p) => s + p.codCents, 0))} · {g.parcels[0].city ?? "—"} · هاتف …
        {g.parcels[0].phoneKey?.slice(-4) ?? "—"}
      </p>
      <details className="text-[11px] text-neutral-600">
        <summary className="cursor-pointer text-neutral-500">علاش؟</summary>
        <p>{g.reason}</p>
        <p dir="ltr">{g.parcels.map((p) => `${p.trackingCode} (${p.invoiceNumber})`).join(" · ")}</p>
        {g.candidates.length > 0 && (
          <p className="mt-1">
            {g.candidates.map((c) => (
              <Link key={c.id} href={`/admin/orders/${c.id}`} className="me-2 font-semibold text-brand-turquoise-dark underline">
                {c.orderNumber}
              </Link>
            ))}
          </p>
        )}
      </details>
      <SafeActionForm action={linkParcelsAction} className="mt-1 flex gap-2">
        {g.parcels.map((p) => (
          <input key={p.id} type="hidden" name="parcel" value={p.id} />
        ))}
        <input
          name="orderNumber"
          required
          dir="ltr"
          autoCapitalize="characters"
          placeholder="TF-2026-…"
          defaultValue={g.candidates.length === 1 ? g.candidates[0].orderNumber : ""}
          aria-label="رقم الطلبية"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 text-sm"
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-lg border border-sky-300 bg-sky-50 px-3 text-sm font-semibold text-sky-900"
        >
          اربط
        </button>
      </SafeActionForm>
    </li>
  );
}
