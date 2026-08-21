#!/usr/bin/env node
/**
 * يُخفِّف صور المنتجات المخزَّنة في Supabase Storage **مكانها**، بلا لمس
 * قاعدة البيانات إطلاقاً.
 *
 * المفتاح هنا أن المسار لا يتغيّر: نُنزّل الكائن، نُعيد ترميزه بنفس قواعد
 * صفحة الرفع الحالية، ثم نرفعه فوق نفسه (upsert) بترويسة تخزين مؤقّت طويلة.
 * لذلك **لا صف واحد في product_images يتغيّر**، ولا صورة تُحذف، ولا رابط
 * ينكسر — لا في الموقع ولا في ملف Meta ولا في أي مكان آخر.
 *
 * سبب وجوده: 127 صورة مستضافة على Supabase بمعدّل 772 كيلوبايت للصورة
 * (أكبرها 4.9 ميغابايت)، وكلها تُقدَّم بـcache-control: no-cache فتُعاد
 * تنزيلها كاملة في كل زيارة.
 *
 * الاستعمال:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/backfill-storage-images.mjs --dry-run
 *
 *   أضف --apply للتنفيذ الفعلي، و--limit=N لمعالجة عدد محدود أولاً.
 */
import { createClient } from "@supabase/supabase-js";
import { optimizeImage, MAX_BYTES } from "./optimize-image.mjs";

const BUCKET = "product-images";
const CACHE_CONTROL = "31536000"; // سنة — المسار يحمل UUID فتغيير الصورة يعني مساراً جديداً
const APPLY = process.argv.includes("--apply");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1] || 0);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("مطلوب SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

/** كل الكائنات داخل الـbucket، مجلَّداً مجلَّداً (كل منتج في مجلد باسم رقمه). */
async function listAllObjects() {
  const out = [];
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(`تعذّر سرد المجلدات: ${error.message}`);

  for (const folder of folders ?? []) {
    if (folder.id !== null) {
      out.push(folder.name); // ملف في الجذر
      continue;
    }
    const { data: files, error: fileError } = await supabase.storage
      .from(BUCKET)
      .list(folder.name, { limit: 1000 });
    if (fileError) throw new Error(`تعذّر سرد ${folder.name}: ${fileError.message}`);
    for (const file of files ?? []) out.push(`${folder.name}/${file.name}`);
  }
  return out;
}

const objects = await listAllObjects();
const targets = LIMIT > 0 ? objects.slice(0, LIMIT) : objects;
console.log(`${objects.length} كائناً في ${BUCKET}${LIMIT ? ` — سنعالج ${targets.length}` : ""}`);
console.log(APPLY ? "الوضع: تنفيذ فعلي\n" : "الوضع: تقرير فقط (أضف --apply للتنفيذ)\n");

let before = 0;
let after = 0;
let rewritten = 0;
let skipped = 0;
let failed = 0;

for (const objectPath of targets) {
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
  if (error || !data) {
    console.error(`  ✗ ${objectPath}: تعذّر التنزيل (${error?.message ?? "بلا بيانات"})`);
    failed += 1;
    continue;
  }

  const original = Buffer.from(await data.arrayBuffer());
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

  // لا نرفع أبداً ملفاً أكبر من الأصل، ولا نلمس صورة خفيفة أصلاً وسليمة
  // الترويسة — إعادة رفعها بلا فائدة تُعرّضها لخطر بلا مقابل.
  if (optimized.length >= original.length && original.length <= MAX_BYTES) {
    after += original.length;
    skipped += 1;
    continue;
  }

  const finalBuffer = optimized.length < original.length ? optimized : original;
  after += finalBuffer.length;

  if (APPLY) {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, finalBuffer, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: CACHE_CONTROL,
      });
    if (uploadError) {
      console.error(`  ✗ ${objectPath}: تعذّر الرفع (${uploadError.message})`);
      failed += 1;
      continue;
    }
  }

  rewritten += 1;
  const pct = (100 - (finalBuffer.length / original.length) * 100).toFixed(0);
  console.log(
    `  ${APPLY ? "✓" : "•"} ${objectPath}: ${Math.round(original.length / 1024)}KB ← ` +
      `${Math.round(finalBuffer.length / 1024)}KB (${pct}% أخف)`
  );
}

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
console.log(
  `\nالمجموع: ${mb(before)} ← ${mb(after)} (${(100 - (after / before) * 100).toFixed(1)}% أخف)`
);
console.log(`أُعيد ترميز ${rewritten}، تُرك ${skipped} كما هو، فشل ${failed}.`);
if (!APPLY) console.log("\nلم يُكتب أي شيء. أعد التشغيل مع --apply للتنفيذ.");
