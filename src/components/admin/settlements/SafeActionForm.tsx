"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";

/**
 * نموذج لإجراء خادم لا يُسقط الصفحة إن انقطع الاتصال.
 *
 * نفس درس صفحة الطلب اليدوي (ac0f070): إجراء الخادم يرمي **في المتصفح**
 * حين ينقطع الإنترنت أو يجيب الخادم بخطأ، والرمي يصعد إلى حدّ الخطأ فتظهر
 * «This page couldn't load». هنا يصير رسالة تحت الزرّ.
 *
 * الإعادة آمنة في كل إجراءات التسويات: «طبّق» يعيد الحساب داخل المعاملة
 * فما سبق تطبيقه لا يُطبَّق ثانية، و«تراجع» يرفض فاتورة متراجَعاً عنها،
 * و«البنك» يكتب نفس القيمة. ونجاح الإجراء (redirect) يمرّ كما هو.
 */
export function SafeActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={className}
      action={async (formData) => {
        setError(null);
        try {
          await action(formData);
        } catch (err) {
          unstable_rethrow(err);
          setError(
            "ما وصلش الطلب للخادم (الإنترنت ولا الخادم). ما تبدل والو بلا ما يتأكد — عاود الضغط، وما غاديش يتطبق جوج مرات."
          );
        }
      }}
    >
      {children}
      {error && (
        <p role="alert" className="mt-2 w-full rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
