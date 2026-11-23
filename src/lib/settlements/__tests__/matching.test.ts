import { describe, expect, it } from "vitest";
import { matchParcels, type CandidateOrder, type OpenParcel } from "@/lib/settlements/matching";

let nextId = 1;
function parcel(over: Partial<OpenParcel> & { codCents: number }): OpenParcel {
  const id = nextId++;
  return {
    id,
    invoiceId: 1,
    invoiceNumber: "FCT-1",
    trackingCode: `BG${id}`,
    phoneKey: "600000001",
    city: "Tahla",
    feeCents: 3500,
    status: "delivered",
    statusRaw: "Livré",
    pickupDate: "2026-11-14",
    ...over,
  };
}

function order(over: Partial<CandidateOrder> & { finalTotalCents: number }): CandidateOrder {
  const id = nextId++;
  return {
    id,
    orderNumber: `TF-${id}`,
    status: "shipped",
    phoneKey: "600000001",
    city: "تاهلة",
    createdAt: "2026-11-12T10:00:00.000Z",
    deliveryFeeCents: 3500,
    cartonCount: null,
    actualDeliveryCostCents: null,
    settled: false,
    ...over,
  };
}

describe("محرّك المطابقة", () => {
  it("كرطونة واحدة بمبلغ مطابق → جاهزة، ثقة متوسطة لأن عدد الكرطونات غير مسجَّل", () => {
    const o = order({ finalTotalCents: 63500 });
    const r = matchParcels([parcel({ codCents: 63500 })], [o]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]).toMatchObject({
      kind: "ready",
      confidence: "medium",
      feeCents: 3500,
      willSetDelivered: true,
      willSetCost: true,
    });
    expect(r.orders[0].confidenceNotes.join()).toMatch(/عدد الكرطونات/);
  });

  it("عدد الكرطونات مسجَّل ومطابق والمدينة مطابقة → ثقة عالية", () => {
    const o = order({ finalTotalCents: 140000, cartonCount: 2 });
    const r = matchParcels([parcel({ codCents: 70000 }), parcel({ codCents: 70000, feeCents: 9000 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "ready", confidence: "high", feeCents: 12500 });
  });

  it("6 كرطونات × 718 = 4,308 → مكتملة بمجموع رسوم الست", () => {
    const o = order({ finalTotalCents: 430800, cartonCount: 6 });
    const ps = Array.from({ length: 6 }, () => parcel({ codCents: 71800 }));
    const r = matchParcels(ps, [o]);
    expect(r.orders[0]).toMatchObject({ kind: "ready", feeCents: 21000, confidence: "high" });
  });

  it("كرطونات ناقصة → تنتظر بالمبلغ الناقص", () => {
    const o = order({ finalTotalCents: 311100 });
    const r = matchParcels([parcel({ codCents: 71800 }), parcel({ codCents: 77700 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "waiting", missingCents: 161600 });
  });

  it("كرطونات موزعة على فاتورتين تكتمل حين تجتمع", () => {
    const o = order({ finalTotalCents: 211000 });
    const a = parcel({ codCents: 75500, invoiceId: 1 });
    const b = parcel({ codCents: 107500, invoiceId: 1 });
    const c = parcel({ codCents: 28000, invoiceId: 2, invoiceNumber: "FCT-2", pickupDate: "2026-11-20" });
    expect(matchParcels([a, b], [o]).orders[0].kind).toBe("waiting");
    const r = matchParcels([a, b, c], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "ready", codCents: 211000, feeCents: 10500 });
  });

  it("المبلغ مكتمل لكن العدد المسجَّل أكبر → تنتظر كرطونة بلا تحصيل", () => {
    const o = order({ finalTotalCents: 63500, cartonCount: 2 });
    const r = matchParcels([parcel({ codCents: 63500 })], [o]);
    expect(r.orders[0].kind).toBe("waiting");
  });

  it("مبلغ أكبر من المبلغ النهائي → محجوبة", () => {
    const o = order({ finalTotalCents: 60000 });
    const r = matchParcels([parcel({ codCents: 63500 })], [o]);
    expect(r.orders[0].kind).toBe("blocked");
  });

  it("كرطونة راجعة → محجوبة، لا تُطبَّق تلقائياً أبداً", () => {
    const o = order({ finalTotalCents: 63500 });
    const r = matchParcels(
      [parcel({ codCents: 63500, status: "returned", statusRaw: "Retourné" })],
      [o]
    );
    expect(r.orders[0].kind).toBe("blocked");
    expect(r.orders[0].reasons.join()).toMatch(/Retourné/);
  });

  it("تكلفة توصيل مسجلة بيد المالك ومختلفة → تحتاج قرار، والتكلفة اليدوية محفوظة", () => {
    const o = order({ finalTotalCents: 140000, actualDeliveryCostCents: 2000 });
    const r = matchParcels([parcel({ codCents: 70000 }), parcel({ codCents: 70000, feeCents: 9000 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", costConflict: true, feeCents: 12500 });
  });

  it("تكلفة يدوية مساوية للفاتورة → جاهزة بلا كتابة تكلفة", () => {
    const o = order({ finalTotalCents: 63500, actualDeliveryCostCents: 3500 });
    const r = matchParcels([parcel({ codCents: 63500 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "ready", willSetCost: false, costConflict: false });
  });

  it("المدينة مختلفة → تحتاج قرار", () => {
    const o = order({ finalTotalCents: 41000, city: "El Jadida" });
    const r = matchParcels([parcel({ codCents: 41000, city: "Moulay Abellah Amghar" })], [o]);
    expect(r.orders[0].kind).toBe("decide");
  });

  it("مؤكَّدة لم تُعلَّم مُرسَلة → تحتاج قرار؛ جديدة → محجوبة", () => {
    const confirmed = order({ finalTotalCents: 63500, status: "confirmed" });
    expect(matchParcels([parcel({ codCents: 63500 })], [confirmed]).orders[0].kind).toBe("decide");
    const fresh = order({ finalTotalCents: 63500, status: "new" });
    expect(matchParcels([parcel({ codCents: 63500 })], [fresh]).orders[0].kind).toBe("blocked");
  });

  it("ملغاة فالموقع → محجوبة", () => {
    const o = order({ finalTotalCents: 63500, status: "cancelled" });
    expect(matchParcels([parcel({ codCents: 63500 })], [o]).orders[0].kind).toBe("blocked");
  });

  it("مسلَّمة يدوياً من قبل → جاهزة لتسجيل التكلفة فقط، بلا تغيير حالة", () => {
    const o = order({ finalTotalCents: 63500, status: "delivered" });
    expect(matchParcels([parcel({ codCents: 63500 })], [o]).orders[0]).toMatchObject({
      kind: "ready",
      willSetDelivered: false,
      willSetCost: true,
    });
  });

  it("زبون متكرر: المبلغ يفرّق بين طلبيتين بنفس الهاتف", () => {
    const old = order({ finalTotalCents: 85500, status: "delivered", createdAt: "2026-10-20T10:00:00Z" });
    const fresh = order({ finalTotalCents: 99200, createdAt: "2026-11-12T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 99200 })], [old, fresh]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].order.id).toBe(fresh.id);
  });

  it("طلبيتان بنفس الهاتف ونفس المبلغ → غامضة، لا شيء يُطبَّق", () => {
    const a = order({ finalTotalCents: 63500 });
    const b = order({ finalTotalCents: 63500 });
    const r = matchParcels([parcel({ codCents: 63500 })], [a, b]);
    expect(r.orders).toHaveLength(0);
    expect(r.parcelGroups[0].kind).toBe("ambiguous");
  });

  it("طلبيتان مفتوحتان وكرطونة جزئية → غامضة", () => {
    const a = order({ finalTotalCents: 100000 });
    const b = order({ finalTotalCents: 120000 });
    const r = matchParcels([parcel({ codCents: 50000 })], [a, b]);
    expect(r.parcelGroups[0].kind).toBe("ambiguous");
  });

  it("طلبية أقدم من 45 يوماً قبل الاستلام لا تُرشَّح", () => {
    const old = order({ finalTotalCents: 63500, createdAt: "2026-09-20T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 63500 })], [old]);
    expect(r.orders).toHaveLength(0);
    expect(r.parcelGroups[0].kind).toBe("unmatched");
  });

  it("كرطونة استُلمت قبل إنشاء الطلبية لا تُطابَق معها", () => {
    const o = order({ finalTotalCents: 63500, createdAt: "2026-11-16T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 63500, pickupDate: "2026-11-14" })], [o]);
    expect(r.orders).toHaveLength(0);
  });

  it("هاتف بلا طلبية → بلا طلبية؛ هاتف طلبية مسوّاة → كرطونة زائدة", () => {
    const r1 = matchParcels([parcel({ codCents: 1000, phoneKey: "699999999" })], []);
    expect(r1.parcelGroups[0].kind).toBe("unmatched");
    const settled = order({ finalTotalCents: 63500, settled: true });
    const r2 = matchParcels([parcel({ codCents: 0 })], [settled]);
    expect(r2.parcelGroups[0].kind).toBe("extra");
  });
});
