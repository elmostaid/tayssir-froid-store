/**
 * يختبر ثلاثة علاجات لمهلة الاستعلام، ويقيس أيّها ينهي الاستعلام المعلّق
 * فعلاً **حين يتعذّر على cancel() فتح اتصاله** — وهي الحالة التي أنتجت
 * الـ300 ثانية.
 *
 * محلي بالكامل. قفل في معاملة نتحكّم فيها + SELECT. لا كتابة ولا إنتاج.
 */
import postgres from "/home/user/tayssir-froid-store/node_modules/postgres/src/index.js";

const URL_ = "postgres://postgres@127.0.0.1:5434/tayssir_test";
const MODE = process.argv[2]; // startup | setlocal | none
const WAIT_MS = Number(process.argv[3] ?? 40000);
const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1);
const ctl = (p) => fetch(`http://127.0.0.1:9099${p}`).then((r) => r.json());

// دور بلا statement_timeout — يُحاكي دور `postgres` في الإنتاج (مقيس:
// لا إعداد له، فيسقط على العام 2 دقيقة).
const base = { max: 5, idle_timeout: 20, connect_timeout: 5, prepare: false };
const opts =
  MODE === "startup"
    ? { ...base, connection: { statement_timeout: 8000 } } // ما لا يعمل عبر 6543
    : base;

const locker = postgres(URL_, { ...base, max: 1 });
const client = postgres(URL_, opts);

async function main() {
  await ctl("/normal"); await ctl("/reset");
  // اجعل الدور بلا مهلة، كما في الإنتاج
  await client`set statement_timeout = '2min'`.catch(() => {});
  const [{ st }] = await client`select current_setting('statement_timeout') as st`;
  console.log(`الوضع: ${MODE}   ·   statement_timeout على الجلسة = ${st}`);

  let release;
  const held = new Promise((r) => (release = r));
  locker.begin(async (trx) => {
    await trx`lock table public.settings in access exclusive mode`;
    await held;
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  console.log(`[${el()}s] 🔒 القفل مأخوذ`);

  await ctl("/blackhole?after=0");
  console.log(`[${el()}s] ⛔ لا اتصال جديد ينجح — فcancel() لا يستطيع العمل`);

  const t = Date.now();
  let outcome = "🔴 لم يُحَلّ أبداً";
  const run =
    MODE === "setlocal"
      ? // العلاج المُقترَح: المهلة تُضبَط **داخل المعاملة** بـSET LOCAL،
        // فتُطبَّق على الخادم ولا تتسرّب إلى العميل التالي في نمط المعاملة.
        client.begin(async (trx) => {
          await trx`set local statement_timeout = 8000`;
          return trx`select count(*) from public.settings`;
        })
      : client`select count(*) from public.settings`;

  await Promise.race([
    run.then(() => (outcome = `نجح بعد ${((Date.now()-t)/1000).toFixed(1)}s`))
       .catch((e) => (outcome = `✅ رُفِض بعد ${((Date.now()-t)/1000).toFixed(1)}s بـ ${e.code || e.message?.slice(0,40)}`)),
    new Promise((r) => setTimeout(r, WAIT_MS)),
  ]);
  console.log(`النتيجة: ${outcome}   (انتظرنا ${WAIT_MS/1000}s؛ سقف Vercel 300s)`);
  release(); await ctl("/normal");
  process.exit(0);
}
main();
