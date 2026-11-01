import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/queries/settings", () => ({
  getSettings: async () => ({ storeName: "Tayssir Froid", storeCity: "مراكش", whatsappNumber: "+212722083458" }),
  FALLBACK_SETTINGS: { storeName: "Tayssir Froid", storeCity: "مراكش", whatsappNumber: "+212722083458" },
}));
vi.mock("@/components/ConsentBanner", () => ({ PrivacySettingsLink: () => <button>إعدادات الكوكيز</button> }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderPage() {
  const { default: PrivacyPage } = await import("@/app/(storefront)/privacy/page");
  return render(await PrivacyPage());
}

describe("صفحة الخصوصية — لا معلومة قانونية غير مؤكَّدة", () => {
  test("بلا وصولات CNDP: لا قسم ولا رقم ولا عبارة «لم تُضَف»، ولا ادّعاء إذن", async () => {
    vi.stubEnv("CNDP_RECEIPT_NUMBERS", "");
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    expect(text).not.toContain("مراجع CNDP");
    expect(text).not.toContain("لم تُضَف");
    expect(text).not.toMatch(/إذن|مرخّص|رخصة/);
    expect(text).not.toContain("Ireland");
    expect(text).toContain("شخص ذاتي");
  });

  test("بوصولات مضبوطة: تُعرض كما هي", async () => {
    vi.stubEnv("CNDP_RECEIPT_NUMBERS", "D-TEST-0001");
    const { container } = await renderPage();
    expect(container.textContent).toContain("مراجع CNDP");
    expect(container.textContent).toContain("D-TEST-0001");
  });

  test("البريد لا يظهر إلا إن ضُبط", async () => {
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "");
    expect((await renderPage()).container.textContent).not.toContain("البريد");
    cleanup();
    vi.stubEnv("PRIVACY_CONTACT_EMAIL", "contact@example.ma");
    expect((await renderPage()).container.textContent).toContain("contact@example.ma");
  });
});
