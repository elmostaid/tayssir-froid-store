import { sql } from "@/lib/db";
import { isExpenseCategory, type ExpenseCategory } from "@/lib/expenses/expenseCategories";

/**
 * مصاريف التشغيل: قراءة وكتابة.
 *
 * كل ما هنا مقصور على /admin (تتحقّق الصفحات والإجراءات من isOwnerAdmin قبل
 * الوصول إلى هذه الدوال) — المصاريف بيانات مالية داخلية لا تظهر لأي زبون.
 *
 * التاريخ: spent_on عمود date، والمدى يصل من dateRange كسلسلتَي "YYYY-MM-DD"
 * محليتين. المقارنة بينهما مباشرة بلا أي تحويل مناطق زمنية — وهذا بالضبط
 * سبب اختيار date بدل timestamptz: المصروف يقع في يوم، لا في لحظة.
 */

export type ExpenseRow = {
  id: number;
  amountMad: number;
  category: string;
  description: string;
  spentOn: string;
  note: string | null;
  createdBy: string | null;
};

export type ExpenseInput = {
  amountMad: number;
  category: ExpenseCategory;
  description: string;
  spentOn: string;
  note: string | null;
};

export type ExpenseFieldError = { field: string; message: string };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * تحقّق واحد يستعمله الإنشاء والتعديل معاً، فلا ينحرف أحدهما عن الآخر.
 * الحدود هنا مطابقة لقيود القاعدة عمداً: نُرجع رسالة عربية مفهومة بدل أن
 * ندع Postgres يرفض بخطأ إنجليزي لا يقرأه صاحب المتجر.
 */
export function validateExpense(input: ExpenseInput): ExpenseFieldError[] {
  const errors: ExpenseFieldError[] = [];

  if (!Number.isFinite(input.amountMad) || input.amountMad <= 0) {
    errors.push({ field: "amount", message: "المبلغ يجب أن يكون رقماً أكبر من صفر." });
  } else if (input.amountMad > 9_999_999) {
    errors.push({ field: "amount", message: "المبلغ كبير جداً — تأكّد من الرقم." });
  }

  if (!isExpenseCategory(input.category)) {
    errors.push({ field: "category", message: "اختر تصنيفاً من القائمة." });
  }

  const description = input.description.trim();
  if (description.length === 0) {
    errors.push({ field: "description", message: "البيان إجباري — اكتب سبب المصروف." });
  } else if (description.length > 200) {
    errors.push({ field: "description", message: "البيان طويل جداً (200 حرف كحد أقصى)." });
  }

  if (!YMD_RE.test(input.spentOn) || Number.isNaN(Date.parse(input.spentOn))) {
    errors.push({ field: "spentOn", message: "تاريخ المصروف غير صالح." });
  }

  if (input.note !== null && input.note.trim().length > 500) {
    errors.push({ field: "note", message: "الملاحظة طويلة جداً (500 حرف كحد أقصى)." });
  }

  return errors;
}

export async function listExpenses(limit = 200): Promise<ExpenseRow[]> {
  const rows = await sql<
    {
      id: number;
      amount_mad: string;
      category: string;
      description: string;
      spent_on: string;
      note: string | null;
      created_by: string | null;
    }[]
  >`
    select id, amount_mad, category, description, spent_on, note, created_by
    from public.operating_expenses
    order by spent_on desc, id desc
    limit ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    amountMad: Number(row.amount_mad),
    category: row.category,
    description: row.description,
    // عمود date يعود كـDate من السائق أحياناً وكنصّ أحياناً حسب الإعداد؛
    // نُثبّته على "YYYY-MM-DD" هنا فلا يحتاج أي مستهلك أن يعرف الفرق.
    spentOn: toDayString(row.spent_on),
    note: row.note,
    createdBy: row.created_by,
  }));
}

function toDayString(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function getExpenseById(id: number): Promise<ExpenseRow | null> {
  const rows = await sql<
    {
      id: number;
      amount_mad: string;
      category: string;
      description: string;
      spent_on: string;
      note: string | null;
      created_by: string | null;
    }[]
  >`
    select id, amount_mad, category, description, spent_on, note, created_by
    from public.operating_expenses where id = ${id} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    amountMad: Number(row.amount_mad),
    category: row.category,
    description: row.description,
    spentOn: toDayString(row.spent_on),
    note: row.note,
    createdBy: row.created_by,
  };
}

export async function createExpense(
  input: ExpenseInput,
  createdBy: string
): Promise<{ ok: true; id: number } | { ok: false; errors: ExpenseFieldError[] }> {
  const errors = validateExpense(input);
  if (errors.length > 0) return { ok: false, errors };

  const [row] = await sql<{ id: number }[]>`
    insert into public.operating_expenses (
      amount_mad, category, description, spent_on, note, created_by
    ) values (
      ${input.amountMad}, ${input.category}, ${input.description.trim()},
      ${input.spentOn}, ${input.note?.trim() || null}, ${createdBy}
    )
    returning id
  `;
  return { ok: true, id: row.id };
}

export async function updateExpense(
  id: number,
  input: ExpenseInput
): Promise<{ ok: true } | { ok: false; errors: ExpenseFieldError[] }> {
  const errors = validateExpense(input);
  if (errors.length > 0) return { ok: false, errors };

  const rows = await sql<{ id: number }[]>`
    update public.operating_expenses
    set amount_mad = ${input.amountMad},
        category = ${input.category},
        description = ${input.description.trim()},
        spent_on = ${input.spentOn},
        note = ${input.note?.trim() || null},
        updated_at = now()
    where id = ${id}
    returning id
  `;
  if (rows.length === 0) {
    return { ok: false, errors: [{ field: "general", message: "المصروف غير موجود." }] };
  }
  return { ok: true };
}

export async function deleteExpense(id: number): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    delete from public.operating_expenses where id = ${id} returning id
  `;
  return rows.length > 0;
}

export type ExpensesTotal = {
  totalMad: number;
  count: number;
  /** المجموع لكل تصنيف، الأكبر أولاً — لمعرفة أين يذهب المال. */
  byCategory: { category: string; totalMad: number; count: number }[];
};

/**
 * مجموع المصاريف داخل مدى أيام محلية (الطرفان شاملان).
 *
 * `fromDay`/`toDay` بصيغة "YYYY-MM-DD" كما تُنتجهما resolveRange — نفس
 * المدى المعروض في التقرير بالضبط، فلا يمكن أن يعرض الربح الخام أسبوعاً
 * والمصاريف أسبوعاً آخر.
 */
export async function getExpensesTotal(fromDay: string, toDay: string): Promise<ExpensesTotal> {
  const rows = await sql<{ category: string; total: string; count: number }[]>`
    select category, coalesce(sum(amount_mad), 0) as total, count(*)::int as count
    from public.operating_expenses
    where spent_on >= ${fromDay} and spent_on <= ${toDay}
    group by category
    order by sum(amount_mad) desc
  `;

  const byCategory = rows.map((row) => ({
    category: row.category,
    totalMad: Number(row.total),
    count: row.count,
  }));

  return {
    totalMad: byCategory.reduce((sum, row) => sum + row.totalMad, 0),
    count: byCategory.reduce((sum, row) => sum + row.count, 0),
    byCategory,
  };
}
