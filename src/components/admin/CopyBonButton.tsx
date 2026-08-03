"use client";

import { useState } from "react";
import { formatMad } from "@/lib/format";
import { splitProductNameSnapshot } from "@/lib/orders/productNameSnapshot";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";

function buildBonText(order: AdminOrderDetail, items: AdminOrderItem[]): string {
  const lines: string[] = [];
  lines.push(`بون تحضير الطلب ${order.orderNumber}`);
  lines.push(`التاريخ: ${new Date(order.createdAt).toLocaleString("ar-MA")}`);
  lines.push(`اسم الزبون: ${order.customerName}`);
  lines.push(`رقم الهاتف: ${order.customerPhone}`);
  lines.push(`المدينة: ${order.customerCity}`);
  lines.push(`العنوان: ${order.customerAddress}`);
  if (order.customerNotes) lines.push(`ملاحظة الزبون: ${order.customerNotes}`);
  lines.push("");
  lines.push("المنتجات:");
  for (const item of items) {
    const { productName, variantName } = splitProductNameSnapshot(item.productNameSnapshot);
    const variantPart = variantName ? ` (${variantName})` : "";
    lines.push(
      `- ${productName}${variantPart} | SKU: ${item.skuSnapshot} | الكمية: ${item.quantity} | ثمن الوحدة: ${formatMad(item.unitPriceSnapshot)} | المجموع: ${formatMad(item.lineTotal)}`
    );
  }
  lines.push("");
  lines.push(`مجموع المنتجات: ${formatMad(order.itemsSubtotal)}`);
  lines.push(`مصاريف التوصيل: ${order.deliveryFee ? formatMad(order.deliveryFee) : "غير محدَّدة بعد"}`);
  if (order.finalTotal) {
    lines.push(`المبلغ الإجمالي عند الاستلام: ${formatMad(order.finalTotal)}`);
  }
  lines.push("");
  lines.push("طريقة الدفع: الدفع عند الاستلام");

  return lines.join("\n");
}

export function CopyBonButton({ order, items }: { order: AdminOrderDetail; items: AdminOrderItem[] }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(buildBonText(order, items));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
    >
      {copied ? "تم النسخ ✓" : "نسخ البون"}
    </button>
  );
}
