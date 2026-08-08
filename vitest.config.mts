import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    // اختبارات التكامل (createOrder.test.ts، adminDashboardStats.test.ts...)
    // تكتب فعلياً على نفس قاعدة Postgres المحلية المشتركة. أغلبها معزول
    // بأسماء اختبار فريدة (SKU/هاتف)، لكن أي اختبار يتحقق من مجموع عالمي
    // غير مُصفّى (مثل عدد/قيمة طلبات "اليوم" فـgetDashboardOrderStats)
    // يتأثر فعلياً بملفات أخرى تُنشئ/تحذف طلبات فاللحظة نفسها إذا عملت
    // الملفات بالتوازي — فتصبح النتيجة متذبذبة (flaky) دون أي خطأ حقيقي فـ
    // الكود نفسه. تشغيل ملفات الاختبار تباعاً (بدل التوازي) يزيل هذا
    // التذبذب تماماً، بكلفة زمنية صغيرة جداً على حجم هذه الحزمة الحالي.
    fileParallelism: false,
  },
});
