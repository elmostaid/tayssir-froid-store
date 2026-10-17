import { afterEach, describe, expect, test, vi } from "vitest";
import {
  classifyKeyFormat,
  claimedProjectRef,
  verifyAnonKey,
  verifyServiceRoleKey,
} from "@/lib/diagnostics/keyIdentity";

/** رمز JWT مُلفَّق للاختبار — بلا توقيع حقيقي، ولا يصلح لأي شيء. */
function fakeJwt(ref: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase", ref, role: "anon" })).toString(
    "base64url"
  );
  return `${header}.${payload}.signature-not-verified`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyKeyFormat", () => {
  test("يميّز الصيغ الثلاث والغياب", () => {
    expect(classifyKeyFormat(undefined)).toBe("absent");
    expect(classifyKeyFormat("   ")).toBe("absent");
    expect(classifyKeyFormat("sb_publishable_abc")).toBe("publishable");
    expect(classifyKeyFormat("sb_secret_abc")).toBe("secret");
    expect(classifyKeyFormat(fakeJwt("abc"))).toBe("legacy-jwt");
    expect(classifyKeyFormat("قيمة-غريبة")).toBe("unknown");
  });
});

describe("claimedProjectRef", () => {
  test("يقرأ ref من حمولة JWT", () => {
    expect(claimedProjectRef(fakeJwt("zgdjmeigdbgxdxwixnfl"))).toBe("zgdjmeigdbgxdxwixnfl");
  });

  test("لا ادّعاء في المفاتيح الحديثة ولا في قيمة مشوَّهة", () => {
    expect(claimedProjectRef("sb_publishable_abc")).toBeNull();
    expect(claimedProjectRef("a.b.c")).toBeNull();
  });
});

describe("verifyAnonKey — إثبات بالطلب لا بالادّعاء", () => {
  test("200 يعني أن المشروع قبل المفتاح", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const identity = await verifyAnonKey("https://ref.supabase.co", fakeJwt("ref"));

    expect(identity.probeStatus).toBe(200);
    expect(identity.acceptedByProject).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ref.supabase.co/auth/v1/settings",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  test("401 يعني مفتاح مشروع آخر", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    const identity = await verifyAnonKey("https://ref.supabase.co", fakeJwt("other"));
    expect(identity.acceptedByProject).toBe(false);
    expect(identity.probeStatus).toBe(401);
  });

  test("فشل الشبكة لا يُسرِّب نص الخطأ الكامل — اسم الخطأ فقط", async () => {
    const leaky = new Error("connect ECONNREFUSED postgres://user:pass@host:5432/db");
    leaky.name = "TypeError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(leaky));

    const identity = await verifyAnonKey("https://ref.supabase.co", fakeJwt("ref"));

    expect(identity.probeError).toBe("TypeError");
    expect(JSON.stringify(identity)).not.toContain("pass");
    expect(JSON.stringify(identity)).not.toContain("ECONNREFUSED");
  });

  test("مفتاح غائب لا يُنتج أي طلب شبكة", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const identity = await verifyAnonKey("https://ref.supabase.co", undefined);
    expect(identity.format).toBe("absent");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyServiceRoleKey", () => {
  test("يفحص سرد الدلاء ولا يُرجع أي اسم دلو", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ name: "product-images" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const identity = await verifyServiceRoleKey("https://ref.supabase.co", "sb_secret_xyz");

    expect(identity.acceptedByProject).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ref.supabase.co/storage/v1/bucket");
    // لا قيمة المفتاح ولا محتوى الجواب يظهران في التقرير.
    expect(JSON.stringify(identity)).not.toContain("sb_secret_xyz");
    expect(JSON.stringify(identity)).not.toContain("product-images");
  });
});
