import { describe, expect, test } from "vitest";
import {
  buildWhatsAppLink,
  buildProductWhatsAppLink,
  buildCustomerWhatsAppLink,
} from "@/lib/whatsapp";

function textParam(link: string): string {
  const url = new URL(link);
  const text = url.searchParams.get("text");
  if (text === null) throw new Error("لا يوجد معامل text فالرابط");
  return text;
}

describe("buildWhatsAppLink", () => {
  // api.whatsapp.com/send وليس wa.me عمداً — انظر التعليق فوق buildWhatsAppLink
  // فـsrc/lib/whatsapp.ts: wa.me يفقد "text" أحياناً على الحاسوب عبر القفزة
  // الوسيطة الإضافية نحو WhatsApp Web، بينما api.whatsapp.com/send المباشر لا.
  test("يبني رابط api.whatsapp.com/send برقم settings.whatsappNumber المُمرَّر، وليس ثابتاً مكتوباً هنا", () => {
    const link = buildWhatsAppLink("0612345678", "مرحباً");
    expect(link.startsWith("https://api.whatsapp.com/send/?")).toBe(true);
    const url = new URL(link);
    expect(url.searchParams.get("phone")).toBe("212612345678");
    expect(url.searchParams.get("type")).toBe("phone_number");
    expect(url.searchParams.get("app_absent")).toBe("0");
  });

  test("رقم بصيغة +212 يُحوَّل لنفس الصيغة الدولية", () => {
    const link = buildWhatsAppLink("+212722083458", "مرحباً");
    expect(new URL(link).searchParams.get("phone")).toBe("212722083458");
  });

  test("يشفّر النص العربي داخل الرابط ويُعيده كما هو تماماً عند فك الترميز", () => {
    const link = buildWhatsAppLink("0612345678", "سؤال");
    expect(textParam(link)).toBe("سؤال");
  });

  test("رسالة طلب عربية طويلة (أسطر متعددة، أسعار، رموز، SKU) — text لا يضيع ولا يُقطَع أبداً", () => {
    const longMessage = [
      "طلب جديد من موقع طيسير فرويد",
      "",
      "الاسم الكامل: عبد الرحمان بنعلي الإدريسي",
      "الهاتف: 0612345678",
      "المدينة: الدار البيضاء - سيدي البرنوصي",
      "العنوان: تجزئة النخيل، زنقة 14، رقم 27، الطابق الثاني، شقة 5 — بجانب مقهى الأمل",
      "ملاحظات: المرجو الاتصال قبل التوصيل، والانتباه للكلب في المدخل! شكراً 🙏",
      "",
      "المنتجات:",
      "- حزام دراما غسالة LG 12 كيلو (TF-WM-045) × 2 = 240.00 د.م.",
      "- صمام مياه أوتوماتيكي 220 فولط (TF-AWM-013) × 1 = 85.50 د.م.",
      "- كيربوكس سيمي أوتوماتيك موديل 01 LG رأس طويل (TF-SAW-001) × 3 = 750.00 د.م.",
      "",
      "مجموع المنتجات: 1,075.50 د.م.",
      "(هذا المجموع لا يشمل مصاريف التوصيل — ستُحسب بعد تجهيز الطلب وتحديد عدد الكرطونات، الدفع عند الاستلام)",
    ].join("\n");

    const link = buildWhatsAppLink("0612345678", longMessage);
    const decoded = textParam(link);

    expect(decoded).toBe(longMessage);
    // كل سطر يبقى مفصولاً فعلياً (لا اندماج/فقدان للأسطر الجديدة)
    expect(decoded.split("\n")).toHaveLength(longMessage.split("\n").length);
    // خانات حرجة يجب ألا تُفقَد أو تُشوَّه: SKU، الأسعار بفاصلة الآلاف، الرموز
    expect(decoded).toContain("TF-SAW-001");
    expect(decoded).toContain("TF-AWM-013");
    expect(decoded).toContain("1,075.50 د.م.");
    expect(decoded).toContain("🙏");
    expect(decoded).toContain("—");
  });
});

describe("buildProductWhatsAppLink", () => {
  test("يضمّن اسم المنتج ورمز SKU داخل الرسالة، ويستعمل الرقم المُمرَّر", () => {
    const link = buildProductWhatsAppLink("0612345678", "حزام دراما غسالة", "DEMO-001");
    expect(link.startsWith("https://api.whatsapp.com/send/?")).toBe(true);
    const decoded = textParam(link);
    expect(decoded).toContain("حزام دراما غسالة");
    expect(decoded).toContain("DEMO-001");
  });
});

describe("buildCustomerWhatsAppLink", () => {
  test("يستبدل {orderNumber} و{storeName} فالقالب المُمرَّر من الإعدادات", () => {
    const link = buildCustomerWhatsAppLink(
      "0612345678",
      "TF-2026-0001",
      "مرحباً بخصوص طلبكم رقم {orderNumber} في {storeName}.",
      "متجري"
    );
    expect(textParam(link)).toBe("مرحباً بخصوص طلبكم رقم TF-2026-0001 في متجري.");
  });

  test("يبني الرابط برقم الزبون نفسه، وليس رقم المتجر", () => {
    const link = buildCustomerWhatsAppLink("0699887766", "TF-1", "{orderNumber}", "س");
    expect(new URL(link).searchParams.get("phone")).toBe("212699887766");
  });
});
