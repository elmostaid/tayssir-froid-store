import { escapeHtml } from "@/lib/pdf/htmlFallback";
import { splitProductNameSnapshot } from "@/lib/orders/productNameSnapshot";
import { formatMad } from "@/lib/format";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";

// المحتوى المشترك لبون التحضير (HTML)، يُستعمل في مكانين: بديل HTML عند فشل
// توليد PDF، وصفحة الطباعة المباشرة في لوحة الإدارة — نفس البيانات بالضبط
// في كلا المكانين حتى لا يختلف ما يُطبَع عمّا يُنزَّل كـPDF.
export function buildPickingSlipBodyHtml(order: AdminOrderDetail, items: AdminOrderItem[]): string {
  const rows = items
    .map((item) => {
      const { productName, variantName } = splitProductNameSnapshot(item.productNameSnapshot);
      return `<tr>
        <td>${escapeHtml(productName)}</td>
        <td>${escapeHtml(item.skuSnapshot)}</td>
        <td>${escapeHtml(variantName ?? "")}</td>
        <td>${item.quantity}</td>
        <td>${escapeHtml(formatMad(item.unitPriceSnapshot))}</td>
        <td>${escapeHtml(formatMad(item.lineTotal))}</td>
        <td>[ ]</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="letterhead">
      <img src="/brand/logo-tayssir-froid.png" alt="Tayssir Froid" class="logo" />
      <div class="title-block">
        <h1>بون تحضير الطلب</h1>
        <p class="order-number">${escapeHtml(order.orderNumber)}</p>
      </div>
    </div>
    <div class="field"><span>التاريخ</span><span>${escapeHtml(new Date(order.createdAt).toLocaleString("ar-MA"))}</span></div>
    <div class="field"><span>اسم الزبون</span><span>${escapeHtml(order.customerName)}</span></div>
    <div class="field"><span>رقم الهاتف</span><span>${escapeHtml(order.customerPhone)}</span></div>
    <div class="field"><span>المدينة</span><span>${escapeHtml(order.customerCity)}</span></div>
    <div class="field"><span>العنوان</span><span>${escapeHtml(order.customerAddress)}</span></div>
    ${order.customerNotes ? `<div class="field"><span>ملاحظة الزبون</span><span>${escapeHtml(order.customerNotes)}</span></div>` : ""}
    <table>
      <thead><tr><th>المنتج</th><th>SKU</th><th>المتغير</th><th>الكمية</th><th>ثمن الوحدة</th><th>المجموع</th><th>✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="field" style="margin-top:12px;font-weight:bold;"><span>مجموع المنتجات</span><span>${escapeHtml(formatMad(order.itemsSubtotal))}</span></div>
    <div class="field"><span>مصاريف التوصيل</span><span>${order.deliveryFee ? escapeHtml(formatMad(order.deliveryFee)) : "غير محدَّدة بعد"}</span></div>
    ${
      order.finalTotal
        ? `<div class="field total-final"><span>المبلغ الإجمالي عند الاستلام</span><span>${escapeHtml(formatMad(order.finalTotal))}</span></div>`
        : ""
    }
    <p class="note">طريقة الدفع: الدفع عند الاستلام — مستند داخلي فقط، لا يُعرض للزبون.</p>
  `;
}
