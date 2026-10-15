/**
 * يُعيد إنتاج الفجوة المُشتبهة: مؤقّت العميل يُشعِل cancel()، لكن cancel()
 * يحتاج **فتح اتصال TCP جديد** لإرسال CancelRequest. فإن تعذّر فتحه، لا
 * يُرفَض الاستعلام الأصلي أبداً.
 *
 * نفس خيارات db.ts ونفس منطق boundQueryLifetime (منسوخ حرفياً، لا نعدّل
 * db.ts). المتغيّر الوحيد: هل statement_timeout نافذ على الخادم أم لا —
 * لأن هذا بالضبط ما لم نتحقّق منه بعد عبر Supavisor.
 *
 * كل شيء على القاعدة المحلية، SELECT وقفل في معاملة نتحكّم فيها. لا كتابة.
 */
import postgres from "/home/user/tayssir-froid-store/node_modules/postgres/src/index.js";

const URL_ = "postgres://postgres@127.0.0.1:5434/tayssir_test";
const QUERY_HARD_TIMEOUT_MS = 10000;          // نفس db.ts:8
const STATEMENT_TIMEOUT = Number(process.argv[2] ?? 8000); // 0 = «الـpooler أسقطها»
const WAIT_MS = Number(process.argv[3] ?? 120000);

// ── منسوخ من db.ts:42-93 بلا تغيير ──────────────────────────────────
function boundQueryLifetime(query) {
  const pending = query;
  if (!pending || typeof pending.cancel !== "function" || typeof pending.then !== "function") return query;
  const originalThen = pending.then;
  const cancel = pending.cancel.bind(pending);
  let timer, armed = false;
  const disarm = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const arm = () => {
    if (armed) return;
    armed = true;
    timer = setTimeout(() => {
      timer = undefined;
      console.log(`   [${((Date.now()-T0)/1000).toFixed(1)}s] ⏰ المؤقّت أشعل cancel()`);
      try { cancel(); } catch {}
    }, QUERY_HARD_TIMEOUT_MS);
    Reflect.apply(originalThen, pending, [disarm, disarm]);
  };
  Object.defineProperty(pending, "then", {
    configurable: true, writable: true,
    value: function patchedThen(...args) { arm(); return Reflect.apply(originalThen, pending, args); },
  });
  return query;
}
// ────────────────────────────────────────────────────────────────────

const opts = {
  max: 5, idle_timeout: 20, connect_timeout: 5, max_lifetime: 60 * 30,
  prepare: false, connection: { statement_timeout: STATEMENT_TIMEOUT },
};
const locker = postgres(URL_, { ...opts, max: 1 });
const client = postgres(URL_, opts);
const q = (p) => boundQueryLifetime(p);  // p ناتج قالب موسوم حقيقي

const T0 = Date.now();
const el = () => ((Date.now() - T0) / 1000).toFixed(1);
const ctl = (p) => fetch(`http://127.0.0.1:9099${p}`).then((r) => r.json());

process.on("unhandledRejection", (e) =>
  console.log(`   [${el()}s] ⚠️  unhandledRejection: ${e?.code || e?.message || e}`));

async function main() {
  await ctl("/normal"); await ctl("/reset");
  console.log(`statement_timeout = ${STATEMENT_TIMEOUT === 0 ? "0 (مُعطَّل — محاكاة إسقاط الـpooler له)" : STATEMENT_TIMEOUT + "ms (نافذ)"}`);

  // 1) سخّن المجمّع: اتصال واحد مفتوح على الأقل قبل الانقطاع
  await q(client`select 1 as warm`).catch(() => {});
  console.log(`[${el()}s] المجمّع ساخن — اتصالات الوسيط: ${(await ctl("/stats")).live}`);

  // 2) اقفل جدولاً داخل معاملة (لا كتابة — قفل فقط)
  let release;
  const held = new Promise((r) => (release = r));
  locker.begin(async (trx) => {
    await trx`lock table public.settings in access exclusive mode`;
    console.log(`[${el()}s] 🔒 القفل مأخوذ على public.settings`);
    await held;
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));

  // 3) اقطع كل اتصال جديد — فلا cancel() يستطيع فتح اتصاله
  await ctl("/blackhole?after=0");
  console.log(`[${el()}s] ⛔ الانقطاع مُفعَّل: لا اتصال جديد ينجح من الآن`);

  // 4) استعلام يتوقّف على القفل، على اتصال مفتوح أصلاً
  console.log(`[${el()}s] ▶️  استعلام محجوب يبدأ (نتوقّع رفضه خلال 8–10 ثوان)`);
  const t = Date.now();
  let outcome = "لم يُحَلّ أبداً";
  await Promise.race([
    q(client`select count(*) from public.settings`)
      .then(() => (outcome = `نجح بعد ${((Date.now()-t)/1000).toFixed(1)}s`))
      .catch((e) => (outcome = `رُفِض بعد ${((Date.now()-t)/1000).toFixed(1)}s بـ ${e.code || e.message}`)),
    new Promise((r) => setTimeout(r, WAIT_MS)),
  ]);

  console.log(`\n══ النتيجة: ${outcome}`);
  console.log(`   (انتظرنا ${WAIT_MS/1000}s كحدّ أقصى. سقف Vercel الحقيقي 300s)`);
  release();
  await ctl("/normal");
  process.exit(0);
}
main();
