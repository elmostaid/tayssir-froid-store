import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BulkReviewPanel, type ReviewItem } from "@/components/admin/BulkReviewPanel";

// vitest لا يُفعِّل تنظيف RTL تلقائياً في هذا المشروع، فبدونه تتراكم
// نتائج التصيير بين الاختبارات ويصبح كل استعلام يجد عناصر مكرَّرة.
afterEach(cleanup);

function item(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    clientId: crypto.randomUUID(),
    finalName: "قفل باب مكينة الصابون الأوتوماتيكية - موديل 01",
    isAutoName: true,
    purchasePrice: "50",
    salePrice: "90",
    stock: "500",
    minOrderQty: "1",
    imagePreviewUrl: null,
    imageCount: 1,
    problems: [],
    ...overrides,
  };
}

describe("BulkReviewPanel — شاشة المراجعة قبل الحفظ", () => {
  test("تعرض الاسم النهائي والأثمنة والمخزون وأقل عدد والتصنيف", () => {
    render(
      <BulkReviewPanel
        items={[item()]}
        plan={{ firstSku: "TF-AWM-029", description: "قطعة غيار مخصصة للاستبدال." }}
        categoryLabel="أقفال أبواب"
        onBack={() => {}}
        onConfirm={() => {}}
        isSaving={false}
      />
    );
    expect(
      screen.getByText("قفل باب مكينة الصابون الأوتوماتيكية - موديل 01")
    ).toBeTruthy();
    expect(screen.getByText(/أقفال أبواب/)).toBeTruthy();
    expect(screen.getByText(/TF-AWM-029/)).toBeTruthy();
    expect(screen.getByText(/شراء: 50/)).toBeTruthy();
    expect(screen.getByText(/المخزون: 500/)).toBeTruthy();
    // الاسم المولَّد يُوسَم بوضوح حتى يعرف صاحب المتجر أنه لم يكتبه بنفسه.
    expect(screen.getByText("اسم تلقائي")).toBeTruthy();
  });

  test("منتج فيه مشكلة يظهر بسببه ولا يُخفى، والعدّاد يستثنيه", () => {
    render(
      <BulkReviewPanel
        items={[
          item({ finalName: "منتج سليم", problems: [] }),
          item({ finalName: "منتج ناقص", problems: ["ثمن البيع ناقص أو غير صالح."] }),
        ]}
        plan={null}
        categoryLabel="أقفال أبواب"
        onBack={() => {}}
        onConfirm={() => {}}
        isSaving={false}
      />
    );
    // السبب مكتوب صراحةً، والمنتج نفسه ما زال ظاهراً.
    expect(screen.getByText(/ثمن البيع ناقص أو غير صالح/)).toBeTruthy();
    expect(screen.getByText("منتج ناقص")).toBeTruthy();
    expect(screen.getByText(/1 فيه مشكلة/)).toBeTruthy();
    // زر الحفظ يذكر عدد الجاهزين فقط (واحد من اثنين).
    expect(screen.getByRole("button", { name: /إضافة المجموعة كاملة \(1\)/ })).toBeTruthy();
  });

  test("لا شيء جاهز: زر الإضافة معطَّل", () => {
    render(
      <BulkReviewPanel
        items={[item({ problems: ["ثمن البيع ناقص أو غير صالح."] })]}
        plan={null}
        categoryLabel="أقفال أبواب"
        onBack={() => {}}
        onConfirm={() => {}}
        isSaving={false}
      />
    );
    const button = screen.getByRole("button", { name: /إضافة المجموعة كاملة/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  test("زر الرجوع للتعديل يستدعي onBack", () => {
    const onBack = vi.fn();
    render(
      <BulkReviewPanel
        items={[item()]}
        plan={null}
        categoryLabel="أقفال أبواب"
        onBack={onBack}
        onConfirm={() => {}}
        isSaving={false}
      />
    );
    screen.getByRole("button", { name: "رجوع للتعديل" }).click();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
