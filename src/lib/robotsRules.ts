/**
 * كل صفحة هنا تُصيَّر على الخادم عند كل طلب، فكل زيارة روبوت = استدعاء
 * دالة مدفوع على Vercel. هذه مسارات لا قيمة لفهرستها: لوحة الإدارة، والسلة
 * وإتمام الطلب وصفحة الطلبية (خاصة بكل زبون)، والبحث وروابط الترتيب/البحث
 * (فضاء روابط لا نهائي يستنزف الزحف بلا صفحة جديدة واحدة)، وواجهات API.
 */
export const PRODUCTION_DISALLOW = [
  "/admin",
  "/api/",
  "/cart",
  "/checkout",
  "/order/",
  "/search",
  "/preview",
  "/*?*sort=",
  "/*?*q=",
];

/**
 * زواحف لا تجلب زبوناً واحداً: تدريب نماذج الذكاء الاصطناعي وأدوات تحليل
 * السيو. Googlebot وBingbot وروبوتات Meta الإعلانية (`facebookexternalhit`،
 * `facebookcatalog`) ليست هنا عمداً: الأولى للظهور في البحث، والثانية
 * لمعاينة روابط الإعلانات وجلب صور الكاطالوغ.
 *
 * robots.txt يحترمه الملتزم وحده — الحماية من غير الملتزمين مكانها جدار
 * Vercel (Bot Protection)، لا هنا.
 */
export const NON_CUSTOMER_CRAWLERS = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "Applebot-Extended",
  "PerplexityBot",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "cohere-ai",
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "PetalBot",
  "DataForSeoBot",
  "BLEXBot",
  "serpstatbot",
];
