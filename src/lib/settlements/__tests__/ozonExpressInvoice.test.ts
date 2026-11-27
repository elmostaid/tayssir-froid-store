import { describe, expect, it } from "vitest";
import { extractPdfTextItems } from "@/lib/settlements/pdfText";
import { parseOzonExpressInvoice, isOzonExpressInvoice } from "@/lib/settlements/ozonExpressInvoice";
import { buildFakeOzonExpressPdf, type FakeOzonParcel } from "./fakeOzonExpressPdf";
import { buildFakeBigDeliveryPdf } from "./fakeBigDeliveryPdf";

/**
 * نفس بنية الكشف الأصلي VRT-N-2846416-261026-81-99416 (14 كرطونة، 8,735 /
 * 700 / 8,035، و«Total Colis» 8,175) بهواتف وأرقام تتبع وهمية.
 */
const row = (code: string, suffix: string, ph: string, city: string, cod: number, fee: number, pickup = "2026-10-22", delivery = "2026-10-23"): FakeOzonParcel =>
  ({ code, suffix, phone: `06000000${ph}`, city, cod, fee, pickup, delivery });
const ORIGINAL: FakeOzonParcel[] = [
  row("TET100000000001", "MA", "01", "Tetouan", 498, 35),
  row("TET100000000002", "FQ", "01", "Tetouan", 498, 35),
  row("TET100000000003", "EG", "01", "Tetouan", 498, 35),
  row("TET100000000004", "NW", "01", "Tetouan", 498, 35),
  row("TET100000000005", "OO", "01", "Tetouan", 498, 70),
  row("Laou10000000006", "UJ", "02", "Oued Laou", 45, 45, "2026-10-22", "2026-10-26"),
  row("KS1000000000007", "RM", "03", "Ksar El Kebir", 567, 80, "2026-10-23", "2026-10-24"),
  row("KS1000000000008ED", "", "03", "Ksar El Kebir", 567, 45, "2026-10-23", "2026-10-24"),
  row("KS1000000000009", "GD", "03", "Ksar El Kebir", 567, 45, "2026-10-23", "2026-10-24"),
  row("KS1000000000010", "DR", "03", "Ksar El Kebir", 567, 45, "2026-10-23", "2026-10-24"),
  row("KS1000000000011", "QX", "03", "Ksar El Kebir", 567, 45, "2026-10-23", "2026-10-24"),
  row("KS1000000000012PV", "", "03", "Ksar El Kebir", 565, 80, "2026-10-23", "2026-10-24"),
  row("MEK100000000013", "VK", "04", "Meknes", 1400, 70, "2026-10-23", "2026-10-24"),
  row("MEK100000000014", "KA", "04", "Meknes", 1400, 35, "2026-10-23", "2026-10-24"),
];

async function parse(opts: Parameters<typeof buildFakeOzonExpressPdf>[0]) {
  return parseOzonExpressInvoice(await extractPdfTextItems(buildFakeOzonExpressPdf(opts)));
}

describe("كشف OzonExpress", () => {
  it("نفس بنية الأصل: 14 كرطونة على صفحتين، المجاميع مضبوطة، و«Total Colis» تنبيه فقط", async () => {
    const r = await parse({ number: "VRT-N-1000000-261026-81-00001", parcels: ORIGINAL, totalColis: 8175 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv = r.invoice;
    expect(inv).toMatchObject({
      carrier: "ozonexpress",
      invoiceNumber: "VRT-N-1000000-261026-81-00001",
      invoiceDate: "2026-10-26",
      carrierStatus: "Virement",
      totalCodCents: 873500,
      totalFeesCents: 70000,
      otherFeesCents: 0,
      totalNetCents: 803500,
      declaredNetCents: 803500,
      pageCount: 2,
    });
    expect(inv.parcels).toHaveLength(14);
    expect(r.warnings?.join()).toMatch(/Total Colis/);
    expect(r.warnings?.join()).toMatch(/560,00/);
  });

  it("رقم التتبع على سطرين كيتجمع، والهاتف كيتفرق عليه (حتى ملي كيطلع للسطر الثاني)", async () => {
    const r = await parse({ number: "VRT-N-1", parcels: ORIGINAL, totalColis: 8175 });
    if (!r.ok) throw new Error(r.problems.join());
    const p = r.invoice.parcels;
    expect(p[0]).toMatchObject({ lineNo: 1, trackingCode: "TET100000000001MA", phoneKey: "600000001", city: "Tetouan", status: "delivered", pickupDate: "2026-10-22", deliveryDate: "2026-10-23" });
    expect(p[7]).toMatchObject({ trackingCode: "KS1000000000008ED", phoneKey: "600000003" });
    expect(p[5]).toMatchObject({ trackingCode: "Laou10000000006UJ", codCents: 4500, feeCents: 4500, netCents: 0 });
    expect(p[13]).toMatchObject({ lineNo: 14, trackingCode: "MEK100000000014KA", city: "Meknes", codCents: 140000 });
    // 6 كرطونات Ksar El Kebir = 3,400 برسوم 340 (بحال TF-2026-0284).
    const ksar = p.filter((x) => x.city === "Ksar El Kebir");
    expect(ksar.reduce((s, x) => s + x.codCents, 0)).toBe(340000);
    expect(ksar.reduce((s, x) => s + x.feeCents, 0)).toBe(34000);
  });

  it("«Total Colis» مساوي للسطور → بلا تنبيه", async () => {
    const r = await parse({ number: "VRT-N-2", parcels: ORIGINAL.slice(0, 3) });
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("سطر حسابو غالط (تحصيل − رسوم ≠ الصافي) → الكشف كامل مرفوض", async () => {
    const bad = ORIGINAL.slice(0, 3).map((p, i) => (i === 1 ? { ...p, net: 470 } : p));
    const r = await parse({ number: "VRT-N-3", parcels: bad });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join()).toMatch(/TET100000000002FQ/);
  });

  it("الصافي ولا الرسوم المطبوعين ما كيتطابقوش مع السطور → مرفوض", async () => {
    const netWrong = await parse({ number: "VRT-N-4", parcels: ORIGINAL.slice(0, 3), overrideTotals: { net: 1300 } });
    expect(netWrong.ok).toBe(false);
    const feesWrong = await parse({ number: "VRT-N-5", parcels: ORIGINAL.slice(0, 3), overrideTotals: { frais: 100 } });
    expect(feesWrong.ok).toBe(false);
    const headerWrong = await parse({ number: "VRT-N-6", parcels: ORIGINAL.slice(0, 3), overrideTotals: { headerNet: 999 } });
    expect(headerWrong.ok).toBe(false);
    const countWrong = await parse({ number: "VRT-N-7", parcels: ORIGINAL.slice(0, 3), overrideTotals: { colis: 4 } });
    expect(countWrong.ok).toBe(false);
  });

  it("مصاريف إضافية ولا رسوم تحويل كتنقص من الصافي وكتحسب", async () => {
    const r = await parse({ number: "VRT-N-8", parcels: ORIGINAL.slice(0, 2), supplement: 10, transferFee: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invoice).toMatchObject({ otherFeesCents: 1500, totalNetCents: 99600 - 7000 - 1500 });
  });

  it("كرطونة راجعة كتتقرا «returned»", async () => {
    const parcels = [...ORIGINAL.slice(0, 2), { ...row("TET100000000099", "ZZ", "09", "Tetouan", 0, 20), status: "Retourné" }];
    const r = await parse({ number: "VRT-N-9", parcels });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invoice.parcels[2]).toMatchObject({ status: "returned", codCents: 0, feeCents: 2000 });
  });

  it("الشركة كتتعرف من الملف: BigDelivery ماشي Ozon", async () => {
    const big = await extractPdfTextItems(buildFakeBigDeliveryPdf({ number: "FCT-1", parcels: [{ code: "BG1AA001", pickup: "2026-11-01", phone: "0600000001", cityLines: ["Fes"], cod: 100, fee: 35 }] }));
    expect(isOzonExpressInvoice(big)).toBe(false);
    const ozon = await extractPdfTextItems(buildFakeOzonExpressPdf({ number: "VRT-N-1", parcels: ORIGINAL.slice(0, 1) }));
    expect(isOzonExpressInvoice(ozon)).toBe(true);
    expect((parseOzonExpressInvoice(big)).ok).toBe(false);
  });
});
