/**
 * جسر "الإضافة المبكّرة": يجعل زر «أضف للسلة» يعمل قبل وصول React أصلاً.
 *
 * لماذا هذا الحل تحديداً، وليس تقليل حجم JavaScript:
 * قِسْنا الصفحة على 4G بطيء فوجدنا الزر يظهر عند الثانية الثانية بينما لا
 * يستجيب قبل 8.5–10 ثوانٍ. وفحصنا الأجزاء الثلاثة عشر: من 161 كيلوبايت
 * مضغوطة، ~140 منها إطار العمل نفسه (react-dom وموجّه Next)، بينما كود
 * الإضافة للسلة **3 كيلوبايت فقط**. أي أن تقليل كودنا لا يحرّك شيئاً — ما
 * ينتظره الزبون هو الإطار، لا منطقنا.
 *
 * فالحل أن تعمل الإضافة بلا إطار: سكريبت صغير مضمَّن في HTML نفسه (يُنفَّذ
 * فور تحليل الصفحة، بلا أي تنزيل) يلتقط الضغطة، يكتب في نفس مفتاح التخزين
 * وبنفس منطق الدمج بالضبط، ويحدّث الزر وعدّاد السلة. حين يصل React لاحقاً
 * يقرأ نفس التخزين فيجد السلة كما تركها الزبون تماماً.
 *
 * ثلاث ضمانات تمنع أي ازدواج أو تعارض:
 *  1) الاستماع في طور الالتقاط على document مع stopImmediatePropagation.
 *     الأخيرة ضرورية لا تجميلية: موجّه App Router يُرطِّب الوثيقة نفسها،
 *     فمستمعو React مثبَّتون على **نفس** العقدة — و stopPropagation وحدها
 *     لا توقف مستمعاً آخر على نفس العقدة. ولأن سكريبتنا يُسجَّل وقت تحليل
 *     الصفحة (قبل تنزيل أي حزمة) فهو دائماً الأسبق، فلا يرى React الحدث
 *     إطلاقاً ولا يُعيد تشغيله بعد الترطيب.
 *  2) العلَم __tfCartLive يُرفع داخل نفس الكتلة المتزامنة التي يقرأ فيها
 *     CartProvider التخزين. JavaScript أحادي الخيط، فلا يمكن لأي ضغطة أن
 *     تقع بين القراءة ورفع العلَم — لا سباق ممكن، لا نظرياً ولا عملياً.
 *  3) كل إضافة مبكّرة تُصفّ في __tfPendingAdds، ويُفرغها CartProvider بعد
 *     الترطيب عبر نفس مسار القياس الداخلي — فلا يضيع أي حدث.
 */

export const CART_STORAGE_KEY = "tayssir_cart_v1";

/** الحمولة التي يحملها الزر في data-early-add. */
export type EarlyAddPayload = {
  productId: number;
  variantId: number | null;
  slug: string;
  sku: string;
  name: string;
  variantName: string | null;
  unitPrice: number;
  minOrderQty: number;
  qtyIncrement: number;
  imageUrl: string | null;
  /** الكمية المضافة بضغطة واحدة (الكمية الدنيا لبطاقة المنتج). */
  quantity: number;
};

/** حدث إضافة وقع قبل الترطيب، ينتظر إرساله إلى القياس الداخلي. */
export type PendingAdd = {
  productId: number;
  sku: string;
  quantity: number;
  cartValue: number;
};

declare global {
  interface Window {
    __tfCartLive?: boolean;
    __tfPendingAdds?: PendingAdd[];
  }
}

/** يُزيل المسافات البادئة فقط — لا يُغيّر أي رمز، ويوفّر ~30% من حجم السلك. */
function compact(source: string): string {
  return source.trim().replace(/^[ \t]+/gm, "");
}

/**
 * نص السكريبت المضمَّن. مكتوب يدوياً بلا أي استيراد أو أداة بناء لأنه
 * يُحقن حرفياً في HTML — كل بايت هنا يُحمَّل مع الصفحة، فبقي دون كيلوبايت
 * واحد على السلك (اختبار يحرس هذا الحدّ).
 *
 * ملاحظتان على السلوك، كانتا تعليقين داخل السكريبت فأُخرِجتا هنا لتوفير
 * بايتات على السلك: (أ) بعد الترطيب يملك React نصّ الزر، فالمؤقّت لا يُعيد
 * النص إلا إذا كان لا يزال «تمت الإضافة ✓» والعلَم لم يُرفع بعد؛ (ب) أول
 * تحديث للعدّاد قد يسبق وجود الترويسة في DOM لأن السكريبت يُنفَّذ وقت
 * التحليل، لذلك يُعاد عند DOMContentLoaded أيضاً.
 *
 * `snap` هنا نسخة مطابقة لِما في cartMath.ts. التكرار مقصود ومحدود:
 * استيراد الوحدة يعني تحميل حزمة، وهو بالضبط ما نتفاداه. اختبار مشترك
 * يُثبت تطابق النسختين على نفس الحالات (earlyAdd.test.ts).
 */
export const EARLY_ADD_SCRIPT = compact(`
(function(){
  var KEY=${JSON.stringify(CART_STORAGE_KEY)};
  var DONE="تمت الإضافة ✓";
  window.__tfPendingAdds=window.__tfPendingAdds||[];
  function snap(q,min,inc){
    var m=Math.max(1,min||1),i=Math.max(1,inc||1);
    if(q<=m)return m;
    return m+Math.round((q-m)/i)*i;
  }
  function read(){
    try{var r=localStorage.getItem(KEY);var p=r?JSON.parse(r):[];return Array.isArray(p)?p:[];}catch(e){return [];}
  }
  function badge(items){
    try{
      var n=0;for(var i=0;i<items.length;i++)n+=items[i].quantity;
      var el=document.querySelector("[data-cart-count]");
      if(el){el.textContent=String(n);el.hidden=n===0;}
    }catch(e){}
  }
  document.addEventListener("click",function(ev){
    try{
      if(window.__tfCartLive)return;
      var t=ev.target;
      var btn=t&&t.closest?t.closest("[data-early-add]"):null;
      if(!btn||btn.disabled)return;
      ev.preventDefault();
      ev.stopPropagation();
      if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
      var it=JSON.parse(btn.getAttribute("data-early-add"));
      var items=read();
      var key=it.productId+":"+(it.variantId==null?"base":it.variantId);
      var found=-1;
      for(var i=0;i<items.length;i++){
        if(items[i].productId+":"+(items[i].variantId==null?"base":items[i].variantId)===key){found=i;break;}
      }
      if(found>-1){
        items[found].quantity=snap(items[found].quantity+it.quantity,items[found].minOrderQty,items[found].qtyIncrement);
      }else{
        var c={};for(var k in it)c[k]=it[k];
        c.quantity=snap(it.quantity,it.minOrderQty,it.qtyIncrement);
        items.push(c);
      }
      try{localStorage.setItem(KEY,JSON.stringify(items));}catch(e){}
      var v=0;for(var j=0;j<items.length;j++)v+=items[j].unitPrice*items[j].quantity;
      window.__tfPendingAdds.push({productId:it.productId,sku:it.sku,quantity:it.quantity,cartValue:v});
      badge(items);
      var label=btn.querySelector("[data-add-label]")||btn;
      var was=label.textContent;
      label.textContent=DONE;
      setTimeout(function(){
        if(!window.__tfCartLive&&label.textContent===DONE)label.textContent=was;
      },1800);
    }catch(e){}
  },true);
  function sync(){badge(read());}
  try{
    sync();
    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sync);
  }catch(e){}
})();
`);
