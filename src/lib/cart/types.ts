import type { TierPricing } from "@/lib/pricing/tierPricing";

export type CartItem = {
  productId: number;
  variantId: number | null;
  slug: string;
  sku: string;
  name: string;
  variantName: string | null;
  /** آخر سعر معروف للعرض فقط — لا يُعتمد عليه أبداً عند إنشاء الطلب،
   * حيث يُعاد جلب السعر الحقيقي من قاعدة البيانات في الخادم.
   * مع التسعير المتدرِّج هذا هو ثمن المستوى الأول؛ الثمن المعروض فعلياً
   * يُشتق دائماً من pricing + quantity عبر cartItemUnitPrice(). */
  unitPrice: number;
  /** إعدادات التسعير المتدرِّج لهذا السطر.
   * اختياري عمداً: سلَّة محفوظة في localStorage قبل نشر هذه الميزة لا تحتوي
   * هذا الحقل إطلاقاً، وغيابه يعني "ثمن واحد بقيمة unitPrice المخزَّنة" —
   * أي بالضبط السلوك القديم، بلا كسر السلَّة ولا مسحها. */
  pricing?: TierPricing;
  minOrderQty: number;
  qtyIncrement: number;
  imageUrl: string | null;
  quantity: number;
};
