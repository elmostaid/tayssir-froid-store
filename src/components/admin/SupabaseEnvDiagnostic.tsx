// تشخيص مؤقت وآمن لسبب ظهور "لوحة الإدارة غير مُهيَّأة بعد" في Production
// رغم إضافة المتغيرات في Vercel. يقرأ بالضبط نفس القيمتين اللي كتستعملهما
// isSupabaseConfigured() (src/lib/supabase/config.ts)، ويبيّن فقط إن كانت
// كل واحدة موجودة (truthy) أو لا — بلا كشف أي قيمة أو جزء منها إطلاقاً.
//
// احذف هذا المكوّن (وسطر استعماله في admin/login/page.tsx) بعد التأكد من
// وصول القيمتين الصحيحتين إلى Production — هذا الغرض الوحيد منه.
export function SupabaseEnvDiagnostic() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasAnonKey = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <div
      dir="rtl"
      className="mx-auto mb-4 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <p className="font-bold">تشخيص مؤقت (Environment Variables):</p>
      <p className="mt-1">
        NEXT_PUBLIC_SUPABASE_URL: {hasUrl ? "موجود" : "غير موجود"}
      </p>
      <p>
        NEXT_PUBLIC_SUPABASE_ANON_KEY: {hasAnonKey ? "موجود" : "غير موجود"}
      </p>
    </div>
  );
}
