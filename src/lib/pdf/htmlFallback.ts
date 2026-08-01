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

export function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; padding: 24px; color: #292524; }
  h1 { font-size: 18px; border-bottom: 2px solid #03AFB9; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #e5e5e5; padding: 6px 8px; font-size: 13px; text-align: right; }
  th { background: #03AFB9; color: #fff; }
  .field { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px; }
  .field span:first-child { color: #737373; }
  .note { margin-top: 16px; font-size: 12px; color: #737373; }
  .fallback-notice { background: #fff1e9; border: 1px solid #FB5A01; padding: 10px; border-radius: 6px; margin-bottom: 16px; font-size: 12px; }
  @media print { .fallback-notice { display: none; } }
</style>
</head>
<body>
  <div class="fallback-notice">
    تعذّر توليد PDF مباشرة لهذا الطلب. هذه نسخة HTML بنفس المعلومات — استعمل
    طباعة المتصفح (Ctrl+P) لحفظها كـPDF عند الحاجة.
  </div>
  ${bodyHtml}
</body>
</html>`;
}
