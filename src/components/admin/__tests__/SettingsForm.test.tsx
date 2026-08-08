import { describe, test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SettingsForm } from "@/components/admin/SettingsForm";
import type { StoreSettings } from "@/lib/queries/settings";

// updateSettings الحقيقية تتصل بـSupabase/PostgreSQL — نُحاكيها هنا فقط
// لعزل هذا الاختبار على سلوك الواجهة (checkbox) داخل jsdom، بمعزل عن
// طبقة البيانات التي لها اختباراتها التكاملية الخاصة (createOrder.test.ts
// وغيره).
vi.mock("@/app/admin/(protected)/settings/actions", () => ({
  updateSettings: vi.fn(async () => ({ error: null, success: true })),
}));

afterEach(() => {
  cleanup();
});

function baseSettings(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    minOrderAmountMad: 1000,
    deliveryFeePerCartonMad: 45,
    whatsappNumber: "+212722083458",
    storeCity: "مراكش - حي المحاميد",
    storeName: "Tayssir Froid",
    whatsappOrderMessageTemplate: "مرحباً، بخصوص طلبكم رقم {orderNumber} في {storeName}.",
    codEnabled: true,
    ...overrides,
  };
}

// يحاكي بالضبط العطل المُبلَّغ عنه فProduction: React 19 يُعيد ضبط عناصر
// النموذج غير المُتحكَّم بها تلقائياً بعد نجاح أي form action، إلى
// defaultChecked التي كانت مُثبَّتة فالـDOM وقت آخر mount — وليس بالضرورة
// القيمة الطازجة القادمة من الخادم. هذا الاختبار يُشغِّل دورة action حقيقية
// (useActionState + <form action>) فبيئة DOM حقيقية (jsdom)، ثم يحاكي وصول
// props طازجة من الخادم (كما يحدث فعلياً بعد revalidatePath)، ويتأكد أن
// الـcheckbox المعروض يطابق القيمة الطازجة فالنهاية — وليس القيمة القديمة
// عند أول تحميل للصفحة.
describe("SettingsForm — checkbox استقبال طلبات جديدة", () => {
  test("تعطيل الخيار ثم الحفظ: الحالة النهائية المعروضة تطابق القيمة الطازجة من الخادم (false)، وليس القيمة القديمة", async () => {
    const { rerender } = render(<SettingsForm settings={baseSettings({ codEnabled: true })} />);

    let checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    const form = checkbox.closest("form");
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);

    await screen.findByText("تم الحفظ بنجاح ✓");

    // هذا بالضبط العطل المُبلَّغ عنه: بمجرد نجاح الـaction، React 19 يُعيد
    // ضبط checkbox تلقائياً إلى defaultChecked الأصلية عند أول mount (true)
    // — رغم أن updateSettings الحقيقية حفظت false فقاعدة البيانات بنجاح
    // (مؤكَّد بالاختبارات التكاملية فـcreateOrder.test.ts وroleGuards عبر
    // نفس مسار sql). التوثيق الصريح لهذا السلوك هنا يمنع أي حذف مستقبلي
    // للإصلاح (key) بذريعة أنه "لا يبدو ضرورياً".
    expect(checkbox.checked).toBe(true);

    // الخادم أعاد صفحة جديدة بـsettings.codEnabled=false الحقيقية (القيمة
    // التي حُفظت فعلاً فقاعدة البيانات) — نُعيد الرندر بها كما يفعل Next.js
    // فعلياً بعد revalidatePath("/admin/settings"). الإصلاح (key فـ
    // SettingsForm.tsx) هو ما يضمن أن العنصر يُعاد mount بالقيمة الطازجة
    // هنا، بدل البقاء عالقاً على القيمة القديمة أعلاه.
    rerender(<SettingsForm settings={baseSettings({ codEnabled: false })} />);

    checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  test("تفعيل الخيار ثم الحفظ: الحالة النهائية المعروضة تطابق القيمة الطازجة من الخادم (true)", async () => {
    const { rerender } = render(<SettingsForm settings={baseSettings({ codEnabled: false })} />);

    let checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const form = checkbox.closest("form");
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);

    await screen.findByText("تم الحفظ بنجاح ✓");
    expect(checkbox.checked).toBe(false); // نفس إعادة الضبط التلقائية أعلاه

    rerender(<SettingsForm settings={baseSettings({ codEnabled: true })} />);

    checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  test("حفظ بلا تغيير فـcodEnabled لا يُغيِّر قيم بقية الحقول المعروضة", async () => {
    const settings = baseSettings({ storeName: "اسم مميز", storeCity: "الدار البيضاء" });
    render(<SettingsForm settings={settings} />);

    const storeNameInput = screen.getByDisplayValue("اسم مميز") as HTMLInputElement;
    const storeCityInput = screen.getByDisplayValue("الدار البيضاء") as HTMLInputElement;

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    const form = checkbox.closest("form");
    if (!form) throw new Error("form not found");
    fireEvent.submit(form);

    await screen.findByText("تم الحفظ بنجاح ✓");

    expect(storeNameInput.value).toBe("اسم مميز");
    expect(storeCityInput.value).toBe("الدار البيضاء");
  });
});
