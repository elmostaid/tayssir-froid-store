import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sql } from "@/lib/db";
import {
  createExpense,
  deleteExpense,
  getExpensesTotal,
  listExpenses,
  updateExpense,
  validateExpense,
  type ExpenseInput,
} from "@/lib/queries/adminExpenses";
import { resolveRange } from "@/lib/analytics/dateRange";

const ADMIN = "expenses-test@tayssir.local";

/** نحصر التنظيف في صفوف هذا الملف وحده — قاعدة الاختبار مشتركة. */
async function cleanup() {
  await sql`delete from public.operating_expenses where created_by = ${ADMIN}`;
}

beforeEach(cleanup);
afterEach(cleanup);

const base = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  amountMad: 250,
  category: "advertising",
  description: "إعلان فيسبوك",
  spentOn: "2026-08-20",
  note: null,
  ...over,
});

describe("التحقق من المصروف", () => {
  test("المبلغ يجب أن يكون أكبر من صفر", () => {
    expect(validateExpense(base({ amountMad: 0 })).some((e) => e.field === "amount")).toBe(true);
    expect(validateExpense(base({ amountMad: -5 })).some((e) => e.field === "amount")).toBe(true);
    expect(validateExpense(base({ amountMad: Number.NaN })).some((e) => e.field === "amount")).toBe(
      true
    );
    expect(validateExpense(base({ amountMad: 0.5 }))).toHaveLength(0);
  });

  test("التصنيف خارج القائمة مرفوض", () => {
    const errors = validateExpense(base({ category: "bitcoin" as ExpenseInput["category"] }));
    expect(errors.some((e) => e.field === "category")).toBe(true);
  });

  test("البيان إجباري ولا يكفي أن يكون فراغات", () => {
    expect(validateExpense(base({ description: "" })).some((e) => e.field === "description")).toBe(
      true
    );
    expect(
      validateExpense(base({ description: "   " })).some((e) => e.field === "description")
    ).toBe(true);
  });

  test("التاريخ غير الصالح مرفوض", () => {
    expect(validateExpense(base({ spentOn: "20-08-2026" })).some((e) => e.field === "spentOn")).toBe(
      true
    );
    expect(validateExpense(base({ spentOn: "" })).some((e) => e.field === "spentOn")).toBe(true);
  });

  test("المصروف السليم يمرّ بلا أخطاء", () => {
    expect(validateExpense(base())).toHaveLength(0);
  });
});

describe("إنشاء وتعديل وحذف", () => {
  test("المصروف يُحفظ ويُقرأ كما أُدخل", async () => {
    const created = await createExpense(base({ amountMad: 1250.75, note: "  دفعة أولى  " }), ADMIN);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const rows = (await listExpenses()).filter((row) => row.createdBy === ADMIN);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountMad).toBe(1250.75);
    expect(rows[0].category).toBe("advertising");
    expect(rows[0].spentOn).toBe("2026-08-20");
    // الملاحظة تُقصّ من الفراغات، والبيان كذلك.
    expect(rows[0].note).toBe("دفعة أولى");
  });

  test("القاعدة نفسها ترفض التصنيف الخارج عن القائمة", async () => {
    // نتجاوز التحقق في الكود عمداً لنُثبت أن الحماية الأخيرة في القاعدة.
    await expect(
      sql`
        insert into public.operating_expenses (amount_mad, category, description, spent_on, created_by)
        values (100, 'crypto', 'اختبار', '2026-08-20', ${ADMIN})
      `
    ).rejects.toThrow();
  });

  test("القاعدة ترفض مبلغاً صفرياً أو سالباً", async () => {
    await expect(
      sql`
        insert into public.operating_expenses (amount_mad, category, description, spent_on, created_by)
        values (0, 'rent', 'اختبار', '2026-08-20', ${ADMIN})
      `
    ).rejects.toThrow();
  });

  test("التعديل يغيّر الصفّ نفسه بلا إنشاء صفّ ثانٍ", async () => {
    const created = await createExpense(base(), ADMIN);
    if (!created.ok) throw new Error("فشل الإنشاء");

    const result = await updateExpense(
      created.id,
      base({ amountMad: 400, category: "rent", description: "كراء غشت" })
    );
    expect(result.ok).toBe(true);

    const rows = (await listExpenses()).filter((row) => row.createdBy === ADMIN);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].amountMad).toBe(400);
    expect(rows[0].category).toBe("rent");
    expect(rows[0].description).toBe("كراء غشت");
  });

  test("تعديل مصروف غير موجود يُرجع خطأ لا استثناء", async () => {
    const result = await updateExpense(99_999_999, base());
    expect(result.ok).toBe(false);
  });

  test("الحذف يُزيل الصفّ، وحذفه ثانيةً يُرجع false", async () => {
    const created = await createExpense(base(), ADMIN);
    if (!created.ok) throw new Error("فشل الإنشاء");

    expect(await deleteExpense(created.id)).toBe(true);
    expect(await deleteExpense(created.id)).toBe(false);
    expect((await listExpenses()).filter((row) => row.createdBy === ADMIN)).toHaveLength(0);
  });
});

describe("المجاميع حسب المدى", () => {
  beforeEach(async () => {
    await createExpense(base({ amountMad: 100, category: "advertising", spentOn: "2026-08-10" }), ADMIN);
    await createExpense(base({ amountMad: 200, category: "rent", spentOn: "2026-08-20" }), ADMIN);
    await createExpense(base({ amountMad: 50, category: "advertising", spentOn: "2026-08-25" }), ADMIN);
    await createExpense(base({ amountMad: 999, category: "wages", spentOn: "2026-07-15" }), ADMIN);
  });

  test("المدى يشمل طرفيه", async () => {
    const total = await getExpensesTotal("2026-08-10", "2026-08-20");
    expect(total.totalMad).toBe(300);
    expect(total.count).toBe(2);
  });

  test("ما خارج المدى لا يُحتسَب", async () => {
    const total = await getExpensesTotal("2026-08-01", "2026-08-31");
    expect(total.totalMad).toBe(350);
    // مصروف يوليوز خارج الشهر فلا يدخل.
    expect(total.byCategory.some((row) => row.category === "wages")).toBe(false);
  });

  test("التجميع حسب التصنيف صحيح ومرتَّب بالأكبر", async () => {
    const total = await getExpensesTotal("2026-08-01", "2026-08-31");
    expect(total.byCategory[0]).toEqual({ category: "rent", totalMad: 200, count: 1 });
    const advertising = total.byCategory.find((row) => row.category === "advertising");
    expect(advertising).toEqual({ category: "advertising", totalMad: 150, count: 2 });
  });

  test("مدى بلا مصاريف يُرجع صفراً لا خطأ", async () => {
    const total = await getExpensesTotal("2026-01-01", "2026-01-31");
    expect(total.totalMad).toBe(0);
    expect(total.count).toBe(0);
    expect(total.byCategory).toEqual([]);
  });
});

describe("المدى المختار في التقرير يوافق المصاريف", () => {
  test("preset «الشهر الحالي» يبدأ من أول الشهر وينتهي اليوم", () => {
    const range = resolveRange("month", null, null, new Date("2026-08-25T12:00:00Z"));
    expect(range.preset).toBe("month");
    expect(range.fromDay).toBe("2026-08-01");
    expect(range.toDay).toBe("2026-08-25");
  });

  test("presets الأخرى لم تتغيّر", () => {
    const now = new Date("2026-08-25T12:00:00Z");
    expect(resolveRange("today", null, null, now).fromDay).toBe("2026-08-25");
    expect(resolveRange("yesterday", null, null, now).fromDay).toBe("2026-08-24");
    expect(resolveRange("7d", null, null, now).fromDay).toBe("2026-08-19");
    expect(resolveRange("30d", null, null, now).fromDay).toBe("2026-07-27");
  });

  test("مجموع مصاريف نفس مدى التقرير يُطابق ما يُطرَح من الربح الخام", async () => {
    await createExpense(base({ amountMad: 300, spentOn: "2026-08-25" }), ADMIN);
    const range = resolveRange("month", null, null, new Date("2026-08-25T12:00:00Z"));
    const total = await getExpensesTotal(range.fromDay, range.toDay);

    const grossProfit = 1000;
    expect(grossProfit - total.totalMad).toBe(700);
  });
});
