/**
 * قياس نمطَي اتصال Supavisor — يعمل **وقت البناء** على Vercel.
 *
 * لماذا وقت البناء لا عبر مسار HTTP: مسار التشخيص محميّ بمصادقة المدير (وهو
 * شرط صحيح لا أريد إضعافه)، فقراءته تحتاج جلسة بشرية. أما حاوية البناء على
 * Vercel فتصل إلى المجمّع بنفس بيانات البيئة، فيُنفَّذ القياس من تلقائه مع
 * كل نشر للفرع. بلا أي تدخّل يدوي.
 *
 * وميزة أكبر: يقيس **الرابطين في نفس اللحظة** — منفذ المعاملة 6543 ومنفذ
 * الجلسة 5432 المشتقّ منه في الذاكرة — فتصير المقارنة بين نمطين، لا بين
 * نشرين ولا بين لحظتين ولا بين إصدارين من الكود.
 *
 * حدٌّ صريح: حاوية البناء ليست نسخة Serverless (لا تجميد ولا إعادة تسخين)،
 * فهي تُثبِت سلوك المجمّع والمهل والمعاملات، ولا تُثبِت سلوك الاتصال الميت
 * بعد خمول نسخة. ذاك يبقى لقياس وقت التشغيل.
 *
 * ولا يُفشِل البناء أبداً، ولا يطبع سرّاً: بصمة الاتصال بلا كلمة السر فقط.
 */
import postgres from "postgres";
import {
  SESSION_MODE_TEST_BRANCH,
  connectionFingerprint,
  deriveSessionModeUrl,
} from "../src/lib/diagnostics/sessionModeUrl";
import { previewOnlyVerdict } from "../src/lib/diagnostics/previewOnly";
import { runSessionModeProbe, type ProbeClient } from "../src/lib/diagnostics/sessionModeProbe";

/** قيمة مميَّزة لا يضبطها أي شيء آخر — بها نفرّق سبب المهلة عن مصدرها. */
const DISTINCT_TIMEOUT_MS = 4321;

type ModeTarget = { label: string; url: string };

function buildClient(
  connectionString: string,
  options: { max: number; statementTimeoutMs: number | null }
): ProbeClient {
  return postgres(connectionString, {
    max: options.max,
    idle_timeout: 20,
    connect_timeout: 5,
    max_lifetime: 60 * 30,
    ...(options.statementTimeoutMs === null
      ? {}
      : { connection: { statement_timeout: options.statementTimeoutMs } }),
    prepare: false,
  });
}

async function withClient<T>(
  connectionString: string,
  options: { max: number; statementTimeoutMs: number | null },
  run: (sql: ProbeClient) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string; code: string | null }> {
  let client: ProbeClient | null = null;
  try {
    client = buildClient(connectionString, options);
    return { ok: true, value: await run(client) };
  } catch (error) {
    const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
    return {
      ok: false,
      error: `${String(candidate?.name ?? "Error")}: ${String(candidate?.message ?? error)}`,
      code: typeof candidate?.code === "string" ? candidate.code : null,
    };
  } finally {
    if (client) {
      try {
        await client.end({ timeout: 5 });
      } catch {
        /* إنهاء المجمّع ليس جزءاً من القياس */
      }
    }
  }
}

/**
 * السؤال الأول الذي طلبتَه: هل يُقبَل `statement_timeout` كمعامل بدء اتصال
 * على كل منفذ؟
 *
 * والفخّ الذي كان سيُفسد الجواب: دور `postgres` على قاعدة المعاينة يحمل
 * أصلاً `statement_timeout=8s`، فلو أرسلنا 8000 وقرأنا «8s» لم نعرف هل
 * المعامل قُبِل أم أن الدور هو المتكلّم. فنُرسل قيمة **مميَّزة** (4321ms):
 * ظهورها = المعامل مقبول ومُطبَّق؛ وبقاء «8s» = المعامل مُتجاهَل بصمت
 * والمهلة من الدور؛ وفشل الاتصال بـ08P01 = مرفوض صراحةً.
 */
async function timeoutAcceptance(target: ModeTarget) {
  const read = async (sql: ProbeClient) => {
    const [row] = await sql<{ effective: string | null; source_role: string }[]>`
      select current_setting('statement_timeout', true) as effective,
             current_user as source_role
    `;
    return row ?? null;
  };

  const withDistinct = await withClient(
    target.url,
    { max: 1, statementTimeoutMs: DISTINCT_TIMEOUT_MS },
    read
  );
  const withoutOption = await withClient(target.url, { max: 1, statementTimeoutMs: null }, read);

  const observedWithOption = withDistinct.ok ? withDistinct.value?.effective ?? null : null;
  return {
    mode: target.label,
    sentMs: DISTINCT_TIMEOUT_MS,
    withOption: withDistinct.ok
      ? { connected: true, effective: observedWithOption }
      : { connected: false, error: withDistinct.error, code: withDistinct.code },
    withoutOption: withoutOption.ok
      ? { connected: true, effective: withoutOption.value?.effective ?? null }
      : { connected: false, error: withoutOption.error, code: withoutOption.code },
    verdict: !withDistinct.ok
      ? `الاتصال فشل مع المعامل (${withDistinct.code ?? "بلا رمز"}) — مرفوض صراحةً`
      : observedWithOption === `${DISTINCT_TIMEOUT_MS}ms`
        ? "المعامل مقبول ومُطبَّق"
        : `المعامل مُتجاهَل بصمت — المهلة الفعلية ${observedWithOption ?? "غير معروفة"} من إعداد الدور`,
  };
}

/**
 * التمييز الحقيقي بين النمطين.
 *
 * الدرس الذي فرض هذه الخطوة: «بقاء قيمة SET بين استعلامين» ظهر صحيحاً على
 * **المنفذين كليهما** في الجولة الأولى — لأن مجمّع المعاملات بلا مزاحمة
 * يُعيد نفس الخادم من باب الحظّ لا من باب الضمان. فذاك الفحص لا يُميّز شيئاً
 * عند الخمول.
 *
 * وما يُميّز فعلاً هو ثبات **معرّف عملية الخادم**: في نمط الجلسة يُحجَز خادم
 * واحد لعمر اتصال العميل كله، فمهما كثرت الاستعلامات يبقى المعرّف واحداً.
 * وفي نمط المعاملة قد يتبدّل الخادم بين معاملة وأخرى، فتظهر معرّفات متعدّدة.
 */
async function backendPidStability(target: ModeTarget, rounds = 24) {
  const result = await withClient(target.url, { max: 1, statementTimeoutMs: null }, async (sql) => {
    const pids: number[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const [row] = await sql<{ pid: number }[]>`select pg_backend_pid() as pid`;
      if (row) pids.push(row.pid);
    }
    return pids;
  });

  if (!result.ok) {
    return { mode: target.label, rounds, error: result.error, distinctPids: null, pids: null };
  }
  const distinct = [...new Set(result.value)];
  return {
    mode: target.label,
    rounds,
    distinctPids: distinct.length,
    firstPid: result.value[0] ?? null,
    changed: distinct.length > 1,
  };
}

/** القياس الكامل: استعلام يتجاوز المهلة، ومعاملة، والاتصالات. */
async function fullProbe(target: ModeTarget, max: number) {
  const label = `${target.label}|max=${max}`;
  const result = await withClient(target.url, { max, statementTimeoutMs: 8000 }, (sql) =>
    runSessionModeProbe({
      sql,
      label,
      includeClientCounters: false,
      includeRuntimeConfig: false,
    })
  );
  return result.ok
    ? { label, ok: true as const, report: result.value }
    : { label, ok: false as const, error: result.error, code: result.code };
}

/**
 * الطلبيات والمخزون عبر **مسار الكود الحقيقي** لا عبر SQL يدوي.
 *
 * شرطك: «لا تكتفِ بظهور HTTP 200». فهذا الفحص يستدعي `createOrder` نفسها —
 * نفس الدالة التي يستعملها زبون الموقع — على اتصال نمط الجلسة، ويتحقّق من
 * ثلاثة أشياء بالأرقام: طلبية واحدة تُنشأ، والمخزون ينزل بالكمية بالضبط،
 * وثلاث محاولات متزامنة بنفس مفتاح التفرّد تُنتج **طلبية واحدة وخصماً
 * واحداً** لا ثلاثة.
 *
 * ببيانات اصطناعية بحتة، وعلى قاعدة المعاينة المعزولة وحدها، ويُنظَّف بعده.
 */
async function ordersAndStockCheck() {
  // الاستيراد داخل الدالة: هذه الوحدات تبني عميل db.ts المشترك، ولا نريد
  // بناءه إلا بعد أن تتحقّق كل شروط البيئة أعلاه.
  const { createOrder } = await import("../src/lib/orders/createOrder");
  const { sql } = await import("../src/lib/db");

  const marker = `probe-${Date.now()}`;
  const customer = {
    fullName: `اختبار نمط الجلسة ${marker}`,
    phone: "0600000199",
    city: "مراكش",
    address: "عنوان اختباري — لا زبون خلفه",
    notes: marker,
  };

  try {
    const [product] = await sql<{ id: number; stock_quantity: number }[]>`
      select p.id, p.stock_quantity
      from public.products p
      where p.stock_quantity >= 10
        and not exists (select 1 from public.product_variants v where v.product_id = p.id)
      order by p.id
      limit 1
    `;
    if (!product) return { skipped: true, reason: "لا منتج بلا متغيّرات ومخزونه ≥ 10" };

    const stockBefore = product.stock_quantity;
    const items = [{ productId: product.id, variantId: null, quantity: 2 }];

    const first = await createOrder({ items, customer, idempotencyKey: `${marker}-a` });

    const [afterFirst] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${product.id}
    `;

    // ثلاث محاولات متزامنة بنفس المفتاح — هذا هو الفحص الذي يمسّ المال.
    const key = `${marker}-b`;
    const concurrent = await Promise.all([
      createOrder({ items, customer, idempotencyKey: key }),
      createOrder({ items, customer, idempotencyKey: key }),
      createOrder({ items, customer, idempotencyKey: key }),
    ]);

    const [afterConcurrent] = await sql<{ stock_quantity: number }[]>`
      select stock_quantity from public.products where id = ${product.id}
    `;
    const rows = await sql<{ id: number; idempotency_key: string | null }[]>`
      select id, idempotency_key from public.orders where customer_notes = ${marker}
    `;

    const createdIds = rows.map((r) => r.id);
    const result = {
      skipped: false,
      productId: product.id,
      stockBefore,
      stockAfterFirstOrder: afterFirst?.stock_quantity ?? null,
      stockAfterConcurrent: afterConcurrent?.stock_quantity ?? null,
      firstOrderOk: first.ok,
      concurrentOk: concurrent.filter((r) => r.ok).length,
      ordersCreated: rows.length,
      distinctIdempotencyKeys: [...new Set(rows.map((r) => r.idempotency_key))].length,
      // المتوقَّع: طلبيتان فقط (الأولى + واحدة من الثلاث)، وخصم 4 وحدات.
      expectedOrders: 2,
      expectedStockDrop: 4,
      actualStockDrop:
        afterConcurrent?.stock_quantity != null ? stockBefore - afterConcurrent.stock_quantity : null,
    };

    // تنظيف: نُرجِع المخزون ونحذف طلبيات الاختبار، فلا تبقى أرقام مصطنعة
    // تُشوّش أي قياس لاحق على المعاينة.
    if (createdIds.length > 0) {
      await sql`delete from public.orders where id = any(${createdIds})`;
      await sql`update public.products set stock_quantity = ${stockBefore} where id = ${product.id}`;
    }

    return { ...result, cleanedUp: createdIds.length };
  } catch (error) {
    return {
      skipped: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (branch !== SESSION_MODE_TEST_BRANCH) {
    console.log(`[probe] تخطٍّ: الفرع ${branch ?? "(محلي)"} ليس فرع الاختبار.`);
    return;
  }

  const verdict = previewOnlyVerdict();
  if (!verdict.allowed) {
    console.log(`[probe] تخطٍّ: ${verdict.reason}`);
    return;
  }

  const base = process.env.DATABASE_URL;
  if (!base) {
    console.log("[probe] تخطٍّ: DATABASE_URL غير معرَّف في بيئة البناء.");
    return;
  }

  let derived: ReturnType<typeof deriveSessionModeUrl>;
  try {
    derived = deriveSessionModeUrl(base);
  } catch (error) {
    console.log(`[probe] توقّف: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`[probe] بصمة الرابط كما هو: ${JSON.stringify(connectionFingerprint(base))}`);
    return;
  }

  const targets: ModeTarget[] = derived.alreadySessionMode
    ? [{ label: "session-mode-5432", url: derived.url }]
    : [
        { label: "transaction-mode-6543", url: base },
        { label: "session-mode-5432", url: derived.url },
      ];

  console.log(`[probe] بصمة قبل: ${JSON.stringify(derived.before)}`);
  console.log(`[probe] بصمة بعد: ${JSON.stringify(derived.after)}`);

  const payload: Record<string, unknown> = {
    fingerprintBefore: derived.before,
    fingerprintAfter: derived.after,
    removedPgbouncerFlag: derived.removedPgbouncerFlag,
    timeoutAcceptance: [] as unknown[],
    pidStability: [] as unknown[],
    fullProbes: [] as unknown[],
  };

  for (const target of targets) {
    (payload.timeoutAcceptance as unknown[]).push(await timeoutAcceptance(target));
  }
  for (const target of targets) {
    (payload.pidStability as unknown[]).push(await backendPidStability(target));
  }
  for (const target of targets) {
    for (const max of [1, 2]) {
      (payload.fullProbes as unknown[]).push(await fullProbe(target, max));
    }
  }

  // الطلبيات والمخزون عبر مسار الكود الحقيقي، على اتصال نمط الجلسة
  // (عميل db.ts المشترك يشتقّ المنفذ بنفسه داخل هذا الفرع).
  payload.ordersAndStock = await ordersAndStockCheck();

  console.log(`[probe] ${JSON.stringify(payload).slice(0, 1200)}`);

  // تُحفَظ النتيجة في جدول على قاعدة المعاينة: سجل البناء يضيع فيه الجوهر
  // بين عشرات تحذيرات npm، أما الصفّ فيُستعلَم مرة واحدة ويبقى للمقارنة.
  // والكتابة عبر الرابط الأصلي لأنه المعروف أنه يعمل.
  const recorder = buildClient(base, { max: 1, statementTimeoutMs: 8000 });
  try {
    await recorder`
      insert into public.diag_runs (commit_sha, label, payload)
      values (
        ${process.env.VERCEL_GIT_COMMIT_SHA ?? null},
        ${"matrix"},
        ${recorder.json(payload as never)}
      )
    `;
    console.log("[probe] حُفظت نتائج المصفوفة في public.diag_runs");
  } catch (error) {
    console.log(
      `[probe] تعذّر حفظ النتائج: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    try {
      await recorder.end({ timeout: 5 });
    } catch {
      /* لا يهمّ */
    }
  }
}

main()
  .catch((error) => {
    console.log(
      `[probe] خطأ غير متوقَّع (لا يُفشِل البناء): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  })
  .finally(() => {
    process.exit(0);
  });
