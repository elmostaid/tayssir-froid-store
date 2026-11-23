// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractPdfTextItems } from "@/lib/settlements/pdfText";
import { parseBigDeliveryInvoice, mapCarrierStatus } from "@/lib/settlements/bigDeliveryInvoice";
import { buildFakeBigDeliveryPdf, type FakeParcel } from "./fakeBigDeliveryPdf";

async function parse(pdf: Uint8Array) {
  return parseBigDeliveryInvoice(await extractPdfTextItems(pdf));
}

const base: FakeParcel[] = [
  { code: "BG1AA001", pickup: "2026-11-11", phone: "0600000001", cityLines: ["Beni", "Ahmed", "chamal"], cod: 718, fee: 35 },
  { code: "BG1AA002", pickup: "2026-11-11", phone: "0600000001", cityLines: ["Beni", "Ahmed", "chamal"], cod: 777, fee: 80 },
  { code: "BG4BB003", pickup: "2026-11-14", phone: "+212600000002", cityLines: ["Tahla"], cod: 1075, fee: 35 },
];

function manyParcels(n: number): FakeParcel[] {
  return Array.from({ length: n }, (_, i) => ({
    code: `BG9MP${String(i + 1).padStart(3, "0")}`,
    pickup: "2026-11-17",
    phone: `06100${String(i + 1).padStart(5, "0")}`,
    cityLines: i % 3 === 0 ? ["Moulay", "Abellah", "Amghar"] : ["Erfoud"],
    cod: 400 + i * 7,
    fee: i % 4 === 0 ? 90 : 35,
  }));
}

describe("قراءة فاتورة BigDelivery", () => {
  it("يقرأ الرأس والكرطونات والمجاميع (المدينة الملتفّة و«DH» تحت المبلغ)", async () => {
    const r = await parse(buildFakeBigDeliveryPdf({ number: "FCT-TEST-0001", parcels: base }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inv = r.invoice;
    expect(inv.invoiceNumber).toBe("FCT-TEST-0001");
    expect(inv.invoiceDate).toBe("2026-11-20");
    expect(inv.carrierStatus).toBe("Payé");
    expect(inv.totalCodCents).toBe(257000);
    expect(inv.totalFeesCents).toBe(15000);
    expect(inv.totalNetCents).toBe(242000);
    expect(inv.parcels).toHaveLength(3);
    expect(inv.parcels[0]).toMatchObject({
      lineNo: 1,
      trackingCode: "BG1AA001",
      pickupDate: "2026-11-11",
      phoneKey: "600000001",
      status: "delivered",
      city: "Beni Ahmed chamal",
      codCents: 71800,
      feeCents: 3500,
      netCents: 68300,
    });
    // +212… و06… يعطيان نفس المفتاح.
    expect(inv.parcels[2].phoneKey).toBe("600000002");
    expect(inv.parcels[2].codCents).toBe(107500);
  });

  it("فاتورة متعددة الصفحات (رأس الجدول مكرَّر في كل صفحة)", async () => {
    const parcels = manyParcels(34);
    const r = await parse(buildFakeBigDeliveryPdf({ number: "FCT-MULTI-1", parcels, rowsPerPage: 12 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invoice.pageCount).toBe(3);
    expect(r.invoice.parcels.map((p) => p.trackingCode)).toEqual(parcels.map((p) => p.code));
    expect(r.invoice.parcels.map((p) => p.lineNo)).toEqual(parcels.map((_, i) => i + 1));
    expect(r.invoice.parcels[33].city).toBe("Moulay Abellah Amghar");
  });

  it("فاتورة متعددة الصفحات بلا تكرار رأس الجدول", async () => {
    const parcels = manyParcels(26);
    const r = await parse(
      buildFakeBigDeliveryPdf({ number: "FCT-MULTI-2", parcels, rowsPerPage: 13, repeatHeader: false })
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.invoice.parcels).toHaveLength(26);
  });

  it("كرطونة راجعة بتحصيل 0 وصافي سالب تُقرأ «returned»", async () => {
    const parcels: FakeParcel[] = [
      ...base,
      { code: "BG5RR004", pickup: "2026-11-15", phone: "0600000003", status: "Retourné", cityLines: ["Fes"], cod: 0, fee: 20 },
    ];
    const r = await parse(buildFakeBigDeliveryPdf({ number: "FCT-RET-1", parcels }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invoice.parcels[3]).toMatchObject({ status: "returned", codCents: 0, feeCents: 2000, netCents: -2000 });
  });

  it("يرفض الفاتورة كلها إذا اختلف مجموع الرسوم بدرهم واحد، ويقول الفرق", async () => {
    const r = await parse(
      buildFakeBigDeliveryPdf({ number: "FCT-BAD-1", parcels: base, overrideTotals: { frais: 149, net: 2421 } })
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join("\n")).toMatch(/مجموع الرسوم/);
  });

  it("يرفض سطراً لا يساوي فيه التحصيل ناقص الرسوم الصافي", async () => {
    const parcels = base.map((p, i) => (i === 1 ? { ...p, net: 690 } : p));
    const r = await parse(buildFakeBigDeliveryPdf({ number: "FCT-BAD-2", parcels, overrideTotals: { net: 2413 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toMatch(/BG1AA002/);
  });

  it("يرفض عدد كرطونات معلن مختلف عن المقروء", async () => {
    const r = await parse(buildFakeBigDeliveryPdf({ number: "FCT-BAD-3", parcels: base, overrideTotals: { colis: 4 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join("\n")).toMatch(/4 كرطونة/);
  });

  it("يرفض ملفاً ليس من BigDelivery", async () => {
    const r = await parse(buildFakeBigDeliveryPdf({ number: "X-1", parcels: base, companyName: "Autre Transport" }));
    expect(r.ok).toBe(false);
  });

  it("يرفض ملفاً ليس PDF", async () => {
    await expect(extractPdfTextItems(new TextEncoder().encode("not a pdf"))).rejects.toThrow(/PDF/);
  });

  it("خريطة حالات الشركة", () => {
    expect(mapCarrierStatus("Livré")).toBe("delivered");
    expect(mapCarrierStatus("Retourné")).toBe("returned");
    expect(mapCarrierStatus("Refusé")).toBe("refused");
    expect(mapCarrierStatus("En cours")).toBe("other");
  });
});
