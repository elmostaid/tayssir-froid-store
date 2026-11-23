import { NextResponse, type NextRequest } from "next/server";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getInvoiceFile } from "@/lib/settlements/settlementStore";

/** الملف الأصلي للفاتورة — لصاحب الحساب وحده، بلا أي تخزين وسيط. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.redirect(new URL("/admin/login", request.url));
  if (!isOwnerAdmin(admin)) return new NextResponse("غير مصرَّح", { status: 403 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse("غير موجود", { status: 404 });
  const file = await getInvoiceFile(id);
  if (!file) return new NextResponse("غير موجود", { status: 404 });

  const name = (file.fileName ?? `invoice-${id}.pdf`).replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
