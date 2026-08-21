#!/usr/bin/env node
/**
 * يُعيد ترميز صور public/ إلى الحجم الذي تُعرض به فعلاً.
 *
 * لماذا يدوياً وليس عبر next/image: مُحسِّن الصور فـVercel مقفل على هذه
 * الخطة (402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED عند أي تحويل جديد —
 * تحقّقنا منه مباشرة)، ولذلك ضُبط images.unoptimized = true فـnext.config.
 * يعني أن **الملف المخزَّن هو الملف الذي يصل هاتف الزبون حرفياً**، فحجمه
 * على القرص هو المشكلة وهو الحل.
 *
 * الاستعمال:
 *   node scripts/optimize-public-images.mjs --dry-run   # تقرير بلا كتابة
 *   node scripts/optimize-public-images.mjs             # يكتب مكان الملفات
 *
 * حدود مقصودة:
 *  - صور المنتجات (.jpg فقط): كل مسارات قاعدة البيانات المحلية تنتهي بـ.jpg،
 *    فإعادة الترميز مكان الملف تُبقي الرابط كما هو ولا تكسر أي صف.
 *  - ملفات .png/.webp القديمة داخل product-images-v3 لا تُلمس إطلاقاً: هي
 *    نسخ أصلية لم تعد أي صورة منتج تشير إليها (تحقّقنا: 236 مساراً محلياً
 *    كلها .jpg). حذفها قرار منفصل يخصّ صاحب المتجر، لا قرار سكريبت.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(process.cwd(), "public");
const DRY = process.argv.includes("--dry-run");

/**
 * لكل مجموعة: الضلع الأطول المطلوب، والجودة، وحدّ أقصى للحجم.
 * الأبعاد مشتقّة من العرض الفعلي على الشاشة × 2 (كثافة بكسل الهواتف)، لا
 * من تخمين: بطاقة المنتج ~190 نقطة، صفحة المنتج بعرض الشاشة كاملاً،
 * وبطاقة التصنيف بعرض الحاوية كاملاً (حتى 1120 نقطة على الحاسوب).
 */
const RULES = [
  {
    name: "صور المنتجات",
    match: (rel) => /^product-images(-v\d)?\//.test(rel) && rel.endsWith(".jpg"),
    longEdge: 1000,
    quality: 80,
    maxBytes: 200 * 1024,
    format: "jpeg",
  },
  {
    name: "صور التصنيفات",
    match: (rel) => rel.startsWith("categories/") && /\.(jpe?g|png)$/i.test(rel),
    longEdge: 900,
    quality: 78,
    maxBytes: 120 * 1024,
    format: "jpeg",
  },
  {
    name: "الشعار",
    // يُستعمَل كذلك فترويسة ملفات PDF، فنُبقي دقّة تكفي للطباعة (3.5× حجم
    // العرض) بدل تصغيره إلى 169 بكسل بالضبط.
    match: (rel) => rel === "brand/logo-tayssir-froid.png",
    longEdge: 600,
    format: "png",
  },
  {
    name: "أيقونة الثلج",
    match: (rel) => rel === "brand/icon-snowflake.png",
    longEdge: 128,
    format: "png",
  },
];

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function encode(input, rule) {
  const base = sharp(input, { failOn: "none" })
    .rotate() // يطبّق اتجاه EXIF ثم يُسقطه مع باقي البيانات الوصفية
    .resize({
      width: rule.longEdge,
      height: rule.longEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (rule.format === "png") {
    // الشعار والأيقونة يحتاجان الشفافية — تحويلهما إلى JPEG يضع خلفية بيضاء
    // فتظهر مربّعاً أبيض فوق أي خلفية ملوّنة.
    return base.png({ compressionLevel: 9, palette: true }).toBuffer();
  }

  const flat = base.flatten({ background: { r: 255, g: 255, b: 255 } });
  for (const quality of [rule.quality, 72, 65, 58]) {
    const out = await flat
      .clone()
      .jpeg({ quality, mozjpeg: true, progressive: false, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (out.length <= (rule.maxBytes ?? Infinity) || quality === 58) return out;
  }
  throw new Error("unreachable");
}

const totals = new Map();
let skipped = 0;

for await (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const rule = RULES.find((r) => r.match(rel));
  if (!rule) {
    skipped += 1;
    continue;
  }

  const input = await fs.readFile(file);
  let output;
  try {
    output = await encode(input, rule);
  } catch (error) {
    console.error(`تعذّرت معالجة ${rel}: ${error.message}`);
    continue;
  }

  // لا نكتب أبداً ملفاً أكبر مما كان — بعض الصور مضغوطة جيداً أصلاً.
  const improved = output.length < input.length;
  if (improved && !DRY) await fs.writeFile(file, output);

  const t = totals.get(rule.name) ?? { count: 0, before: 0, after: 0, rewritten: 0 };
  t.count += 1;
  t.before += input.length;
  t.after += improved ? output.length : input.length;
  if (improved) t.rewritten += 1;
  totals.set(rule.name, t);
}

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
console.log(DRY ? "— تقرير فقط، لم يُكتب أي ملف —\n" : "— أُعيد ترميز الملفات مكانها —\n");
let gBefore = 0;
let gAfter = 0;
for (const [name, t] of totals) {
  gBefore += t.before;
  gAfter += t.after;
  console.log(
    `${name}: ${t.count} ملفاً، أُعيد ترميز ${t.rewritten} — ${mb(t.before)} ← ${mb(t.after)} ` +
      `(${(100 - (t.after / t.before) * 100).toFixed(1)}% أخف)`
  );
}
console.log(`\nالمجموع: ${mb(gBefore)} ← ${mb(gAfter)} (${(100 - (gAfter / gBefore) * 100).toFixed(1)}% أخف)`);
console.log(`ملفات خارج النطاق لم تُلمس: ${skipped}`);
