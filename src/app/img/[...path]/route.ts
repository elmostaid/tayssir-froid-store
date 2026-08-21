import { NextResponse } from "next/server";

/**
 * تقديم صور المنتجات المرفوعة من نطاق الموقع نفسه بدل رابط Supabase المباشر.
 *
 * السبب مقيس لا مفترَض: Supabase على الخطة الحالية تُرجع كل كائن عام
 * بترويسة `cache-control: no-cache` مهما ضبطنا `cacheControl` عند الرفع
 * (تحقّقنا: البيانات الوصفية للكائن تحمل max-age=31536000 فعلاً، بينما
 * الاستجابة العامة تبقى no-cache — احترام تلك القيمة ميزة مدفوعة). النتيجة
 * أن الزبون العائد يُعيد تنزيل كل صورة من الصفر في كل زيارة.
 *
 * هنا نتحكّم في الترويسة بأنفسنا. `immutable` آمنة تماماً لأن اسم كل ملف
 * UUID عشوائي يُولَّد عند الرفع: تبديل صورة منتج يُنتج مساراً جديداً كلياً،
 * فلا يمكن لأي زبون أن يبقى عالقاً على صورة قديمة.
 *
 * مكسب إضافي على الشبكات الضعيفة: تختفي رحلة DNS/TLS كاملة إلى نطاق ثالث،
 * وتُقدَّم الصور من نفس الاتصال المفتوح أصلاً للموقع، ومن حافة Vercel
 * القريبة بدل مخزن في ستوكهولم.
 */

export const runtime = "nodejs";

/** اتفاقية الرفع الوحيدة: {productId}/{UUID}.{ext} — أي شيء آخر يُرفَض. */
const OBJECT_PATH_RE =
  /^\d+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const objectPath = path.join("/");

  // فحص صارم بقائمة بيضاء: هذا المسار لا يجلب إلا كائناً يطابق اتفاقية
  // الرفع داخل bucket واحد معروف — فلا يمكن استعماله لجلب أي عنوان آخر.
  if (!OBJECT_PATH_RE.test(objectPath)) {
    return new NextResponse(null, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  if (!supabaseUrl) return new NextResponse(null, { status: 404 });

  const extension = objectPath.split(".").pop()!.toLowerCase();

  try {
    const upstream = await fetch(
      `${supabaseUrl}/storage/v1/object/public/product-images/${objectPath}`,
      {
        cache: "no-store",
        // مهلة صريحة: بدونها، تعثّر Supabase يُعلّق هذه الدالة بلا نهاية —
        // نفس فئة العطل التي أصلحناها في safeQuery. الصورة تسقط بهدوء
        // (404) بدل أن تحجز نسخة خادم.
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!upstream.ok) return new NextResponse(null, { status: 404 });

    return new NextResponse(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? CONTENT_TYPES[extension],
        // s-maxage يجعل حافة Vercel تحتفظ بها، فلا تتكرّر رحلة الخادم إلى
        // Supabase إلا مرة واحدة لكل حافة.
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
