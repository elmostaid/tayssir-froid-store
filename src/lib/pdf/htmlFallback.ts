// احتياط عند فشل توليد PDF (مكتبة @react-pdf/renderer تنهار أحياناً مع بعض
// النصوص العربية القصيرة حسب عرض السطر — خطأ داخل محرك ترتيب النصوص نفسه،
// وليس في بياناتنا). نعرض هنا نفس المعلومات كصفحة HTML عادية بدل PDF، يمكن
// للمستخدم طباعتها كـPDF من المتصفح (Ctrl+P) دون أي خطر انهيار.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SHARED_STYLES = `
  @page { size: A4; margin: 16mm; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; padding: 24px; color: #292524; }
  .letterhead { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #03AFB9; padding-bottom: 10px; margin-bottom: 12px; }
  .letterhead .logo { height: 48px; }
  .letterhead h1 { font-size: 18px; margin: 0; }
  .letterhead .order-number { margin: 2px 0 0; font-size: 13px; color: #737373; direction: ltr; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #e5e5e5; padding: 6px 8px; font-size: 13px; text-align: right; }
  th { background: #03AFB9; color: #fff; }
  .field { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
  .field span:first-child { color: #737373; }
  .field.total-final { margin-top: 8px; padding-top: 8px; border-top: 1px solid #292524; font-size: 16px; font-weight: bold; }
  .field.total-final span:first-child { color: #292524; }
  .field.total-final span:last-child { color: #FB5A01; }
  .note { margin-top: 16px; font-size: 12px; color: #737373; }
`;

// نُستعمل في مكانين: (1) بديل عند فشل توليد PDF (banner تنبيه)، و(2) صفحة
// الطباعة المباشرة في لوحة الإدارة (زر "طباعة أو حفظ PDF" بدل التنبيه،
// يختفي عند الطباعة الفعلية). نفس التنسيق (@page A4) في الحالتين.
export function wrapHtmlDocument(
  title: string,
  bodyHtml: string,
  options: { mode?: "fallback" | "print" } = {}
): string {
  const mode = options.mode ?? "fallback";
  const banner =
    mode === "fallback"
      ? `<div class="fallback-notice">
          تعذّر توليد PDF مباشرة لهذا الطلب. هذه نسخة HTML بنفس المعلومات — استعمل
          طباعة المتصفح (Ctrl+P) لحفظها كـPDF عند الحاجة.
        </div>`
      : `<button type="button" class="print-button" onclick="window.print()">🖨 طباعة أو حفظ PDF</button>`;

  const extraStyles =
    mode === "fallback"
      ? `.fallback-notice { background: #fff1e9; border: 1px solid #FB5A01; padding: 10px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; }
         @media print { .fallback-notice { display: none; } }`
      : `.print-button { background: #03AFB9; color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 16px; }
         @media print { .print-button { display: none; } }`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${SHARED_STYLES}
${extraStyles}
</style>
</head>
<body>
  ${banner}
  ${bodyHtml}
</body>
</html>`;
}
