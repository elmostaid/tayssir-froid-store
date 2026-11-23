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

const RUN = String(Date.now()).slice(-6);
const numbers: string[] = [];

function request(bytes: Uint8Array | null, name = "f.pdf") {
  const form = new FormData();
  if (bytes) form.set("invoice", new File([Buffer.from(bytes)], name, { type: "application/pdf" }));
  return new NextRequest("http://localhost/admin/settlements/upload", { method: "POST", body: form });
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
});
