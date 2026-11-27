import Link from "@/components/Link";
import { formatMad } from "@/lib/format";

/**
 * سطر صغير تحت «ربح الطلبية»: من أين جاءت تكلفة التوصيل، والحالات الثلاث
 * المنفصلة — مسلَّمة (حالة الطلبية)، الشركة سوّات (هذه التسوية)، الفلوس وصلات للبنك.
 */
export function CarrierSettlementNote({
  settlement,
}: {
  settlement: {
    invoices: { id: number; number: string; carrierLabel: string; bankReceived: boolean }[];
    parcelCount: number;
    feeTotal: number;
    settledAt: string;
    confidence: string;
    outcome: "delivered" | "returned";
  };
}) {
  if (settlement.outcome === "returned") {
    return (
      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        <p className="font-semibold">
          رجعة مؤكَّدة من الفاتورة · {settlement.parcelCount} كرطونة · خسارة توصيل {formatMad(settlement.feeTotal)}
        </p>
        <p className="mt-1">
          {settlement.invoices.map((i) => (
            <Link key={i.id} href={`/admin/settlements/${i.id}`} className="me-2 underline" dir="ltr">
              {i.carrierLabel} {i.number}
            </Link>
          ))}
        </p>
        <p className="mt-1">ملي توصلك السلعة، بدّل الحالة لـ«راجعة» باش يرجع المخزون.</p>
      </div>
    );
  }
  const bankAll = settlement.invoices.length > 0 && settlement.invoices.every((i) => i.bankReceived);
  return (
    <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
      <p className="font-semibold text-neutral-800">
        الشركة سوّات هاد الطلبية · {settlement.parcelCount} كرطونة · توصيل {formatMad(settlement.feeTotal)}
      </p>
      <p className="mt-1">
        {settlement.invoices.map((i) => (
          <Link key={i.id} href={`/admin/settlements/${i.id}`} className="me-2 underline" dir="ltr">
            {i.carrierLabel} {i.number}
          </Link>
        ))}
      </p>
      <p className={`mt-1 font-semibold ${bankAll ? "text-green-800" : "text-amber-700"}`}>
        {bankAll ? "الفلوس وصلات للبنك" : "الفلوس مازال ما تأكدش وصولها للبنك"}
      </p>
    </div>
  );
}
