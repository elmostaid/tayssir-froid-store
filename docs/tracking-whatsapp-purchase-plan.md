# خطة: كل بيعة مؤكَّدة قابلة للقياس، بقناتها الحقيقية ومصدرها المُثبَت

> الحالة: **مُنفَّذة في فرع منفصل، غير منشورة.** لا migration طُبِّقت على أي
> قاعدة حيّة، ولا حدث أُرسل إلى Meta.

## 0. ما ثبت قبل البدء (قراءة فقط)

| الحقيقة | المصدر |
|---|---|
| 59 طلب موقع مؤكَّد وصل Meta، و42 طلب واتساب مؤكَّد لم يصل منها شيء | `orders.meta_purchase_accepted_at`، `createManualOrder.ts` |
| زرّ «استفسار» (الترويسة + القائمة + التذييل) يرسل «مرحباً، عندي سؤال بخصوص منتجات …» بلا أي مرجع | `SiteHeader.tsx:19`، `SiteFooter.tsx:14` |
| أيقونة واتساب في بطاقة المنتج وزرّ صفحة المنتج يرسلان اسم المنتج وSKU بلا مرجع | `ProductCardActions.tsx:27`، `product/[slug]/page.tsx:91` |
| زرّ «أكمل الطلب عبر واتساب» يحمل مرجع `W-…` ويُسجَّل في `whatsapp_leads` — لكن التحويل إلى طلب يُسقط الإسناد والهوية | `CartWhatsAppButton.tsx`، `convertWhatsappLead.ts` |
| 47 lead من الموقع في 13–31 أكتوبر، 9 فقط حُوِّلت عبر الزرّ، و38 بقيت معلّقة (27 من حملة الشوفو) | قاعدة الإنتاج |
| مداولة CNDP رقم D-939-2025 (28/11/2025): كوكيز الإشهار المخصَّص تحتاج **موافقة مسبقة**؛ الاحتفاظ **6 أشهر** كحدّ أقصى؛ النقل للخارج يحتاج **إذناً مسبقاً**؛ الربط مع ملفات أخرى يحتاج إذناً (المادة 12) | cndp.ma |

## 1. القرارات التي تحكم كل شيء

1. **القناة الحقيقية لا تتغيّر أبداً.** `orders.source` يبقى `whatsapp` / `phone` / `store`. الإسناد الإعلاني يُحفظ **بجانبه** (`attribution_*`، `origin_reference`)، لا مكانه.
2. **`action_source` يتبع القناة، لا المصدر الإعلاني:**
   `website → website`، `whatsapp → chat`، `phone → phone_call`، `store → physical_store`، `other → other`.
   طلبية بدأت من إعلان وأُغلقت في واتساب تُرسَل `chat` مع `fbc` المُثبَت — لا `website`.
3. **`business_messaging` غير قابل للاستعمال الآن:** يتطلّب إعلانات Click-to-WhatsApp، وWhatsApp Business Platform (Cloud API)، و`ctwa_clid` من webhook الرسائل، وWABA ID. لا شيء من ذلك موجود: الإعلانات إعلانات موقع، والرقم يعمل بتطبيق واتساب العادي.
4. **لا معرّف مُختلَق.** `fbc` يُؤخذ من كوكي `_fbc` أو يُبنى من `fbclid` حقيقي بلحظته الحقيقية (طريقة موثّقة من Meta) — وإلا لا يُرسَل. لا تخمين بالهاتف أو الوقت.
5. **لا حدث بلا موافقة، ولا حدث خارج الموقع قبل إذن CNDP:**
   - الموقع: موافقة صريحة عبر شريط الموافقة (`tf_ad_consent=granted`) قبل تحميل Pixel وقبل أي CAPI.
   - المبيعات خارج الموقع: مفتاح خادم `META_OFFLINE_PURCHASES_ENABLED=true` **مُطفأ افتراضياً**، لا يُشغَّل إلا بعد إذن CNDP للربط والنقل. وموافقة الزبون إمّا موروثة من زيارته (عبر المرجع) أو مُصرَّح بها من المدير صراحةً.
6. **مرة واحدة لكل طلبية** — نفس الحرس القائم (`event_id = purchase:<id>`، حجز ذرّي، سقف محاولات)، لكل القنوات.
7. **لا يُفترض أن حدث `chat` يُحسّن حملة Website Purchase.** Meta تقبله في نفس الـDataset لكن الوثائق لا تقول إنه يدخل تحسين حملات الموقع. يُقاس أثره في Ads Manager (أعمدة "Purchases" الشاملة مقابل "Website purchases") بعد التشغيل، لا يُفترض.

## 2. تغييرات قاعدة البيانات (migration واحدة، لم تُطبَّق)

`supabase/migrations/20261101000000_whatsapp_inquiries_and_sale_channels.sql`

- **جدول جديد `whatsapp_inquiries`**: `reference` (Q-XXXXXXXX، فريد)، `idempotency_key` (فريد)، `kind` (general/product)، `product_sku`، `page_path`، `attribution_first/last`، `capi_identity` (فقط مع الموافقة)، `ad_consent`، `analytics_session_id`، `converted_order_id`، `created_at`. RLS بنفس نمط `whatsapp_leads`.
- **`whatsapp_leads`**: + `capi_identity jsonb`، + `ad_consent text`.
- **`orders`**: + `origin_reference text` (Q-/W- المربوط)، + `ad_consent text` (granted/denied/unknown، افتراضي unknown)، + `ad_consent_source text` (website_banner/inherited/admin_declared)، + `meta_purchase_action_source text` (للتدقيق).
- **دالة `purge_expired_tracking_identity(days)`**: تمحو `capi_identity` ومعرّفات النقر من الإسناد بعد 180 يوماً (حدّ CNDP)، في الطلبات والـleads والاستفسارات. لا تمسّ بيانات الطلب نفسه.
- كل الطلبات الحالية تبقى `ad_consent='unknown'` ⇒ **لا يُرسَل عنها شيء جديد** بعد النشر (لا إرسال بأثر رجعي).

## 3. الملفات

**جديد**
- `src/lib/whatsappInquiry.ts` — المرجع Q- ورسالة الاستفسار.
- `src/components/WhatsAppInquiryLink.tsx` — رابط واتساب بمرجع، ويُسجّل الاستفسار بـkeepalive.
- `src/app/api/whatsapp-inquiries/route.ts` + `src/lib/orders/createWhatsappInquiry.ts`.
- `src/lib/orders/originReference.ts` — قراءة/ربط Q- وW- داخل معاملة الطلب.
- `src/lib/privacy/consent.ts` + `src/components/ConsentBanner.tsx` + `src/app/(storefront)/privacy/page.tsx`.
- `src/lib/pixel/actionSource.ts` — القناة ⇒ action_source + بوّابات الإرسال.
- `src/app/api/cron/purge-tracking/route.ts` + `vercel.json` (cron يومي، يحتاج `CRON_SECRET`).
- `scripts/meta-test-event.mjs` — يطبع الحمولة؛ لا يرسل إلا بـ`--send` و`META_TEST_EVENT_CODE`.

**معدَّل**
- `SiteHeader`، `HeaderWhatsAppButton`، `MobileNav`، `SiteFooter`، `page.tsx` (الرئيسية)، `ProductCardActions`، `product/[slug]/page.tsx` — كلها عبر `WhatsAppInquiryLink`.
- `MetaPixel.tsx` + `fbq.ts` + `api/pixel-events` — لا Pixel ولا relay بلا موافقة.
- `requestContext.ts`، `createOrder.ts`، `createWhatsappLead.ts` — لقطة الموافقة، ولا هوية/معرّف نقر بدونها.
- `createManualOrder.ts`، `convertWhatsappLead.ts`، `actions.ts`، `ManualOrderForm.tsx` — حقل المرجع، وموافقة المدير المصرَّح بها، والإرسال بعد الإنشاء.
- `sendDeferredPurchase.ts`، `capi.ts` — كل القنوات، action_source الصحيح، `country`، بوّابات الموافقة.
- صفحة الطلب في الإدارة — المرجع، الموافقة، قناة الإرسال، وتنبيه «أُلغي بعد إرسال البيعة».
- `CheckoutClient.tsx` — سطر إشعار بالخصوصية.

## 4. الاختبارات (قاعدة Postgres محلية معزولة، وCAPI مُحاكى)

1. طلب موقع مؤكَّد بموافقة ⇒ `website`، القيمة، `MAD`، `purchase:<id>`. بلا موافقة ⇒ لا شيء.
2. إعلان ⇒ استفسار Q- ⇒ طلب واتساب بالمرجع ⇒ `chat` مع `fbc`، والمصدر يبقى `whatsapp`، والإسناد منسوخ. والمفتاح مُطفأ ⇒ لا شيء.
3. واتساب مباشر بلا مرجع ⇒ لا شيء بلا موافقة مُصرَّحة؛ معها ⇒ `chat` بالهاتف وحده (بلا fbc).
4. طلب هاتفي ⇒ `phone_call`.
5. تأكيد مرتين ⇒ حدث واحد.
6. فشل ثم إعادة ⇒ نفس `event_id`، قبول واحد.
7. تأكيد ثم إلغاء ⇒ لا حدث ثانٍ ولا قيمة سالبة، والطلب يُعلَّم «أُلغي بعد الإرسال».
+ مرجع مستعمل مرتين، مرجع غير موجود، lead W- عبر النموذج اليدوي، تنقية الإسناد بلا موافقة، دالة المحو بعد 180 يوماً.

**Test Events:** `scripts/meta-test-event.mjs` يطبع الحمولة المشفَّرة دون إرسال. الإرسال الفعلي يحتاج قرارك و`META_TEST_EVENT_CODE` من Events Manager.

## 5. قيود

- **قانونية (لا تُحلّ بالكود):** تصريح مبسَّط للكوكيز عبر CNDP-FORMS؛ إذن نقل للخارج (Meta، Google، Vercel، Supabase)؛ إذن الربط (المادة 12) قبل تشغيل `META_OFFLINE_PURCHASES_ENABLED`؛ أرقام الوصولات تُضاف لصفحة الخصوصية. **أنا لست مستشاراً قانونياً — النصوص تحتاج مراجعة.**
- **أثر تجاري:** الموافقة المسبقة ستُنقص أحداث Pixel/CAPI بقدر نسبة الرفض (غير معروفة قبل النشر).
- **تقني:** الضغط الطويل/«فتح في تبويب جديد» على زرّ واتساب يفتح الرابط دون تسجيل الاستفسار؛ المرجع قد يُحذف يدوياً من الرسالة؛ GA4 خارج نطاق الموافقة هنا (قياس جمهور بلا ملف شخصي) لكنه يبقى نقلاً للخارج.

## 6. نتائج التحقق (محلياً، بلا نشر)

- **الاختبارات:** 135 ملفاً / 1220 اختباراً ناجحاً على Postgres محلية معزولة (منها 17 جديدة للحالات السبع، و13 للموافقة والمرجع). Meta مُحاكاة بالكامل.
- **اختبار الطفرة:** تحويل `whatsapp→website` أو إزالة حرس «مرجع مستعمل» يُسقط 5 اختبارات — الاختبارات تلتقط الانحراف فعلاً.
- **typecheck + lint + `next build`:** نظيفة.
- **متصفح حقيقي (Chromium، بناء إنتاجي محلي، معرّف Pixel مزيّف، وكل نطاقات Facebook محجوبة):**
  - قبل الموافقة: الشريط ظاهر، **صفر** طلب نحو Meta، لا كوكي `_fbp`، و`fbclid` غير مكتوب في التخزين المحلي.
  - زرّ «استفسار»: الرسالة تحمل `مرجع الاستفسار: Q-XXXXXXXXXX`، والصفّ مسجَّل بـ`ad_consent=unknown` وبلا هوية.
  - بعد «موافق»: كوكي `tf_ad_consent=granted` لـ180 يوماً، طلب `fbevents.js` (محجوب)، و`fbclid` المنتظر يُكتب في لمسته؛ الاستفسار التالي مسجَّل بـ`fbc` مبني من النقرة الحقيقية.
  - `/privacy` تُعرض.
