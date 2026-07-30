export function SupabaseNotConfigured() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center" dir="rtl">
      <h1 className="text-lg font-bold text-neutral-800">
        لوحة الإدارة غير مُهيَّأة بعد
      </h1>
      <p className="mt-3 text-sm text-neutral-600">
        لوحة الإدارة تعتمد على Supabase Auth ولم يتم ربط مشروع Supabase
        حقيقي بعد. هذه الخطوات يدوية وتخصّك أنت فقط (لا حاجة لإرسال أي كلمة
        مرور أو مفتاح هنا):
      </p>
      <ol className="mt-4 list-inside list-decimal space-y-2 text-right text-sm text-neutral-700">
        <li>أنشئ مشروع Supabase مجاني.</li>
        <li>
          طبِّق ملفات <code className="rounded bg-neutral-100 px-1">supabase/migrations</code> على
          قاعدة بياناته (بنفس الترتيب).
        </li>
        <li>
          أنشئ مستخدماً واحداً عبر Supabase Auth (من لوحة تحكم Supabase
          مباشرة) لتستعمله كأول مدير.
        </li>
        <li>
          أضف صفاً واحداً يدوياً في جدول <code className="rounded bg-neutral-100 px-1">admin_profiles</code>{" "}
          بمعرّف (id) ذلك المستخدم — عبر SQL Editor في Supabase.
        </li>
        <li>
          أضف <code className="rounded bg-neutral-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code> و
          <code className="rounded bg-neutral-100 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> إلى
          إعدادات البيئة (راجع <code className="rounded bg-neutral-100 px-1">.env.example</code>).
        </li>
      </ol>
      <p className="mt-4 text-xs text-neutral-500">
        لا يوجد أي باب دخول بديل أو تجريبي — لوحة الإدارة تبقى مقفلة بالكامل
        حتى تكتمل هذه الخطوات.
      </p>
    </div>
  );
}
