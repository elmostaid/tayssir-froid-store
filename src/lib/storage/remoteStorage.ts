import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * هل التخزين السحابي (Supabase Storage) مُهيَّأ للكتابة في هذه البيئة؟
 *
 * ## لماذا ملفٌّ مستقلّ عن productImages.ts
 *
 * productImages.ts يستعمل `path.join(process.cwd(), "public", …)`، فتتبّع
 * ملفات البناء يُدخل مجلد public/ كله في حزمة كل دالة تستورده. وخطة Vercel
 * المجانية تحدّ النشر بـ12 دالة: حين صارت صفحتا «صور الحملات» و«الأكثر طلباً»
 * تستوردانه لهذا الفحص وحده، كبرت حزمتاهما فانقسمت الدوال وفشل البناء
 * (`exceeded_serverless_functions_per_deployment`). الفحص لا يحتاج نظام
 * الملفات، فيعيش هنا بلا أي استيراد ثقيل، ويُعاد تصديره من productImages.ts
 * لمن يستورده من هناك.
 */
export function isRemoteStorageConfigured(): boolean {
  return isSupabaseConfigured() && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** رفع الصور ممكن فعلاً هنا (كل رفع مباشر من المتصفح إلى Supabase Storage). */
export function canWriteProductImages(): boolean {
  return isRemoteStorageConfigured();
}
