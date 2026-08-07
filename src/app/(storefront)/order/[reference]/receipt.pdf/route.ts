import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  getOrderByPublicReference,
  getOrderItemsByPublicReference,
  type OrderSummary,
  type OrderLineSummary,
} from "@/lib/queries/orders";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";
import { registerPdfFonts } from "@/lib/pdf/theme";
import { CustomerReceiptDocument } from "@/lib/pdf/CustomerReceiptDocument";
import { escapeHtml, wrapHtmlDocument } from "@/lib/pdf/htmlFallback";
import { formatMad } from "@/lib/format";

export const runtime = "nodejs";

function receiptHtmlFallback(
  order: OrderSummary,
  items: OrderLineSummary[],
  deliveryFeePerCartonMad: number
): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.productNameSnapshot)}</td>
        <td>${item.quantity}</td>
        <td>${formatMad(item.unitPriceSnapshot)}</td>
        <td>${formatMad(item.lineTotal)}</td>
      </tr>`
    )
    .join("");

  const body = `
    <h1>تأكيد الطلب — ${escapeHtml(order.publicReference)}</h1>
    <div class="field"><span>التاريخ</span><span>${escapeHtml(new Date(order.createdAt).toLocaleString("ar-MA"))}</span></div>
    <div class="field"><span>اسم الزبون</span><span>${escapeHtml(order.customerName)}</span></div>
    <div class="field"><span>المدينة</span><span>${escapeHtml(order.customerCity)}</span></div>
    <table>
      <thead><tr><th>المنتج</th><th>الكمية</th><th>ثمن الوحدة</th><th>المجموع</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="field" style="margin-top:12px;font-weight:bold;"><span>مجموع المنتجات</span><span>${formatMad(order.itemsSubtotal)}</span></div>
    <p class="note">
      طريقة الدفع: الدفع عند الاستلام فقط. التوصيل ${formatMad(deliveryFeePerCartonMad)} لكل كرطونة،
      يُحدَّد عدد الكرطونات بعد تجهيز الطلب. هذا طلب أولي في انتظار تأكيد فريق Tayssir Froid.
    </p>
  `;
  return wrapHtmlDocument(`وصل الطلب ${order.publicReference}`, body);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;

  const order = await getOrderByPublicReference(reference);
  if (!order) {
    return NextResponse.json({ error: "الطلب غير موجود." }, { status: 404 });
  }

  const [items, settings] = await Promise.all([
    getOrderItemsByPublicReference(reference),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "receiptPdf.getSettings"),
  ]);

  try {
    registerPdfFonts();
    const buffer = await renderToBuffer(
      CustomerReceiptDocument({
        orderNumber: order.publicReference,
        createdAt: order.createdAt,
        customerName: order.customerName,
        customerCity: order.customerCity,
        itemsSubtotal: order.itemsSubtotal,
        deliveryFeePerCartonMad: settings.deliveryFeePerCartonMad,
        items: items.map((item, i) => ({
          id: i,
          name: item.productNameSnapshot,
          quantity: item.quantity,
          unitPrice: item.unitPriceSnapshot,
          lineTotal: item.lineTotal,
        })),
      })
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="order-${order.publicReference}-receipt.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // نفس احتياط بون التحضير: بعض تركيبات النصوص العربية تُسقط مكتبة PDF —
    // نعرض HTML بدل خطأ 500 خام حتى يبقى وصل الطلب قابلاً للعرض والطباعة.
    console.error("receipt.pdf: فشل توليد PDF، التراجع إلى HTML", reference, error);
    return new NextResponse(receiptHtmlFallback(order, items, settings.deliveryFeePerCartonMad), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
}
