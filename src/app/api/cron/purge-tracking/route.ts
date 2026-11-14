import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { AD_CONSENT_MAX_AGE_DAYS } from "@/lib/privacy/consent";

export const dynamic = "force-dynamic";

/**
 * محو بيانات التتبّع بعد 180 يوماً — يومياً، عبر Vercel Cron (vercel.json).
 *
 * مداولة CNDP D-939-2025، الفقرة 5: بيانات الكوكيز تُحفظ ستة أشهر كحدّ
 * أقصى، ثم تُمحى أو تُجهَّل. المحو نفسه في دالة SQL واحدة
 * (`purge_expired_tracking_identity`) تمسّ هوية المتصفح ومعرّفات النقر وحدها،
 * ولا تمسّ الطلبية ولا سطورها ولا قناتها.
 *
 * Vercel يرسل `Authorization: Bearer $CRON_SECRET`. بلا `CRON_SECRET` مضبوط
 * لا شيء يُنفَّذ (503) — المسار لا يصير عاماً بنسيان متغيّر.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET غير مضبوط" }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const [result] = await sql<{ orders_purged: string; leads_purged: string; inquiries_purged: string }[]>`
    select * from public.purge_expired_tracking_identity(${AD_CONSENT_MAX_AGE_DAYS})
  `;
  return NextResponse.json({
    ok: true,
    ordersPurged: Number(result?.orders_purged ?? 0),
    leadsPurged: Number(result?.leads_purged ?? 0),
    inquiriesPurged: Number(result?.inquiries_purged ?? 0),
  });
}
