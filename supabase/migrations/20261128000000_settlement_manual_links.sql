-- تسويات التوصيل، المرحلة 3: الربط اليدوي الآمن لكرطونة بطلبية.
--
-- ## لماذا
--
-- أول فاتورة حقيقية (1761) فيها كرطونات ما يقدر النظام يربطها وحدو بيقين: هاتف
-- مختلف، ولا جوج طلبيات بنفس الهاتف. المالك كيعرف الطلبية الصحيحة؛ خاصو يقدر
-- يقولها للنظام بلا ما يتجاوز الحماية.
--
-- ## كيفاش
--
-- الربط **ماشي تطبيق**: كيسجل غير «هاد الكرطونات ديال هاد الطلبية». من بعد،
-- نفس المحرك كيحكم على الطلبية (المبلغ، الحالة، الكرطونات)، وكتبان فـ«تحتاج
-- قرارك» بأدلتها، وما كتطبّق إلا إلا علّم عليها المالك. والتسوية اللي كتخرج منها
-- كتتسجل بقرار «manual» للمراجعة.
--
-- ## ما يتغيّر
--
-- - ثلاثة أعمدة جديدة فـ`carrier_parcels` (جدول هذا النظام): الطلبية المربوطة،
--   شكون ربطها، وإمتى. فارغة فكل الصفوف الموجودة.
-- - قيد القرار فـ`carrier_order_settlements` كيقبل «manual» زيادة على القيم
--   القديمة. كل صف قائم كيبقى صالح.
-- لا شيء فـ`orders` ولا فأي جدول آخر.
--
-- ## التراجع عن هذا الملف
--
--   alter table public.carrier_order_settlements drop constraint carrier_order_settlements_decision_check;
--   alter table public.carrier_order_settlements add constraint carrier_order_settlements_decision_check
--     check (decision in ('auto', 'approved'));   -- بعد التراجع عن أي تسوية manual
--   alter table public.carrier_parcels drop column manual_order_id,
--     drop column manual_linked_by, drop column manual_linked_at;

begin;

alter table public.carrier_parcels
  add column manual_order_id bigint references public.orders(id) on delete set null,
  add column manual_linked_by text,
  add column manual_linked_at timestamptz;

alter table public.carrier_order_settlements
  drop constraint carrier_order_settlements_decision_check;
alter table public.carrier_order_settlements
  add constraint carrier_order_settlements_decision_check
    check (decision in ('auto', 'approved', 'manual'));

comment on column public.carrier_parcels.manual_order_id is
  'ربط يدوي من المالك بطلبية. ماشي تطبيق: الطلبية كتبان فـ«تحتاج قرارك» وما كتطبّق إلا بموافقة.';

commit;
