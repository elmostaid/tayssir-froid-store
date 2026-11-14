# النسخة الاحتياطية عبر Vercel Sandbox (بلا جهاز صاحب المشروع وبلا كلمة سرّ)

**لماذا:** الخطة المجانية في Supabase بلا نسخ تلقائية، وبيئة العمل لا تصل إلى
Postgres مباشرة، وصاحب المشروع لا يُطلب منه تثبيت شيء ولا لصق كلمة سرّ.

**الآلة:** Sandbox مسمّى `tf-db-backup` في مشروع Vercel نفسه (منطقة arn1،
قرب قاعدة eu-north-1). غير مرتبط بالموقع ولا بالنشر.

## التسلسل
1. داخل الآلة: `python3 make-credential.py` ← يولّد كلمة سرّ عشوائية في
   `/root/.tf/pw` (600) ويطبع **مُحقِّق SCRAM فقط** (لا يكشف كلمة السرّ).
2. في الإنتاج (بموافقة صاحب المشروع)، بالمُحقِّق:
   ```sql
   create role tf_backup_reader with login bypassrls connection limit 2
     valid until '<غداً>' password '<SCRAM-SHA-256$…>';
   grant pg_read_all_data to tf_backup_reader;
   alter role tf_backup_reader set default_transaction_read_only = on;
   ```
   `bypassrls` لازم: 31 جدولاً عليها RLS، وبدونه ينسخ pg_dump جداول فارغة أو يفشل.
3. داخل الآلة: `PGHOST=aws-?-eu-north-1.pooler.supabase.com PGPORT=5432
   PGUSER=tf_backup_reader.<ref> PGDATABASE=postgres bash backup.sh`
   ← عدّ قبل، pg_dump (public+auth)، عدّ بعد، حذف كلمة السرّ، استرجاع في
   Postgres محلي، مقارنة كل جدول (قبل ≤ مسترجَع ≤ بعد)، sha256.
4. في الإنتاج: `drop role tf_backup_reader;`
5. لقطة دائمة للآلة (snapshot بلا انتهاء) — النسخة تبقى فيها.

## ما جُرِّب (2026-11-01) داخل الآلة نفسها على بيانات وهمية
دخول بالمُحقِّق ✓، كلمة السرّ لم تغادر الآلة وحُذفت بعد التشغيل ✓، جداول RLS
نُسخت كاملة ✓، كتابة حيّة أثناء النسخ لا تُعدّ عطلاً ✓، الاسترجاع والمقارنة ✓،
الدور لا يستطيع الكتابة (`permission denied`) ✓. وكشف التدريب عطلاً حقيقياً
(صلاحية قراءة الملف عند الاسترجاع) فأوقف النتيجة بـ«NOT VERIFIED» — أُصلح.

**ما لم يُجرَّب بعد:** قبول مجمِّع اتصالات Supabase (Supavisor) لدور مخصّص —
يُعرف عند أول اتصال حقيقي؛ إن رفض، لا يُكتب شيء ويُحذف الدور.
