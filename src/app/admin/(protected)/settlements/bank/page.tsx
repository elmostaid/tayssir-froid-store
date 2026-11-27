import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import { listInvoices } from "@/lib/settlements/settlementStore";
import { ApplyButton, SelectAll, SelectedTotal } from "@/components/admin/settlements/SelectionControls";
import { SafeActionForm } from "@/components/admin/settlements/SafeActionForm";
import { markBankBulkAction } from "../actions";

/**
 * وصول الفلوس للبنك — منفصل تماماً على تسجيل التسليم. المالك كيعلّم الكشوفات
 * اللي شاف فلوسها فالحساب، وكيدخل نهار الوصول، وضغطة وحدة. المبلغ = صافي كل
 * كشف؛ إلا وصل مبلغ مختلف، كيتسجل من صفحة الكشف بالمبلغ الحقيقي.
 * «Payé» عند الشركة ماشي دليل: والو ما كيتعلّم وحدو.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "وصول الفلوس للبنك" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BankPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");
  const sp = await searchParams;

  const invoices = (await listInvoices(400)).filter((i) => i.status === "active");
  const owed = invoices
    // الكشوفات السالبة (غير رسوم) داخلين: الشركة كتخصمهم من التحويل.
    .filter((i) => !i.bankReceivedAt)
    .sort((a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? ""));
  const received = invoices.filter((i) => i.bankReceivedAt);
  const owedTotal = owed.reduce((s, i) => s + i.totalNet, 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <Link href="/admin/settlements" className="text-sm font-semibold text-brand-turquoise-dark">
        ← تسويات التوصيل
      </Link>
      <h1 className="mt-2 text-xl font-bold text-neutral-800">💰 وصول الفلوس للبنك</h1>
      <p className="mt-1 text-xs text-neutral-500">
        علّم غير الكشوفات اللي شفتي فلوسها فالحساب البنكي. هادشي ما كيبدل حتى طلبية.
      </p>

      {one(sp.marked) && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800" data-testid="bank-banner">
          تسجّل وصول {one(sp.marked)} كشف.
        </div>
      )}
      {one(sp.error) && (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {one(sp.error)}
        </div>
      )}
      {one(sp.notice) === "none" && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">ما اخترتي حتى كشف.</div>
      )}

      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <h2 className="text-base font-bold text-neutral-800">
          مازال عند شركات التوصيل <span className="text-neutral-500">({owed.length})</span>
        </h2>
        <p className="mt-1 text-sm">
          المجموع: <span className="font-bold tabular-nums">{formatMad(owedTotal)}</span>
        </p>
        {owed.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">والو.</p>
        ) : (
          <SafeActionForm action={markBankBulkAction} className="mt-3">
            <SelectAll name="inv" label={`الكل (${owed.length})`} />
            <ul className="mt-2 divide-y divide-neutral-100 rounded-lg bg-white">
              {owed.map((inv) => (
                <li key={inv.id} className="scroll-mb-28">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      name="inv"
                      value={inv.id}
                      data-cents={Math.round(inv.totalNet * 100)}
                      className="h-5 w-5 shrink-0 accent-brand-turquoise"
                    />
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block truncate font-semibold text-neutral-800" dir="ltr">
                        {inv.invoiceNumber}
                      </span>
                      <span className="text-neutral-500">
                        {inv.carrierLabel} · {inv.invoiceDate ?? "—"}
                        {inv.carrierStatus && ` · الشركة: ${inv.carrierStatus}`}
                        {inv.totalNet < 0 && " · غير رسوم: كتخصم من التحويل"}
                      </span>
                    </span>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${inv.totalNet < 0 ? "text-red-700" : ""}`}>
                      {formatMad(inv.totalNet)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="mt-3 block text-sm font-semibold text-neutral-800" htmlFor="receivedOn">
              نهار الوصول للحساب
            </label>
            <input
              id="receivedOn"
              name="receivedOn"
              type="date"
              required
              max={today}
              defaultValue={today}
              className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
            />
            <p className="mt-2 rounded-lg bg-white p-2 text-sm">
              المختار: <SelectedTotal name="inv" /> — خاصو يكون هو المبلغ اللي وصل للحساب.
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              كل كشف كيتسجل بالصافي ديالو (السالب = خصم). وصل مبلغ آخر؟ سجّلو من صفحة الكشف.
            </p>
            <div className="sticky bottom-0 z-10 -mx-4 mt-3 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
              <ApplyButton idle="اختار الكشوفات أولاً" template="وصلات فلوس {n} كشف" />
            </div>
          </SafeActionForm>
        )}
      </section>

      {received.length > 0 && (
        <details className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <summary className="cursor-pointer text-base font-bold text-neutral-800">
            وصلات <span className="text-neutral-500">({received.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-neutral-100">
            {received.map((inv) => (
              <li key={inv.id}>
                <Link href={`/admin/settlements/${inv.id}`} className="flex items-center justify-between gap-2 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold" dir="ltr">
                      {inv.invoiceNumber}
                    </span>{" "}
                    <span className="text-neutral-500">{inv.bankReceivedAt?.slice(0, 10)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMad(inv.bankReceivedAmount ?? 0)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
