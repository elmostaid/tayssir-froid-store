-- استبدال الصور الأساسية لـ16 منتجاً موجوداً مسبقاً بصور جديدة أوضح (حزمة
-- الاستبدال الثانية من العميل، 18 صورة، 3 منها لم تُطابَق بثقة كافية
-- فاستُبعدت وتُركت الصورة القديمة كما هي بانتظار تأكيد). لا تغيير على
-- الاسم أو الثمن أو التصنيف أو SKU أو الوصف — تحديث storage_path
-- وalt_text_ar للصورة الرئيسية (is_primary) فقط لكل منتج.

update public.product_images pi set
  storage_path = 'product-images/shared/three-metal-coupling-heads.png',
  alt_text_ar = 'صورة راكور إكرو نحاس وماملو خاوي نحاس'
from public.products p
where pi.product_id = p.id and pi.is_primary
  and p.sku in ('TF-RF-002', 'TF-RF-003');

update public.product_images pi set
  storage_path = 'product-images/TF-WM-001/white-round-knob.png',
  alt_text_ar = 'صورة بوطون منتري ستاندار'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-001';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-003/black-timer-multicolor-wires.png',
  alt_text_ar = 'صورة منتري صابون 6 خيوط'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-003';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-004/black-rubber-bellows.png',
  alt_text_ar = 'صورة جلدة نشاف بريسيستوب'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-004';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-005/motor-type-a-label.png',
  alt_text_ar = 'صورة موطور صابون 150 واط'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-005';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-006/v-belts.png',
  alt_text_ar = 'صورة كروة الغسالة'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-006';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-007/black-timer-three-wires.png',
  alt_text_ar = 'صورة منتري صابون 3 خيوط'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-007';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-008/white-corrugated-hoses.png',
  alt_text_ar = 'صورة تيو الماء'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-008';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-009/motor-type-b-round-gold.png',
  alt_text_ar = 'صورة موطور نشاف 70 واط'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-009';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-010/metal-bearing-hub.png',
  alt_text_ar = 'صورة بولي موطور نشاف'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-010';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-011/countersunk-screws.png',
  alt_text_ar = 'صورة فيس فراكة'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-011';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-014/long-coil-spring.png',
  alt_text_ar = 'صورة روسول جلدة الماء'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-014';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-015/small-white-timer-two-wires.png',
  alt_text_ar = 'صورة منتري نشاف بخيطين'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-015';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-016/large-grey-pulley.png',
  alt_text_ar = 'صورة بولي موطور الصابون'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-016';

update public.product_images pi set
  storage_path = 'product-images/TF-WM-017/capacitor-12-5uf.png',
  alt_text_ar = 'صورة كوندنساتور 12/5 µF'
from public.products p
where pi.product_id = p.id and pi.is_primary and p.sku = 'TF-WM-017';
