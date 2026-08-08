"use client";

import { useState } from "react";
import type { AdminOrderDetail } from "@/lib/queries/adminOrders";

function buildDeliveryInfoText(order: AdminOrderDetail): string {
  const lines = [
    `الاسم: ${order.customerName}`,
    `الهاتف: ${order.customerPhone}`,
    `المدينة: ${order.customerCity}`,
    `العنوان: ${order.customerAddress}`,
  ];
  if (order.customerNotes) lines.push(`ملاحظة: ${order.customerNotes}`);
  return lines.join("\n");
}

export function CopyDeliveryInfoButton({ order }: { order: AdminOrderDetail }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(buildDeliveryInfoText(order));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
    >
      {copied ? "تم النسخ ✓" : "نسخ معلومات التوصيل"}
    </button>
  );
}
