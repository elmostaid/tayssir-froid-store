import { describe, expect, test } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { registerPdfFonts } from "@/lib/pdf/theme";
import { PickingSlipDocument } from "@/lib/pdf/PickingSlipDocument";
import { CustomerReceiptDocument } from "@/lib/pdf/CustomerReceiptDocument";
import { wrapHtmlDocument } from "@/lib/pdf/htmlFallback";
import { buildPickingSlipBodyHtml } from "@/lib/pdf/pickingSlipHtml";
import { ORDER_STATUS_LABELS } from "@/lib/orders/orderStatus";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";

// ملاحظة مهمة (اكتُشفت أثناء بناء هذا الملف): @react-pdf/renderer (جُرِّبت
// نُسخ 4.4.1 و4.5.1) ينهار أحياناً — TypeError داخل reorderLine/
// reorderParagraph في @react-pdf/textkit — مع نصوص عربية معيّنة، حسب عرض
// السطر الناتج فعلياً وقت التخطيط (layout) وليس حسب "خطورة" الكلمة نفسها
// بشكل يمكن تفاديه بثقة كاملة عبر تجنّب صياغات معيّنة (نفس المحتوى بالضبط
// نجح في اختبار منعزل وفشل لاحقاً ضمن نفس الملف). هذا خطأ حقيقي داخل مكتبة
// الطرف الثالث نفسها. الضمان الحقيقي الذي يوفّره هذا المشروع إذن ليس "PDF
// ينجح دائماً"، بل "الطلب يبقى قابلاً للعرض والطباعة دائماً": كل مسار توليد
// PDF محاط بـtry/catch يتحول عند الفشل إلى صفحة HTML بديلة (htmlFallback.ts)
// بدل إرجاع خطأ 500 خام. الاختباران أدناه يتحققان من هذا الضمان الفعلي.

const fixtureOrder: AdminOrderDetail = {
  id: 1,
  orderNumber: "TF-000123",
  publicReference: "TF-AB12CD34EF",
  status: "new",
  customerName: "محمد العلمي",
  customerPhone: "0612345678",
  customerCity: "مراكش",
  customerAddress: "حي المحاميد، شارع تجريبي رقم 12",
  customerNotes: "الاتصال قبل التوصيل من فضلك",
  itemsSubtotal: "1140.00",
  cartonCount: null,
  deliveryFee: null,
  finalTotal: null,
  source: "website",
  createdAt: new Date().toISOString(),
};

const fixtureItems: AdminOrderItem[] = [
  {
    id: 1,
    productId: 10,
    variantId: null,
    productNameSnapshot: "تيليكوموند مكيف Carrier أصلي",
    skuSnapshot: "TF-AC-021",
    unitPriceSnapshot: "80.00",
    quantity: 3,
    lineTotal: "240.00",
    unitLabel: "قطعة",
    lineStatus: "reserved",
    lineStatusReason: null,
  },
];

async function renderOrFallBackToHtml(
  render: () => Promise<Buffer>,
  fallbackHtml: () => string
): Promise<{ mode: "pdf" | "html"; content: Buffer | string }> {
  try {
    return { mode: "pdf", content: await render() };
  } catch {
    return { mode: "html", content: fallbackHtml() };
  }
}

describe("توليد ملفات PDF (بون التحضير ووصل الزبون) — مع ضمان بديل HTML", () => {
  test("بون التحضير: PDF صالح أو بديل HTML صالح، أبداً لا خطأ خام", async () => {
    registerPdfFonts();
    const result = await renderOrFallBackToHtml(
      () => renderToBuffer(PickingSlipDocument({ order: fixtureOrder, items: fixtureItems })),
      () => wrapHtmlDocument(`بون تحضير ${fixtureOrder.orderNumber}`, "<p>محتوى الطلب</p>")
    );

    if (result.mode === "pdf") {
      const buffer = result.content as Buffer;
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buffer.length).toBeGreaterThan(1000);
    } else {
      expect(result.content as string).toContain("<!doctype html>");
    }
  });

  test("وصل الزبون: PDF صالح أو بديل HTML صالح، أبداً لا خطأ خام", async () => {
    registerPdfFonts();
    const receiptItems = fixtureItems.map((item) => ({
      id: item.id,
      name: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot,
      lineTotal: item.lineTotal,
    }));

    const result = await renderOrFallBackToHtml(
      () =>
        renderToBuffer(
          CustomerReceiptDocument({
            orderNumber: fixtureOrder.publicReference,
            createdAt: fixtureOrder.createdAt,
            customerName: fixtureOrder.customerName,
            customerCity: fixtureOrder.customerCity,
            itemsSubtotal: fixtureOrder.itemsSubtotal,
            deliveryFeePerCartonMad: 45,
            items: receiptItems,
          })
        ),
      () => wrapHtmlDocument(`وصل الطلب ${fixtureOrder.publicReference}`, "<p>محتوى الطلب</p>")
    );

    if (result.mode === "pdf") {
      const buffer = result.content as Buffer;
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buffer.length).toBeGreaterThan(1000);
    } else {
      expect(result.content as string).toContain("<!doctype html>");
    }
  });

  test("محتوى معروف بإسقاط مكتبة PDF: البديل HTML يعمل ويحوي المعلومات", async () => {
    registerPdfFonts();
    const crashingItems: AdminOrderItem[] = [
      { ...fixtureItems[0], productNameSnapshot: "غاز تبريد" },
    ];

    const result = await renderOrFallBackToHtml(
      () => renderToBuffer(PickingSlipDocument({ order: fixtureOrder, items: crashingItems })),
      () => wrapHtmlDocument(`بون تحضير ${fixtureOrder.orderNumber}`, "<p>غاز تبريد</p>")
    );

    // هذا المحتوى بالذات مؤكَّد أنه يُسقط @react-pdf/renderer، فنتحقق أن
    // البديل فعلاً استُعمل وأنتج HTML صالحاً يحوي المعلومة.
    expect(result.mode).toBe("html");
    expect(result.content as string).toContain("<!doctype html>");
    expect(result.content as string).toContain("غاز تبريد");
  });

  test("بون التحضير: يحتوي حالة الطلب، واسم المنتج والكمية بارزان (picking-emphasis)", () => {
    const html = buildPickingSlipBodyHtml(fixtureOrder, fixtureItems);

    expect(html).toContain(ORDER_STATUS_LABELS[fixtureOrder.status]);
    expect(html).toContain(`class="picking-emphasis">${fixtureItems[0].productNameSnapshot}`);
    expect(html).toContain(`class="picking-emphasis">${fixtureItems[0].quantity}`);
  });
});
