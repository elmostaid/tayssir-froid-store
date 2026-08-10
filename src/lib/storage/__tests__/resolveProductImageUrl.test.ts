import { describe, expect, test } from "vitest";
import { resolveProductImageUrl, resolveProductImageUrls } from "@/lib/storage/resolveProductImageUrl";

describe("resolveProductImageUrl — بسيط ومباشر: رابط كامل يُعاد كما هو، وإلا مسار محلي كما كان دائماً", () => {
  test("storage_path محلي (قديم): يُعاد /{storage_path} حرفياً، بلا أي فحص أو فك ترميز", async () => {
    const storagePath = "product-images/TF-CK-009/09__%D9%8A%D8%AF%20%D9%83%D9%88%D9%83%D9%88%D8%A9.png";
    const url = await resolveProductImageUrl(storagePath);
    expect(url).toBe(`/${storagePath}`);
  });

  test("storage_path يبدأ بـhttps://: يُعاد كما هو حرفياً بلا أي تعديل", async () => {
    const storagePath = "https://example.supabase.co/storage/v1/object/public/product-images/42/uuid.webp";
    const url = await resolveProductImageUrl(storagePath);
    expect(url).toBe(storagePath);
  });

  test("storage_path يبدأ بـhttp:// (نادر لكن مدعوم): يُعاد كما هو حرفياً", async () => {
    const storagePath = "http://example.supabase.co/storage/v1/object/public/product-images/42/uuid.webp";
    const url = await resolveProductImageUrl(storagePath);
    expect(url).toBe(storagePath);
  });

  test("resolveProductImageUrls: يحل دفعة مسارات (محلية وروابط كاملة معاً) ويرجع كائناً عادياً بلا تكرار", async () => {
    const local = "product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-2.jpg";
    const remote = "https://example.supabase.co/storage/v1/object/public/product-images/42/uuid.webp";

    const result = await resolveProductImageUrls([local, remote, local]);

    expect(result[local]).toBe(`/${local}`);
    expect(result[remote]).toBe(remote);
    expect(Object.keys(result)).toHaveLength(2);
  });
});
