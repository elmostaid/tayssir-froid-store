export type CartItem = {
  productId: number;
  variantId: number | null;
  slug: string;
  sku: string;
  name: string;
  variantName: string | null;
  /** آخر سعر معروف للعرض فقط — لا يُعتمد عليه أبداً عند إنشاء الطلب،
   * حيث يُعاد جلب السعر الحقيقي من قاعدة البيانات في الخادم. */
  unitPrice: number;
  minOrderQty: number;
  qtyIncrement: number;
  imageUrl: string | null;
  quantity: number;
};
