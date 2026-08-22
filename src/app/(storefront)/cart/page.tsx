import { CartPageClient } from "@/components/CartPageClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "السلة",
};

// لم تعد هذه الصفحة تقرأ الإعدادات: الحد الأدنى للطلب حُذف، والسلة كلها
// تُقرأ من التخزين المحلي في المتصفح. استعلام أقل لكل زيارة.
export default function CartPage() {
  return <CartPageClient />;
}
