"use client";

import { useEffect, useState } from "react";
import {
  isValidIdempotencyKey,
  manualOrderStorageKey,
  newIdempotencyKey,
} from "@/lib/orders/manualOrderKey";

/**
 * يملك مفتاح تفرّد الطلبية ويضمن عنه ثلاث خصائص — كلّ واحدة منها مطلوبة
 * لمنع طلبية مكرّرة، ولا تكفي وحدها:
 *
 * 1. **يُولَّد قبل أول محاولة حفظ.** عند أول تصيير، لا عند الإرسال — فلحظة
 *    الإرسال قد تتكرّر.
 * 2. **يبقى ثابتاً حتى تُعرَف النتيجة.** إعادة التصيير، الضغط المزدوج،
 *    وإعادة تحميل الصفحة (F5 بعد شاشة معلّقة) كلها تُعيد **نفس** المفتاح،
 *    لأن المصدر `sessionStorage` لا حالة React.
 * 3. **يُستبدَل بعد النجاح.** الطلبية التالية تحتاج مفتاحاً جديداً، وإلا
 *    اصطدمت بالفهرس الفريد فأُعيدت الطلبية السابقة بدلها.
 *
 * ## كيف يُعرَف أن المفتاح «استُهلك»
 *
 * الإجراء ينجح بـ`redirect()` إلى صفحة الطلبية، فالمكوّن يُفكَّك ولا يرى
 * النجاح أبداً — فلا يمكن تنظيفه من هنا عند النجاح. ولا يصحّ تنظيفه عند
 * الإرسال (ذاك يُبطل الخصلة 2 وهو أخطر ما يمكن فعله هنا).
 *
 * فالخادم هو من يُحكم: عند فتح النموذج نسأل مرّة واحدة «هل هذا المفتاح
 * مستعمل؟» — استعلام واحد على عمود فريد مفهرس. إن كان مستعملاً فالطلبية
 * السابقة نجحت، فنُدوّر المفتاح. وهذا يُشافي **كل** المسارات بلا استثناء:
 * النجاح ثم الرجوع بالزر الخلفي، إغلاق التبويب وفتحه، أو انهيار المتصفّح
 * في منتصف الحفظ.
 *
 * وعند فشل السؤال (قاعدة البيانات متعذّرة — وهي الحالة التي نعمل فيها
 * أصلاً) **نُبقي المفتاح كما هو**. هذا هو الاتجاه الآمن: الإبقاء يعني أن
 * إعادة المحاولة تبقى محروسة؛ والتدوير عند الشكّ كان سيُنتج طلبية ثانية.
 */
export function useIdempotencyKey(
  /** يسأل الخادم: هل أُنشئت طلبية بهذا المفتاح؟ */
  isSpent: (key: string) => Promise<boolean>,
  leadId?: number
): string | null {
  const storageKey = manualOrderStorageKey(leadId);

  // `null` حتى يُقرأ التخزين: التصيير على الخادم لا يملك sessionStorage،
  // وتوليد مفتاح هناك كان سيُنتج قيمة تختلف عن قيمة المتصفّح (عدم تطابق
  // الترطيب)، وأسوأ: مفتاحاً جديداً مع كل تصيير للخادم.
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const read = (): string | null => {
      try {
        const stored = sessionStorage.getItem(storageKey);
        return isValidIdempotencyKey(stored) ? stored : null;
      } catch {
        // نافذة خاصة، أو تخزين معطّل. المفتاح يبقى في الذاكرة وحدها:
        // يحمي من الضغط المزدوج، ولا يحمي من إعادة التحميل. وهذا أفضل
        // ما يمكن فعله بلا تخزين، ولا ندّعي غيره.
        return null;
      }
    };

    const write = (value: string) => {
      try {
        sessionStorage.setItem(storageKey, value);
      } catch {
        /* كما أعلاه */
      }
    };

    const existing = read();
    if (!existing) {
      const fresh = newIdempotencyKey();
      write(fresh);
      setKey(fresh);
      return;
    }

    // مفتاح موجود: نعرضه فوراً (فإعادة التحميل أثناء حفظٍ مجهول النتيجة
    // تُرسل نفس المفتاح حتى لو لم يصل جواب الخادم بعد)، ثم نُدوّره إن
    // تبيّن أنه استُهلك.
    setKey(existing);
    isSpent(existing)
      .then((spent) => {
        if (cancelled || !spent) return;
        const fresh = newIdempotencyKey();
        write(fresh);
        setKey(fresh);
      })
      .catch(() => {
        /* الإبقاء هو الاتجاه الآمن — انظر التعليق أعلى الدالّة. */
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey, isSpent]);

  return key;
}
