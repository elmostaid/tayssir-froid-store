import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth/requireAdmin";
import { getAdminOrderById, getAdminOrderItems } from "@/lib/queries/adminOrders";
import { wrapHtmlDocument } from "@/lib/pdf/htmlFallback";
import { buildPickingSlipBodyHtml } from "@/lib/pdf/pickingSlipHtml";

// صفحة طباعة مباشرة (وليست بديل PDF فاشل) — نفس محتوى بون التحضير، مع زر
// "طباعة أو حفظ PDF" بدل تنبيه الفشل، مناسبة لورق A4 (نفس @page في htmlFallback).
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

  const html = wrapHtmlDocument(`بون تحضير ${order.orderNumber}`, buildPickingSlipBodyHtml(order, items), {
    mode: "print",
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
