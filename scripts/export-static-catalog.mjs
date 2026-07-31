// يصدّر بيانات ثابتة من الـviews الآمنة (catalog_*) وجدول settings إلى ملف
// JSON محلي (src/lib/data/staticCatalog.json) يُستعمل كـfallback عندما
// DATABASE_URL غير معرَّف (مثلاً في معاينة Vercel بدون قاعدة بيانات).
// سكريبت لمرة واحدة، يُشغَّل يدوياً محلياً حيث DATABASE_URL معرَّف فعلاً —
// لا يُستدعى أبداً وقت التشغيل (runtime) للموقع نفسه.
import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL غير معرَّف — شغّل هذا السكريبت محلياً فقط.");
  process.exit(1);
}

const sql = postgres(connectionString, {
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (x) => String(x),
      parse: (x) => Number(x),
    },
  },
});

const categories = await sql`
  select id, slug, name_ar, name_fr, description_ar, parent_id, sort_order
  from public.catalog_categories
  order by sort_order asc, name_ar asc
`;

const products = await sql`
  select * from public.catalog_products order by created_at desc
`;

const variantsByProductId = {};
const imagesByProductId = {};

for (const p of products) {
  const variants = await sql`
    select * from public.catalog_product_variants
    where product_id = ${p.id}
    order by sort_order asc
  `;
  if (variants.length > 0) variantsByProductId[p.id] = variants;

  const images = await sql`
    select * from public.catalog_product_images
    where product_id = ${p.id}
    order by is_primary desc, sort_order asc
  `;
  if (images.length > 0) imagesByProductId[p.id] = images;
}

const settingsRows = await sql`select key, value from public.settings`;
const settingsMap = Object.fromEntries(
  settingsRows.map((row) => [row.key, row.value])
);
const settings = {
  minOrderAmountMad: Number(settingsMap.min_order_amount_mad ?? 1000),
  deliveryFeePerCartonMad: Number(settingsMap.delivery_fee_per_carton_mad ?? 45),
  whatsappNumber: String(settingsMap.whatsapp_number ?? "+212722083458"),
  storeCity: String(settingsMap.store_city ?? "مراكش - حي المحاميد"),
};

const fixture = { categories, products, variantsByProductId, imagesByProductId, settings };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "src", "lib", "data", "staticCatalog.json");
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");

console.log(
  `تم التصدير: ${categories.length} تصنيف، ${products.length} منتج → ${outPath}`
);

await sql.end();
