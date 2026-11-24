import { beforeEach, describe, expect, test } from "vitest";
import {
  MANUAL_DRAFT_TTL_MS,
  clearManualDraft,
  isMeaningfulDraft,
  loadManualDraft,
  manualDraftStorageKey,
  parseManualDraft,
  saveManualDraft,
  type DraftCustomer,
} from "@/lib/orders/manualOrderDraft";

const customer: DraftCustomer = {
  fullName: "زبون",
  phone: "0612345678",
  city: "فاس",
  address: "حي",
  source: "whatsapp",
  originReference: "",
  notes: "",
  adConsentDeclared: false,
  actualDeliveryCost: "",
};
const line = (i: number) => ({
  productId: i,
  sku: `SKU-${i}`,
  name: `منتج ${i}`,
  quantity: 2,
  unitPrice: 100,
  purchasePrice: 60,
  stockQuantity: 50,
  reservedQuantity: 0,
});

beforeEach(() => sessionStorage.clear());

describe("مسودّة الطلب اليدوي", () => {
  test("تُحفظ وتُسترجع كما هي — 50 منتجاً ومفتاح المحاولة", () => {
    const key = manualDraftStorageKey();
    const lines = Array.from({ length: 50 }, (_, i) => line(i + 1));
    saveManualDraft(key, { attemptKey: "k-1", customer, lines, deliveryFee: 35 });
    const d = loadManualDraft(key);
    expect(d?.lines).toHaveLength(50);
    expect(d?.attemptKey).toBe("k-1");
    expect(d?.customer.fullName).toBe("زبون");
    expect(d?.deliveryFee).toBe(35);
  });

  test("في sessionStorage لا localStorage (التبويب وحده)", () => {
    saveManualDraft(manualDraftStorageKey(), { attemptKey: null, customer, lines: [], deliveryFee: 0 });
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  test("نموذج فارغ لا يُحفظ، والحذف يمحوها", () => {
    const key = manualDraftStorageKey();
    const empty = { ...customer, fullName: "", phone: "", city: "", address: "" };
    saveManualDraft(key, { attemptKey: null, customer: empty, lines: [], deliveryFee: 0 });
    expect(loadManualDraft(key)).toBeNull();
    saveManualDraft(key, { attemptKey: null, customer, lines: [], deliveryFee: 0 });
    clearManualDraft(key);
    expect(loadManualDraft(key)).toBeNull();
  });

  test("تنتهي بعد 12 ساعة، وأي شكل فاسد يُرفض بلا انهيار", () => {
    const old = JSON.stringify({ v: 1, savedAt: 0, attemptKey: null, customer, lines: [], deliveryFee: 0 });
    expect(parseManualDraft(old, MANUAL_DRAFT_TTL_MS + 1)).toBeNull();
    expect(parseManualDraft("{not json")).toBeNull();
    expect(parseManualDraft(JSON.stringify({ v: 1, savedAt: Date.now() }))).toBeNull();
    const badLine = JSON.stringify({ v: 1, savedAt: Date.now(), attemptKey: "k", customer, lines: [{ productId: "x" }, line(1)], deliveryFee: 0 });
    expect(parseManualDraft(badLine)?.lines).toHaveLength(1);
  });

  test("مفتاح منفصل لكل تحويل واتساب", () => {
    expect(manualDraftStorageKey(7)).not.toBe(manualDraftStorageKey());
    expect(isMeaningfulDraft({ customer, lines: [] })).toBe(true);
  });
});
