/**
 * مولِّد نسخ الصور المحسَّنة — يعمل يدوياً أو في CI، **لا في وقت التشغيل**.
 *
 * ## الشرط الحاكم
 *
 * «لا يعيد تحويل الصور مع كل طلب، ولا يعتمد على sharp داخل كل زيارة.»
 * لذلك `sharp` يُستورَد **هنا فقط**، وهذا الملف تحت `scripts/` ولا
 * يستورده أي كود تطبيق. التطبيق يقرأ `variant-manifest.json` فقط.
 *
 * ## الأمان
 *
 *   • **لا يكتب فوق أي أصل ولا يحذفه.** يقرأ الأصول ويكتب ملفات جديدة
 *     بأسماء مجزَّأة تحت `public/_opt/`.
 *   • **لا يلمس قاعدة البيانات.** يقرأ `product_images` قراءةً فقط عبر
 *     `DATABASE_URL`، ولا ينفّذ أي كتابة.
 *   • **لا يرفع شيئاً إلى Supabase Storage.** الكتابة محلية بحتة.
 *   • **قابل للإيقاف والاستكمال.** يتخطّى أي أصل له نسخه كاملة على
 *     القرص، فإعادة التشغيل تُكمل من حيث توقّف بلا عمل مكرَّر.
 *
 * ## الاستعمال
 *
 *   npx tsx scripts/generate-image-variants.mts --sample 30
 *   npx tsx scripts/generate-image-variants.mts --all --limit 50
 *   npx tsx scripts/generate-image-variants.mts --all --dry-run
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { VARIANT_WIDTHS, variantKey, type VariantWidth } from "../src/lib/images/variants.js";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "_opt");
const MANIFEST = path.join(ROOT, "src", "lib", "images", "variant-manifest.json");
const BUCKET_MARKER = "/storage/v1/object/public/product-images/";

/**
 * الجودة 78 لـWebP ليست رقماً اعتباطياً: هي أدنى قيمة بقيت عندها تفاصيل
 * قطع الغيار (أرقام المواصفات المطبوعة، أطراف الوصلات، أسنان التروس)
 * مقروءةً في الفحص البصري. وتحتها تبدأ الحوافّ الدقيقة في الذوبان — وهو
 * بالضبط ما لا يجوز لمتجر يبيع لصنايعية يميّزون القطعة من شكلها.
 */
const WEBP_QUALITY = 78;

type Args = { sample: number | null; all: boolean; limit: number | null; dryRun: boolean; fromFile: string | null };
function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };
  return {
    sample: get("--sample") ? Number(get("--sample")) : null,
    all: argv.includes("--all"),
    limit: get("--limit") ? Number(get("--limit")) : null,
    dryRun: argv.includes("--dry-run"),
    fromFile: get("--from-file"),
  };
}

type Row = { storage_path: string; sku: string; cat: string | null; is_primary: boolean };

async function loadRows(sql: postgres.Sql): Promise<Row[]> {
  return sql<Row[]>`
    select pi.storage_path, p.sku, c.slug as cat, pi.is_primary
    from public.product_images pi
    join public.products p on p.id = pi.product_id
    left join public.categories c on c.id = p.category_id
    where coalesce(pi.storage_path, '') <> ''
    order by c.slug nulls last, p.sku, pi.sort_order
  `;
}

/** بايتات الأصل: من القرص للمسار المحلي، ومن الموقع الحيّ لكائن المخزن. */
async function readOriginal(storagePath: string): Promise<Buffer> {
  if (!storagePath.startsWith("http")) {
    return readFile(path.join(ROOT, "public", storagePath));
  }
  const i = storagePath.indexOf(BUCKET_MARKER);
  if (i === -1) throw new Error("رابط خارج bucket المنتجات");
  const obj = storagePath.slice(i + BUCKET_MARKER.length);
  // عبر /img لا عبر Supabase مباشرة: نفس المسار الذي يراه الزائر، ويُخدَم
  // من حافة Vercel — فالتوليد لا يُحمِّل Supabase شيئاً.
  const base = process.env.VARIANT_SOURCE_ORIGIN ?? "https://www.tayssirfroid.com";
  const res = await fetch(`${base}/img/${obj}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function variantFile(storagePath: string, width: VariantWidth): string {
  return path.join(OUT_DIR, `${variantKey(storagePath)}-${width}.webp`);
}

/** هل لهذا الأصل نسخه كاملة أصلاً؟ أساس «لا إعادة معالجة بلا سبب». */
function alreadyDone(storagePath: string, widths: readonly VariantWidth[]): boolean {
  return widths.every((w) => existsSync(variantFile(storagePath, w)));
}

/**
 * عيّنة التجربة: 3 صور من كل تصنيف، مُنتقاة **لصعوبتها** لا لسهولتها —
 * الأكبر حجماً، وما امتداده يخالف صيغته الحقيقية، ومن المصدرين معاً.
 */
function pickSample(rows: Row[], perCat: number, sizes: Map<string, number>): Row[] {
  const byCat = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.cat ?? "(بلا تصنيف)";
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(r);
  }
  const out: Row[] = [];
  for (const [, list] of byCat) {
    const scored = list
      .map((r) => {
        const ext = r.storage_path.split(".").pop()!.toLowerCase();
        // كل كائنات المخزن محتواها JPEG مهما كان الامتداد (مقيس: 472/472
        // بـmimetype=image/jpeg) — فامتداد غير jpg على المخزن يعني تضارباً.
        const liesAboutFormat = r.storage_path.startsWith("http") && ext !== "jpg";
        const nonAscii = /[^\x20-\x7E]/.test(r.storage_path);
        const bytes = sizes.get(r.storage_path) ?? 0;
        return { r, score: bytes + (liesAboutFormat ? 5e6 : 0) + (nonAscii ? 5e6 : 0) };
      })
      .sort((a, b) => b.score - a.score);
    // الأصعب، ثم واحدة من المصدر الآخر إن وُجدت — لئلا تكون العيّنة كلها
    // من مخزن واحد فنختبر نصف النظام.
    const chosen: Row[] = [];
    for (const s of scored) {
      if (chosen.length >= perCat) break;
      chosen.push(s.r);
    }
    const haveLocal = chosen.some((c) => !c.storage_path.startsWith("http"));
    if (!haveLocal) {
      const local = scored.find((s) => !s.r.storage_path.startsWith("http"));
      if (local && chosen.length) chosen[chosen.length - 1] = local.r;
    }
    out.push(...chosen);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sample && !args.all && !args.fromFile) {
    console.error("استعمل --from-file <ملف> أو --sample <عدد لكل تصنيف> أو --all");
    process.exit(1);
  }

  let rows: Row[] = [];
  const bucketSizes = new Map<string, number>();

  // مسار بلا قاعدة بيانات: قائمة جاهزة روجعت قبل التشغيل. هو المسار
  // المستعمَل فـبيئة التطوير هذه، حيث DATABASE_URL للإنتاج سرٌّ لا يُقرأ —
  // وهو أيضاً الأأمن عملياً: ما يُعالَج معروف ومكتوب قبل أن يبدأ شيء.
  if (args.fromFile) {
    rows = JSON.parse(await readFile(path.resolve(args.fromFile), "utf8"));
    console.log(`قائمة من ملف: ${rows.length} صف`);
  } else {

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL غير معرَّف.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 2, prepare: false });
  try {
    rows = await loadRows(sql);
    const sizeRows = await sql<{ storage_path: string; bytes: string }[]>`
      select pi.storage_path, (o.metadata->>'size') as bytes
      from public.product_images pi
      join storage.objects o
        on o.bucket_id = 'product-images'
       and o.name = substring(pi.storage_path from position(${BUCKET_MARKER} in pi.storage_path) + ${BUCKET_MARKER.length})
      where position(${BUCKET_MARKER} in coalesce(pi.storage_path,'')) > 0
    `;
    for (const s of sizeRows) bucketSizes.set(s.storage_path, Number(s.bytes));
  } finally {
    await sql.end({ timeout: 5 });
  }
  }

  const targets = args.sample ? pickSample(rows, args.sample, bucketSizes) : rows;
  const seen = new Set<string>();
  const queue = targets.filter((r) => {
    if (seen.has(r.storage_path)) return false;
    seen.add(r.storage_path);
    return true;
  });
  const work = args.limit ? queue.slice(0, args.limit) : queue;

  console.log(`مرشَّحة: ${work.length} صورة${args.dryRun ? "  (تجربة جافّة)" : ""}`);
  if (args.dryRun) {
    work.forEach((r, i) =>
      console.log(
        `  ${String(i + 1).padStart(3)}. ${r.sku.padEnd(22)} ${(r.cat ?? "-").padEnd(36)} ${
          r.storage_path.startsWith("http") ? "مخزن" : "محلي"
        }  ${r.storage_path.slice(-44)}`
      )
    );
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const processed: string[] = JSON.parse(
    existsSync(MANIFEST) ? await readFile(MANIFEST, "utf8") : '{"processed":[]}'
  ).processed;
  const done = new Set<string>(processed);

  let made = 0, skipped = 0, failed = 0, origBytes = 0, newBytes = 0;
  const failures: string[] = [];

  for (const [i, r] of work.entries()) {
    const label = `${String(i + 1).padStart(3)}/${work.length} ${r.sku}`;
    if (alreadyDone(r.storage_path, VARIANT_WIDTHS)) {
      done.add(r.storage_path);
      skipped++;
      continue;
    }
    try {
      const buf = await readOriginal(r.storage_path);
      const meta = await sharp(buf).metadata();
      origBytes += buf.length;
      for (const w of VARIANT_WIDTHS) {
        const out = await sharp(buf)
          // تدوير حسب وسم EXIF قبل حذف البيانات الوصفية: المتصفح يدوّر
          // الأصل JPEG حسب الوسم، والنسخة بلا EXIF لن تُدوَّر — فبدون هذا
          // تظهر صورة هاتف مائلة 90°. فحص 690 أصلاً: لا وسم في أيٍّ منها
          // اليوم، لكن الرفع المستقبلي من الهاتف سيحمله.
          .rotate()
          // بلا `fit: cover` وبلا `position`: لا قصّ ولا تشويه إطلاقاً.
          // `withoutEnlargement` يمنع تكبير صورة أصغر من الهدف — تكبيرها
          // يزيد البايتات بلا أي كسب في الوضوح.
          .resize({ width: w, withoutEnlargement: true })
          // بلا ICC وبلا EXIF: الحاوية VP8X+ICC هي ما وثّقه
          // migration 20260815000000 كسبب الصور المكسورة. sharp بلا
          // withMetadata يُنتج VP8 بسيطة، وهي الصيغة التي أقرّها نفس
          // الـmigration كآمنة.
          .webp({ quality: WEBP_QUALITY, effort: 5 })
          .toBuffer();
        await writeFile(variantFile(r.storage_path, w), out);
        newBytes += out.length;
      }
      done.add(r.storage_path);
      made++;
      console.log(`  ✅ ${label}  ${meta.width}×${meta.height}  ${(buf.length / 1024).toFixed(0)}KB`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${r.sku} :: ${r.storage_path.slice(-40)} :: ${msg.slice(0, 60)}`);
      console.log(`  ❌ ${label}  ${msg.slice(0, 60)}`);
      // فشل صورة واحدة لا يُسقط الدفعة: الباقي يُعالَج، وهذه تبقى على
      // أصلها — وهو بالضبط سلوك اليوم، فلا خسارة.
    }
  }

  await writeFile(
    MANIFEST,
    JSON.stringify({ generatedAt: new Date().toISOString(), processed: [...done].sort() }, null, 2) + "\n",
    "utf8"
  );

  let optDirBytes = 0;
  try {
    const { readdir } = await import("node:fs/promises");
    for (const f of await readdir(OUT_DIR)) optDirBytes += (await stat(path.join(OUT_DIR, f))).size;
  } catch {}

  console.log("\n──────── الخلاصة ────────");
  console.log(`  وُلِّدت: ${made} · مُتخطّاة (مُعالَجة سابقاً): ${skipped} · فشلت: ${failed}`);
  if (origBytes) {
    console.log(`  أصول هذه الدفعة: ${(origBytes / 1048576).toFixed(2)} MB`);
    console.log(`  نسخها (360+540): ${(newBytes / 1048576).toFixed(2)} MB`);
  }
  console.log(`  حجم public/_opt كاملاً: ${(optDirBytes / 1048576).toFixed(2)} MB`);
  console.log(`  المانيفست: ${done.size} أصلاً مُعالَجاً`);
  if (failures.length) {
    console.log("\n  الإخفاقات:");
    failures.forEach((f) => console.log("    " + f));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
