import type { Config } from "tailwindcss";

// إعداد Tailwind v3.4 الكلاسيكي (ملف config بدل @theme فـglobals.css التي
// كانت خاصة بـv4) — نفس أسماء الألوان والخط بالضبط، بحيث تبقى كل الأصناف
// المستعملة فالكود (bg-brand-orange، text-whatsapp-dark، إلخ) تعمل حرفياً
// بلا أي تعديل فأي مكوّن. القيم نفسها تُقرأ من متغيرات CSS فـglobals.css
// (وليست مكرَّرة هنا كقيم ثابتة) حتى يبقى مصدر الحقيقة اللوني واحداً فقط.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        "brand-orange": "var(--brand-orange)",
        "brand-orange-dark": "var(--brand-orange-dark)",
        "brand-orange-tint": "var(--brand-orange-tint)",

        "brand-turquoise": "var(--brand-turquoise)",
        "brand-turquoise-dark": "var(--brand-turquoise-dark)",
        "brand-turquoise-tint": "var(--brand-turquoise-tint)",

        whatsapp: "var(--whatsapp)",
        "whatsapp-dark": "var(--whatsapp-dark)",
      },
      fontFamily: {
        sans: ["var(--font-arabic)", "Tahoma", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
