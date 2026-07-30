import { describe, expect, test } from "vitest";
import { buildWhatsAppLink, buildProductWhatsAppLink } from "@/lib/whatsapp";

describe("buildWhatsAppLink", () => {
  test("يبني رابط wa.me برقم Tayssir Froid الصحيح", () => {
    const link = buildWhatsAppLink("مرحباً");
    expect(link.startsWith("https://wa.me/212722083458?text=")).toBe(true);
  });

  test("يشفّر النص العربي داخل الرابط", () => {
    const link = buildWhatsAppLink("سؤال");
    expect(link).toContain(encodeURIComponent("سؤال"));
  });
});

describe("buildProductWhatsAppLink", () => {
  test("يضمّن اسم المنتج ورمز SKU داخل الرسالة", () => {
    const link = buildProductWhatsAppLink("حزام دراما غسالة", "DEMO-001");
    const decoded = decodeURIComponent(link.split("text=")[1]);
    expect(decoded).toContain("حزام دراما غسالة");
    expect(decoded).toContain("DEMO-001");
  });
});
