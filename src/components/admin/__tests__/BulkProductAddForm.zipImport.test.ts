import { describe, it, expect, vi } from "vitest";

// canvas وcreateImageBitmap غير متوفّرين في jsdom، ومعالجة الصور لها ملف
// اختبار مستقل (imageProcessing.test.ts) يغطي التصغير والاتجاه والتعرّف على
// النوع. هنا نُحاكي العقد فقط: نفس فحوص الحجم، ونُعيد الملف كما هو — فيبقى
// هذا الملف مركّزاً على مسار الرفع لا على معالجة البكسلات.
vi.mock("@/lib/storage/imageProcessing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/imageProcessing")>(
    "@/lib/storage/imageProcessing"
  );
  return {
    ...actual,
    processImageForUpload: async (file: File) => {
      if (file.size === 0) return { ok: false as const, error: "الملف فارغ." };
      if (file.size > actual.MAX_UPLOAD_INPUT_BYTES) {
        return { ok: false as const, error: "حجم الصورة كبير جداً (12 ميغابايت كحد أقصى)." };
      }
      return { ok: true as const, file, width: 800, height: 600, bytes: file.size };
    },
  };
});

import JSZip from "jszip";
import {
  parseZipFile,
  guessCategoryId,
  isRowEmpty,
  type Row,
  type ZipProductEntry,
} from "@/components/admin/BulkProductAddForm";

// صورة JPEG أحادية اللون 1×1 حقيقية (بايتات صالحة، وليست نصاً وهمياً) —
// كافية لاختبار مسار القراءة/التحقق الفعلي في parseZipFile دون الحاجة لأي
// ملف خارج المستودع.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

function tinyJpegFile(): Uint8Array {
  return Uint8Array.from(atob(TINY_JPEG_BASE64), (c) => c.charCodeAt(0));
}

async function buildZip(entries: ZipProductEntry[]): Promise<File> {
  const zip = new JSZip();
  zip.file("products.json", JSON.stringify(entries));
  for (const entry of entries) {
    const folder = entry.image_folder ?? "";
    for (const imgName of entry.images ?? []) {
      zip.file(`${folder}/${imgName}`, tinyJpegFile());
    }
  }
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  return new File([buffer], "batch.zip", { type: "application/zip" });
}

const SEMI_AUTO_CATEGORY_OPTIONS = [
  { id: 17, label: "قطع غيار آلات غسيل الملابس نصف الأوتوماتيكية" },
  { id: 16, label: "قطع غيار آلات غسيل الملابس الأوتوماتيكية" },
];

// نفس بنية دفعة الكيربوكسات الحقيقية (7 موديلات) — مصدر الحقيقة products.json
// المرفق مع تلك الدفعة، معاد بناؤه هنا حرفياً كبيانات اختبار ثابتة داخل
// المستودع (بدل الاعتماد على ملف خارجي فمجلد scratchpad المؤقت للجلسة).
const GEARBOX_ENTRIES: ZipProductEntry[] = [
  {
    model: "01",
    name_ar: "كيربوكس سيمي أوتوماتيك موديل 01 LG رأس طويل",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: 40,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-01",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg", "02.jpg", "03.jpg", "04.jpg"],
  },
  {
    model: "02",
    name_ar: "كيربوكس موديل 02 هايير",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-02",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg", "02.jpg", "03.jpg", "04.jpg"],
  },
  {
    model: "03",
    name_ar: "كيربوكس موديل 03",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-03",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg", "02.jpg", "03.jpg", "04.jpg"],
  },
  {
    model: "04",
    name_ar: "كيربوكس موديل 04",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-04",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg", "02.jpg", "03.jpg", "04.jpg", "05.jpg", "06-extra.jpg"],
  },
  {
    model: "05",
    name_ar: "كيربوكس موديل 05",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-05",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg", "02.jpg", "03.jpg", "04.jpg"],
  },
  {
    model: "06",
    name_ar: "كيربوكس موديل 06",
    purchase_price_mad: 250,
    sale_price_mad: 300,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-06",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg"],
  },
  {
    model: "07",
    name_ar: "كيربوكس موديل 07",
    purchase_price_mad: 220,
    sale_price_mad: 250,
    min_quantity: 1,
    stock: null,
    category_ar: "غسالة الملابس نصف أوتوماتيكية",
    image_folder: "photos/model-07",
    primary_image: "01-primary.jpg",
    images: ["01-primary.jpg"],
  },
];

describe("parseZipFile — synthetic 7-model gearbox batch", () => {
  it("parses exactly 7 rows with correct names and prices", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    expect(outcome.errors).toEqual([]);
    expect(outcome.rows).toHaveLength(7);
    expect(outcome.rows.map((r) => r.nameAr)).toEqual(GEARBOX_ENTRIES.map((e) => e.name_ar));

    // موديل 06 وحده ثمنه مختلف (250/300)
    expect(outcome.rows[5].purchasePrice).toBe("250");
    expect(outcome.rows[5].salePrice).toBe("300");
    for (const i of [0, 1, 2, 3, 4, 6]) {
      expect(outcome.rows[i].purchasePrice).toBe("220");
      expect(outcome.rows[i].salePrice).toBe("250");
    }
  });

  it("marks only model 01's stock as known (40); models 02-07 require manual entry, never invented", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    const [m01, m02, m03, m04, m05, m06, m07] = outcome.rows;
    expect(m01.stockQuantity).toBe("40");
    expect(m01.stockRequired).toBe(false);

    for (const row of [m02, m03, m04, m05, m06, m07]) {
      expect(row.stockQuantity).toBe("");
      expect(row.stockRequired).toBe(true);
    }
  });

  it("caps model 04 at 5 images (site limit), primary image first, extra reference photo dropped", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    const model04 = outcome.rows[3];
    expect(model04.images).toHaveLength(5);
    expect(model04.images[0].file.name).toBe("01-primary.jpg");
    expect(model04.images.some((img) => img.file.name === "06-extra.jpg")).toBe(false);
  });

  it("loads exactly 1 image each for models 06 and 07", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    expect(outcome.rows[5].images).toHaveLength(1);
    expect(outcome.rows[6].images).toHaveLength(1);
  });

  it("auto-suggests the existing semi-automatic-washing category, never a new one", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    expect(outcome.categoryGuessId).toBe("17");
  });

  it("loads a real, non-empty image blob for every row", async () => {
    const file = await buildZip(GEARBOX_ENTRIES);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    for (const row of outcome.rows) {
      for (const img of row.images) {
        expect(img.file.size).toBeGreaterThan(0);
        expect(img.file.type).toBe("image/jpeg");
      }
    }
  });

  it("reports a clear error (not a crash) when a referenced image file is missing from the archive", async () => {
    const entries: ZipProductEntry[] = [
      {
        name_ar: "منتج بصورة ناقصة",
        image_folder: "photos/x",
        images: ["missing.jpg"],
      },
    ];
    const zip = new JSZip();
    zip.file("products.json", JSON.stringify(entries));
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "batch.zip", { type: "application/zip" });

    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0].images).toHaveLength(0);
    expect(outcome.errors.some((e) => e.includes("missing.jpg"))).toBe(true);
  });

  it("skips entries missing name_ar and reports why, without failing the whole batch", async () => {
    const entries: ZipProductEntry[] = [
      { model: "99", images: [] },
      GEARBOX_ENTRIES[0],
    ];
    const file = await buildZip(entries);
    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);

    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0].nameAr).toBe(GEARBOX_ENTRIES[0].name_ar);
    expect(outcome.errors.some((e) => e.includes("99"))).toBe(true);
  });

  it("returns a clear error for a zip with no products.json", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "no products here");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const file = new File([buffer], "batch.zip", { type: "application/zip" });

    const outcome = await parseZipFile(file, SEMI_AUTO_CATEGORY_OPTIONS);
    expect(outcome.rows).toEqual([]);
    expect(outcome.errors.length).toBeGreaterThan(0);
  });
});

describe("guessCategoryId", () => {
  it("scores >=2 overlapping words as a confident match", () => {
    const id = guessCategoryId("غسالة الملابس نصف أوتوماتيكية", SEMI_AUTO_CATEGORY_OPTIONS);
    expect(id).toBe("17");
  });

  it("returns empty string when no option scores >=2 (never guesses wildly)", () => {
    const id = guessCategoryId("إكسسوارات هواتف نقالة", SEMI_AUTO_CATEGORY_OPTIONS);
    expect(id).toBe("");
  });
});

describe("isRowEmpty", () => {
  function makeRow(overrides: Partial<Row>): Row {
    return {
      clientId: "x",
      nameAr: "",
      purchasePrice: "",
      salePrice: "",
      minOrderQtyOverride: "",
      stockQuantity: "",
      stockRequired: false,
      images: [],
      status: "idle",
      message: null,
      sku: null,
      ...overrides,
    };
  }

  it("is true for a fresh blank row", () => {
    expect(isRowEmpty(makeRow({}))).toBe(true);
  });

  it("is false once a name is entered", () => {
    expect(isRowEmpty(makeRow({ nameAr: "test" }))).toBe(false);
  });
});
