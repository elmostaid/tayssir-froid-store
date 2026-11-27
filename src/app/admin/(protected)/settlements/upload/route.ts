import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { extractPdfTextItems, PdfReadError } from "@/lib/settlements/pdfText";
import { parseBigDeliveryInvoice } from "@/lib/settlements/bigDeliveryInvoice";
import { isOzonExpressInvoice, parseOzonExpressInvoice } from "@/lib/settlements/ozonExpressInvoice";
import { registerInvoice } from "@/lib/settlements/settlementStore";
import type { UploadOutcome } from "@/lib/settlements/uploadOutcome";

/**
 * رفع فاتورة PDF. Route Handler لا Server Action: إجراءات الخادم مسقوفة بـ1MB
 * افتراضياً، ورفع هذا السقف يرفعه لكل إجراءات الموقع. هنا السقف خاص بهذا
 * المسار وحده (10MB في القاعدة، و4MB هنا أقلّ من حدّ Vercel).
 *
 * الرفع لا يغيّر أي طلبية: يقرأ، يتحقق من المجاميع، ويسجّل الكرطونات. التطبيق
 * على الطلبيات خطوة منفصلة بزرّ «طبّق».
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * نتيجة كل ملف. الرفع المتعدد (UploadInvoicesForm) كيطلب JSON بـ`x-upload-mode: json`
 * باش يعرض التقدم ملف بملف؛ الرفع العادي (بلا JavaScript) كيبقى تحويل للصفحة.
 */
function respond(request: NextRequest, json: boolean, params: Record<string, string>, outcome: UploadOutcome) {
  if (json) return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
  const url = new URL("/admin/settlements", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const json = request.headers.get("x-upload-mode") === "json";
  const admin = await getAdminUser();
  if (!admin) {
    if (json) return NextResponse.json({ status: "rejected", message: "الجلسة سالات — عاود الدخول.", notes: [] }, { status: 401 });
    return NextResponse.redirect(new URL("/admin/login", request.url), 303);
  }
  if (!isOwnerAdmin(admin)) return new NextResponse("غير مصرَّح", { status: 403 });
  const reject = (message: string, problems: string[] = [], invoiceId?: number) =>
    respond(
      request,
      json,
      {
        error: message,
        ...(problems.length ? { problems: problems.slice(0, 8).join("\n").slice(0, 1800) } : {}),
        ...(invoiceId ? { invoice: String(invoiceId) } : {}),
      },
      { status: "rejected", message, notes: problems.slice(0, 8), ...(invoiceId ? { invoiceId } : {}) }
    );

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("invoice");
    file = value instanceof File ? value : null;
  } catch {
    return reject("تعذّرت قراءة الملف المرفوع.");
  }
  if (!file || file.size === 0) return reject("اختار ملف الفاتورة (PDF) أولاً.");
  if (file.size > MAX_BYTES) return reject("الملف كبير بزاف (أكثر من 4 ميغا).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return reject(
      "هاد الملف ماشي PDF. حمّل الفاتورة من «Factures» فـBigDelivery، ولا كشف التحويل (Virement) من OzonExpress."
    );
  }

  let parsed;
  try {
    // الشركة كتتعرف من الملف نفسه (اسمها مكتوب فيه)، ماشي من اختيار المستعمل.
    const items = await extractPdfTextItems(bytes);
    parsed = isOzonExpressInvoice(items) ? parseOzonExpressInvoice(items) : parseBigDeliveryInvoice(items);
  } catch (error) {
    if (error instanceof PdfReadError) return reject(error.message);
    console.error("settlements/upload: قراءة PDF", error);
    return reject("تعذّرت قراءة الـPDF.");
  }
  if (!parsed.ok) return reject("الفاتورة ترفضات وما تسجل منها والو:", parsed.problems);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    const r = await registerInvoice({
      parsed: parsed.invoice,
      bytes,
      fileName: file.name.slice(0, 255) || null,
      sha256,
      actor: admin.email,
      warnings: parsed.warnings ?? [],
    });
    const meta = {
      invoiceNumber: parsed.invoice.invoiceNumber,
      carrier: parsed.invoice.carrier,
      parcels: parsed.invoice.parcels.length,
    };
    if (r.kind === "already_active")
      return respond(
        request,
        json,
        { notice: "already", invoice: String(r.invoiceId) },
        { status: "already", invoiceId: r.invoiceId, ...meta, notes: [] }
      );
    if (r.kind === "number_conflict")
      return reject(
        `رقم الفاتورة ${parsed.invoice.invoiceNumber} سبق تسجيله بملف مختلف — ما تسجلش هاد الملف.`,
        [],
        r.invoiceId
      );
    // تنبيهات القراءة (مثلاً «Total Colis» ديال Ozon) + تعارضات الكرطونات المكررة.
    const notes = [...(parsed.warnings ?? []), ...r.conflicts].slice(0, 8);
    return respond(
      request,
      json,
      {
        uploaded: String(r.invoiceId),
        kind: r.kind,
        dup: String(r.duplicates),
        ...(notes.length ? { problems: notes.join("\n").slice(0, 1800) } : {}),
      },
      { status: "created", invoiceId: r.invoiceId, ...meta, duplicates: r.duplicates, notes }
    );
  } catch (error) {
    console.error("settlements/upload: التسجيل", error);
    // 500: العميل كيعتبرها قابلة لإعادة المحاولة (البصمة كتمنع التكرار).
    if (json)
      return NextResponse.json({ status: "rejected", message: "تعذّر تسجيل الفاتورة. عاود المحاولة.", notes: [] }, { status: 500 });
    return reject("تعذّر تسجيل الفاتورة. عاود المحاولة.");
  }
}
