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
 *  3) كل إضافة مبكّرة تُصفّ في التخزين (لا في الذاكرة)، ويُفرغها
 *     CartProvider بعد الترطيب عبر نفس مسار القياس الداخلي — فلا يضيع
 *     الحدث حتى لو غادر الزبون الصفحة قبل أن يصل React.
 */

export const CART_STORAGE_KEY = "tayssir_cart_v1";

/**
 * طابور الإضافات المبكّرة المنتظِرة للقياس. في التخزين لا في الذاكرة، لأن
 * الزبون الذي يضغط عند الثانية الثانية كثيراً ما يغادر الصفحة قبل أن يصل
 * React عند الثانية العاشرة — فطابور في الذاكرة يموت معه، ويختفي من اللوحة
 * حدثٌ وقع فعلاً. قِسنا هذا على Production: ضغطة قبل الترطيب ثم مغادرة =
 * صفر أحداث. مع التخزين تُفرَّغ في أول صفحة يكتمل فيها الترطيب.
 */
export const PENDING_ADDS_KEY = "tayssir_pending_adds_v1";

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
  /** لحظة الضغط — تُستعمل لإسقاط ما شاخ أكثر من عمر الجلسة. */
  at: number;
  /**
   * مُعرّف الضغطة. ليس زينة: بينما يُرسَل الحدث قد تصل ضغطة جديدة إلى نفس
   * الطابور، فلا يصحّ أن نمسح الطابور كله عند النجاح. نمسح ما أُكِّد وصوله
   * بالمُعرّف وحده.
   */
  id: string;
};

declare global {
  interface Window {
    __tfCartLive?: boolean;
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
  var PKEY=${JSON.stringify(PENDING_ADDS_KEY)};
  var DONE="✓ تمت الإضافة للسلة";
  function snap(q,min,inc){
    var m=Math.max(1,min||1),i=Math.max(1,inc||1);
    if(q<=m)return m;
    return m+Math.round((q-m)/i)*i;
  }
  function read(){
    try{var r=localStorage.getItem(KEY);var p=r?JSON.parse(r):[];return Array.isArray(p)?p:[];}catch(e){return [];}
  }
  function money(v){
    // نفس صياغة formatMad بالضبط، وإلا اختلف نصّ الشريط قبل الترطيب عنه
    // بعده أمام عين الزبون.
    try{return new Intl.NumberFormat("ar-MA",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+" درهم";}
    catch(e){return v+" درهم";}
  }
  function badge(items){
    try{
      var n=0,v=0;
      for(var i=0;i<items.length;i++){n+=items[i].quantity;v+=items[i].unitPrice*items[i].quantity;}
      var el=document.querySelector("[data-cart-count]");
      if(el){el.textContent=String(n);el.hidden=n===0;}
      var bar=document.querySelector("[data-cart-bar]");
      if(bar)bar.hidden=n===0;
      var c=document.querySelector("[data-cart-bar-count]");
      if(c)c.textContent=String(n);
      var t=document.querySelector("[data-cart-bar-total]");
      if(t)t.textContent=money(v);
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
      try{
        var q=JSON.parse(localStorage.getItem(PKEY)||"[]");
        if(!Array.isArray(q))q=[];
        var id=Date.now().toString(36)+Math.random().toString(36).slice(2,10);
        q.push({id:id,productId:it.productId,sku:it.sku,quantity:it.quantity,cartValue:v,at:Date.now()});
        localStorage.setItem(PKEY,JSON.stringify(q));
      }catch(e){}
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
