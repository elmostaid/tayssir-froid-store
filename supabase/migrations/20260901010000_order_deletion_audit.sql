-- حذف الطلب: يُعيد المخزون مرة واحدة، ويترك أثراً.
--
-- ما كان يقع قبل هذا: حذف الطلب يمحو صفّه وسطوره وسجل حالاته، ويترك حركات
-- المخزون معلَّقة بلا طلب (ON DELETE SET NULL) **بلا إرجاع الكمية**. النتيجة
-- المقاسة على الإنتاج: 2,103 وحدة عبر 144 منتجاً خُصمت من المخزون بلا طلب
-- مقابل، ومنتج واحد (فرفارة بوش) صار صفراً وهو معروض للبيع. ولا سجل يقول
-- من حذف ولا متى — كل أثر الطلب يختفي معه.

-- 1) سببان ناقصان في قيد حركات المخزون.
--
-- 'order_deleted' جديد: يميّز إرجاع الحذف عن إرجاع الإلغاء، وهو ما يجعل
-- تصحيح المخزون قابلاً لإعادة التشغيل بلا مضاعفة (المجموع يصير صفراً).
--
-- 'order_returned' ليس إضافة تجميلية: `RESTOCK_MOVEMENT_REASON.returned`
-- في actions.ts يكتب هذه القيمة بالضبط منذ البداية، والقيد يرفضها — أي أن
-- تسجيل أي طلب كـ«راجع» كان يفشل بخطأ قاعدة بيانات. القيد هنا هو الخطأ.
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('order_created', 'order_cancelled', 'order_returned',
                    'order_deleted', 'manual_adjustment'));

-- 2) سجل الحذف.
--
-- بلا مفتاح أجنبي على order_id عمداً: الطلب لم يعد موجوداً، والغرض من هذا
-- الجدول أن يبقى بعده. ولقطة السطور تُحفظ كـjsonb لأن order_items تُمحى
-- بـCASCADE — فبدونها لا يبقى أي أثر لما كان في الطلب.
create table if not exists public.order_deletions (
  id bigserial primary key,
  order_id bigint not null,
  order_number text not null,
  public_reference text,
  source text,
  status_at_deletion text,
  customer_name text,
  customer_phone text,
  customer_city text,
  items_subtotal numeric(10,2),
  final_total numeric(10,2),
  order_created_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  -- هل أرجع هذا الحذف مخزوناً، وكم. طلب مُلغى أو راجع أرجع مخزونه سابقاً
  -- فلا يُرجعه الحذف مرة ثانية — وهذان العمودان يوثّقان أيّ الحالتين وقعت.
  stock_restored boolean not null default false,
  restored_units integer not null default 0,
  deleted_by text,
  deleted_at timestamptz not null default now()
);

create index if not exists order_deletions_deleted_at_idx
  on public.order_deletions (deleted_at desc);
create index if not exists order_deletions_order_number_idx
  on public.order_deletions (order_number);

-- نفس سياسة بقية جداول الإدارة: RLS مُفعَّل بلا سياسات، فلا يصل أحد الجدول
-- عبر PostgREST بالمفتاح العام. الوصول يقع من الخادم بمفتاح الخدمة وحده.
alter table public.order_deletions enable row level security;
