import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadCapi() {
  return import("@/lib/pixel/capi");
}

describe("capi.ts — Meta Conversions API (خادم فقط)", () => {
  test("isCapiConfigured: false بدون NEXT_PUBLIC_META_PIXEL_ID أو بدون META_CONVERSIONS_API_ACCESS_TOKEN", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "");
    const { isCapiConfigured } = await loadCapi();
    expect(isCapiConfigured()).toBe(false);
  });

  test("isCapiConfigured: false إذا وُجد Pixel ID فقط بلا access token", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "");
    const { isCapiConfigured } = await loadCapi();
    expect(isCapiConfigured()).toBe(false);
  });

  test("isCapiConfigured: true فقط عند وجود الاثنين معاً", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    const { isCapiConfigured } = await loadCapi();
    expect(isCapiConfigured()).toBe(true);
  });

  test("hashForCapi: SHA256 hex بعد trim+lowercase (نفس تنسيق Meta الإلزامي)", async () => {
    const { hashForCapi } = await loadCapi();
    const a = hashForCapi("  212612345678  ");
    const b = hashForCapi("212612345678");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("sendCapiEvent: بلا META_CONVERSIONS_API_ACCESS_TOKEN، لا يُنفَّذ أي fetch إطلاقاً (بلا خطأ)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await loadCapi();

    await expect(
      sendCapiEvent({
        eventName: "Purchase",
        eventId: "order-1",
        customData: { content_ids: ["X"], content_type: "product", currency: "MAD", value: 10 },
      })
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sendCapiEvent: يبني الطلب الصحيح (URL، event_id، هاتف مُجزَّأ، custom_data) عند التوفّر", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent, hashForCapi } = await loadCapi();

    await sendCapiEvent({
      eventName: "Purchase",
      eventId: "order-idempotency-key-1",
      eventSourceUrl: "https://www.tayssirfroid.com/checkout",
      userData: { phone: "212612345678", clientIpAddress: "1.2.3.4", clientUserAgent: "UA/1.0" },
      customData: {
        content_ids: ["TF-1"],
        content_type: "product",
        currency: "MAD",
        value: 100,
        num_items: 2,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("https://graph.facebook.com/");
    expect(url).toContain("/2565914390520172/events");
    expect(url).toContain("access_token=secret-token-xyz");

    const body = JSON.parse(init.body);
    const event = body.data[0];
    expect(event.event_name).toBe("Purchase");
    expect(event.event_id).toBe("order-idempotency-key-1");
    expect(event.action_source).toBe("website");
    expect(event.event_source_url).toBe("https://www.tayssirfroid.com/checkout");
    expect(event.user_data.ph).toEqual([hashForCapi("212612345678")]);
    expect(event.user_data.client_ip_address).toBe("1.2.3.4");
    expect(event.user_data.client_user_agent).toBe("UA/1.0");
    expect(event.custom_data).toEqual({
      content_ids: ["TF-1"],
      content_type: "product",
      currency: "MAD",
      value: 100,
      num_items: 2,
    });
  });

  test("sendCapiEvent: لا يُدرج ph فـuser_data إن لم يُمرَّر هاتف (لا حقول فارغة/مخترَعة)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await loadCapi();

    await sendCapiEvent({
      eventName: "ViewContent",
      eventId: "e1",
      customData: { content_ids: ["X"], content_type: "product", currency: "MAD" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data[0].user_data).toEqual({});
  });

  test("sendCapiEvent: فشل الشبكة لا يرمي أبداً (fire-and-forget حقيقي)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    const { sendCapiEvent } = await loadCapi();

    await expect(
      sendCapiEvent({
        eventName: "Purchase",
        eventId: "order-2",
        customData: { content_ids: ["X"], content_type: "product", currency: "MAD" },
      })
    ).resolves.toBeUndefined();
  });

  test("sendCapiEvent: استجابة غير ناجحة من Meta (400/401) لا ترمي أبداً، فقط تُسجَّل", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "bad-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "Invalid token" })
    );
    const { sendCapiEvent } = await loadCapi();

    await expect(
      sendCapiEvent({
        eventName: "Purchase",
        eventId: "order-3",
        customData: { content_ids: ["X"], content_type: "product", currency: "MAD" },
      })
    ).resolves.toBeUndefined();
  });
});
