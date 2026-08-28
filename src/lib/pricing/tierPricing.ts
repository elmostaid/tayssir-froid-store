/**
 * المصدر الوحيد لحساب ثمن الوحدة في المتجر كله.
 *
 * كل من: صفحة المنتج، بطاقة المنتج، السلة، Checkout، وإنشاء الطلب من الخادم
 * (createOrder) — يستعملون هذه الدوال بالضبط، حتى يستحيل بنيوياً أن يظهر
 * للزبون ثمن في صفحة ويُحسب ثمن مختلف في صفحة أخرى.
 *
 * دوال خالصة (pure) بلا أي I/O ولا استيراد من "@/lib/db" — لذلك تعمل كما هي
 * على الخادم وفي المتصفح وفي الاختبارات.
 *
 * القاعدة الأساسية: التسعير **تراجعي (retroactive)**. عند بلوغ مستوى، ثمنه
 * يُطبَّق على كل وحدات نفس المنتج وليس فقط على القطع التي تجاوزت الحد:
 *   50 قطعة بـ12 = 600 درهم، وليس (49 × 13) + (1 × 12).
 */

export const PRICING_MODES = ["single", "two_tier", "three_tier"] as const;

export type PricingMode = (typeof PRICING_MODES)[number];

/**
 * صورة مبسَّطة ومستقلة عن قاعدة البيانات لإعدادات تسعير سطر واحد.
 * تُخزَّن كما هي داخل عناصر السلة (localStorage) حتى تُحسب الأثمنة في السلة
 * بلا أي طلب شبكة عند كل تغيير كمية.
 */
export type TierPricing = {
  mode: PricingMode;
  /** ثمن المستوى الأول = sale_price في قاعدة البيانات */
  unitPrice: number;
  tier2MinQty: number | null;
  tier2Price: number | null;
  tier3MinQty: number | null;
  tier3Price: number | null;
};

/** الشكل الخام كما يأتي من الـview/الجدول (numeric يعود كنص من postgres.js) */
export type TierPricingSource = {
  sale_price: string | number;
  pricing_mode?: string | null;
  tier2_min_qty?: number | null;
  tier2_price?: string | number | null;
  tier3_min_qty?: string | number | null;
  tier3_price?: string | number | null;
};

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveInt(value: string | number | null | undefined): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * يبني TierPricing من صف منتج خام.
 *
 * دفاعي عمداً: أي عمود ناقص أو تالف (حالة يمنعها قيد
 * products_pricing_mode_coherent في قاعدة البيانات، لكن قد تحدث في بيانات
 * معاينة قديمة أو JSON مكتوب يدوياً) يُخفَّض تلقائياً إلى ثمن واحد بدل رمي
 * استثناء — لأن "المنتج يُباع بثمنه الأساسي" أسلم بكثير من "الصفحة تنهار".
 */
export function toTierPricing(source: TierPricingSource): TierPricing {
  const unitPrice = toFiniteNumber(source.sale_price) ?? 0;
  const single: TierPricing = {
    mode: "single",
    unitPrice,
    tier2MinQty: null,
    tier2Price: null,
    tier3MinQty: null,
    tier3Price: null,
  };

  const mode = source.pricing_mode;
  if (mode !== "two_tier" && mode !== "three_tier") return single;

  const tier2MinQty = toPositiveInt(source.tier2_min_qty);
  const tier2Price = toFiniteNumber(source.tier2_price);
  if (tier2MinQty === null || tier2Price === null || tier2Price < 0) return single;

  if (mode === "two_tier") {
    return { ...single, mode: "two_tier", tier2MinQty, tier2Price };
  }

  const tier3MinQty = toPositiveInt(source.tier3_min_qty);
  const tier3Price = toFiniteNumber(source.tier3_price);
  // مستوى ثالث لا يبدأ بعد الثاني ليس مستوى ثالثاً — نتجاهله ونكتفي بمستويين
  // بدل إنتاج سلَّم أثمنة غير منطقي.
  if (tier3MinQty === null || tier3Price === null || tier3Price < 0 || tier3MinQty <= tier2MinQty) {
    return { ...single, mode: "two_tier", tier2MinQty, tier2Price };
  }

  return {
    mode: "three_tier",
    unitPrice,
    tier2MinQty,
    tier2Price,
    tier3MinQty,
    tier3Price,
  };
}

/**
 * التسعير الفعلي لمتغيّر (variant).
 *
 * ⚠️ قاعدة مقصودة وموثَّقة: التسعير المتدرِّج مُعرَّف على **المنتج الأب فقط**.
 * إذا كان للمتغيّر ثمن خاص (sale_price_override) فهو يُلغي سلَّم الأثمنة
 * بالكامل ويُعامَل كثمن واحد لكل الكميات — لأن ثمن المتغيّر يستبدل ثمن
 * المنتج الأب، ولا معنى لخلطه مع مستويات جملة مبنية على ثمن مختلف.
 * متغيّر بلا ثمن خاص يرث سلَّم أثمنة المنتج الأب كاملاً.
 *
 * لا توجد (ولن توجد في هذه المرحلة) حقول tiers خاصة بالمتغيّرات. إن احتجناها
 * مستقبلاً فهي تطوير منفصل، وليس شيئاً "يُفترض أنه يعمل أصلاً".
 */
export function resolveVariantPricing(
  productPricing: TierPricing,
  variantSalePrice: string | number | null | undefined,
  variantHasOwnPrice: boolean
): TierPricing {
  if (!variantHasOwnPrice) return productPricing;
  const overridePrice = toFiniteNumber(variantSalePrice);
  if (overridePrice === null) return productPricing;
  return {
    mode: "single",
    unitPrice: overridePrice,
    tier2MinQty: null,
    tier2Price: null,
    tier3MinQty: null,
    tier3Price: null,
  };
}

/** ثمن الوحدة المطبَّق فعلياً على كامل الكمية المطلوبة. */
export function resolveUnitPrice(pricing: TierPricing, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return pricing.unitPrice;
  if (pricing.mode === "single") return pricing.unitPrice;

  if (
    pricing.mode === "three_tier" &&
    pricing.tier3MinQty !== null &&
    pricing.tier3Price !== null &&
    quantity >= pricing.tier3MinQty
  ) {
    return pricing.tier3Price;
  }

  if (pricing.tier2MinQty !== null && pricing.tier2Price !== null && quantity >= pricing.tier2MinQty) {
    return pricing.tier2Price;
  }

  return pricing.unitPrice;
}

/**
 * تقريب نقدي إلى سنتيمين — يطابق numeric(10,2) في قاعدة البيانات ويمنع أي
 * انزلاق في حساب الفاصلة العائمة بين المتصفح والخادم (مثل 0.1 + 0.2).
 */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** مجموع السطر = ثمن الوحدة المطبَّق × الكمية (مُقرَّباً نقدياً). */
export function resolveLineTotal(pricing: TierPricing, quantity: number): number {
  return roundMoney(resolveUnitPrice(pricing, quantity) * quantity);
}

export type TierRow = {
  /** أقل كمية يبدأ منها هذا المستوى */
  minQty: number;
  /** أكبر كمية داخل هذا المستوى، أو null إذا كان المستوى الأخير (مفتوح) */
  maxQty: number | null;
  unitPrice: number;
};

/**
 * وصف المستويات للعرض في صفحة المنتج.
 *
 * يُرجع مصفوفة **فارغة** في نمط الثمن الواحد — حتى لا تظهر أبداً أي "tiers
 * فارغة" لمنتج بثمن واحد، ويبقى عرضه بسيطاً كما هو اليوم.
 *
 * startQty هي min_order_qty الخاصة بالمنتج: منتج حده الأدنى 1 يظهر "1–9"،
 * ومنتج حده الأدنى 5 يظهر "5–9" بدل "1–9" الكاذبة.
 */
export function describeTiers(pricing: TierPricing, startQty = 1): TierRow[] {
  if (pricing.mode === "single") return [];

  const rows: TierRow[] = [];
  const tier2MinQty = pricing.tier2MinQty;
  const tier2Price = pricing.tier2Price;
  if (tier2MinQty === null || tier2Price === null) return [];

  const firstMin = Math.max(1, startQty);
  // حد أدنى للطلب يتجاوز أصلاً بداية الجملة يُلغي معنى المستوى الأول: الزبون
  // لا يستطيع أبداً شراء كمية بثمن القطعة، فلا نعرض له مستوى وهمياً.
  if (firstMin < tier2MinQty) {
    rows.push({ minQty: firstMin, maxQty: tier2MinQty - 1, unitPrice: pricing.unitPrice });
  }

  const hasTier3 =
    pricing.mode === "three_tier" && pricing.tier3MinQty !== null && pricing.tier3Price !== null;

  rows.push({
    minQty: Math.max(firstMin, tier2MinQty),
    maxQty: hasTier3 ? pricing.tier3MinQty! - 1 : null,
    unitPrice: tier2Price,
  });

  if (hasTier3) {
    rows.push({
      minQty: Math.max(firstMin, pricing.tier3MinQty!),
      maxQty: null,
      unitPrice: pricing.tier3Price!,
    });
  }

  return rows;
}

/** هل لهذا المنتج سلَّم أثمنة فعلي يستحق العرض؟ */
export function hasTierPricing(pricing: TierPricing): boolean {
  return pricing.mode !== "single";
}
