// خط Tailwind v3.4 الكلاسيكي (tailwindcss + autoprefixer منفصلَين) بدل
// @tailwindcss/postcss v4 — autoprefixer يقرأ .browserslistrc تلقائياً عبر
// حزمة browserslist، فيُنتج بادئات -webkit-/-moz- الفعلية اللازمة للنطاق
// المُعرَّف هناك (يشمل هواتف أقدم)، ومخرَج Tailwind v3 نفسه لا يحتوي أصلاً
// على @layer/@property/color-mix()/oklch() (توجيهات/دوال v4 حصرية غير
// موجودة فشيفرة v3 إطلاقاً) — توافق أوسع مضمون هيكلياً، وليس اعتماداً على
// دعم فرعي مشروط كما كان.
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
