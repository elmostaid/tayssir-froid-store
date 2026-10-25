/**
 * فحص ما قبل البناء: لا يُعلَن رابط نسخة WebP إلا إذا كانت صحيحة **الآن**.
 *
 * يعمل تلقائياً قبل `next build` (`prebuild` في package.json)، فيُنقّي
 * `variant-manifest.json` داخل حاوية البناء من حالتين:
 *
 *   1. **ملف نسخة ناقص** — رابط يُعلَن بلا ملف = 404 مؤكَّد.
 *   2. **أصل محلي تغيّر بعد التوليد** — أحدهم استبدل
 *      `public/product-images-v3/TF-WM-005/TF-WM-005.jpg` بصورة جديدة
 *      بنفس الاسم ولم يُعِد تشغيل المولِّد. بلا هذا الفحص كان الموقع
 *      سيعرض نسخة WebP للصورة **القديمة** ما دام المانيفست يشير إليها.
 *
 * في الحالتين يُحذف المدخل فتُعرض الصورة **بأصلها** — وهو سلوك أي صورة
 * لم تُعالَج بعد، لا خطأ. الفحص **لا يُفشل البناء أبداً** لأجل صورة:
 * النشر الذي يعرض أصلاً أسلم من نشر متوقّف.
 *
 * كائنات المخزن (روابط http) لا تُعاد بصمتها هنا: رفعها يُنشئ دائماً اسماً
 * جديداً `{productId}/{UUID}`، فمحتوى المسار لا يتغيّر، ولا داعي لتنزيل
 * مئات الصور في كل بناء.
 *
 * لا sharp، لا شبكة، لا قاعدة بيانات: قراءة ملفات محلية فقط (~25 MB من
 * الأصول المحلية، أقل من ثانية).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIDTHS = [360, 540];

/** نفس `contentKey` في src/lib/images/variants.ts — مكرَّرة عمداً لئلا يحتاج الفحص TypeScript. */
function contentKey(bytes) {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}

/**
 * @param {string} root جذر المشروع
 * @param {Record<string, string>} variants مسار الأصل ← بصمته
 * @returns {{ kept: Record<string, string>, dropped: { path: string, reason: string }[], unverifiable: string[] }}
 */
export function verifyVariants(root, variants) {
  const kept = {};
  const dropped = [];
  const unverifiable = [];
  for (const [p, key] of Object.entries(variants)) {
    const missing = WIDTHS.filter((w) => !existsSync(path.join(root, "public", "_opt", `${key}-${w}.webp`)));
    if (missing.length) {
      dropped.push({ path: p, reason: `ملف نسخة ناقص (${missing.join("، ")})` });
      continue;
    }
    if (!p.startsWith("http")) {
      const original = path.join(root, "public", p);
      if (!existsSync(original)) {
        // الأصل غير موجود محلياً: النسخة تمثّل آخر محتوى معروف له، فتبقى.
        unverifiable.push(p);
      } else if (contentKey(readFileSync(original)) !== key) {
        dropped.push({ path: p, reason: "الأصل تغيّر بعد التوليد" });
        continue;
      }
    }
    kept[p] = key;
  }
  return { kept, dropped, unverifiable };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const file = path.join(root, "src", "lib", "images", "variant-manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const { kept, dropped, unverifiable } = verifyVariants(root, manifest.variants ?? {});
  const total = Object.keys(manifest.variants ?? {}).length;
  console.log(`[image-variants] ${Object.keys(kept).length}/${total} نسخة صالحة`);
  for (const u of unverifiable) console.log(`[image-variants] تنبيه: أصل محلي غير موجود، أُبقيت نسخته: ${u}`);
  if (dropped.length) {
    for (const d of dropped) console.log(`[image-variants] أُسقطت (ستُعرض بأصلها): ${d.path} — ${d.reason}`);
    console.log("[image-variants] أعِد تشغيل scripts/generate-image-variants.mts لاستعادتها.");
    writeFileSync(file, JSON.stringify({ ...manifest, variants: kept }, null, 2) + "\n", "utf8");
  }
}
