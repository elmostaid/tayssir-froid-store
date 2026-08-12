import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { AdminProduct } from "@/lib/queries/adminProducts";
import type { AdminCategory } from "@/lib/queries/adminCategories";
import type { ProductFormState } from "@/app/admin/(protected)/products/actions";

const generateProductSkuMock = vi.fn();
vi.mock("@/app/admin/(protected)/products/actions", () => ({
  generateProductSku: (...args: unknown[]) => generateProductSkuMock(...args),
}));

const { ProductForm } = await import("@/components/admin/ProductForm");

afterEach(() => {
  cleanup();
  generateProductSkuMock.mockReset();
});

const CATEGORIES: AdminCategory[] = [
  {
    id: 1,
    slug: "cat-1",
    name_ar: "تصنيف 1",
    name_fr: null,
    description_ar: null,
    parent_id: null,
    sort_order: 1,
    is_active: true,
  },
  {
    id: 2,
    slug: "cat-2",
    name_ar: "تصنيف 2",
    name_fr: null,
    description_ar: null,
    parent_id: null,
    sort_order: 2,
    is_active: true,
  },
];

describe("ProductForm — البيانات تبقى كما هي عند خطأ (SKU مكرر مثلاً)، لا تختفي", () => {
  // ملاحظة منهجية: jsdom (بيئة هذا المختبر) لا يُنفِّذ فعلياً آلية
  // <form action={fn}> الحقيقية لـReact 19 (لا عبر click ولا حتى
  // form.requestSubmit() — قيد بيئي معروف فـjsdom/RTL، وليس خللاً فالكود).
  // الإثبات الحاسم للسيناريو الحقيقي الكامل (كتابة كل الحقول، SKU مكرر،
  // ضغط حفظ، تبقى القيم) يُنفَّذ فمتصفح حقيقي (Playwright) ضد التطبيق
  // الفعلي — هنا نختبر الآلية الجذرية نفسها التي تحمي القيم: أن كل حقل
  // controlled (قيمته المعروضة تُشتَق من حالة React)، فحتى استدعاء
  // form.reset() (وهو ما يُنفِّذه React داخلياً بعد اكتمال أي إجراء form
  // action، ناجحاً كان أو فاشلاً — هذا بالضبط سبب اختفاء الحقول قبل هذا
  // الإصلاح) لا يمحو القيمة المعروضة لحقل controlled.
  test("form.reset() (ما ينفّذه React داخلياً بعد أي إجراء) لا يمحو قيم الحقول controlled", () => {
    const action = vi.fn(async (): Promise<ProductFormState> => ({ error: null }));
    const { container } = render(<ProductForm action={action} categories={CATEGORIES} mode="create" />);

    fireEvent.change(screen.getByLabelText("SKU *"), { target: { value: "TF-XX-999" } });
    fireEvent.change(screen.getByLabelText("الاسم العربي *"), { target: { value: "منتج تجريبي" } });
    fireEvent.change(screen.getByLabelText("ثمن البيع (درهم) *"), { target: { value: "123.45" } });
    fireEvent.change(screen.getByLabelText("وصف مختصر (اختياري)"), {
      target: { value: "وصف تجريبي طويل شوية" },
    });

    const form = container.querySelector("form")!;
    form.reset();

    expect((screen.getByLabelText("SKU *") as HTMLInputElement).value).toBe("TF-XX-999");
    expect((screen.getByLabelText("الاسم العربي *") as HTMLInputElement).value).toBe("منتج تجريبي");
    expect((screen.getByLabelText("ثمن البيع (درهم) *") as HTMLInputElement).value).toBe("123.45");
    expect((screen.getByLabelText("وصف مختصر (اختياري)") as HTMLTextAreaElement).value).toBe(
      "وصف تجريبي طويل شوية"
    );
  });

});

describe("ProductForm — توليد SKU تلقائي حسب التصنيف (وضع الإنشاء فقط)", () => {
  test("زر 'توليد SKU' يظهر فوضع الإنشاء، ويملأ حقل SKU بالاقتراح دون لمس بقية الحقول", async () => {
    generateProductSkuMock.mockResolvedValue({ sku: "TF-XX-042" });
    const action = vi.fn(async (): Promise<ProductFormState> => ({ error: null }));

    render(<ProductForm action={action} categories={CATEGORIES} mode="create" />);

    fireEvent.change(screen.getByLabelText("الاسم العربي *"), { target: { value: "اسم ثابت" } });
    fireEvent.change(screen.getByLabelText("التصنيف *"), { target: { value: "1" } });

    // اختيار التصنيف نفسه يُطلِق اقتراحاً تلقائياً (SKU غير ملموس بعد) —
    // ننتظر استقراره أولاً (الزر يعود لنصه العادي بعد اكتمال الـtransition)
    // قبل اختبار الضغط الصريح على الزر نفسه، لتفادي تداخل عمليتين متزامنتين.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "توليد SKU" })).toBeTruthy()
    );
    generateProductSkuMock.mockClear();
    generateProductSkuMock.mockResolvedValue({ sku: "TF-XX-042" });

    fireEvent.click(screen.getByRole("button", { name: "توليد SKU" }));

    await waitFor(() => expect(generateProductSkuMock).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect((screen.getByLabelText("SKU *") as HTMLInputElement).value).toBe("TF-XX-042")
    );
    expect((screen.getByLabelText("الاسم العربي *") as HTMLInputElement).value).toBe("اسم ثابت");
  });

  test("اختيار تصنيف (والـSKU لا يزال فارغاً/غير ملموس): يقترح SKU تلقائياً بلا ضغط أي زر", async () => {
    generateProductSkuMock.mockResolvedValue({ sku: "TF-YY-007" });
    const action = vi.fn(async (): Promise<ProductFormState> => ({ error: null }));

    render(<ProductForm action={action} categories={CATEGORIES} mode="create" />);
    fireEvent.change(screen.getByLabelText("التصنيف *"), { target: { value: "2" } });

    await waitFor(() => expect(generateProductSkuMock).toHaveBeenCalledWith(2));
    await waitFor(() =>
      expect((screen.getByLabelText("SKU *") as HTMLInputElement).value).toBe("TF-YY-007")
    );
  });

  test("إذا كتب المستخدم SKU يدوياً بنفسه، تغيير التصنيف لا يستبدله باقتراح تلقائي", async () => {
    const action = vi.fn(async (): Promise<ProductFormState> => ({ error: null }));
    render(<ProductForm action={action} categories={CATEGORIES} mode="create" />);

    fireEvent.change(screen.getByLabelText("SKU *"), { target: { value: "MY-OWN-SKU" } });
    fireEvent.change(screen.getByLabelText("التصنيف *"), { target: { value: "1" } });

    expect(generateProductSkuMock).not.toHaveBeenCalled();
    expect((screen.getByLabelText("SKU *") as HTMLInputElement).value).toBe("MY-OWN-SKU");
  });

  test("وضع التعديل: لا يظهر زر 'توليد SKU' إطلاقاً", () => {
    const product: AdminProduct = {
      id: 1,
      sku: "TF-EXIST-001",
      slug: "existing-product",
      category_id: 1,
      category_name_ar: "تصنيف 1",
      name_ar: "منتج موجود",
      name_fr: null,
      description_ar: null,
      technical_specs: null,
      unit_label: "قطعة",
      min_order_qty: 1,
      qty_increment: 1,
      purchase_price: null,
      sale_price: "10.00",
      stock_quantity: 5,
      status: "published",
      sort_order: 1,
    };
    const action = vi.fn(async (): Promise<ProductFormState> => ({ error: null }));
    render(<ProductForm action={action} product={product} categories={CATEGORIES} mode="edit" />);

    expect(screen.queryByRole("button", { name: /توليد SKU/ })).toBeNull();
    expect((screen.getByLabelText("SKU *") as HTMLInputElement).value).toBe("TF-EXIST-001");
  });
});
