-- تسويات التوصيل: تنبيهات الكشف كتتحفظ، وكتحتاج موافقة المالك قبل التطبيق.
--
-- ## لماذا
--
-- كشف OzonExpress الأصلي (VRT-N-2846416-261026-81-99416) فيه «Total Colis»
-- 8,175 ومجموع السطور 8,735 (فرق 560). القارئ كيعتمد على السطور (متطابقة مع
-- الرسوم والصافي المحوَّل)، ولكن المالك طلب: الفرق يبان بوضوح، وما تطبّق حتى
-- تسوية من هاد الكشف حتى يوافق عليه.
--
-- ## ما يتغيّر
--
-- ثلاثة أعمدة جديدة فـ`carrier_invoices` (جدول هذا النظام):
--   parse_warnings            ملاحظات القراءة (فارغة فكل فاتورة قديمة وفـBigDelivery).
--   warnings_acknowledged_at  إمتى وافق المالك عليها.
--   warnings_acknowledged_by  شكون وافق.
-- لا شيء فـ`orders` ولا فأي جدول آخر، ولا صف قائم كيتبدل.
--
-- ## التراجع
--
--   alter table public.carrier_invoices drop column parse_warnings,
--     drop column warnings_acknowledged_at, drop column warnings_acknowledged_by;

begin;

alter table public.carrier_invoices
  add column parse_warnings text[] not null default '{}',
  add column warnings_acknowledged_at timestamptz,
  add column warnings_acknowledged_by text;

comment on column public.carrier_invoices.parse_warnings is
  'ملاحظات القراءة (مثلاً «Total Colis» مختلف). ما كتطبّق حتى تسوية من الكشف حتى يوافق المالك (warnings_acknowledged_at).';

commit;
