import { describe, expect, test } from "vitest";
import {
  localImageProxyPath,
  resolveProductImageUrl,
  resolveProductImageUrls,
} from "@/lib/storage/resolveProductImageUrl";

const SUPABASE_IMAGE =
  "https://example.supabase.co/storage/v1/object/public/product-images/42/1c3b4d5e-0000-4000-8000-000000000001.jpg";

describe("resolveProductImageUrl — مسار محلي كما هو، وصور Supabase عبر نطاقنا", () => {
  test("storage_path محلي (قديم): يُعاد /{storage_path} حرفياً، بلا أي فحص أو فك ترميز", async () => {
    const storagePath = "product-images/TF-CK-009/09__%D9%8A%D8%AF%20%D9%83%D9%88%D9%83%D9%88%D8%A9.png";
    expect(await resolveProductImageUrl(storagePath)).toBe(`/${storagePath}`);
  });

  test("صورة من bucket صورنا: تُقدَّم عبر /img/ من نطاق الموقع", async () => {
    expect(await resolveProductImageUrl(SUPABASE_IMAGE)).toBe(
      "/img/42/1c3b4d5e-0000-4000-8000-000000000001.jpg"
    );
  });

  test("http:// كذلك (نادر لكن مدعوم)", async () => {
    expect(await resolveProductImageUrl(SUPABASE_IMAGE.replace("https://", "http://"))).toBe(
      "/img/42/1c3b4d5e-0000-4000-8000-000000000001.jpg"
    );
  });

  test("رابط خارجي لا يخصّ bucket صورنا: يُعاد كما هو بلا لمس", async () => {
    const foreign = "https://cdn.example.com/photo.jpg";
    expect(await resolveProductImageUrl(foreign)).toBe(foreign);
  });

  test("قاعدة البيانات لا تتغيّر: التحويل عرضٌ فقط", () => {
    // localImageProxyPath دالة خالصة تُشتقّ من النص، ولا تكتب شيئاً في أي مكان.
    expect(localImageProxyPath(SUPABASE_IMAGE)).toBe(
      "/img/42/1c3b4d5e-0000-4000-8000-000000000001.jpg"
    );
    expect(localImageProxyPath("product-images/local/x.jpg")).toBeNull();
  });

  test("محاولة خروج من المسار تُرفَض", () => {
    expect(
      localImageProxyPath(
        "https://example.supabase.co/storage/v1/object/public/product-images/../../secret.jpg"
      )
    ).toBeNull();
  });

  test("resolveProductImageUrls: يحل دفعة مسارات ويرجع كائناً عادياً بلا تكرار", async () => {
    const local = "product-images/TF-WM-004/TF-WM-004-dryer-pressostat-seal-2.jpg";
    const result = await resolveProductImageUrls([local, SUPABASE_IMAGE, local]);

    expect(result[local]).toBe(`/${local}`);
    expect(result[SUPABASE_IMAGE]).toBe("/img/42/1c3b4d5e-0000-4000-8000-000000000001.jpg");
    expect(Object.keys(result)).toHaveLength(2);
  });
});
