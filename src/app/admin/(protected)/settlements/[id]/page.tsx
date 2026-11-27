import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { formatMad } from "@/lib/format";
import { getInvoice } from "@/lib/settlements/settlementStore";
import { PendingSubmit } from "@/components/admin/settlements/PendingSubmit";
import { SafeActionForm } from "@/components/admin/settlements/SafeActionForm";
import { markBankAction, rollbackInvoiceAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "فاتورة توصيل" };

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const PARCEL_STATUS: Record<string, string> = {
  delivered: "Livré",
  returned: "راجعة",
  refused: "مرفوضة",
  other: "أخرى",
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const data = await getInvoice(id);
  if (!data) notFound();
  const { invoice: inv, parcels } = data;
  const sp = await searchParams;
  const active = inv.status === "active";

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <Link href="/admin/settlements" className="text-sm font-semibold text-brand-turquoise-dark">
        ← تسويات التوصيل
      </Link>
      <h1 className="mt-2 text-lg font-bold text-neutral-800" dir="ltr">
        {inv.invoiceNumber}
      </h1>
      <p className="text-xs text-neutral-500">
        {inv.carrierLabel} · {inv.invoiceDate ?? "—"} · حالة الشركة: {inv.carrierStatus ?? "—"}
        {!active && " · متراجَع عنها"}
      </p>
      {/* «Payé» كلمة الشركة على نفسها، ماشي دليل: الفلوس وصلات غير ملي كتسجّلها نتا من الحساب البنكي. */}
      {inv.carrierStatus && /pay/i.test(inv.carrierStatus) && !inv.bankReceivedAt && active && (
        <p className="mt-1 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
          «{inv.carrierStatus}» = {inv.carrierLabel} كتقول راه صيفطات الفلوس. هادشي ماشي تأكيد: الفاتورة كتبقى
          «الفلوس ما وصلاتش» حتى تشوف المبلغ فالحساب البنكي وتسجّلو لتحت بالنهار ديالو.
        </p>
      )}

      {one(sp.error) && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{one(sp.error)}</div>
      )}
      {one(sp.rolledBack) && (
        <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          تم التراجع: {one(sp.rolledBack)} طلبية رجعات كيف كانت.
          {one(sp.kept) && (
            <ul className="mt-1 list-disc ps-5 text-xs text-amber-800">
              {one(sp.kept)!.split("\n").map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-center text-xs">
        <div>
          <dt className="text-neutral-500">المحصَّل</dt>
          <dd className="font-bold tabular-nums">{formatMad(inv.totalCod)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">الرسوم</dt>
          <dd className="font-bold tabular-nums">{formatMad(inv.totalFees)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">الصافي</dt>
          <dd className="font-bold tabular-nums text-brand-turquoise-dark">{formatMad(inv.totalNet)}</dd>
        </div>
      </dl>

      <section className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
        <h2 className="text-sm font-bold text-neutral-800">وصول الفلوس للبنك</h2>
        {inv.bankReceivedAt ? (
          <SafeActionForm action={markBankAction} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-green-800">
              وصل {formatMad(inv.bankReceivedAmount ?? 0)} — {inv.bankReceivedAt.slice(0, 10)}
              {inv.bankReceivedAmount !== null && inv.bankReceivedAmount !== inv.totalNet && (
                <span className="block text-xs text-amber-800">
                  مختلف عن صافي الفاتورة بـ{formatMad(inv.totalNet - inv.bankReceivedAmount)}
                </span>
              )}
            </span>
            <input type="hidden" name="invoiceId" value={inv.id} />
            <input type="hidden" name="clear" value="1" />
            <PendingSubmit pendingText="…" className="text-xs font-semibold text-neutral-500 underline">
              إلغاء
            </PendingSubmit>
          </SafeActionForm>
        ) : active ? (
          <SafeActionForm action={markBankAction} className="mt-2 grid grid-cols-2 gap-2">
            <input type="hidden" name="invoiceId" value={inv.id} />
            <label className="text-xs text-neutral-600">
              المبلغ اللي وصل
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={String(inv.totalNet)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm tabular-nums"
              />
            </label>
            <label className="text-xs text-neutral-600">
              نهار الوصول
              <input
                name="receivedOn"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                max={new Date().toISOString().slice(0, 10)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              />
            </label>
            <PendingSubmit
              pendingText="…"
              className="col-span-2 min-h-11 rounded-full bg-green-700 px-4 text-sm font-bold text-white disabled:bg-neutral-300"
            >
              وصلات الفلوس للبنك
            </PendingSubmit>
          </SafeActionForm>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">—</p>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
        <h2 className="text-sm font-bold text-neutral-800">الكرطونات ({parcels.length})</h2>
        <ul className="mt-1 divide-y divide-neutral-100">
          {parcels.map((p) => (
            <li key={p.id} className="py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-neutral-800" dir="ltr">
                  {p.lineNo}. {p.trackingCode}
                </span>
                {p.skipReason === "duplicate" ? (
                  <span className="text-neutral-500">محسوبة ففاتورة أخرى</span>
                ) : p.skipReason === "duplicate_conflict" ? (
                  <span className="font-semibold text-red-700">تعارض مع فاتورة أخرى</span>
                ) : p.settledOrderNumber ? (
                  <Link href={`/admin/orders/${p.settledOrderId}`} className="font-semibold text-green-800 underline">
                    {p.settledOrderNumber} ✓
                  </Link>
                ) : !p.active ? (
                  <span className="text-neutral-400">غير محسوبة</span>
                ) : (
                  <span className="text-amber-700">مازال ما تسوّاتش</span>
                )}
              </div>
              <p className="mt-0.5 text-neutral-600">
                {p.city ?? "—"} · {PARCEL_STATUS[p.status] ?? p.status} · استلام {p.pickupDate ?? "—"} · هاتف{" "}
                <span dir="ltr">{p.phone ?? "—"}</span>
              </p>
              <p className="text-neutral-600">
                تحصيل <span className="font-semibold tabular-nums">{formatMad(p.cod)}</span> · رسوم{" "}
                <span className="font-semibold tabular-nums">{formatMad(p.fee)}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <a
        href={`/admin/settlements/${inv.id}/file`}
        target="_blank"
        rel="noopener"
        className="mt-3 block rounded-full border border-neutral-300 py-3 text-center text-sm font-semibold text-neutral-700"
      >
        شوف الفاتورة الأصلية (PDF)
      </a>

      {active && (
        <details className="mt-6 rounded-xl border border-red-200 bg-red-50/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-red-800">تراجع عن هاد الفاتورة</summary>
          <p className="mt-2 text-xs leading-relaxed text-neutral-700">
            كل طلبية تسوّات بكرطونة من هاد الفاتورة كترجع كيف كانت (الحالة وتكلفة التوصيل)، حتى إلا كانت
            كملات بفاتورة أخرى. إلا بدلتي شي حاجة بيدك من بعد، كتبقى كما هي. الفاتورة ما كتتمسحش، وتقدر
            تعاود ترفعها من بعد.
          </p>
          <SafeActionForm action={rollbackInvoiceAction} className="mt-3">
            <input type="hidden" name="invoiceId" value={inv.id} />
            <PendingSubmit
              pendingText="كنتراجع…"
              className="min-h-11 w-full rounded-full bg-red-700 px-4 text-sm font-bold text-white disabled:bg-neutral-300"
            >
              أكّد التراجع
            </PendingSubmit>
          </SafeActionForm>
        </details>
      )}
    </div>
  );
}
