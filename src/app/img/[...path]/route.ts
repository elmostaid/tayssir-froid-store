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

  const primary = await fetchObject(supabaseUrl, objectPath, extension);
  if (primary) return primary;

  // مخزن احتياطي للقراءة فقط — للمعاينة وحدها، ولا يُضبط في الإنتاج.
  //
  // لماذا وُجد: هذا المسار يتجاهل النطاق المخزَّن في `storage_path` ويُعيد
  // بناء الرابط من NEXT_PUBLIC_SUPABASE_URL الخاص بالبيئة الجارية. وهو
  // الصواب في الإنتاج، لكنه في المعاينة يبحث عن الكائن في مخزن المعاينة —
  // وهو شبه فارغ (5 كائنات مقابل 471 في الإنتاج) لأن صفوف قاعدة المعاينة
  // نُسخت من الإنتاج بينما كائنات التخزين لم تُنسخ. فكل صورة رُفعت عبر
  // Supabase تظهر مكسورة في المعاينة وسليمة في الإنتاج.
  //
  // فالمتغيّر يسمح للمعاينة وحدها بقراءة نفس الصور العامة من مخزن الإنتاج.
  // وهي صور منتجات عامة تُقدَّم أصلاً لكل زائر على الموقع الحيّ — لا بيانات
  // زبناء ولا أي شيء خاص. والقراءة فقط: لا كتابة ولا نسخ ولا تعديل لأي
  // كائن أو صفّ في الإنتاج.
  //
  // وفي الإنتاج المتغيّر غير مضبوط، فالشرط التالي يُرجع 404 مباشرةً —
  // أي أن سلوك الإنتاج لا يتغيّر إطلاقاً، ولا طلب إضافي يقع.
  const fallbackUrl = process.env.IMAGE_FALLBACK_SUPABASE_URL?.replace(/\/+$/, "");
  if (!fallbackUrl || fallbackUrl === supabaseUrl) {
    return new NextResponse(null, { status: 404 });
  }

  const fallback = await fetchObject(fallbackUrl, objectPath, extension);
  return fallback ?? new NextResponse(null, { status: 404 });
}

/** جلب كائن واحد من مخزن مُعطى. `null` = غير موجود أو تعذّر الوصول. */
async function fetchObject(
  baseUrl: string,
  objectPath: string,
  extension: string
): Promise<NextResponse | null> {
  try {
    const upstream = await fetch(
      `${baseUrl}/storage/v1/object/public/product-images/${objectPath}`,
      {
        cache: "no-store",
        // مهلة صريحة: بدونها، تعثّر Supabase يُعلّق هذه الدالة بلا نهاية —
        // نفس فئة العطل التي أصلحناها في safeQuery. الصورة تسقط بهدوء
        // (404) بدل أن تحجز نسخة خادم.
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!upstream.ok) return null;

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
    return null;
  }
}
