/**
 * مصفوفة اختبارات عبر **مجمّع معاملات حقيقي** (PgBouncer pool_mode=transaction
 * على 6543) — لا عبر Postgres مباشرة. السلسلة:
 *     عميل → وسيط TCP:5435 → PgBouncer:6543 → Postgres:5433
 *
 * ⚠️ PgBouncer ليس Supavisor: نفس **نمط** التجميع (transaction)، تنفيذ
 * مختلف (C مقابل Elixir). فهذا يُثبت سلوك تجميع المعاملات، لا تفاصيل
 * Supavisor. أقوى بكثير من Postgres المباشر، وأضعف من الشيء نفسه.
 *
 * محلي بالكامل. لا إنتاج. والكتابة تُنظَّف.
 */
import postgres from "/home/user/tayssir-froid-store/node_modules/postgres/src/index.js";

const VIA_PROXY = "postgres://postgres@127.0.0.1:5435/tayssir_test"; // عبر الوسيط ثم المجمّع
const DIRECT_POOLER = "postgres://postgres@127.0.0.1:6543/tayssir_test";
const ctl = (p) => fetch(`http://127.0.0.1:9099${p}`).then((r) => r.json()).catch(() => ({}));
const ok = (s) => `\x1b[32m${s}\x1b[0m`, bad = (s) => `\x1b[31m${s}\x1b[0m`;

// نفس إعدادات db.ts الحالية
// إعداد db.ts الحرفي — يُرفَض فاتالاً عبر مجمّع المعاملات (اختبار 0)
const AS_IN_DB_TS = { max: 5, idle_timeout: 20, connect_timeout: 5, max_lifetime: 1800,
                      prepare: false, connection: { statement_timeout: 8000 } };
// نفسه بلا الـstartup parameter — لتتمكّن بقية الاختبارات من الاتصال أصلاً
const CURRENT = { max: 5, idle_timeout: 20, connect_timeout: 5, max_lifetime: 1800, prepare: false };

const line = (n, label, verdict, detail) =>
  console.log(`${String(n).padStart(2)}. ${label.padEnd(42)} ${verdict}  ${detail}`);

async function t0_startupParamRejected() {
  await ctl("/normal"); await ctl("/reset");
  const sql = postgres(DIRECT_POOLER, AS_IN_DB_TS);
  let code = "قُبِل بلا اعتراض";
  try { await sql`select 1`; } catch (e) { code = `${e.code} ${(e.message||"").slice(0,42)}`; }
  await sql.end({ timeout: 2 }).catch(() => {});
  line(0, "إعداد db.ts الحرفي عبر مجمّع المعاملات",
       code.startsWith("08P01") ? bad("مرفوض فاتالاً") : ok("قُبِل"), code);
}

async function t1_hangBeforeAuth() {
  await ctl("/normal"); await ctl("/reset"); await ctl("/blackhole?after=0");
  const sql = postgres(VIA_PROXY, CURRENT);
  const t = Date.now();
  let code = "لم يفشل";
  try { await sql`select 1`; } catch (e) { code = e.code || e.message?.slice(0, 30); }
  const s = ((Date.now() - t) / 1000).toFixed(1);
  await sql.end({ timeout: 2 }).catch(() => {});
  await ctl("/normal");
  line(1, "تعليق قبل المصادقة", Number(s) < 7 ? ok("محدود") : bad("غير محدود"), `${s}s · ${code}`);
}

async function t2_clientQueueWait() {
  await ctl("/normal"); await ctl("/reset");
  // max:2 و12 استعلاماً بطيئاً => الفائض ينتظر في طابور العميل
  const sql = postgres(DIRECT_POOLER, { ...CURRENT, max: 2 });
  const t = Date.now();
  const rs = await Promise.allSettled(
    Array.from({ length: 12 }, () => sql`select pg_sleep(0.3), 1 as v`)
  );
  const s = ((Date.now() - t) / 1000).toFixed(1);
  const good = rs.filter((r) => r.status === "fulfilled").length;
  await sql.end({ timeout: 5 });
  line(2, "انتظار طابور العميل (max:2 ← 12 استعلاماً)", good === 12 ? ok("كلها نجحت") : bad("فقدان"), `${s}s · ${good}/12`);
}

async function t3_poolerQueueWait() {
  await ctl("/normal"); await ctl("/reset");
  // نُشبع مجمّع PgBouncer (default_pool_size=5) بعملاء آخرين يحتجزون معاملات،
  // ثم نقيس ما يحدث لعميلنا: ينتظر عند **المجمّع** لا عند العميل.
  const hogs = postgres(DIRECT_POOLER, { ...CURRENT, max: 6 });
  const held = [];
  for (let i = 0; i < 5; i++) {
    held.push(hogs.begin(async (trx) => { await trx`select pg_sleep(4)`; }).catch(() => {}));
  }
  await new Promise((r) => setTimeout(r, 600));
  const sql = postgres(DIRECT_POOLER, CURRENT);
  const t = Date.now();
  let verdict = "", code = "نجح";
  try { await sql`select 1 as v`; } catch (e) { code = e.code || e.message?.slice(0, 26); }
  const s = ((Date.now() - t) / 1000).toFixed(1);
  verdict = Number(s) < 10 ? ok("انتهى") : bad("تعليق طويل");
  await Promise.all(held); await sql.end({ timeout: 5 }); await hogs.end({ timeout: 5 });
  line(3, "انتظار طابور المجمّع (المجمّع مُشبَع)", verdict, `${s}s · ${code}`);
}

async function t4_longQuery(mode) {
  await ctl("/normal"); await ctl("/reset");
  const sql = postgres(DIRECT_POOLER, CURRENT);
  await sql`select 1`.catch(() => {});
  const t = Date.now();
  let code = "أكمل بلا حدّ";
  try {
    if (mode === "setlocal") {
      await sql.begin(async (trx) => {
        await trx`set local statement_timeout = 8000`;
        return trx`select pg_sleep(30)`;
      });
    } else {
      await sql`select pg_sleep(30)`;
    }
  } catch (e) { code = e.code || e.message?.slice(0, 30); }
  const s = ((Date.now() - t) / 1000).toFixed(1);
  await sql.end({ timeout: 2 }).catch(() => {});
  const bounded = Number(s) < 12;
  line(4, `استعلام طويل 30s — ${mode === "setlocal" ? "SET LOCAL" : "الوضع الحالي"}`,
       bounded ? ok("حُدّ") : bad("لم يُحَدّ"), `${s}s · ${code}`);
  return { mode, s: Number(s), code };
}

async function t5_cancelFails(mode) {
  await ctl("/normal"); await ctl("/reset");
  const sql = postgres(VIA_PROXY, { ...CURRENT, max: 1 });
  // نُطلق الاستعلام الطويل **أولاً** على اتصال يُفتَح الآن، ثم نحجب الجديد:
  // فالاستعلام جارٍ فعلاً على اتصال قائم، وcancel() وحده يحتاج اتصالاً.
  const t = Date.now();
  let code = "🔴 لم يُحَلّ";
  const run = mode === "setlocal"
    ? sql.begin(async (trx) => { await trx`set local statement_timeout = 8000`; return trx`select pg_sleep(60)`; })
    : sql`select pg_sleep(60)`;
  await new Promise((r) => setTimeout(r, 1200));  // تأكّد أنه انطلق
  await ctl("/blackhole?after=0");
  await Promise.race([
    run.then(() => (code = "أكمل")).catch((e) => (code = e.code || e.message?.slice(0, 30))),
    new Promise((r) => setTimeout(r, 35000)),
  ]);
  const s = ((Date.now() - t) / 1000).toFixed(1);
  await ctl("/normal"); await sql.end({ timeout: 2 }).catch(() => {});
  const bounded = Number(s) < 15;
  line(5, `فشل الإلغاء — ${mode === "setlocal" ? "SET LOCAL" : "الوضع الحالي"}`,
       bounded ? ok("حُدّ") : bad("تعليق"), `${s}s · ${code}`);
  return { mode, s: Number(s), code };
}

async function t6_mismatchedRows() {
  await ctl("/normal"); await ctl("/reset");
  // التحذير الأخطر في التوثيق: «return mismatched rows». نُطلق 200 استعلاماً
  // متمايزاً بالتوازي عبر مجمّع المعاملات ونتحقّق أن كل وعد أخذ جوابه هو.
  const sql = postgres(DIRECT_POOLER, CURRENT);
  const N = 200;
  const rs = await Promise.all(
    Array.from({ length: N }, (_, i) => sql`select ${i}::int as marker, ${"s" + i} as tag`
      .then((r) => ({ i, got: Number(r[0].marker), tag: r[0].tag })))
  );
  const wrong = rs.filter((r) => r.got !== r.i || r.tag !== "s" + r.i);
  await sql.end({ timeout: 5 });
  line(6, `تطابق النتائج — ${N} استعلاماً متوازياً`,
       wrong.length === 0 ? ok("كلها مطابقة") : bad("عدم تطابق!"), `${N - wrong.length}/${N}`);
  return wrong.length;
}

async function t7_writesAndCleanup() {
  await ctl("/normal"); await ctl("/reset");
  const sql = postgres(DIRECT_POOLER, CURRENT);
  await sql`drop table if exists public._tf_pool_probe`;
  await sql`create table public._tf_pool_probe (k text primary key, n int)`;
  // عشر معاملات متزامنة بنفس المفتاح: يجب أن تنجح واحدة فقط في الإدخال
  const rs = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      sql.begin(async (trx) => {
        await trx`set local statement_timeout = 8000`;
        return trx`insert into public._tf_pool_probe (k, n) values ('same', 1)
                   on conflict (k) do nothing returning k`;
      })
    )
  );
  const [{ c }] = await sql`select count(*)::int as c from public._tf_pool_probe`;
  const inserted = rs.filter((r) => r.status === "fulfilled" && r.value.length > 0).length;
  await sql`drop table public._tf_pool_probe`;
  // تنظيف الاتصالات: هل عاد المجمّع فارغاً؟
  const admin = postgres("postgres://postgres@127.0.0.1:6543/pgbouncer", { max: 1, prepare: false, fetch_types: false });
  let active = "?";
  try {
    const pools = await admin.unsafe("show pools");
    const row = pools.find((p) => p.database === "tayssir_test");
    active = row ? `sv_active=${row.sv_active} cl_waiting=${row.cl_waiting}` : "لا مجمّع";
  } catch (e) { active = "تعذّر: " + (e.message || "").slice(0, 24); }
  await admin.end({ timeout: 2 }).catch(() => {});
  await sql.end({ timeout: 5 });
  line(7, "كتابات متزامنة بنفس المفتاح (×10)", Number(c) === 1 && inserted === 1 ? ok("صفّ واحد") : bad("تكرار"), `صفوف=${c} أدخل=${inserted}`);
  line(8, "تنظيف اتصالات المجمّع بعدها", ok("قيس"), active);
}

async function main() {
  console.log("══ عبر مجمّع معاملات حقيقي (PgBouncer pool_mode=transaction, pool=5) ══\n");
  await t0_startupParamRejected();
  await t1_hangBeforeAuth();
  await t2_clientQueueWait();
  await t3_poolerQueueWait();
  const l1 = await t4_longQuery("current");
  const l2 = await t4_longQuery("setlocal");
  const c1 = await t5_cancelFails("current");
  const c2 = await t5_cancelFails("setlocal");
  const mm = await t6_mismatchedRows();
  await t7_writesAndCleanup();
  console.log("\n── الخلاصة ──");
  console.log(`  استعلام طويل: الوضع الحالي ${l1.s}s (${l1.code})  →  SET LOCAL ${l2.s}s (${l2.code})`);
  console.log(`  فشل الإلغاء : الوضع الحالي ${c1.s}s (${c1.code})  →  SET LOCAL ${c2.s}s (${c2.code})`);
  console.log(`  عدم تطابق النتائج: ${mm === 0 ? "لم يظهر في هذه الجولة" : mm + " حالة!"}`);
  process.exit(0);
}
main();
