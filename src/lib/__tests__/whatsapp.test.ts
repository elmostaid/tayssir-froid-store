import { describe, expect, test } from "vitest";
import {
  buildWhatsAppLink,
  buildProductWhatsAppLink,
  buildCustomerWhatsAppLink,
} from "@/lib/whatsapp";

describe("buildWhatsAppLink", () => {
  test("يبني رابط wa.me برقم settings.whatsappNumber المُمرَّر، وليس ثابتاً مكتوباً هنا", () => {
    const link = buildWhatsAppLink("0612345678", "مرحباً");
    expect(link.startsWith("https://wa.me/212612345678?text=")).toBe(true);
  });

  test("رقم بصيغة +212 يُحوَّل لنفس الصيغة الدولية", () => {
    const link = buildWhatsAppLink("+212722083458", "مرحباً");
    expect(link.startsWith("https://wa.me/212722083458?text=")).toBe(true);
  });

  test("يشفّر النص العربي داخل الرابط", () => {
    const link = buildWhatsAppLink("0612345678", "سؤال");
    expect(link).toContain(encodeURIComponent("سؤال"));
  });
});

describe("buildProductWhatsAppLink", () => {
  test("يضمّن اسم المنتج ورمز SKU داخل الرسالة، ويستعمل الرقم المُمرَّر", () => {
    const link = buildProductWhatsAppLink("0612345678", "حزام دراما غسالة", "DEMO-001");
    expect(link.startsWith("https://wa.me/212612345678?text=")).toBe(true);
    const decoded = decodeURIComponent(link.split("text=")[1]);
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
    const decoded = decodeURIComponent(link.split("text=")[1]);
    expect(decoded).toBe("مرحباً بخصوص طلبكم رقم TF-2026-0001 في متجري.");
  });

  test("يبني الرابط برقم الزبون نفسه، وليس رقم المتجر", () => {
    const link = buildCustomerWhatsAppLink("0699887766", "TF-1", "{orderNumber}", "س");
    expect(link.startsWith("https://wa.me/212699887766")).toBe(true);
  });
});
