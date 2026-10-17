import { NextResponse } from "next/server";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { previewOnlyVerdict } from "@/lib/diagnostics/previewOnly";
import { reportProjectKeys } from "@/lib/diagnostics/keyIdentity";
import { runSessionModeProbe } from "@/lib/diagnostics/sessionModeProbe";

/**
 * مسار تشخيص **مؤقَّت** لقياس نمط اتصال Supavisor على معاينة معزولة.
 * يُحذَف بعد انتهاء الاختبارات — هذا شرط صريح، لا نيّة حسنة.
 *
 * ثلاث حمايات متراكبة، وترتيبها مقصود:
 *
 *  1. **قفل البيئة أولاً، قبل أي شيء آخر** (previewOnly.ts): نشر إنتاجي
 *     يُرفَض بـ404 قبل أن يُقرأ أي ملفّ تعريف أو تُفتح أي جلسة أو يُلمَس أي
 *     اتصال بقاعدة البيانات. فلو وصل طلب مباشر إلى هذا الرابط في الإنتاج
 *     لا يحدث شيء على الإطلاق — ولا يتسرّب حتى وجود المسار.
 *  2. **مصادقة المدير**: صاحب الحساب (Admin) وحده، بنفس فحص الخادم الذي
 *     تستعمله كل الإجراءات الإدارية. وstaff لا يكفي: هذه قياسات بنية تحتية.
 *  3. **حماية Vercel** للمعاينات فوق ذلك كله — طبقة لا يتحكّم فيها هذا
 *     الكود أصلاً، وهي التي تمنع أي زائر من الوصول للرابط ابتداءً.
 *
 * ولا يقبل هذا المسار أي معامل: لا استعلام من المستخدم، ولا قيمة تُركَّب في
 * SQL. كل الاستعلامات نصوص ثابتة في sessionModeProbe.ts.
 *
 * ولا يُرجِع ولا يُسجِّل أي سرّ: لا DATABASE_URL ولا أي جزء منه، ولا مفتاح،
 * ولا اسم مضيف، ولا صفّ من بيانات الزبناء. المفاتيح تُفحَص بنتيجة الطلب
 * (رمز حالة) لا بقيمتها — انظر keyIdentity.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * الخطوتان الطويلتان (استعلام 12 ثانية ثم معاملة 12 ثانية) تحتاجان أكثر من
 * المهلة الافتراضية. 45 ثانية مقصورة **على هذا المسار المؤقَّت وحده**، ولا
 * علاقة لها بأي صفحة أخرى — فلا يصحّ أن يُفهَم هذا الرقم كإقرار بأن مهلة
 * أطول آمنة عموماً.
 */
export const maxDuration = 45;

export async function GET() {
  const environment = previewOnlyVerdict();
  if (!environment.allowed) {
    // 404 لا 403: لا نُقرّ حتى بوجود المسار خارج المعاينة المعزولة.
    return new NextResponse(null, { status: 404 });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "غير مصرَّح." }, { status: 401 });
  }
  if (!isOwnerAdmin(admin)) {
    return NextResponse.json(
      { error: "التشخيص مقصور على صاحب الحساب (Admin)." },
      { status: 403 }
    );
  }

  // بالتسلسل لا بالتوازي: طلبات فحص المفاتيح تخرج إلى Supabase عبر HTTP،
  // ولو تزامنت مع قياس المجمّع لشوَّشت أرقام الاتصالات التي نقيسها.
  const keys = await reportProjectKeys();
  const probe = await runSessionModeProbe();

  return NextResponse.json(
    { environment: environment.environment, keys, probe },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
