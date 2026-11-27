import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { extractPdfTextItems, PdfReadError } from "@/lib/settlements/pdfText";
import { parseBigDeliveryInvoice } from "@/lib/settlements/bigDeliveryInvoice";
import { isOzonExpressInvoice, parseOzonExpressInvoice } from "@/lib/settlements/ozonExpressInvoice";
import { registerInvoice } from "@/lib/settlements/settlementStore";

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

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/admin/settlements", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.redirect(new URL("/admin/login", request.url), 303);
  if (!isOwnerAdmin(admin)) return new NextResponse("غير مصرَّح", { status: 403 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("invoice");
    file = value instanceof File ? value : null;
  } catch {
    return back(request, { error: "تعذّرت قراءة الملف المرفوع." });
  }
  if (!file || file.size === 0) return back(request, { error: "اختار ملف الفاتورة (PDF) أولاً." });
  if (file.size > MAX_BYTES) return back(request, { error: "الملف كبير بزاف (أكثر من 4 ميغا)." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    return back(request, {
      error: "هاد الملف ماشي PDF. حمّل الفاتورة من «Factures» فـBigDelivery، ولا كشف التحويل (Virement) من OzonExpress.",
    });
  }

  let parsed;
  try {
    // الشركة كتتعرف من الملف نفسه (اسمها مكتوب فيه)، ماشي من اختيار المستعمل.
    const items = await extractPdfTextItems(bytes);
    parsed = isOzonExpressInvoice(items) ? parseOzonExpressInvoice(items) : parseBigDeliveryInvoice(items);
  } catch (error) {
    if (error instanceof PdfReadError) return back(request, { error: error.message });
    console.error("settlements/upload: قراءة PDF", error);
    return back(request, { error: "تعذّرت قراءة الـPDF." });
  }
  if (!parsed.ok) {
    return back(request, {
      error: "الفاتورة ترفضات وما تسجل منها والو:",
      problems: parsed.problems.slice(0, 8).join("\n").slice(0, 1800),
    });
  }

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
    if (r.kind === "already_active") return back(request, { notice: "already", invoice: String(r.invoiceId) });
    if (r.kind === "number_conflict")
      return back(request, {
        error: `رقم الفاتورة ${parsed.invoice.invoiceNumber} سبق تسجيله بملف مختلف — ما تسجلش هاد الملف.`,
        invoice: String(r.invoiceId),
      });
    return back(request, {
      uploaded: String(r.invoiceId),
      kind: r.kind,
      dup: String(r.duplicates),
      // تنبيهات القراءة (مثلاً «Total Colis» ديال Ozon) + تعارضات الكرطونات المكررة.
      ...([...(parsed.warnings ?? []), ...r.conflicts].length
        ? { problems: [...(parsed.warnings ?? []), ...r.conflicts].slice(0, 8).join("\n").slice(0, 1800) }
        : {}),
    });
  } catch (error) {
    console.error("settlements/upload: التسجيل", error);
    return back(request, { error: "تعذّر تسجيل الفاتورة. عاود المحاولة." });
  }
}
