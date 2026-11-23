// وحدة الـworker لا تشحن ملف أنواع؛ نستعملها فقط لتعيينها في globalThis.pdfjsWorker.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
