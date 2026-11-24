import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * صفحة الطلب اليدوي سقطت («This page couldn't load») لأن إجراءات الخادم
 * كانت **ترمي** عند انقطاع قاعدة البيانات، والرمي يصعد في المتصفح إلى حدّ
 * الخطأ. هذه الاختبارات تحرس العقد الجديد: كل إجراء تستعمله الصفحة يُرجع
 * رسالة ولا يرمي — بحث المنتجات، الاستيراد، الحفظ، والتحقق من الحساب.
 */

const getAdminUser = vi.fn();
vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: () => getAdminUser(),
  isOwnerAdmin: (a: { role?: string } | null) => a?.role === "admin",
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
const searchProductsForOrder = vi.fn();
vi.mock("@/lib/queries/adminProductSearch", async (orig) => ({
  ...(await orig<object>()),
  searchProductsForOrder: (...a: unknown[]) => searchProductsForOrder(...a),
}));
const createManualOrder = vi.fn();
vi.mock("@/lib/orders/createManualOrder", async (orig) => ({
  ...(await orig<object>()),
  createManualOrder: (...a: unknown[]) => createManualOrder(...a),
}));
const buildOrderDraft = vi.fn();
vi.mock("@/lib/orders/importOrder", async (orig) => ({
  ...(await orig<object>()),
  buildOrderDraft: (...a: unknown[]) => buildOrderDraft(...a),
}));

const actions = await import("@/app/admin/(protected)/orders/actions");
const connectTimeout = Object.assign(new Error("write CONNECT_TIMEOUT aws-0-eu-north-1.pooler.supabase.com:6543"), {
  code: "CONNECT_TIMEOUT",
});

function manualForm() {
  const fd = new FormData();
  fd.set("source", "whatsapp");
  fd.set("fullName", "زبون");
  fd.set("phone", "0612345678");
  fd.set("city", "فاس");
  fd.set("address", "حي");
  fd.set("deliveryFee", "35");
  fd.set("idempotencyKey", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  fd.append("productId", "1");
  fd.append("quantity", "2");
  fd.append("unitPrice", "100");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAdminUser.mockResolvedValue({ id: "u", email: "owner@test", role: "admin" });
});

describe("إجراءات الطلب اليدوي لا ترمي عند انقطاع القاعدة", () => {
  test("بحث المنتجات: مهلة اتصال ⇒ رسالة، لا استثناء", async () => {
    searchProductsForOrder.mockRejectedValue(connectTimeout);
    const r = await actions.searchProductsAction("ضاغط");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/تعذّر البحث/);
  });

  test("بحث المنتجات: يعمل عادياً حين تجيب القاعدة", async () => {
    searchProductsForOrder.mockResolvedValue([{ id: 1 }]);
    expect(await actions.searchProductsAction("ضاغط")).toEqual({ ok: true, results: [{ id: 1 }] });
  });

  test("التحقق من الحساب نفسه يرمي (admin_profiles) ⇒ رسالة انقطاع، لا «غير مصرَّح» ولا استثناء", async () => {
    getAdminUser.mockRejectedValue(connectTimeout);
    const r = await actions.searchProductsAction("ضاغط");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/انقطع الاتصال/);
  });

  test("الحفظ: createManualOrder يرمي (البحث بمفتاح المحاولة قبل المعاملة) ⇒ رسالة، لا استثناء", async () => {
    createManualOrder.mockRejectedValue(connectTimeout);
    const r = await actions.createManualOrderAction({ error: null }, manualForm());
    expect(r.error).toMatch(/انقطع الاتصال/);
    // نفس مفتاح المحاولة يصل للخادم في الإعادة، فلا تكرار.
    expect(createManualOrder.mock.calls[0][0].idempotencyKey).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
  });

  test("الاستيراد: مهلة أثناء المطابقة ⇒ أخطاء معروضة، لا استثناء", async () => {
    buildOrderDraft.mockRejectedValue(connectTimeout);
    const r = await actions.importOrderDraftAction(
      JSON.stringify({ customer: { name: "x" }, items: [{ sku: "A", quantity: 1 }] })
    );
    expect(r.ok).toBe(false);
  });
});
