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

function order(over: Partial<CandidateOrder> & { finalTotalCents: number | null }): CandidateOrder {
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
    expect(r.orders[0].confidenceNotes.join()).toMatch(/كرطونة بلا تحصيل/);
    // الثقة المتوسطة لا تُعلَّم مسبقاً — المالك يختارها.
    expect(r.orders[0].preselect).toBe(false);
    expect(r.orders[0].evidence.join("\n")).toMatch(/الهاتف مطابق/);
    expect(r.orders[0].evidence.join("\n")).toMatch(/بالضبط/);
    expect(r.orders[0].evidence.join("\n")).toMatch(/بعد الطلبية بـ2 يوم/);
  });

  it("عدد الكرطونات مسجَّل ومطابق والمدينة مطابقة → ثقة عالية", () => {
    const o = order({ finalTotalCents: 140000, cartonCount: 2 });
    const r = matchParcels([parcel({ codCents: 70000 }), parcel({ codCents: 70000, feeCents: 9000 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "ready", confidence: "high", feeCents: 12500, preselect: true });
    expect(r.orders[0].evidence.join("\n")).toMatch(/2 من 2 كرطونات/);
  });

  it("تحتاج قراراً لا تُعلَّم مسبقاً حتى لو كانت ثقتها عالية", () => {
    const o = order({ finalTotalCents: 63500, cartonCount: 1, actualDeliveryCostCents: 2000 });
    const r = matchParcels([parcel({ codCents: 63500 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", confidence: "high", preselect: false });
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

  it("كل كرطونات الطلبية راجعة → «رجعة» بتأكيد المالك وحده، لا تغيير حالة", () => {
    const o = order({ finalTotalCents: 63500 });
    const r = matchParcels([parcel({ codCents: 0, feeCents: 2000, status: "returned", statusRaw: "Retourné" })], [o]);
    expect(r.orders[0]).toMatchObject({
      kind: "return",
      feeCents: 2000,
      preselect: false,
      willSetDelivered: false,
      willSetCost: true,
    });
  });

  it("كرطونة مرفوضة كتعامل بحال الراجعة", () => {
    const o = order({ finalTotalCents: 63500 });
    const r = matchParcels([parcel({ codCents: 0, feeCents: 1500, status: "refused", statusRaw: "Refusé" })], [o]);
    expect(r.orders[0].kind).toBe("return");
  });

  it("وحدة تسلّمات ووحدة رجعات فنفس الطلبية → محجوبة (ماشي رجعة كاملة)", () => {
    const o = order({ finalTotalCents: 140000 });
    const r = matchParcels(
      [parcel({ codCents: 70000 }), parcel({ codCents: 0, feeCents: 2000, status: "returned", statusRaw: "Retourné" })],
      [o]
    );
    expect(r.orders[0].kind).toBe("blocked");
  });

  it("رجعة فيها تحصيل، أو على طلبية جديدة أو مسلَّمة → محجوبة", () => {
    const returned = (cod: number) => parcel({ codCents: cod, feeCents: 2000, status: "returned", statusRaw: "Retourné" });
    expect(matchParcels([returned(5000)], [order({ finalTotalCents: 63500 })]).orders[0].kind).toBe("blocked");
    expect(matchParcels([returned(0)], [order({ finalTotalCents: 63500, status: "new" })]).orders[0].kind).toBe("blocked");
    expect(matchParcels([returned(0)], [order({ finalTotalCents: 63500, status: "delivered" })]).orders[0].kind).toBe("blocked");
  });

  it("رجعة على طلبية سبق للمالك يعلّمها «راجعة» → كتقبل تسجيل الخسارة", () => {
    const o = order({ finalTotalCents: 63500, status: "returned" });
    const r = matchParcels([parcel({ codCents: 0, feeCents: 2000, status: "returned", statusRaw: "Retourné" })], [o]);
    expect(r.orders[0].kind).toBe("return");
  });

  it("رجعة وتكلفة يدوية مختلفة → كتبان، وإلا أكد المالك كتولي ديال الفاتورة", () => {
    const o = order({ finalTotalCents: 63500, actualDeliveryCostCents: 3500 });
    const r = matchParcels([parcel({ codCents: 0, feeCents: 2000, status: "returned", statusRaw: "Retourné" })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "return", costConflict: true, willSetCost: true });
    expect(r.orders[0].reasons.join()).toMatch(/35/);
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

  it("طلبية تسجّلات من بعد الإرسال بيوم ولا جوج (تسجيل متأخر) → تحتاج قرار، أبداً تلقائياً", () => {
    const o = order({ finalTotalCents: 63500, createdAt: "2026-11-16T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 63500, pickupDate: "2026-11-14" })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", preselect: false });
    expect(r.orders[0].reasons.join()).toMatch(/من بعد ما خرجات الكرطونة بـ2 يوم/);
  });

  it("طلبية تسجّلات من بعد الإرسال بأكثر من 3 أيام → ماشي هي، والسبب مكتوب", () => {
    const o = order({ finalTotalCents: 63500, createdAt: "2026-11-25T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 63500, pickupDate: "2026-11-14" })], [o]);
    expect(r.orders).toHaveLength(0);
    expect(r.parcelGroups[0].kind).toBe("unmatched");
    expect(r.parcelGroups[0].candidates).toHaveLength(0);
    expect(r.parcelGroups[0].reason).toMatch(/11 يوم من بعد الإرسال/);
  });

  it("طلبية قبل الإرسال + طلبية من بعدو بنفس الهاتف: الثانية ما كتدخلش فالغموض (TF-2026-0516)", () => {
    const before = order({ finalTotalCents: 170500, createdAt: "2026-10-30T14:00:00Z" });
    const after = order({ finalTotalCents: 166600, createdAt: "2026-11-25T22:00:00Z" });
    const ps = [parcel({ codCents: 85300, pickupDate: "2026-10-31" }), parcel({ codCents: 85300, feeCents: 8000, pickupDate: "2026-10-31" })];
    const r = matchParcels(ps, [before, after]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].order.id).toBe(before.id);
    expect(r.parcelGroups).toHaveLength(0);
  });

  it("تقريب: 1,705 على جوج كرطونات = 853 + 853 → تحتاج قرار بفرق +1، والربح على المحصَّل", () => {
    const o = order({ finalTotalCents: 170500 });
    const r = matchParcels([parcel({ codCents: 85300 }), parcel({ codCents: 85300 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", roundingCents: 100, preselect: false });
    expect(r.orders[0].reasons.join()).toMatch(/زايد 1,00/);
  });

  it("تقريب ناقص درهم (730 لطلبية 731) → تحتاج قرار، ماشي «كتسنى كرطونة»", () => {
    const o = order({ finalTotalCents: 73100 });
    const r = matchParcels([parcel({ codCents: 73000 })], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", roundingCents: -100 });
  });

  it("فرق أكبر من درهم لكل كرطونة → ماشي تقريب: محجوبة ولا كتسنى كيف قبل", () => {
    expect(matchParcels([parcel({ codCents: 63700 })], [order({ finalTotalCents: 63500 })]).orders[0].kind).toBe("blocked");
    expect(matchParcels([parcel({ codCents: 63300 })], [order({ finalTotalCents: 63500 })]).orders[0].kind).toBe("waiting");
  });

  it("تقريب مع عدد كرطونات مسجَّل وناقص → كتسنى، ماشي تقريب", () => {
    const o = order({ finalTotalCents: 73100, cartonCount: 2 });
    expect(matchParcels([parcel({ codCents: 73000 })], [o]).orders[0].kind).toBe("waiting");
  });

  it("جوج طلبيات بنفس المبلغ: وحدة مُرسَلة ووحدة ملغاة → الكرطونة ديال المُرسَلة", () => {
    const cancelled = order({ finalTotalCents: 63500, status: "cancelled", createdAt: "2026-11-11T10:00:00Z" });
    const shipped = order({ finalTotalCents: 63500, createdAt: "2026-11-12T10:00:00Z" });
    const r = matchParcels([parcel({ codCents: 63500 })], [cancelled, shipped]);
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0].order.id).toBe(shipped.id);
  });

  it("ربط يدوي بطلبية بهاتف آخر → نفس الحكم على المبلغ، ودايماً «تحتاج قرارك»", () => {
    const o = order({ finalTotalCents: 40500, phoneKey: "611111111", cartonCount: 1, city: "القصر الصغير" });
    const p = parcel({ codCents: 40500, phoneKey: "699999999", city: "Ksar Sghir", manualOrderId: o.id });
    const r = matchParcels([p], [o]);
    expect(r.orders[0]).toMatchObject({ kind: "decide", manual: true, preselect: false });
    // نفس الحماية: مبلغ مختلف بزاف → محجوبة حتى بالربط اليدوي.
    const wrong = parcel({ codCents: 90000, manualOrderId: o.id });
    expect(matchParcels([wrong], [o]).orders[0].kind).toBe("blocked");
  });

  it("الفاتورة الحقيقية 1761 (بلا معطيات شخصية): 0335 جاهزة، 0340 و0341 قرار، 405 بلا طلبية", () => {
    const P = (id: number, key: string, city: string, cod: number, fee: number, pickup: string) =>
      parcel({ id, phoneKey: key, city, codCents: cod * 100, feeCents: fee * 100, pickupDate: pickup });
    const ps = [
      P(901, "100000507", "Ighrem Laalam", 853, 35, "2026-10-31"),
      P(902, "100005530", "Ksar Sghir", 405, 35, "2026-10-31"),
      P(903, "100001762", "Fes", 730, 35, "2026-10-31"),
      P(904, "100000507", "Ighrem Laalam", 853, 80, "2026-10-31"),
      P(905, "100005004", "sidi hajaj settat", 935, 35, "2026-10-30"),
    ];
    const O = (n: string, key: string, status: string, created: string, total: number | null, city: string, cost: number | null = null) =>
      order({ orderNumber: n, phoneKey: key, status, createdAt: created, finalTotalCents: total === null ? null : total * 100, city, actualDeliveryCostCents: cost === null ? null : cost * 100 });
    const os = [
      O("TF-2026-0196", "100001762", "delivered", "2026-10-13T15:32:26Z", null, "فاس", 35),
      O("TF-2026-0334", "100005004", "new", "2026-10-29T14:54:50Z", null, "سيدي حجاج اولاد مراح"),
      O("TF-2026-0335", "100005004", "shipped", "2026-10-29T15:28:39Z", 935, "سيدي حجاج اولاد مراح"),
      O("TF-2026-0340", "100000507", "shipped", "2026-10-30T14:53:48Z", 1705, "بني ملال اغرم نلعلام", 35),
      O("TF-2026-0341", "100001762", "shipped", "2026-10-30T18:34:37Z", 731, "فاس بنسودا"),
      O("TF-2026-0435", "100001762", "shipped", "2026-11-13T01:18:24Z", 690, "فاس"),
      O("TF-2026-0516", "100000507", "shipped", "2026-11-25T22:19:54Z", 1666, "بني ملال اغرم نلعلام"),
    ];
    const r = matchParcels(ps, os);
    const byNumber = Object.fromEntries(r.orders.map((v) => [v.order.orderNumber, v]));
    expect(Object.keys(byNumber).sort()).toEqual(["TF-2026-0335", "TF-2026-0340", "TF-2026-0341"]);
    expect(byNumber["TF-2026-0335"]).toMatchObject({ kind: "ready", city: "match", feeCents: 3500 });
    expect(byNumber["TF-2026-0340"]).toMatchObject({ kind: "decide", codCents: 170600, feeCents: 11500, roundingCents: 100, costConflict: true });
    expect(byNumber["TF-2026-0341"]).toMatchObject({ kind: "decide", codCents: 73000, roundingCents: -100 });
    expect(r.parcelGroups).toHaveLength(1);
    expect(r.parcelGroups[0].parcels.map((p) => p.codCents)).toEqual([40500]);
    // ما كاين حتى أثر لـ0516 ولا 0435 (تسجّلو من بعد الإرسال).
    expect(JSON.stringify(r)).not.toMatch(/0516|0435/);
  });

  it("هاتف بلا طلبية → بلا طلبية؛ هاتف طلبية مسوّاة → كرطونة زائدة", () => {
    const r1 = matchParcels([parcel({ codCents: 1000, phoneKey: "699999999" })], []);
    expect(r1.parcelGroups[0].kind).toBe("unmatched");
    const settled = order({ finalTotalCents: 63500, settled: true });
    const r2 = matchParcels([parcel({ codCents: 0 })], [settled]);
    expect(r2.parcelGroups[0].kind).toBe("extra");
  });
});
