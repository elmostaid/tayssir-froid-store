import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAdminOrderById, getAdminOrderItems } from "@/lib/queries/adminOrders";
import { registerPdfFonts } from "@/lib/pdf/theme";
import { PickingSlipDocument } from "@/lib/pdf/PickingSlipDocument";
import { escapeHtml, wrapHtmlDocument } from "@/lib/pdf/htmlFallback";
import { formatMad } from "@/lib/format";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";

function pickingSlipHtmlFallback(order: AdminOrderDetail, items: AdminOrderItem[]): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.productNameSnapshot)}</td>
        <td>${escapeHtml(item.skuSnapshot)}</td>
        <td>${item.quantity}</td>
        <td>${escapeHtml(item.unitLabel ?? "")}</td>
        <td>[ ]</td>
      </tr>`
    )
    .join("");

  const body = `
    <h1>بون تحضير الطلب — ${escapeHtml(order.orderNumber)}</h1>
    <div class="field"><span>التاريخ</span><span>${escapeHtml(new Date(order.createdAt).toLocaleString("ar-MA"))}</span></div>
    <div class="field"><span>اسم الزبون</span><span>${escapeHtml(order.customerName)}</span></div>
    <div class="field"><span>رقم الهاتف</span><span>${escapeHtml(order.customerPhone)}</span></div>
    <div class="field"><span>المدينة</span><span>${escapeHtml(order.customerCity)}</span></div>
    <div class="field"><span>العنوان</span><span>${escapeHtml(order.customerAddress)}</span></div>
    ${order.customerNotes ? `<div class="field"><span>ملاحظة الزبون</span><span>${escapeHtml(order.customerNotes)}</span></div>` : ""}
    <table>
      <thead><tr><th>المنتج</th><th>SKU</th><th>الكمية</th><th>الوحدة</th><th>✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="field" style="margin-top:12px;font-weight:bold;"><span>مجموع المنتجات</span><span>${formatMad(order.itemsSubtotal)}</span></div>
    <p class="note">طريقة الدفع: الدفع عند الاستلام — مستند داخلي فقط، لا يُعرض للزبون.</p>
  `;
  return wrapHtmlDocument(`بون تحضير ${order.orderNumber}`, body);
}

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "غير مصرَّح." }, { status: 401 });
  }

  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) {
    return NextResponse.json({ error: "معرّف طلب غير صالح." }, { status: 400 });
  }

  const order = await getAdminOrderById(orderId);
  if (!order) {
    return NextResponse.json({ error: "الطلب غير موجود." }, { status: 404 });
  }
  const items = await getAdminOrderItems(orderId);

  try {
    registerPdfFonts();
    const buffer = await renderToBuffer(PickingSlipDocument({ order, items }));

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="order-${order.orderNumber}-picking.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // مكتبة توليد PDF قد تنهار مع نصوص عربية عادية (قصيرة أو طويلة، حسب
    // العرض الدقيق وقت التخطيط وليس حسب طول النص نفسه — خطأ حقيقي داخل
    // محرك ترتيب النصوص فيها، تكرَّر مع أغلب أسماء منتجات عربية واقعية
    // أثناء الاختبار) — نعرض بديلاً HTML بدل رمي خطأ 500 خام، حتى يبقى
    // بون التحضير قابلاً للعرض والطباعة دائماً.
    console.error("picking-slip.pdf: فشل توليد PDF، التراجع إلى HTML", orderId, error);
    return new NextResponse(pickingSlipHtmlFallback(order, items), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
}
