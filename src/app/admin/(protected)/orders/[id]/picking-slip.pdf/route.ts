import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAdminOrderById, getAdminOrderItems } from "@/lib/queries/adminOrders";
import { registerPdfFonts } from "@/lib/pdf/theme";
import { PickingSlipDocument } from "@/lib/pdf/PickingSlipDocument";
import { wrapHtmlDocument } from "@/lib/pdf/htmlFallback";
import { buildPickingSlipBodyHtml } from "@/lib/pdf/pickingSlipHtml";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";

function pickingSlipHtmlFallback(order: AdminOrderDetail, items: AdminOrderItem[]): string {
  return wrapHtmlDocument(`بون تحضير ${order.orderNumber}`, buildPickingSlipBodyHtml(order, items), {
    mode: "fallback",
  });
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
