"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import {
  createManualOrderAction,
  convertWhatsappLeadAction,
  type OrderEditState,
} from "@/app/admin/(protected)/orders/actions";
import { OrderLinesEditor } from "@/components/admin/OrderLinesEditor";
import { MANUAL_ORDER_SOURCES, ORDER_SOURCE_LABELS } from "@/lib/orders/orderSource";
import { ImportOrderPanel } from "@/components/admin/ImportOrderPanel";
import type { EditableLine } from "@/components/admin/OrderLinesEditor";
import type { ImportIssue, ImportedOrderDraft } from "@/lib/orders/importOrder";
import {
  clearManualDraft,
  loadManualDraft,
  manualDraftStorageKey,
  saveManualDraft,
  type DraftCustomer,
  type ManualOrderDraft,
} from "@/lib/orders/manualOrderDraft";

const NETWORK_SAVE_MESSAGE =
  "ما وصلش الطلب للخادم (الإنترنت تقطع أو الخادم ما جاوبش). المعلومات باقية فالنموذج — عاود الضغط على الحفظ. إلا كانت الطلبية تسجلات فعلاً، غادي تفتح هي بلا ما تتعاود.";

function linesFromImport(draft?: ImportedOrderDraft | null): EditableLine[] {
  return (draft?.items ?? []).map((item) => ({
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    purchasePrice: item.purchasePrice,
    stockQuantity: item.stockQuantity,
    reservedQuantity: 0,
  }));
}

function customerFrom(draft?: ImportedOrderDraft | null): DraftCustomer {
  return {
    fullName: draft?.customerName ?? "",
    phone: draft?.phone ?? "",
    city: draft?.city ?? "",
    address: draft?.address ?? "",
    source: draft?.source ?? "whatsapp",
    originReference: "",
    notes: draft?.notes ?? "",
    adConsentDeclared: false,
    actualDeliveryCost:
      draft?.actualDeliveryCost === null || draft?.actualDeliveryCost === undefined
        ? ""
        : String(draft.actualDeliveryCost),
  };
}

const initialState: OrderEditState = { error: null };

function Field({
  label,
  name,
  required,
  type = "text",
  placeholder,
  maxLength,
  value,
  onValue,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  value: string;
  onValue: (value: string) => void;
}) {
  return (
    <label className="text-xs text-neutral-700">
      <span className="mb-1 block font-semibold">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onValue(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
      />
    </label>
  );
}

export function ManualOrderForm({
  initialDraft,
  leadId,
  attemptKey,
}: {
  /** مسودّة جاهزة من تحويل طلب واتساب — انظر lib/orders/whatsappLeadDraft.ts. */
  initialDraft?: ImportedOrderDraft;
  /** وجوده يعني: هذا تحويل Lead لا طلب يدوي عادي — يُرسَل لـconvertWhatsappLeadAction. */
  leadId?: number;
  /**
   * مفتاح هذه المحاولة، يولّده الخادم عند فتح الصفحة. يبقى هو نفسه مع كل
   * إعادة إرسال (بعد خطأ أو انقطاع)، فلا تُنشأ الطلبية مرّتين ولا يُخصم
   * المخزون مرّتين. النجاح ينقل إلى صفحة الطلبية، والطلبية التالية تفتح
   * الصفحة من جديد بمفتاح جديد.
   */
  attemptKey?: string;
} = {}) {
  // تحويل Lead يمرّ بمسار مختلف (قفل ذرّي يمنع تحويله مرتين) — انظر
  // convertWhatsappLead.ts. الشكل (OrderEditState) واحد فالحالتين.
  const action = leadId ? convertWhatsappLeadAction : createManualOrderAction;
  const storageKey = manualDraftStorageKey(leadId);
  // بعد نجاح الحفظ: لا كتابة مؤجَّلة للمسودّة تعيدها بعد مسحها.
  const savedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ## الإرسال لا يُسقط الصفحة
  //
  // إجراء الخادم قد يرمي في المتصفح نفسه (انقطاع الإنترنت، جواب 500، مهلة).
  // بلا هذا الغلاف كان الرمي يصعد إلى حدّ الخطأ — «This page couldn't load»
  // — وتضيع الطلبية المكتوبة. هنا يتحوّل إلى رسالة، والحقول باقية، والإعادة
  // آمنة بنفس مفتاح المحاولة. `unstable_rethrow` يترك لـNext تحويل النجاح
  // (redirect إلى صفحة الطلبية) يمرّ كما هو.
  const [state, formAction, pending] = useActionState(
    async (prev: OrderEditState, formData: FormData): Promise<OrderEditState> => {
      try {
        return await action(prev, formData);
      } catch (error) {
        try {
          unstable_rethrow(error);
        } catch (navigation) {
          // النجاح يصل هنا: الإجراء ينتهي بـredirect إلى صفحة الطلبية، وNext
          // يرفض وعد الإجراء بخطأ redirect داخلي. الطلبية حُفظت، فالمسودّة
          // لم تعد لازمة — نمسحها ثم نترك Next يُكمل الانتقال.
          savedRef.current = true;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          clearManualDraft(storageKey);
          throw navigation;
        }
        return { error: NETWORK_SAVE_MESSAGE };
      }
    },
    initialState
  );
  const [draft, setDraft] = useState<ImportedOrderDraft | null>(initialDraft ?? null);
  const [warnings, setWarnings] = useState<ImportIssue[]>([]);

  // الحقول مُتحكَّم فيها: React 19 يُعيد ضبط الحقول غير المتحكَّم فيها بعد كل
  // إرسال، فكان حفظٌ فاشل يمحو اسم الزبون وهاتفه وعنوانه.
  const [customer, setCustomer] = useState<DraftCustomer>(() => customerFrom(initialDraft));
  const setField = (field: keyof DraftCustomer) => (value: string | boolean) =>
    setCustomer((current) => ({ ...current, [field]: value }));
  const [attempt, setAttempt] = useState(attemptKey ?? null);

  // `key` مشتقّ من عدّاد المسودّات: يُعيد تركيب محرّر السطور بقيمه الجديدة
  // (بعد الاستيراد أو الاسترجاع).
  const [draftKey, setDraftKey] = useState(0);
  const [editorSeed, setEditorSeed] = useState<{ lines: EditableLine[]; deliveryFee: number }>(() => ({
    lines: linesFromImport(initialDraft),
    deliveryFee: initialDraft?.deliveryFee ?? 0,
  }));
  const current = useRef<{ lines: EditableLine[]; deliveryFee: number }>(editorSeed);

  function applyDraft(next: ImportedOrderDraft, nextWarnings: ImportIssue[]) {
    setDraft(next);
    setWarnings(nextWarnings);
    setCustomer((c) => ({ ...customerFrom(next), originReference: c.originReference }));
    setEditorSeed({ lines: linesFromImport(next), deliveryFee: next.deliveryFee ?? 0 });
    setDraftKey((k) => k + 1);
  }

  // ## المسودّة: استرجاع بعد انهيار أو تحديث بالخطأ
  //
  // لا نحفظ شيئاً قبل أن يقرّر المدير ماذا يفعل بمسودّة موجودة، وإلا كتب
  // النموذج الفارغ فوقها في أول لحظة.
  const [pendingRestore, setPendingRestore] = useState<ManualOrderDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    // التخزين لا يُقرأ إلا بعد التركيب في المتصفح (الخادم لا يملكه، وقراءته
    // وقت العرض الأول تُنتج اختلافاً بين HTML الخادم والمتصفح).
    const stored = loadManualDraft(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- مزامنة مع تخزين المتصفح بعد التركيب
    if (stored) setPendingRestore(stored);
    else setDraftReady(true);
  }, [storageKey]);

  const persist = useCallback(() => {
    if (!draftReady || savedRef.current) return;
    saveManualDraft(storageKey, {
      attemptKey: attempt,
      customer,
      lines: current.current.lines,
      deliveryFee: current.current.deliveryFee,
    });
    setSavedAt(Date.now());
  }, [draftReady, storageKey, attempt, customer]);

  const schedulePersist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 400);
  }, [persist]);
  useEffect(() => {
    schedulePersist();
  }, [schedulePersist]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const onLinesChange = useCallback(
    (lines: EditableLine[], deliveryFee: number) => {
      current.current = { lines, deliveryFee };
      schedulePersist();
    },
    [schedulePersist]
  );

  function restoreDraft(stored: ManualOrderDraft) {
    setCustomer(stored.customer);
    // نفس مفتاح المحاولة: إن كانت قد حُفظت فعلاً قبل الانهيار، يُرجع الخادم
    // نفس الطلبية بدل تسجيلها مرّة ثانية.
    if (stored.attemptKey) setAttempt(stored.attemptKey);
    setEditorSeed({ lines: stored.lines, deliveryFee: stored.deliveryFee });
    current.current = { lines: stored.lines, deliveryFee: stored.deliveryFee };
    setDraftKey((k) => k + 1);
    setPendingRestore(null);
    setDraftReady(true);
  }

  function discardDraft() {
    clearManualDraft(storageKey);
    setPendingRestore(null);
    setDraftReady(true);
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {attempt && <input type="hidden" name="idempotencyKey" value={attempt} />}
      {pendingRestore && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-bold text-amber-900">
            عندك طلبية ما تسجلاتش من{" "}
            {new Date(pendingRestore.savedAt).toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit" })}
            {pendingRestore.customer.fullName ? ` — ${pendingRestore.customer.fullName}` : ""} (
            {pendingRestore.lines.length} منتج).
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            محفوظة فهاد التبويب فقط، وكتتمسح منين تسدّو ولا منين تتسجل الطلبية.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => restoreDraft(pendingRestore)}
              className="min-h-10 rounded-full bg-amber-600 px-4 text-sm font-semibold text-white"
            >
              رجّع الطلبية
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="min-h-10 rounded-full border border-amber-400 px-4 text-sm font-semibold text-amber-900"
            >
              احذفها وبدا من جديد
            </button>
          </div>
        </div>
      )}
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {!leadId && <ImportOrderPanel onDraft={applyDraft} />}

      {draft && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-3">
          <p className="text-sm font-bold text-green-800">
            {leadId
              ? `طلب واتساب: ${draft.items.length} منتجاً — راجع كل شيء أدناه، أضف اسم الزبون وهاتفه ومدينته من المحادثة، ثم أكّد.`
              : `قُرئ البون: ${draft.items.length} منتجاً — راجع كل شيء أدناه ثم أكّد.`}
          </p>
          <p className="mt-0.5 text-[11px] text-green-800">
            لم يُنشأ أي طلب بعد، ولم يتغيّر أي مخزون.
          </p>
          {warnings.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-amber-800">
              {warnings.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">الزبون</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            key={`name-${draftKey}`}
            label="اسم الزبون"
            name="fullName"
            required
            maxLength={100}

            value={customer.fullName}
            onValue={setField("fullName")}
          />
          <Field
            key={`phone-${draftKey}`}
            label="الهاتف"
            name="phone"
            required
            type="tel"
            placeholder="0612345678"

            value={customer.phone}
            onValue={setField("phone")}
          />
          <Field
            key={`city-${draftKey}`}
            label="المدينة"
            name="city"
            required
            maxLength={100}

            value={customer.city}
            onValue={setField("city")}
          />
          <Field
            key={`address-${draftKey}`}
            label="العنوان الكامل"
            name="address"
            required
            maxLength={300}

            value={customer.address}
            onValue={setField("address")}
          />
          <label className="text-xs text-neutral-700">
            <span className="mb-1 block font-semibold">
              مصدر الطلب <span className="text-red-500">*</span>
            </span>
            {leadId ? (
              <p className="min-h-11 flex items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600">
                {ORDER_SOURCE_LABELS.whatsapp} (ثابت لتحويل طلب واتساب)
              </p>
            ) : (
              <select
                name="source"
                required
                value={customer.source}
                onChange={(event) => setField("source")(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              >
                {MANUAL_ORDER_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {ORDER_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            )}
          </label>
          {!leadId && (
            <label className="text-xs text-neutral-700">
              <span className="mb-1 block font-semibold">مرجع المحادثة (اختياري)</span>
              <input
                type="text"
                name="originReference"
                value={customer.originReference}
                onChange={(event) => setField("originReference")(event.target.value)}
                dir="ltr"
                placeholder="Q-XXXXXXXXXX أو W-XXXXXXXX"
                maxLength={2000}
                className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
              />
              <span className="mt-1 block text-[11px] text-neutral-500">
                الصق المرجع (أو الرسالة كاملة) من محادثة واتساب. يربط الطلبية بالزيارة التي
                جاءت منها؛ القناة تبقى كما اخترتها. مرجع خاطئ أو مستعمل لا يمنع التسجيل: تُحفظ
                الطلبية بلا ربط ويُكتب السبب في سجلّها.
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs text-neutral-700 sm:col-span-2">
            <input
              type="checkbox"
              name="adConsentDeclared"
              checked={customer.adConsentDeclared}
              onChange={(event) => setField("adConsentDeclared")(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              سألتُ الزبون ووافق صراحةً على مشاركة بيانات هذه البيعة (الهاتف مُشفَّراً) مع Meta
              لقياس الإعلانات. اتركه فارغاً إن لم تسأل — لا يُرسَل شيء.
            </span>
          </label>
          <label className="text-xs text-neutral-700">
            <span className="mb-1 block font-semibold">ملاحظة (اختياري)</span>
            <input
              type="text"
              name="notes"
              maxLength={500}
              value={customer.notes}
              onChange={(event) => setField("notes")(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-bold text-neutral-800">المنتجات</h2>
        <div className="mt-3">
          <OrderLinesEditor
            key={`lines-${draftKey}`}
            initialLines={editorSeed.lines}
            initialDeliveryFee={editorSeed.deliveryFee}
            disabled={pending}
            onChange={onLinesChange}
          />
        </div>

        {/* ما ندفعه نحن لشركة التوصيل — مصروف داخلي لا يمسّ مجموع الزبون
            أعلاه. خارج OrderLinesEditor عمداً: ذاك المحرّر مشترك مع تعديل
            سطور طلب قائم، وهناك يُعاد حساب المبلغ المطلوب من الزبون، فحقلٌ
            لا علاقة له بالزبون لا مكان له فيه.
            يبقى فارغاً في العادة: فاتورة شركة التوصيل تصل بعد التسليم،
            وتُسجَّل حينها من صفحة الطلب. */}
        <div className="mt-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3">
          <label className="text-[11px] text-neutral-600">
            <span className="mb-1 block font-semibold">
              تكلفة التوصيل الفعلية علينا (اختيارية)
            </span>
            <input
              type="number"
              name="actualDeliveryCost"
              min={0}
              step="0.01"
              value={customer.actualDeliveryCost}
              onChange={(event) => setField("actualDeliveryCost")(event.target.value)}
              disabled={pending}
              placeholder="اتركها فارغة إن لم تُعرف بعد"
              className="min-h-10 w-56 rounded-lg border border-neutral-300 px-2 text-sm tabular-nums"
            />
          </label>
          <p className="mt-1 text-[11px] text-neutral-500">
            المبلغ المدفوع لشركة التوصيل. الفراغ يعني «غير مسجَّلة» ولا يعني صفراً — ويمكن
            تسجيلها لاحقاً من صفحة الطلب.
          </p>
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand-orange px-6 text-sm font-semibold text-white disabled:bg-neutral-300"
        >
          {pending ? "جارٍ الحفظ…" : draft ? "تأكيد وإنشاء الطلب" : "حفظ الطلب"}
        </button>
        <p className="text-[11px] text-neutral-500">
          يُحفظ بحالة «مؤكَّد» ويأخذ رقماً عادياً كبقية الطلبات. لا يُرسَل أي حدث إلى Meta.
        </p>
        {savedAt && draftReady && (
          <p className="w-full text-[11px] text-neutral-400">
            مسودّة محفوظة فهاد التبويب ({new Date(savedAt).toLocaleTimeString("fr-MA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}) — إلا طاحت الصفحة ولا تحدّثات، كترجع.
          </p>
        )}
      </div>
    </form>
  );
}
