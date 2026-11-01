import { describe, expect, test } from "vitest";
import {
  CAMPAIGN_IMAGE_SLOTS,
  CAMPAIGN_OBJECT_PATH_RE,
  campaignSlotFolder,
  isCampaignImageUrl,
  parseCampaignImageOverrides,
} from "@/lib/campaignImages";
import { WASHING_TABS } from "@/app/(storefront)/washing-machines/page";
import { HEATER_TABS } from "@/app/(storefront)/water-heaters/page";

const UUID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const BASE = "https://proj.supabase.co/storage/v1/object/public/product-images/";
const good = `${BASE}campaign/washing-machines-standard/${UUID}.jpg`;

describe("صور بطاقات الحملات", () => {
  test("خانة لكل نوع في الصفحتين، لا أكثر", () => {
    expect(CAMPAIGN_IMAGE_SLOTS.map((slot) => slot.key)).toEqual([
      ...WASHING_TABS.map((tab) => `washing-machines:${tab.key}`),
      ...HEATER_TABS.map((tab) => `water-heaters:${tab.key}`),
    ]);
  });

  test("مجلد منفصل عن صور المنتجات ({productId}/…)", () => {
    for (const slot of CAMPAIGN_IMAGE_SLOTS) {
      expect(campaignSlotFolder(slot)).toMatch(/^campaign\//);
    }
    expect(CAMPAIGN_OBJECT_PATH_RE.test(`12/${UUID}.jpg`)).toBe(false);
    expect(CAMPAIGN_OBJECT_PATH_RE.test(`campaign/water-heaters-gas/${UUID}.webp`)).toBe(true);
    expect(CAMPAIGN_OBJECT_PATH_RE.test(`campaign/../12/${UUID}.jpg`)).toBe(false);
  });

  test("لا يُقبل إلا رابط https من bucket صورنا تحت campaign/", () => {
    expect(isCampaignImageUrl(good)).toBe(true);
    expect(isCampaignImageUrl(`http://proj.supabase.co/storage/v1/object/public/product-images/campaign/washing-machines-standard/${UUID}.jpg`)).toBe(false);
    expect(isCampaignImageUrl(`${BASE}12/${UUID}.jpg`)).toBe(false);
    expect(isCampaignImageUrl(`https://evil.example/${UUID}.jpg`)).toBe(false);
  });

  test("قيمة إعدادات تالفة أو غريبة ⇒ لا صورة يدوية (البطاقة تعود للتلقائية)", () => {
    expect(parseCampaignImageOverrides(null)).toEqual({});
    expect(parseCampaignImageOverrides("x")).toEqual({});
    expect(parseCampaignImageOverrides([])).toEqual({});
    expect(
      parseCampaignImageOverrides({
        "washing-machines:standard": { path: good, updatedAt: "2026-11-02T00:00:00Z" },
        "washing-machines:unknown": { path: good },
        "water-heaters:gas": { path: "https://evil.example/x.jpg" },
        "water-heaters:electric": "not-an-object",
      })
    ).toEqual({ "washing-machines:standard": { path: good, updatedAt: "2026-11-02T00:00:00Z" } });
  });
});
