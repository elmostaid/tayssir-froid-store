"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import {
  createExpense,
  deleteExpense,
  updateExpense,
  type ExpenseFieldError,
  type ExpenseInput,
} from "@/lib/queries/adminExpenses";
import { isExpenseCategory, type ExpenseCategory } from "@/lib/expenses/expenseCategories";

export type ExpenseFormState = {
  error: string | null;
  fieldErrors?: ExpenseFieldError[];
  /** يُستعمَل مفتاحاً لإعادة تهيئة النموذج بعد حفظ ناجح. */
  savedAt?: number;
};

/**
 * المصاريف بيانات مالية — مقصورة على Admin كبقية التقارير والأرباح، وليست
 * ضمن صلاحيات Staff (عرض/طباعة/تغيير حالة الطلبات فقط).
 */
async function requireOwner(): Promise<{ email: string } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "غير مصرَّح بهذا الإجراء." };
  if (!isOwnerAdmin(admin)) {
    return { error: "المصاريف مقصورة على صاحب الحساب (Admin)." };
  }
  return { email: admin.email };
}

/** قراءة الحقول من النموذج مرة واحدة — يستعملها الإنشاء والتعديل معاً. */
function readExpense(formData: FormData): ExpenseInput {
  const rawAmount = String(formData.get("amount") ?? "").trim().replace(",", ".");
  const rawCategory = String(formData.get("category") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  return {
    amountMad: Number(rawAmount),
    // التحقق الحقيقي في validateExpense؛ هنا نحوّل فقط بلا افتراض صحّة.
    category: (isExpenseCategory(rawCategory) ? rawCategory : "") as ExpenseCategory,
    description: String(formData.get("description") ?? ""),
    spentOn: String(formData.get("spentOn") ?? "").trim(),
    note: note === "" ? null : note,
  };
}

function refresh() {
  revalidatePath("/admin/expenses");
  revalidatePath("/admin/reports");
}

export async function createExpenseAction(
  _prevState: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const auth = await requireOwner();
  if ("error" in auth) return { error: auth.error };

  const result = await createExpense(readExpense(formData), auth.email);
  if (!result.ok) {
    return { error: result.errors[0]?.message ?? "تعذّر حفظ المصروف.", fieldErrors: result.errors };
  }

  refresh();
  return { error: null, savedAt: Date.now() };
}

export async function updateExpenseAction(
  _prevState: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const auth = await requireOwner();
  if ("error" in auth) return { error: auth.error };

  const id = Number(formData.get("expenseId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "المصروف غير صالح." };

  const result = await updateExpense(id, readExpense(formData));
  if (!result.ok) {
    return { error: result.errors[0]?.message ?? "تعذّر حفظ التعديل.", fieldErrors: result.errors };
  }

  refresh();
  return { error: null, savedAt: Date.now() };
}

export async function deleteExpenseAction(id: number): Promise<{ error: string | null }> {
  const auth = await requireOwner();
  if ("error" in auth) return { error: auth.error };

  if (!Number.isInteger(id) || id <= 0) return { error: "المصروف غير صالح." };

  const deleted = await deleteExpense(id);
  if (!deleted) return { error: "المصروف غير موجود — ربما حُذف من جهاز آخر." };

  refresh();
  return { error: null };
}
