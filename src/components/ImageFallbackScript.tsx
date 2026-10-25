/**
 * الحارس الأخير للصور: أي صورة تفشل تعود إلى أصلها بدل أن تظهر مكسورة.
 *
 * ## العطل الذي يغطّيه ولا يغطّيه `<picture>`
 *
 * `<picture>` يتراجع عن **صيغة** لا يدعمها المتصفح. لكنه **لا يتراجع
 * إطلاقاً** عن مصدر اختاره ثم فشل تحميله: ملف يرجع 404، أو تعثّر شبكة على
 * اتصال ضعيف، أو بايتات تالفة. في هذه الحالات يعرض المتصفح صورة مكسورة
 * ولا ينظر إلى `<img>` داخل الوسم. وهذا هو بالضبط النمط الذي وثّقه
 * `migration 20260815000000`: «نفس الصورة تعمل على iPhone وتنكسر على
 * آخر» — فشل تحميل متقطّع، لا نقص دعم صيغة.
 *
 * ## لماذا مستمع واحد على المستند لا معالج لكل صورة
 *
 * صفحة التصنيف فيها 24 صورة. `onError` لكل واحدة يعني تحويل بطاقة المنتج
 * إلى مكوّن عميل و24 نقطة ترطيب (hydration) لأجل حدث قد لا يقع أبداً.
 * حدث `error` لا يتصاعد (bubble)، لكنه **يُلتقط في طور الالتقاط
 * (capture)** على المستند — فمستمع واحد يغطّي كل صور الموقع: البطاقات
 * وصفحة المنتج والسلة والبحث، والصور التي تُضاف لاحقاً بـ«عرض المزيد»
 * دون أي تسجيل إضافي.
 *
 * ## لماذا سطر مضمَّن لا ملف
 *
 * الحارس يجب أن يكون جاهزاً **قبل** أول صورة تفشل. ملف خارجي قد يصل بعدها
 * على شبكة ضعيفة — وهي بالضبط الحالة التي وُجد لها. فهو أقل من 300 بايت
 * مضمَّنة، تُرسَل مع HTML المضغوط بـBrotli.
 *
 * ولا يُستعمل `next/script`: استراتيجياته كلها تؤجّل التنفيذ إلى ما بعد
 * الترطيب، وهو متأخّر جداً لهذا الغرض.
 */
const GUARD = `(function(){
try{
document.addEventListener("error",function(e){
var t=e.target;
if(!t||t.tagName!=="IMG")return;
var f=t.getAttribute("data-img-fallback");
if(!f)return;
t.removeAttribute("data-img-fallback");
var p=t.parentNode;
if(p&&p.tagName==="PICTURE"){
var s=p.getElementsByTagName("source");
while(s.length)p.removeChild(s[0]);
}
t.removeAttribute("srcset");
t.removeAttribute("sizes");
if(t.getAttribute("src")!==f)t.setAttribute("src",f);else t.src=f;
},true);
}catch(_){}
})();`;

export function ImageFallbackScript() {
  // نصّ ثابت مكتوب في هذا الملف، بلا أي مُدخل خارجي.
  return <script dangerouslySetInnerHTML={{ __html: GUARD }} />;
}
