import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { GET } = await import("@/app/img/[...path]/route");

const PROD = "https://prodref.supabase.co";
const FALLBACK = "https://fallbackref.supabase.co";
const OBJ = "234/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg";

const params = (objectPath: string) => ({ params: Promise.resolve({ path: objectPath.split("/") }) });
const request = () => new Request("http://localhost:3000/img/x");

let fetchMock: ReturnType<typeof vi.fn>;
const okResponse = () =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
const missing = () => new Response(null, { status: 400 });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROD);
  vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * ما يحرسه هذا الملف: الاحتياطي أُضيف لعطلٍ **في المعاينة وحدها** — مخزن
 * المعاينة شبه فارغ (5 كائنات مقابل 471 في الإنتاج) لأن صفوف قاعدته نُسخت
 * من الإنتاج بينما كائنات التخزين لم تُنسخ. والخطر الوحيد في مثل هذا
 * الإصلاح أن يتسرّب إلى الإنتاج: طلبٌ إضافي إلى نطاق ثالث على كل صورة
 * مفقودة، على مسار يُستدعى لكل صورة في المتجر. فالاختبار الحاكم هنا هو
 * اختبار «الإنتاج: طلب واحد لا غير».
 */
describe("GET /img/[...path] — الاحتياطي للمعاينة وحدها", () => {
  test("الكائن موجود: 200 بطلب واحد، ولا يُسأل الاحتياطي أصلاً", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", FALLBACK);
    fetchMock.mockResolvedValueOnce(okResponse());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${PROD}/storage/v1/object/public/product-images/${OBJ}`
    );
  });

  /** الاختبار الحاكم: سلوك الإنتاج لم يتغيّر بأي قدر. */
  test("الإنتاج (لا متغيّر احتياطي): كائن مفقود → 404 بطلب واحد لا غير", async () => {
    fetchMock.mockResolvedValueOnce(missing());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("المعاينة (المتغيّر مضبوط): كائن مفقود → يُجلب من الاحتياطي بـ200", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", FALLBACK);
    fetchMock.mockResolvedValueOnce(missing()).mockResolvedValueOnce(okResponse());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `${FALLBACK}/storage/v1/object/public/product-images/${OBJ}`
    );
  });

  test("مفقود في الاثنين: 404 ولا يرمي", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", FALLBACK);
    fetchMock.mockResolvedValue(missing());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /** ضبطٌ خاطئ يجعل الاحتياطي نفسَ المخزن — لا فائدة من طلبٍ مكرّر. */
  test("الاحتياطي يساوي الأساسي: لا طلب ثانٍ", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", PROD);
    fetchMock.mockResolvedValueOnce(missing());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("تعثُّر الشبكة في الأساسي لا يمنع الاحتياطي ولا يرمي", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", FALLBACK);
    fetchMock.mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValueOnce(okResponse());

    const response = await GET(request(), params(OBJ));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * القائمة البيضاء لم تُمسّ: الاحتياطي لا يجوز أن يصير طريقاً لجلب أي
   * عنوان آخر. مسارٌ لا يطابق اتفاقية الرفع يُرفض **قبل** أي طلب شبكة.
   */
  test("مسار خارج الاتفاقية: 404 بلا أي طلب شبكة، حتى مع الاحتياطي", async () => {
    vi.stubEnv("IMAGE_FALLBACK_SUPABASE_URL", FALLBACK);

    for (const bad of ["../../etc/passwd", "234/not-a-uuid.jpg", "abc/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg", "234/141883e0-0f97-479d-aea9-560cc8b6dac2.svg"]) {
      const response = await GET(request(), params(bad));
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /img — صور بطاقات الحملات", () => {
  test("campaign/{page}-{type}/{UUID}.jpg يُخدَم من نفس الـbucket", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const path = "campaign/water-heaters-gas/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg";
    const res = await GET(request(), params(path));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${PROD}/storage/v1/object/public/product-images/${path}`, expect.anything());
  });

  test.each([
    "campaign/other-page/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
    "campaign/water-heaters-gas/not-a-uuid.jpg",
    "campaign/water-heaters-gas/../../141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
  ])("مسار حملة خارج الاتفاقية (%s): 404 بلا طلب", async (path) => {
    const res = await GET(request(), params(path));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /img — صور العرض في «الأكثر طلباً»", () => {
  test("featured/{productId}/{UUID}.jpg يُخدَم", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const res = await GET(request(), params("featured/234/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg"));
    expect(res.status).toBe(200);
  });

  test("featured بلا رقم منتج: 404 بلا طلب", async () => {
    const res = await GET(request(), params("featured/x/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg"));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /img — صور العرض في أقسام صفحات الحملات", () => {
  test("campaign-products/{washing-machines|water-heaters}-{type}/{productId}/{UUID}.jpg يُخدَم", async () => {
    for (const path of [
      "campaign-products/washing-machines-standard/234/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
      "campaign-products/water-heaters-gas/234/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
      "campaign-products/water-heaters-electric/12/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
    ]) {
      fetchMock.mockResolvedValueOnce(okResponse());
      const res = await GET(request(), params(path));
      expect(res.status).toBe(200);
    }
  });

  test("صفحة غير معروفة أو مسار عابث: 404 بلا طلب", async () => {
    for (const path of [
      "campaign-products/other-page-gas/234/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
      "campaign-products/washing-machines-standard/x/141883e0-0f97-479d-aea9-560cc8b6dac2.jpg",
      "campaign-products/washing-machines-standard/234/../../secret.jpg",
    ]) {
      const res = await GET(request(), params(path));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
