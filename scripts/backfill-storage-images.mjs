#!/usr/bin/env node
/**
 * يُخفِّف صور المنتجات المخزَّنة في Supabase Storage **مكانها**، بلا لمس
 * قاعدة البيانات إطلاقاً — ومع نسخة احتياطية كاملة قابلة للاسترجاع.
 *
 * المفتاح أن المسار لا يتغيّر: نُنزّل الكائن، نحفظ الأصل في bucket احتياطي
 * خاص، نُعيد ترميزه، ثم نرفعه فوق نفسه (upsert). لذلك **لا صف واحد في
 * product_images يتغيّر**، ولا صورة تُحذف، ولا رابط ينكسر — لا في الموقع
 * ولا في ملف Meta ولا في أي مكان آخر.
 *
 * قاعدة السلامة الأولى هنا: **لا كتابة فوق أي صورة قبل أن تُحفظ نسختها
 * الأصلية ويُتحقَّق من حجمها.** فشل النسخ الاحتياطي يُلغي معالجة تلك الصورة
 * بالكامل، ولا يُكتب شيء.
 *
 * الأوضاع:
 *   --dry-run            تقرير فقط، بلا أي كتابة (الافتراضي)
 *   --apply              تنفيذ: نسخة احتياطية ثم إعادة ترميز
 *   --verify             يتأكّد أن لكل صورة مُعاد ترميزها نسخة احتياطية سليمة
 *   --rollback           يُرجِع كل صورة من نسختها الاحتياطية
 *   --limit=N            يعالج أول N صورة فقط (للنشر التدريجي/Canary)
 *   --paths=a.jpg,b.jpg  يعالج مسارات بعينها فقط
 *
 * الاستعمال:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/backfill-storage-images.mjs --apply --limit=5
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { optimizeImage, MAX_BYTES } from "./optimize-image.mjs";

const BUCKET = "product-images";
const BACKUP_BUCKET = "product-images-originals";
const CACHE_CONTROL = "31536000";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name) => process.argv.includes(`--${name}`);

const MODE = has("rollback") ? "rollback" : has("verify") ? "verify" : has("apply") ? "apply" : "dry-run";
const LIMIT = Number(arg("limit") || 0);
const ONLY = (arg("paths") || "").split(",").map((p) => p.trim()).filter(Boolean);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("مطلوب SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

async function listAll(bucket) {
  const out = [];
  const { data: folders, error } = await supabase.storage.from(bucket).list("", { limit: 1000 });
  if (error) throw new Error(`تعذّر سرد ${bucket}: ${error.message}`);

  for (const folder of folders ?? []) {
    if (folder.id !== null) {
      out.push(folder.name);
      continue;
    }
    const { data: files, error: fileError } = await supabase.storage
      .from(bucket)
      .list(folder.name, { limit: 1000 });
    if (fileError) throw new Error(`تعذّر سرد ${bucket}/${folder.name}: ${fileError.message}`);
    for (const file of files ?? []) out.push(`${folder.name}/${file.name}`);
  }
  return out;
}

async function download(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** يُنشئ bucket النسخ الاحتياطية إن لم يكن موجوداً — خاص دائماً، لا يُقدَّم للعموم. */
async function ensureBackupBucket() {
  const { data } = await supabase.storage.getBucket(BACKUP_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`تعذّر إنشاء bucket النسخ الاحتياطية: ${error.message}`);
  }
  console.log(`أُنشئ bucket النسخ الاحتياطية: ${BACKUP_BUCKET} (خاص)`);
}

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

// ─────────────────────────────── الاسترجاع ───────────────────────────────
if (MODE === "rollback") {
  const backups = await listAll(BACKUP_BUCKET).catch(() => []);
  const targets = ONLY.length ? backups.filter((p) => ONLY.includes(p)) : backups;
  if (targets.length === 0) {
    console.log("لا توجد نسخ احتياطية — لا شيء لاسترجاعه.");
    process.exit(0);
  }
  console.log(`استرجاع ${targets.length} صورة من ${BACKUP_BUCKET}\n`);
  let restored = 0;
  let failed = 0;
  for (const path of targets) {
    const original = await download(BACKUP_BUCKET, path);
    if (!original) {
      console.error(`  ✗ ${path}: تعذّر تنزيل النسخة الاحتياطية`);
      failed += 1;
      continue;
    }
    const { error } = await supabase.storage.from(BUCKET).upload(path, original, {
      upsert: true,
      contentType: path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg",
      cacheControl: CACHE_CONTROL,
    });
    if (error) {
      console.error(`  ✗ ${path}: تعذّر الاسترجاع (${error.message})`);
      failed += 1;
      continue;
    }
    console.log(`  ✓ ${path}: أُرجِع ${Math.round(original.length / 1024)}KB`);
    restored += 1;
  }
  console.log(`\nاسترُجعت ${restored}، فشل ${failed}.`);
  process.exit(failed ? 1 : 0);
}

// ─────────────────────────────── التحقّق ───────────────────────────────
if (MODE === "verify") {
  const [live, backups] = await Promise.all([listAll(BUCKET), listAll(BACKUP_BUCKET).catch(() => [])]);
  const backupSet = new Set(backups);
  let ok = 0;
  let missing = 0;
  let corrupt = 0;

  for (const path of ONLY.length ? live.filter((p) => ONLY.includes(p)) : live) {
    const current = await download(BUCKET, path);
    if (!current) continue;
    // الصور التي لم تُلمس (لأنها خفيفة أصلاً) لا يلزمها نسخة احتياطية.
    if (!backupSet.has(path)) {
      if (current.length <= MAX_BYTES) continue;
      console.error(`  ✗ ${path}: صورة ثقيلة بلا نسخة احتياطية`);
      missing += 1;
      continue;
    }
    const backup = await download(BACKUP_BUCKET, path);
    if (!backup || backup.length === 0) {
      console.error(`  ✗ ${path}: النسخة الاحتياطية فارغة أو غير قابلة للقراءة`);
      corrupt += 1;
      continue;
    }
    ok += 1;
  }
  console.log(`\nنسخ احتياطية سليمة: ${ok} — ناقصة: ${missing} — تالفة: ${corrupt}`);
  process.exit(missing + corrupt ? 1 : 0);
}

// ─────────────────────────── التقرير / التنفيذ ───────────────────────────
const APPLY = MODE === "apply";
if (APPLY) await ensureBackupBucket();

const objects = await listAll(BUCKET);
const filtered = ONLY.length ? objects.filter((p) => ONLY.includes(p)) : objects;
const targets = LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered;

const existingBackups = new Set(await listAll(BACKUP_BUCKET).catch(() => []));

console.log(`${objects.length} كائناً في ${BUCKET}${targets.length !== objects.length ? ` — سنعالج ${targets.length}` : ""}`);
console.log(APPLY ? "الوضع: تنفيذ فعلي (مع نسخة احتياطية قبل كل كتابة)\n" : "الوضع: تقرير فقط (أضف --apply للتنفيذ)\n");

let before = 0;
let after = 0;
let rewritten = 0;
let skipped = 0;
let failed = 0;
const manifest = [];

for (const objectPath of targets) {
  const original = await download(BUCKET, objectPath);
  if (!original) {
    console.error(`  ✗ ${objectPath}: تعذّر التنزيل`);
    failed += 1;
    continue;
  }
  before += original.length;

  let optimized;
  try {
    ({ buffer: optimized } = await optimizeImage(original));
  } catch (e) {
    console.error(`  ✗ ${objectPath}: تعذّرت المعالجة (${e.message})`);
    after += original.length;
    failed += 1;
    continue;
  }

  if (optimized.length >= original.length && original.length <= MAX_BYTES) {
    after += original.length;
    skipped += 1;
    continue;
  }

  const finalBuffer = optimized.length < original.length ? optimized : original;
  after += finalBuffer.length;

  if (APPLY) {
    // 1) النسخة الاحتياطية أولاً — وبتحقّق فعلي من أنها وصلت بنفس البايتات.
    if (!existingBackups.has(objectPath)) {
      const { error: backupError } = await supabase.storage
        .from(BACKUP_BUCKET)
        .upload(objectPath, original, { upsert: true, contentType: "application/octet-stream" });
      if (backupError) {
        console.error(`  ✗ ${objectPath}: فشل النسخ الاحتياطي (${backupError.message}) — لم يُكتب شيء`);
        failed += 1;
        continue;
      }
      const check = await download(BACKUP_BUCKET, objectPath);
      if (!check || check.length !== original.length || sha256(check) !== sha256(original)) {
        console.error(`  ✗ ${objectPath}: النسخة الاحتياطية لا تطابق الأصل — لم يُكتب شيء`);
        failed += 1;
        continue;
      }
      existingBackups.add(objectPath);
    }

    // 2) وفقط الآن نكتب فوق الأصل.
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, finalBuffer, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: CACHE_CONTROL,
    });
    if (uploadError) {
      console.error(`  ✗ ${objectPath}: تعذّر الرفع (${uploadError.message}) — الأصل محفوظ في النسخ الاحتياطية`);
      failed += 1;
      continue;
    }
  }

  manifest.push({
    path: objectPath,
    beforeBytes: original.length,
    afterBytes: finalBuffer.length,
    beforeSha256: sha256(original),
    afterSha256: sha256(finalBuffer),
  });
  rewritten += 1;
  const pct = (100 - (finalBuffer.length / original.length) * 100).toFixed(0);
  console.log(
    `  ${APPLY ? "✓" : "•"} ${objectPath}: ${Math.round(original.length / 1024)}KB ← ` +
      `${Math.round(finalBuffer.length / 1024)}KB (${pct}% أخف)`
  );
}

if (APPLY && manifest.length > 0) {
  const name = `manifest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const { error } = await supabase.storage
    .from(BACKUP_BUCKET)
    .upload(name, Buffer.from(JSON.stringify(manifest, null, 2)), {
      upsert: true,
      contentType: "application/json",
    });
  console.log(error ? `\nتحذير: تعذّر حفظ السجل (${error.message})` : `\nسجل العملية: ${BACKUP_BUCKET}/${name}`);
}

console.log(`\nالمجموع: ${mb(before)} ← ${mb(after)} (${(100 - (after / before) * 100).toFixed(1)}% أخف)`);
console.log(`أُعيد ترميز ${rewritten}، تُرك ${skipped} كما هو، فشل ${failed}.`);
if (!APPLY) console.log("\nلم يُكتب أي شيء. أعد التشغيل مع --apply للتنفيذ.");
if (APPLY) console.log(`للاسترجاع الكامل: node scripts/backfill-storage-images.mjs --rollback`);
