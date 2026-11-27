"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { parseMadToCents, parseReceivedDay } from "@/lib/settlements/money";
import {
  acknowledgeInvoiceWarnings,
  addExtraParcelsToSettlement,
  applySettlements,
  linkParcelsToOrder,
  markInvoiceBankReceived,
  markInvoicesBankReceived,
  rollbackInvoice,
  unlinkParcels,
} from "@/lib/settlements/settlementStore";

/**
 * إجراءات صفحة «تسويات التوصيل». كلها لصاحب الحساب وحده، وكلها تُعيد التحقق
 * من الصلاحية من جهة الخادم (إخفاء الرابط في القائمة ليس حماية).
 *
 * لا شيء هنا يستدعي `updateOrderStatus` ولا `sendDeferredPurchase`: التسليم من
 * فاتورة توصيل لا يُرسل Purchase إلى Meta.
 */

async function requireOwner() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");
  return admin;
}

function ids(formData: FormData, key: string): number[] {
  return formData
    .getAll(key)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function revalidateOrders() {
  revalidatePath("/admin/settlements");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/reports");
  revalidatePath("/admin/finance");
}

export async function applySettlementsAction(formData: FormData) {
  const admin = await requireOwner();
  const readyOrderIds = ids(formData, "ready");
  const approvedOrderIds = ids(formData, "approve");
  const returnOrderIds = ids(formData, "return");
  // «موافقة سريعة»: التكلفة اليدوية ← الفاتورة، والتقريب. المخزن كيتأكد بلي ما فيها حتى مشكل آخر.
  const quickOrderIds = [...ids(formData, "quick_cost"), ...ids(formData, "quick_round")];
  if (
    readyOrderIds.length === 0 &&
    approvedOrderIds.length === 0 &&
    returnOrderIds.length === 0 &&
    quickOrderIds.length === 0
  ) {
    redirect("/admin/settlements?notice=none");
  }
  let applied = 0;
  let returned = 0;
  let skipped = 0;
  let failure: string | null = null;
  try {
    const res = await applySettlements({
      readyOrderIds,
      approvedOrderIds,
      returnOrderIds,
      quickOrderIds,
      actor: admin.email,
    });
    returned = res.applied.filter((a) => a.outcome === "returned").length;
    applied = res.applied.length - returned;
    skipped = res.skipped.length;
  } catch (error) {
    console.error("applySettlementsAction", error);
    failure = error instanceof Error ? error.message : "تعذّر التطبيق.";
  }
  revalidateOrders();
  if (failure) redirect(`/admin/settlements?error=${encodeURIComponent(failure)}`);
  redirect(`/admin/settlements?applied=${applied}&returned=${returned}&skipped=${skipped}`);
}

export async function rollbackInvoiceAction(formData: FormData) {
  const admin = await requireOwner();
  const invoiceId = Number(formData.get("invoiceId"));
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) redirect("/admin/settlements");
  const res = await rollbackInvoice(invoiceId, admin.email);
  revalidateOrders();
  if (!res.ok) redirect(`/admin/settlements/${invoiceId}?error=${encodeURIComponent(res.error ?? "")}`);
  const kept = res.kept.map((k) => `${k.orderNumber}: ${k.detail}`).join("\n");
  redirect(
    `/admin/settlements/${invoiceId}?rolledBack=${res.revertedOrders.length}` +
      (kept ? `&kept=${encodeURIComponent(kept.slice(0, 1500))}` : "")
  );
}

export async function markBankAction(formData: FormData) {
  const admin = await requireOwner();
  const invoiceId = Number(formData.get("invoiceId"));
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) redirect("/admin/settlements");
  const clear = formData.get("clear") === "1";
  const cents = clear ? null : parseMadToCents(String(formData.get("amount") ?? ""));
  if (!clear && (cents === null || cents < 0)) {
    redirect(`/admin/settlements/${invoiceId}?error=${encodeURIComponent("المبلغ غير صالح.")}`);
  }
  const day = clear ? null : parseReceivedDay(String(formData.get("receivedOn") ?? ""));
  if (!clear && day === "invalid") {
    redirect(`/admin/settlements/${invoiceId}?error=${encodeURIComponent("التاريخ غير صالح أو فالمستقبل.")}`);
  }
  await markInvoiceBankReceived(invoiceId, cents, admin.email, day === "invalid" ? null : day);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/settlements");
  revalidatePath(`/admin/settlements/${invoiceId}`);
  redirect(`/admin/settlements/${invoiceId}`);
}

/** ربط يدوي: ماشي تطبيق. الطلبية كتبان من بعد فـ«تحتاج قرارك» بأدلتها. */
export async function linkParcelsAction(formData: FormData) {
  const admin = await requireOwner();
  const parcelIds = ids(formData, "parcel");
  const orderNumber = String(formData.get("orderNumber") ?? "");
  let res: Awaited<ReturnType<typeof linkParcelsToOrder>>;
  try {
    res = await linkParcelsToOrder(parcelIds, orderNumber, admin.email);
  } catch (error) {
    console.error("linkParcelsAction", error);
    res = { ok: false, error: "تعذّر الربط، عاود." };
  }
  revalidatePath("/admin/settlements");
  if (!res.ok) redirect(`/admin/settlements?error=${encodeURIComponent(res.error)}`);
  redirect(`/admin/settlements?linked=${encodeURIComponent(res.orderNumber)}`);
}

export async function unlinkParcelsAction(formData: FormData) {
  await requireOwner();
  const parcelIds = ids(formData, "parcel");
  if (parcelIds.length > 0) await unlinkParcels(parcelIds);
  revalidatePath("/admin/settlements");
  redirect("/admin/settlements?unlinked=1");
}

/** موافقة المالك على فرق مجاميع الكشف (مثلاً «Total Colis» ديال Ozon). */
export async function acknowledgeWarningsAction(formData: FormData) {
  const admin = await requireOwner();
  const invoiceId = Number(formData.get("invoiceId"));
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) redirect("/admin/settlements");
  await acknowledgeInvoiceWarnings(invoiceId, admin.email);
  revalidatePath("/admin/settlements");
  revalidatePath(`/admin/settlements/${invoiceId}`);
  if (formData.get("back") === "list") redirect("/admin/settlements?acknowledged=1");
  redirect(`/admin/settlements/${invoiceId}?acknowledged=1`);
}

/** كرطونة زايدة (تحصيل 0) لطلبية مسوّاة: تكلفتها كتتزاد على نفس التسوية. */
export async function addExtraParcelsAction(formData: FormData) {
  const admin = await requireOwner();
  const parcelIds = ids(formData, "parcel");
  const orderId = Number(formData.get("orderId"));
  let res: Awaited<ReturnType<typeof addExtraParcelsToSettlement>>;
  try {
    res = Number.isInteger(orderId) && orderId > 0
      ? await addExtraParcelsToSettlement(parcelIds, orderId, admin.email)
      : { ok: false, error: "طلبية غير صالحة." };
  } catch (error) {
    console.error("addExtraParcelsAction", error);
    res = { ok: false, error: "تعذّرت الزيادة، عاود." };
  }
  revalidateOrders();
  if (!res.ok) redirect(`/admin/settlements?error=${encodeURIComponent(res.error)}`);
  redirect(`/admin/settlements?extra=${encodeURIComponent(res.orderNumber)}&extraFee=${res.addedCents}`);
}

/** «وصلات للبنك» لعدة كشوفات: صافي كل كشف، وتاريخ الوصول. منفصل على التسليم. */
export async function markBankBulkAction(formData: FormData) {
  const admin = await requireOwner();
  const invoiceIds = ids(formData, "inv");
  if (invoiceIds.length === 0) redirect("/admin/settlements/bank?notice=none");
  const day = parseReceivedDay(String(formData.get("receivedOn") ?? ""));
  if (day === "invalid") {
    redirect(`/admin/settlements/bank?error=${encodeURIComponent("التاريخ غير صالح أو فالمستقبل.")}`);
  }
  const n = await markInvoicesBankReceived(invoiceIds, day, admin.email);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/settlements");
  revalidatePath("/admin/settlements/bank");
  redirect(`/admin/settlements/bank?marked=${n}`);
}
