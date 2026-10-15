"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isValidIdempotencyKey,
  manualOrderStorageKey,
  newIdempotencyKey,
} from "@/lib/orders/manualOrderKey";

/**
 * يملك مفتاح تفرّد الطلبية ويضمن عنه القواعد الأربع:
 *
 * 1. **يُولَّد قبل أول محاولة حفظ** — عند أول تصيير، لا عند الإرسال، فلحظة
 *    الإرسال قد تتكرّر.
 * 2. **يبقى ثابتاً ما دامت النتيجة مجهولة** — المصدر `sessionStorage` لا
 *    حالة React، فإعادة التحميل (F5 بعد شاشة معلّقة) تُرسل نفس المفتاح.
 * 3. **الطلبية المحفوظة تبقى مرتبطة بمفتاحها** — لا يُدوَّر أبداً تلقائياً.
 * 4. **ولا يُولَّد مفتاح جديد إلا ببدء طلبية جديدة مستقلة** — بفعل صريح من
 *    المدير عبر `startNew()`.
 *
 * ## الثغرة التي أغلقتها القاعدتان 3 و4
 *
 * كان المفتاح يُدوَّر تلقائياً عند التركيب إن تبيّن أنه مستعمل. ومسار
 * الزرّ الخلفي يُبطل ذلك: المدير يحفظ طلبية بنجاح، يرجع بالزرّ الخلفي،
 * **فيستعيد المتصفّح حقول النموذج القديمة** (سلوك عادي لحقول غير
 * مُتحكَّم فيها) — فيجتمع **محتوى قديم** مع **مفتاح جديد** = طلبية ثانية
 * حقيقية بكل سطورها وخصم مخزونها. التدوير التلقائي كان هو الثغرة، لا
 * الحلّ.
 *
 * فالآن: إن كان المفتاح مستعملاً نُعلن `spent: true` **ولا نُدوّر**.
 * والنموذج يُعطّل الإرسال ويطلب من المدير فعلاً صريحاً: «ابدأ طلبية
 * جديدة»، وهو وحده ما يُولّد مفتاحاً جديداً ويُفرّغ الحقول معاً. فلا
 * يمكن لحقول مُستعادة أن تُرسَل إطلاقاً.
 *
 * **الثمن**: نقرة واحدة إضافية بعد كل حفظ ناجح قبل إدخال الطلبية التالية.
 * ثمنٌ مقبول مقابل استحالة التكرار، وأصدق من تخمين «هل هذه حقول مُستعادة
 * أم نموذج جديد؟» — وهو تخمين لا يمكن إجراؤه بثقة.
 *
 * ## وحين يتعذّر السؤال
 *
 * فشل `isSpent` (قاعدة البيانات متعذّرة — وهي الحالة التي نعمل فيها
 * أصلاً) يُبقي `spent: false`: الإرسال يبقى متاحاً، والمفتاح كما هو، فإعادة
 * المحاولة تبقى محروسة بالفهرس الفريد في القاعدة. الحرس الحقيقي هناك لا
 * هنا؛ هذا السؤال تحسينٌ لما يراه المدير فقط.
 */
export type IdempotencyKeyState = {
  /** `null` حتى تُقرأ القيمة من التخزين (لا وجود له على الخادم). */
  key: string | null;
  /** هل أُنشئت طلبية بهذا المفتاح فعلاً؟ */
  spent: boolean;
  /** يبدأ طلبية جديدة مستقلة: مفتاح جديد. */
  startNew: () => void;
};

export function useIdempotencyKey(
  isSpent: (key: string) => Promise<boolean>,
  leadId?: number
): IdempotencyKeyState {
  const storageKey = manualOrderStorageKey(leadId);
  const [key, setKey] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);

  const write = useCallback(
    (value: string) => {
      try {
        sessionStorage.setItem(storageKey, value);
      } catch {
        // نافذة خاصة أو تخزين معطّل: المفتاح يبقى في الذاكرة وحدها —
        // يحمي من الضغط المزدوج لا من إعادة التحميل. ولا ندّعي غير ذلك.
      }
    },
    [storageKey]
  );

  const startNew = useCallback(() => {
    const fresh = newIdempotencyKey();
    write(fresh);
    setKey(fresh);
    setSpent(false);
  }, [write]);

  useEffect(() => {
    let cancelled = false;

    let stored: string | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      stored = isValidIdempotencyKey(raw) ? raw : null;
    } catch {
      stored = null;
    }

    if (!stored) {
      // لا مفتاح محفوظ = نموذج جديد فعلاً. وهذه هي الحالة الوحيدة التي
      // يُولَّد فيها مفتاح بلا فعل صريح من المدير.
      const fresh = newIdempotencyKey();
      write(fresh);
      setKey(fresh);
      return;
    }

    setKey(stored);
    isSpent(stored)
      .then((used) => {
        if (!cancelled) setSpent(used);
      })
      .catch(() => {
        /* الإبقاء على spent=false هو الاتجاه الآمن — انظر أعلاه. */
      });

    return () => {
      cancelled = true;
    };
  }, [storageKey, isSpent, write]);

  return { key, spent, startNew };
}
