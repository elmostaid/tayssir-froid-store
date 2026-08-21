import { beforeEach, describe, expect, test, vi } from "vitest";
import { PENDING_ADDS_KEY, type PendingAdd } from "@/lib/cart/earlyAdd";

const sendMock = vi.fn<(events: unknown[]) => Promise<boolean>>();
vi.mock("@/lib/analytics/track", () => ({
  sendAnalyticsEventsNow: (events: unknown[]) => sendMock(events),
}));

const { flushPendingEarlyAdds, __resetPendingFlushForTests } = await import(
  "@/lib/cart/pendingAdds"
);

/**
 * الهدف المطلوب حرفياً: ضغطة واحدة = إضافة واحدة في السلة = حدث داخلي
 * واحد بالضبط، حتى مع تحديث الصفحة والتنقّل وانقطاع الشبكة.
 */

let counter = 0;
const add = (over: Partial<PendingAdd> = {}): PendingAdd => ({
  id: `id-${++counter}`,
  productId: 7,
  sku: "TF-CP-001",
  quantity: 5,
  cartValue: 600,
  at: Date.now(),
  ...over,
});

const queue = (): PendingAdd[] => JSON.parse(localStorage.getItem(PENDING_ADDS_KEY) ?? "[]");
const seed = (items: PendingAdd[]) =>
  localStorage.setItem(PENDING_ADDS_KEY, JSON.stringify(items));

beforeEach(() => {
  localStorage.clear();
  sendMock.mockReset();
  __resetPendingFlushForTests();
});

describe("تفريغ الإضافات المبكّرة — مرة واحدة، لا تضيع ولا تتكرّر", () => {
  test("وصل الحدث: يُمحى من الطابور فلا يُرسَل ثانيةً بعد تحديث الصفحة", async () => {
    seed([add()]);
    sendMock.mockResolvedValue(true);

    await flushPendingEarlyAdds();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(queue()).toEqual([]);

    // "تحديث الصفحة": تفريغ ثانٍ على نفس التخزين
    await flushPendingEarlyAdds();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  test("الشبكة مقطوعة: يبقى في الطابور، ويصل مرة واحدة عند عودة الاتصال", async () => {
    seed([add()]);
    sendMock.mockResolvedValue(false);

    await flushPendingEarlyAdds();
    expect(queue()).toHaveLength(1);

    __resetPendingFlushForTests();
    sendMock.mockResolvedValue(true);
    await flushPendingEarlyAdds();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(queue()).toEqual([]);
  });

  test("الخادم رفض ثم قبل: الحدث نفسه لا يتضاعف — مُرسَل مرة واحدة فقط في المجموع", async () => {
    const one = add();
    seed([one]);
    sendMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await flushPendingEarlyAdds();
    __resetPendingFlushForTests();
    await flushPendingEarlyAdds();
    __resetPendingFlushForTests();
    await flushPendingEarlyAdds();

    const sentIds = sendMock.mock.calls.flatMap((c) =>
      (c[0] as Array<{ sku: string }>).map((e) => e.sku)
    );
    expect(sentIds).toHaveLength(2); // محاولتان فقط: فاشلة ثم ناجحة
    expect(queue()).toEqual([]);
    expect(one.id).toBeDefined();
  });

  test("ضغطة جديدة وصلت أثناء الإرسال لا تُمحى مع ما أُكِّد وصوله", async () => {
    const first = add();
    seed([first]);
    sendMock.mockImplementation(async () => {
      // السكريبت المبكّر يضيف ضغطة بينما الطلب في الطريق
      seed([...queue(), add({ sku: "TF-CP-999" })]);
      return true;
    });

    await flushPendingEarlyAdds();

    expect(queue()).toHaveLength(1);
    expect(queue()[0].sku).toBe("TF-CP-999");
  });

  test("ما شاخ أكثر من عمر الجلسة يُسقَط بدل أن يُنسَب إلى جلسة أخرى", async () => {
    seed([add({ at: Date.now() - 45 * 60_000 })]);
    sendMock.mockResolvedValue(true);

    await flushPendingEarlyAdds();

    expect(sendMock).not.toHaveBeenCalled();
    expect(queue()).toEqual([]);
  });

  test("طابور فارغ لا يُنتج أي طلب", async () => {
    await flushPendingEarlyAdds();
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("تفريغان متزامنان لا يُرسلان الحدث مرتين", async () => {
    seed([add()]);
    let resolveSend: (v: boolean) => void = () => {};
    sendMock.mockImplementation(() => new Promise<boolean>((r) => (resolveSend = r)));

    const a = flushPendingEarlyAdds();
    const b = flushPendingEarlyAdds();
    resolveSend(true);
    await Promise.all([a, b]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(queue()).toEqual([]);
  });

  test("تخزين تالف لا يرمي ولا يُرسل شيئاً", async () => {
    localStorage.setItem(PENDING_ADDS_KEY, "{ليس JSON");
    await expect(flushPendingEarlyAdds()).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
