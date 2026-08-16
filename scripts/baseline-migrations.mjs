#!/usr/bin/env node
/**
 * يُنشئ جدول تتبّع الـmigrations الذي تستعمله Supabase CLI، ويُسجِّل فيه كل
 * ملفات supabase/migrations الموجودة على أنها **مُطبَّقة سابقاً**.
 *
 * لماذا: قاعدة الإنتاج لم يكن فيها جدول supabase_migrations.schema_migrations
 * إطلاقاً — أي أنّ الـ32 migration طُبِّقت يدوياً ولا توجد أي وسيلة لمعرفة ما
 * طُبِّق منها وما لم يُطبَّق. بلا هذا الجدول، أي `supabase db push` مستقبلي
 * سيحاول إعادة تطبيق كل شيء من الصفر.
 *
 * السلامة: هذا السكريبت **إضافي بحت**. لا ينشئ إلا schema وجدولاً جديدين،
 * ولا يكتب إلا أسماء نسخ الـmigrations. لا CREATE/ALTER/DROP على أي جدول
 * أعمال، ولا سطر واحد من بيانات المتجر يُقرأ أو يُعدَّل أو يُحذف.
 *
 * صحّة الأساس (baseline) تحقّقنا منها قبل التسجيل بمقارنة بنيوية كاملة بين
 * مخطَّط الإنتاج ومخطَّط قاعدة مبنيّة من هذه الملفات وحدها: 142 عموداً
 * متطابقة تماماً، والفارق الوحيد جدول نسخ احتياطي يدوي
 * (product_images_backup_20260809_*) أُنشئ خارج الـmigrations ولا تنتجه أي
 * منها — تُرك كما هو عمداً (لا نحذف بيانات).
 *
 * الاستعمال:
 *   SUPABASE_ACCESS_TOKEN=... node scripts/baseline-migrations.mjs <project-ref> [--apply]
 * بدون --apply يطبع ما سيفعله فقط (تشغيل جاف).
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ref = process.argv[2];
const apply = process.argv.includes("--apply");

if (!ref) {
  console.error("الاستعمال: node scripts/baseline-migrations.mjs <project-ref> [--apply]");
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN غير معرَّف.");
  process.exit(1);
}

const files = readdirSync(join(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// اسم الملف: <version>_<name>.sql — نفس التقسيم الذي تعتمده Supabase CLI.
const rows = files.map((f) => {
  const base = f.replace(/\.sql$/, "");
  const i = base.indexOf("_");
  return { version: i === -1 ? base : base.slice(0, i), name: i === -1 ? base : base.slice(i + 1) };
});

const values = rows
  .map((r) => `(${quote(r.version)}, ${quote(r.name)})`)
  .join(",\n    ");

const sql = `
create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);

insert into supabase_migrations.schema_migrations (version, name)
values
    ${values}
on conflict (version) do nothing;
`.trim();

function quote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

console.log(`عدد ملفات الـmigrations: ${rows.length}`);
console.log(`أقدم نسخة: ${rows[0].version}   أحدث نسخة: ${rows[rows.length - 1].version}`);

if (!apply) {
  console.log("\n--- تشغيل جاف (بلا --apply). سيُنفَّذ ما يلي: ---\n");
  console.log(sql);
  process.exit(0);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`فشل (${res.status}): ${body}`);
  process.exit(1);
}
console.log("تم التسجيل بنجاح.");
