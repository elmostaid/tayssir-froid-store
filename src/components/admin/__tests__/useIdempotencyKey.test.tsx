import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useIdempotencyKey } from "@/components/admin/useIdempotencyKey";
import { manualOrderStorageKey } from "@/lib/orders/manualOrderKey";

/**
 * السلوكات الأربعة التي طلبها صاحب المتجر بالاسم: **الزرّ الخلفي**،
 * **تحديث الصفحة**، **الضغط المزدوج**، و**انقطاع الاتصال بعد COMMIT**.
 *
 * ما يُحاكَى هنا هو المتصفّح: `sessionStorage` حقيقي (jsdom)، و«إعادة
 * التحميل» = تفكيك المكوّن وتركيبه من جديد، و«الزرّ الخلفي» = تركيب جديد
 * والخادم يقول إن المفتاح استُهلك. أمّا الحرس نفسه فمُختبَر على Postgres
 * حقيقي في lib/orders/__tests__/manualOrderIdempotency.test.ts.
 */

function Probe({ isSpent }: { isSpent: (k: string) => Promise<boolean> }) {
  const { key, spent, startNew } = useIdempotencyKey(isSpent);
  return (
    <div>
      <span data-testid="key">{key ?? "—"}</span>
      <span data-testid="spent">{spent ? "spent" : "fresh"}</span>
      <button type="button" onClick={startNew}>
        ابدأ طلبية جديدة
      </button>
    </div>
  );
}

const storageKey = manualOrderStorageKey();
const readKey = () => screen.getByTestId("key").textContent;
const readSpent = () => screen.getByTestId("spent").textContent;

const never = () => new Promise<boolean>(() => {}); // سؤال لا يُجاب أبداً
const notSpent = async () => false;
const isSpentTrue = async () => true;

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("مفتاح التفرّد في المتصفّح", () => {
  test("يُولَّد قبل أول حفظ ويُخزَّن", async () => {
    render(<Probe isSpent={notSpent} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));
    expect(sessionStorage.getItem(storageKey)).toBe(readKey());
  });

  test("تحديث الصفحة أثناء نتيجة مجهولة يُرسل **نفس** المفتاح", async () => {
    const { unmount } = render(<Probe isSpent={never} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));
    const first = readKey();

    unmount(); // F5 بينما الخادم لم يُجب بعد
    render(<Probe isSpent={never} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));

    expect(readKey()).toBe(first);
  });

  test("الضغط المزدوج: نفس المفتاح في التصييرين", async () => {
    const { rerender } = render(<Probe isSpent={notSpent} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));
    const first = readKey();
    rerender(<Probe isSpent={notSpent} />);
    expect(readKey()).toBe(first);
    expect(sessionStorage.getItem(storageKey)).toBe(first);
  });

  test("انقطاع بعد COMMIT ثم إعادة المحاولة: المفتاح لم يتبدّل", async () => {
    // الطلبية نجحت في القاعدة، والعميل لم يرَ النتيجة. السؤال لا يُجاب
    // (الاتصال مقطوع)، فيجب أن يبقى المفتاح والإرسال متاحاً.
    const { unmount } = render(<Probe isSpent={() => Promise.reject(new Error("الاتصال مقطوع"))} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));
    const before = readKey();
    unmount();
    render(<Probe isSpent={() => Promise.reject(new Error("الاتصال مقطوع"))} />);
    await waitFor(() => expect(readKey()).not.toBe("—"));
    expect(readKey()).toBe(before);
    // وفشل السؤال لا يُعطّل الحفظ: الحرس الحقيقي في الفهرس الفريد.
    expect(readSpent()).toBe("fresh");
  });

  test("🔴 الثغرة المُصلَحة — الزرّ الخلفي: المفتاح المستعمل **لا يُدوَّر**", async () => {
    sessionStorage.setItem(storageKey, "key-of-a-saved-order-0001");
    render(<Probe isSpent={isSpentTrue} />);
    await waitFor(() => expect(readSpent()).toBe("spent"));

    // القاعدة 3: الطلبية المحفوظة تبقى مرتبطة بمفتاحها.
    expect(readKey()).toBe("key-of-a-saved-order-0001");
    expect(sessionStorage.getItem(storageKey)).toBe("key-of-a-saved-order-0001");
  });

  test("ولا يُولَّد مفتاح جديد إلا بفعل صريح", async () => {
    sessionStorage.setItem(storageKey, "key-of-a-saved-order-0002");
    render(<Probe isSpent={isSpentTrue} />);
    await waitFor(() => expect(readSpent()).toBe("spent"));

    await act(async () => {
      screen.getByRole("button", { name: "ابدأ طلبية جديدة" }).click();
    });

    expect(readKey()).not.toBe("key-of-a-saved-order-0002");
    expect(readSpent()).toBe("fresh");
    expect(sessionStorage.getItem(storageKey)).toBe(readKey());
  });

  test("تخزين معطّل (نافذة خاصة) لا يُسقط المكوّن", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("تخزين معطّل");
    });
    const spy2 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("تخزين معطّل");
    });
    try {
      render(<Probe isSpent={notSpent} />);
      await waitFor(() => expect(readKey()).not.toBe("—"));
      // مفتاح في الذاكرة: يحمي من الضغط المزدوج، لا من إعادة التحميل.
      expect(readKey()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    } finally {
      spy.mockRestore();
      spy2.mockRestore();
    }
  });
});
