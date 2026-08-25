/**
 * العنوان اختياري منذ أن صار الزبون قادراً على إتمام الطلب بدونه.
 *
 * القاعدة تحفظ NULL، لكن الطلبات القديمة تحفظ نصاً، وبعضها فراغات وحدها.
 * الشيفرة التي تعرض تحتاج جواباً واحداً لا ثلاثة، فتمرّ كلُّها من هنا:
 * لا NULL ولا نص فارغ ولا سلسلة فراغات — إما عنوان حقيقي وإما «غير محدد».
 */
export const NO_ADDRESS_LABEL = "غير محدد";

/** العنوان إن وُجد فعلاً، وإلا null — للمنطق الذي يقرّر هل يعرض السطر أصلاً. */
export function customerAddressOrNull(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  return trimmed ? trimmed : null;
}

/** العنوان كما يُقرأ على الشاشة أو الوصل: «غير محدد» حين لا عنوان. */
export function displayCustomerAddress(address: string | null | undefined): string {
  return customerAddressOrNull(address) ?? NO_ADDRESS_LABEL;
}
