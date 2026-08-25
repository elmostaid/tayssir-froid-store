import { redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { listExpenses, getExpensesTotal } from "@/lib/queries/adminExpenses";
import { expenseCategoryLabel } from "@/lib/expenses/expenseCategories";
import { localDayString } from "@/lib/analytics/dateRange";
import { formatMad } from "@/lib/format";
import { ExpenseForm } from "@/components/admin/ExpenseForm";
import { ExpenseRowActions } from "@/components/admin/ExpenseRowActions";

export const dynamic = "force-dynamic";

export const metadata = { title: "المصاريف" };

export default async function AdminExpensesPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (!isOwnerAdmin(admin)) redirect("/admin/orders");

  // اليوم بتوقيت المغرب من الخادم — ساعة الهاتف قد تكون مضبوطة على منطقة
  // أخرى، فيُسجَّل المصروف في اليوم الخطأ ويظهر في تقرير يوم آخر.
  const today = localDayString(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;

  const [expenses, monthTotal] = await Promise.all([
    listExpenses(200),
    getExpensesTotal(monthStart, today),
  ]);

  return (
    <div>
      <h1 className="text-xl font-bold text-neutral-800">المصاريف</h1>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        مصاريف تشغيل المشروع — تُطرَح من الربح الخام في{" "}
        <span className="font-semibold">التقارير</span> لتُعطي صافي الربح.{" "}
        <span className="font-semibold text-neutral-600">لا تسجّل هنا ثمن شراء البضاعة</span>:
        هو مخصوم أصلاً داخل الربح الخام، وتسجيله يخصمه مرتين.
      </p>

      <div className="mt-4 rounded-xl border-2 border-brand-orange/30 bg-white p-4">
        <h2 className="mb-3 text-base font-bold text-neutral-800">إضافة مصروف</h2>
        <ExpenseForm today={today} />
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-xs text-neutral-500">مصاريف الشهر الحالي</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-brand-orange">
          {formatMad(monthTotal.totalMad)}
        </p>
        {monthTotal.byCategory.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600">
            {monthTotal.byCategory.map((row) => (
              <li key={row.category}>
                {expenseCategoryLabel(row.category)}:{" "}
                <span className="font-semibold tabular-nums">{formatMad(row.totalMad)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mt-6 border-r-4 border-brand-turquoise pr-3 text-base font-bold text-neutral-800">
        سجلّ المصاريف
      </h2>

      {expenses.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          لا يوجد أي مصروف مسجَّل بعد.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {expenses.map((expense) => (
            <li
              key={expense.id}
              className="rounded-xl border border-neutral-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-800">{expense.description}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
                      {expenseCategoryLabel(expense.category)}
                    </span>
                    <span className="ms-2 tabular-nums" dir="ltr">
                      {expense.spentOn}
                    </span>
                  </p>
                  {expense.note && (
                    <p className="mt-1 text-xs leading-relaxed text-neutral-500">{expense.note}</p>
                  )}
                </div>
                <span className="shrink-0 text-base font-bold tabular-nums text-brand-orange">
                  {formatMad(expense.amountMad)}
                </span>
              </div>

              <ExpenseRowActions
                today={today}
                expense={{
                  id: expense.id,
                  amountMad: expense.amountMad,
                  category: expense.category,
                  description: expense.description,
                  spentOn: expense.spentOn,
                  note: expense.note,
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {expenses.length >= 200 && (
        <p className="mt-3 text-[11px] text-neutral-500">
          يُعرض آخر 200 مصروف. المجاميع في صفحة التقارير تحتسب كل المصاريف بلا استثناء.
        </p>
      )}
    </div>
  );
}
