"use client";

import { useActionState } from "react";
import { updateSettings, type SettingsActionState } from "@/app/admin/(protected)/settings/actions";
import type { StoreSettings } from "@/lib/queries/settings";

const initialState: SettingsActionState = { error: null };

export function SettingsForm({ settings }: { settings: StoreSettings }) {
  const [state, formAction, isPending] = useActionState(updateSettings, initialState);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          الحد الأدنى لقيمة الطلب (درهم)
        </span>
        <input
          name="minOrderAmountMad"
          type="number"
          min={0}
          step="1"
          defaultValue={settings.minOrderAmountMad}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          مصاريف التوصيل الافتراضية (درهم لكل كرطونة)
        </span>
        <input
          name="deliveryFeePerCartonMad"
          type="number"
          min={0}
          step="1"
          defaultValue={settings.deliveryFeePerCartonMad}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">رقم واتساب المتجر</span>
        <input
          name="whatsappNumber"
          type="tel"
          dir="ltr"
          placeholder="0612345678"
          defaultValue={settings.whatsappNumber}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          هذا هو الرقم الذي تصل إليه فعلياً كل روابط واتساب فالموقع (الترويسة،
          التذييل، الصفحة الرئيسية، صفحة المنتج، إتمام الطلب).
        </span>
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">مدينة المتجر</span>
        <input
          name="storeCity"
          defaultValue={settings.storeCity}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">اسم المتجر</span>
        <input
          name="storeName"
          defaultValue={settings.storeName}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          يظهر داخل رسائل واتساب فقط (رسالة إتمام الطلب، رسالة الإدارة
          للزبون). لا يغيّر الشعار أو عنوان الموقع (SEO) — ذاك تعديل منفصل
          خارج نطاق هذه الصفحة.
        </span>
      </label>

      <label className="text-sm">
        <span className="mb-1 block font-medium text-neutral-700">
          قالب رسالة واتساب المرتبطة بالطلب (من الإدارة إلى الزبون)
        </span>
        <textarea
          name="whatsappOrderMessageTemplate"
          rows={2}
          defaultValue={settings.whatsappOrderMessageTemplate}
          required
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base focus:border-brand-turquoise focus:outline-none"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          يُستعمل زر &quot;واتساب الزبون&quot; فصفحة تفاصيل الطلب فقط. اكتب{" "}
          <code dir="ltr" className="rounded bg-neutral-100 px-1">
            {"{orderNumber}"}
          </code>{" "}
          و
          <code dir="ltr" className="rounded bg-neutral-100 px-1">
            {"{storeName}"}
          </code>{" "}
          فأي مكان تريد استبدالهما فيه تلقائياً.
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          // React 19 يُعيد ضبط عناصر النموذج غير المُتحكَّم بها (uncontrolled)
          // إلى defaultChecked/defaultValue تلقائياً بعد نجاح أي form action —
          // لكن القيمة التي يُعاد الضبط إليها هي defaultChecked الحالية
          // للعنصر المُثبَّت أصلاً فالـDOM (وقت آخر mount)، وليست القيمة
          // الطازجة القادمة من الخادم بعد الحفظ. بدون key هنا، checkbox كان
          // يرجع مرئياً لحالته الأولى وقت تحميل الصفحة (defaultChecked
          // القديمة) رغم أن الحفظ الفعلي فقاعدة البيانات كان يتم بشكل صحيح —
          // كان يبدو وكأن التعطيل "لا يُحفَظ" رغم أنه محفوظ فعلاً. تغيير
          // key مع تغيّر settings.codEnabled الحقيقي يجبر React على إعادة
          // mount العنصر بـdefaultChecked الطازج فعلياً فكل مرة يختلف فيها
          // عن آخر قيمة مرئية (يضمن هذا تصحيحاً حتمياً بغض النظر عن تفاصيل
          // دقيقة فسلوك "dirty checkedness flag" الخاص بالمتصفح، بدل
          // الاعتماد عليها).
          key={settings.codEnabled ? "cod-enabled-on" : "cod-enabled-off"}
          name="codEnabled"
          type="checkbox"
          defaultChecked={settings.codEnabled}
          className="h-5 w-5 rounded border-neutral-300"
        />
        <span className="font-medium text-neutral-700">استقبال طلبات جديدة مفعَّل</span>
      </label>
      <p className="-mt-2 text-xs text-neutral-500">
        الدفع عند الاستلام هو الطريقة الوحيدة المتوفرة حالياً فهذا الموقع —
        تعطيل هذا الخيار يوقف استقبال أي طلب جديد مؤقتاً (زر الإرسال فصفحة
        إتمام الطلب يُعطَّل فوراً للزبون)، وليس تفعيل طريقة دفع بديلة.
      </p>

      <button
        type="submit"
        disabled={isPending}
        className="mt-2 self-start rounded-lg bg-brand-orange px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
      </button>

      {state.error && (
        <p className="text-sm font-semibold text-red-600">{state.error}</p>
      )}
      {state.success && !state.error && (
        <p className="text-sm font-semibold text-green-700">تم الحفظ بنجاح ✓</p>
      )}
    </form>
  );
}
