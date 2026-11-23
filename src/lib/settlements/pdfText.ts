/**
 * استخراج نصوص ملف PDF مع موضع كل نص في الصفحة (x, y).
 *
 * الموضع ضروري لا النص وحده: فاتورة BigDelivery جدولٌ تلتفّ فيه المدينة على
 * عدة أسطر و«DH» تنزل تحت المبلغ، فالنص المسطَّح يخلط الأعمدة. بالموضع نعرف
 * أن «Ahmed» تحت «Beni» في عمود المدينة لا في عمود آخر.
 *
 * pdfjs-dist يعمل على الخادم فقط هنا (Node)، بلا Worker حقيقي: نحمّل وحدة
 * الـworker بأنفسنا ونضعها في `globalThis.pdfjsWorker`، فيستعملها pdfjs
 * مباشرة في نفس العملية — وهذا أيضاً يضمن أن يتتبّع Vercel ملف الـworker
 * ضمن الدالة، بدل استيراد ديناميكي يُكتشف وقت التشغيل فقط.
 */

export type PdfTextItem = { page: number; x: number; y: number; str: string };

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!loading) {
    loading = (async () => {
      const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }
  return loading;
}

/** سقف الصفحات: فاتورة كل يومين لا تتجاوز بضع صفحات؛ السقف يحمي من ملف خاطئ ضخم. */
export const MAX_PDF_PAGES = 60;

export class PdfReadError extends Error {}

export async function extractPdfTextItems(
  bytes: Uint8Array,
): Promise<PdfTextItem[]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    // نسخة: pdfjs ينقل ملكية المصفوفة (detach) فلا نُتلف مصفوفة المستدعي.
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    await task.destroy();
    throw new PdfReadError("الملف ماشي PDF صالح أو مقفول بكلمة سر.");
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new PdfReadError(
        `الملف فيه ${doc.numPages} صفحة — كثير بزاف على فاتورة.`,
      );
    }
    const items: PdfTextItem[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const str = raw.str.replace(/\s+/g, " ").trim();
        if (!str) continue;
        items.push({ page: p, x: raw.transform[4], y: raw.transform[5], str });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await task.destroy();
  }
}
