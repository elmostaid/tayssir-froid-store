import postgres from "/home/user/tayssir-froid-store/node_modules/postgres/src/index.js";
const U = "postgres://postgres@127.0.0.1:5435/tayssir_test"; // عبر الوسيط ← المجمّع
const base = { max: 5, idle_timeout: 20, connect_timeout: 5, prepare: false };
const ctl = (p) => fetch(`http://127.0.0.1:9099${p}`).then((r) => r.json());

async function run(label, n, fn, opts = base) {
  const sql = postgres(U, opts);
  await sql`select 1`;                       // سخّن
  await ctl("/reset");
  const t = performance.now();
  await Promise.all(Array.from({ length: n }, () => fn(sql)));
  const ms = performance.now() - t;
  const st = await ctl("/stats");
  await sql.end({ timeout: 5 });
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(0).padStart(5)}ms   اتصالات جديدة=${st.total}`);
  return ms;
}

const plain = (s) => s`select pg_sleep(0.2), 1 as v`;
const inTx  = (s) => s.begin(async (t) => { await t`set local statement_timeout = 8000`; return t`select pg_sleep(0.2), 1 as v`; });

console.log("12 استعلاماً متوازياً، كلّ منها pg_sleep(0.2) — max:5، عبر مجمّع المعاملات:");
const a = await run("استعلامات مباشرة (pipelining مُفعَّل)", 12, plain);
const b = await run("داخل معاملات + SET LOCAL (لا pipelining)", 12, inTx);
console.log(`\n  التسلسل المفروض: ${(b - a).toFixed(0)}ms إضافية (${((b/a - 1) * 100).toFixed(0)}%)`);
console.log(`  (التسلسل المثالي لـ12 على 5 اتصالات = 3 أمواج × 200ms = 600ms)`);

console.log("\nنفس المقارنة باستعلام واقعي (لا نوم) — مجموعة الصفحة الرئيسية ×11:");
const q  = (s) => s`select count(*) from public.products where status='published'`;
const qT = (s) => s.begin(async (t) => { await t`set local statement_timeout = 8000`; return t`select count(*) from public.products where status='published'`; });
const c = await run("مباشرة", 11, q);
const d = await run("بمعاملات + SET LOCAL", 11, qT);
console.log(`\n  الفرق الواقعي: ${(d - c).toFixed(0)}ms (${((d/c - 1) * 100).toFixed(0)}%)`);
process.exit(0);
