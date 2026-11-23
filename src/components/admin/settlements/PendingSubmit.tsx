"use client";

import { useFormStatus } from "react-dom";

/**
 * زرّ إرسال يتعطّل أثناء المعالجة — ضغطتان متتاليتان على «طبّق» من الهاتف لا
 * ترسلان طلبين (والقفل في القاعدة يحمي على أي حال؛ هذا للوضوح فقط).
 */
export function PendingSubmit({
  children,
  pendingText,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText: string;
  className: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}
