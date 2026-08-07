"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";

export type SettingsActionState = { error: string | null; success?: boolean };

// نفس جدول settings الموجود أصلاً (key/value jsonb) — لا نُنشئ نظاماً
// موازياً. كل الحقول تُحدَّث فمعاملة واحدة (transaction) حتى لا يبقى
// المتجر بحالة إعدادات نصف محدَّثة إذا فشل أحد المفاتيح لأي سبب.
export async function updateSettings(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) return { error: "هذا الإجراء مقصور على صاحب الحساب (Admin)." };

  const minOrderAmountMad = Number(formData.get("minOrderAmountMad"));
  const deliveryFeePerCartonMad = Number(formData.get("deliveryFeePerCartonMad"));
  const whatsappNumber = String(formData.get("whatsappNumber") ?? "").trim();
  const storeCity = String(formData.get("storeCity") ?? "").trim();
  const storeName = String(formData.get("storeName") ?? "").trim();
  const whatsappOrderMessageTemplate = String(
    formData.get("whatsappOrderMessageTemplate") ?? ""
  ).trim();
  const codEnabled = formData.get("codEnabled") === "on";

  if (!Number.isFinite(minOrderAmountMad) || minOrderAmountMad < 0) {
    return { error: "الحد الأدنى لقيمة الطلب غير صالح." };
  }
  if (!Number.isFinite(deliveryFeePerCartonMad) || deliveryFeePerCartonMad < 0) {
    return { error: "مصاريف التوصيل الافتراضية غير صالحة." };
  }
  if (!/^(?:\+212|0)[5-7]\d{8}$/.test(whatsappNumber.replace(/[\s-]/g, ""))) {
    return { error: "رقم واتساب المتجر غير صحيح. يجب أن يكون رقماً مغربياً صالحاً." };
  }
  if (!storeCity) return { error: "مدينة المتجر إجبارية." };
  if (!storeName) return { error: "اسم المتجر إجباري." };
  if (!whatsappOrderMessageTemplate) return { error: "قالب رسالة واتساب إجباري." };

  await sql.begin(async (trx) => {
    await trx`
      update public.settings set value = to_jsonb(${minOrderAmountMad}::numeric)
      where key = 'min_order_amount_mad'
    `;
    await trx`
      update public.settings set value = to_jsonb(${deliveryFeePerCartonMad}::numeric)
      where key = 'delivery_fee_per_carton_mad'
    `;
    await trx`
      update public.settings set value = to_jsonb(${whatsappNumber}::text)
      where key = 'whatsapp_number'
    `;
    await trx`
      update public.settings set value = to_jsonb(${storeCity}::text)
      where key = 'store_city'
    `;
    await trx`
      update public.settings set value = to_jsonb(${storeName}::text)
      where key = 'store_name'
    `;
    await trx`
      update public.settings set value = to_jsonb(${whatsappOrderMessageTemplate}::text)
      where key = 'whatsapp_order_message_template'
    `;
    await trx`
      update public.settings set value = to_jsonb(${codEnabled}::boolean)
      where key = 'cod_enabled'
    `;
  });

  // كل الصفحات العامة التي تقرأ getSettings() تُبنى ديناميكياً عند كل طلب
  // (force-dynamic) أصلاً، فلا حاجة لـrevalidatePath لتحديثها — لكن نُنعشها
  // بأي حال حتى لا يبقى أي cache وسيط (مثل fetch cache افتراضي) قديماً.
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");

  return { error: null, success: true };
}
