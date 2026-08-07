// عتبة "مخزون منخفض" — تنبيه بصري فقط (لوحة المنتجات + Dashboard)، لا تمس
// أي منطق طلب أو حجز مخزون حقيقي. ملف منفصل بدون أي استيراد لـ@/lib/db
// عمداً — يُستعمل من adminProducts.ts (خادم) ومن مكوّنات client (مثل
// ProductQuickEditRow) معاً؛ لو بقي معرَّفاً داخل adminProducts.ts فقط،
// استيراده من مكوّن client كان يجرّ معه postgres/tls إلى حزمة المتصفح
// (خطأ بناء حقيقي: "Module not found: Can't resolve 'tls'").
export const LOW_STOCK_THRESHOLD = 10;
