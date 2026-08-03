// createOrder.ts يدمج اسم المتغير داخل product_name_snapshot بصيغة
// "اسم المنتج — اسم المتغير" (لا عمود منفصل للمتغير في order_items). هذه
// الدالة تفصلهما مرة أخرى للعرض في عمود "المتغير/المقاس" المستقل في البون،
// دون أي تعديل على مخطط قاعدة البيانات.
export function splitProductNameSnapshot(snapshot: string): {
  productName: string;
  variantName: string | null;
} {
  const separator = " — ";
  const index = snapshot.indexOf(separator);
  if (index === -1) return { productName: snapshot, variantName: null };
  return {
    productName: snapshot.slice(0, index),
    variantName: snapshot.slice(index + separator.length),
  };
}
