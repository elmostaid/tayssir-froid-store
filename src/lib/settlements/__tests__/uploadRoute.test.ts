// @vitest-environment node
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "@/lib/db";

/**
 * مسار رفع الفاتورة كما يستدعيه المتصفح: صلاحية المالك، رفض غير الـPDF،
 * رفض فاتورة مجاميعها خاطئة دون تسجيل أي شيء، وتسجيل الصحيحة دون لمس الطلبيات.
 */

let role: "admin" | "staff" | null = "admin";
vi.mock("@/lib/auth/requireAdmin", () => ({
  getAdminUser: async () => (role ? { id: "u", email: "owner@test.local", role } : null),
  isOwnerAdmin: (a: { role: string } | null) => a?.role === "admin",
}));

const { POST } = await import("@/app/admin/(protected)/settlements/upload/route");
const { buildFakeBigDeliveryPdf } = await import("./fakeBigDeliveryPdf");
const { buildFakeOzonExpressPdf } = await import("./fakeOzonExpressPdf");

const RUN = String(Date.now()).slice(-6);
const numbers: string[] = [];

function request(bytes: Uint8Array | null, name = "f.pdf", json = false) {
  const form = new FormData();
  if (bytes) form.set("invoice", new File([Buffer.from(bytes)], name, { type: "application/pdf" }));
  return new NextRequest("http://localhost/admin/settlements/upload", {
    method: "POST",
    body: form,
    headers: json ? { "x-upload-mode": "json" } : {},
  });
}

function pdf(number: string, overrideTotals?: { frais?: number; net?: number }) {
  numbers.push(number);
  return buildFakeBigDeliveryPdf({
    number,
    overrideTotals,
    parcels: [
      { code: `BG${RUN}U1`, pickup: "2026-11-14", phone: `0798${RUN}`, cityLines: ["Tahla"], cod: 635, fee: 35 },
    ],
  });
}

async function invoiceCarrier(number: string) {
  const rows = await sql<{ carrier: string; total_cod: string; total_net: string }[]>`
    select carrier, total_cod, total_net from public.carrier_invoices where invoice_number = ${number}
  `;
  return rows;
}

async function invoiceCount(number: string) {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.carrier_invoices where invoice_number = ${number}
  `;
  return n;
}

beforeEach(() => {
  role = "admin";
});

afterAll(async () => {
  const ids = await sql<{ id: number }[]>`select id from public.carrier_invoices where invoice_number = any(${numbers})`;
  const list = ids.map((r) => r.id);
  await sql`delete from public.carrier_parcels where invoice_id = any(${list})`;
  await sql`delete from public.carrier_invoices where id = any(${list})`;
});

describe("رفع فاتورة", () => {
  test("الخدامة (staff) ممنوعة، والزائر يُحوَّل لتسجيل الدخول", async () => {
    role = "staff";
    expect((await POST(request(pdf(`FCT-${RUN}-S`)))).status).toBe(403);
    role = null;
    const res = await POST(request(pdf(`FCT-${RUN}-S2`)));
    expect(res.headers.get("location")).toMatch(/\/admin\/login/);
    expect(await invoiceCount(`FCT-${RUN}-S`)).toBe(0);
  });

  test("ملف ليس PDF يُرفض برسالة", async () => {
    const res = await POST(request(new TextEncoder().encode("hello"), "x.pdf"));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toMatch(/ماشي PDF/);
  });

  test("فاتورة مجاميعها خاطئة تُرفض كاملة ولا يُسجَّل منها شيء", async () => {
    const number = `FCT-${RUN}-BAD`;
    const res = await POST(request(pdf(number, { frais: 30, net: 605 })));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toMatch(/ترفضات/);
    expect(loc.searchParams.get("problems")).toMatch(/مجموع الرسوم/);
    expect(await invoiceCount(number)).toBe(0);
  });

  test("فاتورة صحيحة تُسجَّل، وإعادة رفعها تُعرَف ولا تُكرَّر", async () => {
    const number = `FCT-${RUN}-OK`;
    const file = pdf(number);
    const first = new URL((await POST(request(file))).headers.get("location")!);
    expect(first.searchParams.get("uploaded")).toBeTruthy();
    expect(first.searchParams.get("kind")).toBe("created");
    const second = new URL((await POST(request(file))).headers.get("location")!);
    expect(second.searchParams.get("notice")).toBe("already");
    expect(await invoiceCount(number)).toBe(1);
  });

  test("كشف OzonExpress كيتعرف وحدو، كيتسجل «ozonexpress»، و«Total Colis» المختلف كيبان تنبيه", async () => {
    const number = `VRT-N-${RUN}-OZ`;
    numbers.push(number);
    const pdf = buildFakeOzonExpressPdf({
      number,
      totalColis: 1000,
      parcels: [
        { code: `KS${RUN}000001`, suffix: "RM", phone: `0611${RUN}`, city: "Ksar El Kebir", cod: 567, fee: 80, pickup: "2026-10-23", delivery: "2026-10-24" },
        { code: `KS${RUN}000002ED`, phone: `0611${RUN}`, city: "Ksar El Kebir", cod: 565, fee: 45, pickup: "2026-10-23", delivery: "2026-10-24" },
      ],
    });
    const res = await POST(request(pdf, "ozon.PDF"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("uploaded")).toBeTruthy();
    expect(loc.searchParams.get("problems")).toMatch(/Total Colis/);
    expect(await invoiceCarrier(number)).toEqual([{ carrier: "ozonexpress", total_cod: "1132.00", total_net: "1007.00" }]);
  });

  test("وضع JSON (الرفع المتعدد): دفعة من الشركتين، ملف خايب ما كيوقفش الباقي، والإعادة ما كتكررش", async () => {
    const big = pdf(`FCT-${RUN}-J1`);
    const ozNumber = `VRT-N-${RUN}-J2`;
    numbers.push(ozNumber);
    const oz = buildFakeOzonExpressPdf({
      number: ozNumber,
      parcels: [{ code: `KS${RUN}000009`, suffix: "RM", phone: `0622${RUN}`, city: "Tanger", cod: 300, fee: 35, pickup: "2026-10-23", delivery: "2026-10-24" }],
    });
    const bad = new TextEncoder().encode("not a pdf");
    const batch = [big, bad, oz];
    const out = [];
    for (const f of batch) {
      const res = await POST(request(f, "x.pdf", true));
      expect(res.headers.get("content-type")).toMatch(/json/);
      out.push(await res.json());
    }
    expect(out[0]).toMatchObject({ status: "created", carrier: "bigdelivery", invoiceNumber: `FCT-${RUN}-J1`, parcels: 1 });
    expect(out[1]).toMatchObject({ status: "rejected" });
    expect(out[1].message).toMatch(/ماشي PDF/);
    expect(out[2]).toMatchObject({ status: "created", carrier: "ozonexpress", invoiceNumber: ozNumber });
    // إعادة رفع الدفعة كاملة (مثلاً من بعد انقطاع الإنترنت): «سبق رفعها»، بلا تكرار.
    const again = await (await POST(request(big, "x.pdf", true))).json();
    expect(again).toMatchObject({ status: "already", invoiceId: out[0].invoiceId });
    expect(await invoiceCount(`FCT-${RUN}-J1`)).toBe(1);
    expect(await invoiceCount(ozNumber)).toBe(1);
  });

  test("وضع JSON بلا جلسة: 401 JSON ماشي تحويل", async () => {
    role = null;
    const res = await POST(request(pdf(`FCT-${RUN}-J3`), "x.pdf", true));
    expect(res.status).toBe(401);
    expect((await res.json()).status).toBe("rejected");
  });
});
