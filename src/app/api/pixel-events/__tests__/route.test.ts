import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const sendCapiEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pixel/capi", () => ({ sendCapiEvent: sendCapiEventMock }));

const { POST } = await import("@/app/api/pixel-events/route");

afterEach(() => {
  sendCapiEventMock.mockReset();
});

function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/pixel-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "Mozilla/5.0 test-agent",
      "x-forwarded-for": "9.9.9.9, 10.0.0.1",
      cookie: "_fbp=fb.1.111.222; _fbc=fb.1.333.444",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pixel-events — إعادة توجيه أحداث Pixel (غير Purchase) إلى Meta CAPI", () => {
  test("حدث مسموح (AddToCart): يستدعي sendCapiEvent بنفس event_id، content_type/currency مفروضان من الخادم دائماً", async () => {
    const response = await POST(
      makeRequest({
        eventName: "AddToCart",
        eventId: "evt-abc",
        eventSourceUrl: "https://www.tayssirfroid.com/product/x",
        customData: {
          content_ids: ["TF-1"],
          value: 100,
          contents: [{ id: "TF-1", quantity: 2, item_price: 50 }],
          num_items: 2,
          content_name: "منتج",
          content_category: "تصنيف",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(sendCapiEventMock).toHaveBeenCalledTimes(1);
    const call = sendCapiEventMock.mock.calls[0][0];
    expect(call.eventName).toBe("AddToCart");
    expect(call.eventId).toBe("evt-abc");
    expect(call.eventSourceUrl).toBe("https://www.tayssirfroid.com/product/x");
    expect(call.customData.content_type).toBe("product");
    expect(call.customData.currency).toBe("MAD");
    expect(call.customData.content_ids).toEqual(["TF-1"]);
    expect(call.customData.value).toBe(100);

    // IP: أول عنوان فـx-forwarded-for فقط.
    expect(call.userData.clientIpAddress).toBe("9.9.9.9");
    expect(call.userData.clientUserAgent).toBe("Mozilla/5.0 test-agent");
    expect(call.userData.fbp).toBe("fb.1.111.222");
    expect(call.userData.fbc).toBe("fb.1.333.444");
  });

  test("PageView: customData فارغ (بلا content_type/currency مفروضين — ليس حدث منتج)", async () => {
    const response = await POST(makeRequest({ eventName: "PageView", eventId: "evt-pv-1" }));
    expect(response.status).toBe(200);
    const call = sendCapiEventMock.mock.calls[0][0];
    expect(call.customData).toEqual({});
  });

  test("اسم حدث غير مسموح (مثلاً Purchase أو اسم مُختلَق): يُرفَض 400 بلا أي استدعاء لـsendCapiEvent", async () => {
    const response1 = await POST(makeRequest({ eventName: "Purchase", eventId: "evt-x" }));
    expect(response1.status).toBe(400);

    const response2 = await POST(makeRequest({ eventName: "EvilCustomEvent", eventId: "evt-y" }));
    expect(response2.status).toBe(400);

    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("بلا event_id: يُرفَض 400 بلا استدعاء لـsendCapiEvent", async () => {
    const response = await POST(makeRequest({ eventName: "ViewContent" }));
    expect(response.status).toBe(400);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("جسم JSON غير صالح: يُرفَض 400 بلا رمي أي استثناء", async () => {
    const request = new NextRequest("http://localhost:3000/api/pixel-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(sendCapiEventMock).not.toHaveBeenCalled();
  });

  test("لا يثق بـcontent_type/currency من العميل حتى لو مُرسَلين — تُفرَضان دائماً من الخادم", async () => {
    await POST(
      makeRequest({
        eventName: "ViewContent",
        eventId: "evt-z",
        customData: { content_ids: ["X"], content_type: "vehicle", currency: "USD" },
      })
    );
    const call = sendCapiEventMock.mock.calls[0][0];
    expect(call.customData.content_type).toBe("product");
    expect(call.customData.currency).toBe("MAD");
  });
});
