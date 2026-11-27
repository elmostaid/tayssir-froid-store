-- تسويات التوصيل: كشف صافيه سالب كيتسجل بالصافي ديالو فالبنك (خصم).
--
-- ## لماذا
--
-- كشف فيه غير رسوم (كرطونة زايدة بلا تحصيل، ولا رجعات) صافيه سالب: الشركة
-- كتخصمو من تحويل آخر. تسجيلو بـ0 كان كيخبّي الخصم: «وصلات للبنك» كتزيد
-- و«مازال عند الشركات» كيتغلّط بنفس المبلغ. بالصافي السالب، مجموع الكشوفات
-- المختارة = التحويل اللي وصل فعلاً للحساب.
--
-- ## ما يتغيّر
--
-- قيد `bank_received_amount` فـ`carrier_invoices` (جدول هذا النظام): كيقبل مبلغ
-- سالب **غير** إلا كان الكشف صافيه سالب، وماشي أقل من الصافي. كل صف قائم
-- كيبقى صالح (كلهم ≥ 0). لا شيء فـ`orders` ولا فأي جدول آخر.
--
-- ## التراجع
--
--   alter table public.carrier_invoices drop constraint carrier_invoices_bank_received_amount_check;
--   alter table public.carrier_invoices add constraint carrier_invoices_bank_received_amount_check
--     check (bank_received_amount is null or bank_received_amount >= 0);  -- بعد تصفير أي مبلغ سالب

begin;

alter table public.carrier_invoices drop constraint carrier_invoices_bank_received_amount_check;
alter table public.carrier_invoices add constraint carrier_invoices_bank_received_amount_check
  check (bank_received_amount is null or bank_received_amount >= least(total_net, 0));

commit;
