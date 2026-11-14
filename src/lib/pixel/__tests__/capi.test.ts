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

    // التهيئة الناقصة ليست انقطاعاً عابراً: `retryable: false` حتى لا
    // يُطارد الشراء المؤجَّل توكناً غير موجود خمس مرات.
    await expect(
      sendCapiEvent({
        eventName: "Purchase",
        eventId: "order-1",
        customData: { content_ids: ["X"], content_type: "product", currency: "MAD", value: 10 },
      })
    ).resolves.toMatchObject({ ok: false, retryable: false });
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

  test("sendCapiEvent: بلا META_TEST_EVENT_CODE، لا يُدرَج test_event_code إطلاقاً فالطلب (السلوك الحالي بلا أي تغيير)", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    vi.stubEnv("META_TEST_EVENT_CODE", "");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await loadCapi();

    await sendCapiEvent({
      eventName: "Purchase",
      eventId: "order-no-test-code",
      customData: { content_ids: ["X"], content_type: "product", currency: "MAD" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("test_event_code");
  });

  test("sendCapiEvent: مع META_TEST_EVENT_CODE مضبوطاً، يُدرَج test_event_code فمستوى الجسم الأعلى (وليس داخل كل حدث)، بلا أي تأثير على event_id أو باقي الحقول", async () => {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST20760");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await loadCapi();

    await sendCapiEvent({
      eventName: "Purchase",
      eventId: "order-with-test-code",
      eventSourceUrl: "https://www.tayssirfroid.com/checkout",
      userData: { phone: "212612345678" },
      customData: { content_ids: ["TF-1"], content_type: "product", currency: "MAD", value: 100 },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.test_event_code).toBe("TEST20760");

    // event_id وباقي بنية الحدث بلا أي تغيير — نفس ما كانت عليه بدون الكود التجريبي.
    const event = body.data[0];
    expect(event.event_id).toBe("order-with-test-code");
    expect(event.event_name).toBe("Purchase");
    expect(event).not.toHaveProperty("test_event_code");
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
    ).resolves.toMatchObject({ ok: false, retryable: true });
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
    ).resolves.toMatchObject({ ok: false, status: 401, retryable: false });
  });
});

/**
 * النجاح = إقرار Meta، لا نداؤنا.
 *
 * الشراء المؤجَّل يستهلك حرس exactly-once **قبل** النداء. فلو اعتبرت هذه
 * الدالة مجرّد وصول الجواب نجاحاً، لضاعت البيعة صامتةً عند كل انقطاع: لا
 * إرسال، ولا إعادة محاولة، ولا سطر يقول إن شيئاً فُقد.
 */
describe("sendCapiEvent — التحقّق من جواب Meta وإعادة المحاولة", () => {
  async function withConfig() {
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "2565914390520172");
    vi.stubEnv("META_CONVERSIONS_API_ACCESS_TOKEN", "secret-token-xyz");
    return loadCapi();
  }

  const event = {
    eventName: "Purchase",
    eventId: "purchase:1",
    customData: { content_ids: ["X"], content_type: "product", currency: "MAD", value: 10 },
  };

  test("events_received ≥ 1 ⇒ قبول، ومحاولة واحدة فقط", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{"events_received":1}' });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await withConfig();

    expect(await sendCapiEvent(event)).toMatchObject({ ok: true, eventsReceived: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("events_received = 0 مع HTTP 200 ⇒ رفضٌ لا نجاح", async () => {
    // هذا هو الفخّ: Meta تردّ 200 وتُسقِط الحدث. ولو قرأنا الرمز وحده
    // لاحتسبنا بيعةً لم تصل، ولختمنا الحرس عليها إلى الأبد.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"events_received":0}',
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await withConfig();

    const result = await sendCapiEvent(event);
    expect(result.ok).toBe(false);
    expect(result.eventsReceived).toBe(0);
    // عطبُ حمولة لا عطبُ شبكة: لا تُعاد المحاولة داخل النداء.
    expect(result.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("جسم 200 غير JSON ⇒ قبول بلا عدد — لا نُسقِط بيعة لأن الشكل تغيّر", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "OK" })
    );
    const { sendCapiEvent } = await withConfig();
    expect(await sendCapiEvent(event)).toMatchObject({ ok: true });
  });

  test("5xx ⇒ محاولة ثانية، وتنجح", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "upstream" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{"events_received":1}' });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await withConfig();

    expect(await sendCapiEvent(event)).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("4xx ⇒ بلا محاولة ثانية: حمولة أو توكن خاطئ لا يُصلحه التكرار", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => "bad payload" });
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await withConfig();

    const result = await sendCapiEvent(event);
    expect(result).toMatchObject({ ok: false, status: 400, retryable: false });
    expect(result.error).toContain("bad payload");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("انقطاع الشبكة مرتين ⇒ فشل قابل للإعادة، بعد محاولتين", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const { sendCapiEvent } = await withConfig();

    const result = await sendCapiEvent(event);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
