# استعادة قياس Meta بالموافقة، وحفظ الإعلان وراء كل طلبية (نونبر 2026)

## الأسباب الجذرية

| الخلل | السبب المؤكَّد | الدليل |
|---|---|---|
| Meta لا ترى PageView/ViewContent/AddToCart/InitiateCheckout منذ 2026-11-01 | `5e5c680` أزال `<ConsentBanner />` وأضاف `isAdConsentCollectionEnabled()` (`NEXT_PUBLIC_AD_CONSENT_ENABLED` غير مضبوط في الإنتاج) ⇒ كل زائر `unknown` ⇒ `PixelPageViewTracker` لا يُحمّل Pixel، و`/api/pixel-events` يُرجع 204 | الحملة الجديدة: 1,154 نقرة على الرابط (3–5 نونبر)، 0 LPV/VC/ATC/IC؛ حملات أكتوبر بنفس Pixel: ~250–450 LPV يومياً |
| لا fbclid ولا هوية CAPI على الطلبيات | `withoutClickIdsUnlessConsented` و`requestContext` لا يحفظان معرّف النقرة/`_fbp`/`_fbc` بلا موافقة | طلبيات الموقع قبل 31/10: fbclid 75/94، هوية CAPI 93/94. بعد 1/11: 0/13 و0/13 |
| UTM | **ليس معطّلاً**: Meta تضيف الوسوم تلقائياً (`utm_content` = رقم الإعلان) | 10/13 طلبية بعد 1/11 تحمل UTM (80% قبلها). الحالات الثلاث: زيارتان مباشرتان بلا أي مصدر، وطلبية 363 حيث مُحي رقم الإعلان بإحالة عارية من m.facebook.com |
| وسوم غير معوَّضة | بعض مواضع الحملة القديمة أرسلت `{{ad.id}}` حرفياً | first touch لطلبية 356 |

## الإصلاح (فرع `claude/consent-tracking-preview`)

1. **نمط السؤال** `NEXT_PUBLIC_AD_CONSENT_PROMPT`:
   - `settings` (الافتراضي): لا شريط ولا نافذة. رابط «إعدادات الكوكيز» أسفل الموقع وفي /privacy يفتح الاختيار (موافق/رفض بنفس الوزن).
   - `banner`: الشريط السابق لمن لم يختر.
   - الجمع نفسه يبقى بيد `NEXT_PUBLIC_AD_CONSENT_ENABLED=on`. بدونه لا شيء يتغيّر عن اليوم.
2. **النسب**: إحالة عارية من نفس الشبكة لا تمحو إعلاناً موسوماً عمره أقل من 7 أيام. نقرة على إعلان آخر تأخذ مكانه دائماً. الوسوم غير المعوَّضة تُخزَّن كغياب.
3. **Purchase**: لا تغيير في المنطق. لكن الموافقة تصير مقروءة، فـ:
   - من **وافق**: Purchase بهوية كاملة (fbc/fbp/IP/UA) بدل البيانات الدنيا ⇒ مطابقة أفضل.
   - من **رفض صراحةً**: لا Purchase لطلبيته (`ad_consent = denied` يمنع المصلحة المشروعة — سلوك موجود منذ 1cc8f1c).
   - من لم يختر: كما اليوم (بيانات دنيا).

## قرار 2026-11-06: نمط «الرفض متاح» بلا شريط

`NEXT_PUBLIC_AD_TRACKING_OPT_OUT=on`: القياس يعمل لكل زائر لم يرفض صراحةً (كما قبل 31/10)،
والرفض من «إعدادات الكوكيز» أسفل الموقع نافذ في كل مسار. بوّابة واحدة `isAdTrackingAllowed()`.
القيمة المحفوظة `ad_consent` تبقى الاختيار الحقيقي. هوية الاستفسارات وسلال واتساب تبقى بالموافقة
الصريحة وحدها (قيدا `*_identity_needs_consent` في القاعدة) — بلا Migration.

## Purchase — كل القنوات (بلا تغيير في المنطق)

| القناة | action_source | متى | المطابقة |
|---|---|---|---|
| الموقع | website | عند أول حالة بيعة (confirmed/shipped/delivered) | ph, external_id, country + fbp/fbc/IP/UA لمن لم يرفض |
| واتساب | chat | عند التسجيل (يُنشأ مؤكَّداً) | ph, external_id, country + fbc إن رُبط باستفسار Q-/W- فيه fbclid |
| المحل / الهاتف / آخر | physical_store / phone_call / other | عند التسجيل | ph, external_id, country |

`event_id = purchase:<id>`، `event_time = confirmed_at`، القيمة = السطور المحجوزة بلا توصيل، MAD.
حجز ذرّي قبل الإرسال، تحرير وتسجيل السبب عند الفشل، سقف 5 محاولات، زرّ إعادة للمالك، ولا شيء أقدم من 7 أيام.

## النشر (بعد الموافقة الصريحة فقط)

1. دمج الفرع في فرع الإنتاج.
2. ضبط في الإنتاج: `NEXT_PUBLIC_AD_TRACKING_OPT_OUT=on` و`NEXT_PUBLIC_AD_CONSENT_PROMPT=settings`.
3. نشر Production، ثم التحقق: رابط «إعدادات الكوكيز» يظهر، لا شريط في نمط settings، الموافقة تُحمّل Pixel `2565914390520172` وتُطلق PageView، و/api/pixel-events يُرجع 200 بعد الموافقة و204 قبلها.
4. متابعة يدوية لـ 48 ساعة: LPV/VC/ATC/IC في Meta، نسبة `ad_consent_granted`، Purchase مقبولة بلا تكرار.

## التراجع

- **فوري، بلا تغيير كود**: حذف `NEXT_PUBLIC_AD_TRACKING_OPT_OUT` (و`NEXT_PUBLIC_AD_CONSENT_*`) من الإنتاج ثم إعادة النشر ⇒ عودة حرفية لسلوك اليوم.
- **كامل**: Instant Rollback إلى النشر السابق (`dpl_aueoAy6knnPpdWiwAwPWeZ1cd7wG`).
- لا Migration ولا تغيير في قاعدة البيانات في هذا الإصلاح.
