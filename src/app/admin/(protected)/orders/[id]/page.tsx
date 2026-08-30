import { displayCustomerAddress } from "@/lib/orders/customerAddress";
import { describeTouch } from "@/lib/attribution/types";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminUser, isOwnerAdmin } from "@/lib/auth/requireAdmin";
import { getEditableOrderLines } from "@/lib/queries/adminProductSearch";
import { OrderItemsEditForm } from "@/components/admin/OrderItemsEditForm";
import { RESTOCKING_STATUSES } from "@/lib/orders/orderStatus";
import { ORDER_SOURCE_BADGE_CLASSES, orderSourceLabel } from "@/lib/orders/orderSource";
import {
  getAdminOrderById,
  getAdminOrderItems,
  getAdminOrderStatusHistory,
} from "@/lib/queries/adminOrders";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders/orderStatus";
import { formatMad } from "@/lib/format";
import { splitProductNameSnapshot } from "@/lib/orders/productNameSnapshot";
import { OrderStatusForm } from "@/components/admin/OrderStatusForm";
import { OrderNoteForm } from "@/components/admin/OrderNoteForm";
import { DeliveryFeeForm } from "@/components/admin/DeliveryFeeForm";
import { CopyBonButton } from "@/components/admin/CopyBonButton";
import { DeleteOrderButton } from "@/components/admin/DeleteOrderButton";
import { CopyDeliveryInfoButton } from "@/components/admin/CopyDeliveryInfoButton";
import { buildCustomerWhatsAppLink } from "@/lib/whatsapp";
import { toInternationalDigits } from "@/lib/phone";
import { getSettings, FALLBACK_SETTINGS } from "@/lib/queries/settings";
import { safeQuery } from "@/lib/safeQuery";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AdminOrderDetailPage({ params }: Props) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();

  const order = await getAdminOrderById(orderId);
  if (!order) notFound();

  const owner = isOwnerAdmin(admin);
  const [items, history, settings, editableLines] = await Promise.all([
    getAdminOrderItems(orderId),
    getAdminOrderStatusHistory(orderId),
    safeQuery(() => getSettings(), FALLBACK_SETTINGS, "adminOrderDetail.getSettings"),
    // ثمن الشراء داخل هذه السطور سرّي، فلا نجلبها أصلاً لغير Owner/Admin.
    owner ? getEditableOrderLines(orderId) : Promise.resolve([]),
  ]);

  const needsReviewItems = items.filter((item) => item.lineStatus !== "reserved");

  const editLockedReason = RESTOCKING_STATUSES.includes(order.status)
    ? "لا يمكن تعديل محتوى طلب ملغى أو راجع: مخزونه أُرجع بالفعل، وأي تعديل الآن سيخصمه مرتين."
    : null;

  return (
    <div>
      <Link href="/admin/orders" className="text-xs text-neutral-500 hover:underline">
        ← الرجوع إلى الطلبات
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 dir="ltr" className="font-mono text-xl font-bold text-neutral-800">
            {order.orderNumber}
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              ORDER_SOURCE_BADGE_CLASSES[
                order.source as keyof typeof ORDER_SOURCE_BADGE_CLASSES
              ] ?? "bg-neutral-100 text-neutral-600"
            }`}
          >
            {orderSourceLabel(order.source)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={buildCustomerWhatsAppLink(
              order.customerPhone,
              order.orderNumber,
              settings.whatsappOrderMessageTemplate,
              settings.storeName
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-whatsapp bg-whatsapp/10 px-3 py-2 text-xs font-semibold text-whatsapp-dark"
          >
            واتساب الزبون
          </a>
          <a
            href={`tel:+${toInternationalDigits(order.customerPhone)}`}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            اتصال بالزبون
          </a>
          <CopyBonButton order={order} items={items} />
          <a
            href={`/admin/orders/${order.id}/picking-slip.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-brand-turquoise bg-brand-turquoise-tint px-3 py-2 text-xs font-semibold text-brand-turquoise-dark"
          >
            تحميل / طباعة البون PDF
          </a>
          <CopyDeliveryInfoButton order={order} />
          <a
            href={`/order/${order.publicReference}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            وصل الزبون
          </a>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">بيانات الزبون</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-neutral-500">الاسم</dt>
            <dd className="font-medium text-neutral-800">{order.customerName}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">الهاتف</dt>
            <dd dir="ltr" className="font-medium text-neutral-800">{order.customerPhone}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">المدينة</dt>
            <dd className="font-medium text-neutral-800">{order.customerCity}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">التاريخ والساعة</dt>
            <dd className="font-medium text-neutral-800">
              {new Date(order.createdAt).toLocaleString("ar-MA")}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-neutral-500">العنوان</dt>
            <dd className="font-medium text-neutral-800">{displayCustomerAddress(order.customerAddress)}</dd>
          </div>
          {order.customerNotes && (
            <div className="col-span-2">
              <dt className="text-neutral-500">ملاحظة الزبون</dt>
              <dd className="font-medium text-neutral-800">{order.customerNotes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* من أين جاء هذا الزبون. يظهر فقط حين يكون معروفاً: طلبات ما قبل
          تفعيل النسب وطلبات واتساب لا تحمل مصدراً، ولا نخترع لها واحداً. */}
      {(order.attributionLast || order.attributionFirst) && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-800">مصدر الزبون</h2>
          <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {([
              ["آخر مصدر قبل الطلب", order.attributionLast],
              ["أول مرة عرف الموقع", order.attributionFirst],
            ] as const).map(([label, touch]) => (
              <div key={label} className="rounded-lg bg-neutral-50 p-3">
                <dt className="text-xs text-neutral-500">{label}</dt>
                <dd className="mt-0.5 font-semibold text-neutral-800">{describeTouch(touch)}</dd>
                {touch && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-neutral-600">
                    {touch.utmCampaign && <li>الحملة: <span className="font-medium">{touch.utmCampaign}</span></li>}
                    {touch.utmContent && <li>الإعلان: <span className="font-medium">{touch.utmContent}</span></li>}
                    {touch.utmTerm && <li>الكلمة: <span className="font-medium">{touch.utmTerm}</span></li>}
                    {touch.landingPath && <li dir="ltr" className="truncate">صفحة الدخول: {touch.landingPath}</li>}
                    {touch.referrerHost && <li dir="ltr" className="truncate">الإحالة: {touch.referrerHost}</li>}
                    {(touch.fbclid || touch.gclid || touch.ttclid) && (
                      <li>
                        نقرة إعلانية:{" "}
                        {touch.fbclid ? "Meta" : touch.gclid ? "Google" : "TikTok"}
                      </li>
                    )}
                    <li>{new Date(touch.at).toLocaleString("ar-MA")}</li>
                  </ul>
                )}
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">المنتجات</h2>
        {/* السطور المرفوضة لا تختفي: الطلب يُحفظ كما اختاره الزبون، وما لم
            يُحجز مخزونه يبقى ظاهراً باسمه وكميته وسببه ليراجعه الموظّف. */}
        {needsReviewItems.length > 0 && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">
              {needsReviewItems.length} منتجاً يحتاج مراجعة مخزون قبل التجهيز
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {needsReviewItems.map((item) => (
                <li key={item.id}>
                  {splitProductNameSnapshot(item.productNameSnapshot).productName} ×{item.quantity}
                  {item.lineStatusReason ? ` — ${item.lineStatusReason}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-2">
          {items.map((item) => {
            const { productName, variantName } = splitProductNameSnapshot(item.productNameSnapshot);
            return (
              <div
                key={item.id}
                className="flex items-center justify-between border-b border-neutral-100 pb-2 text-sm last:border-0"
              >
                <div>
                  <p className="font-medium text-neutral-800">
                    {productName}
                    {variantName && <span className="text-neutral-500"> — {variantName}</span>}
                    {item.lineStatus !== "reserved" && (
                      <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                        {item.lineStatus === "out_of_stock" ? "غير متوفر" : "يحتاج مراجعة"}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-neutral-500" dir="ltr">{item.skuSnapshot}</p>
                  {item.lineStatusReason && (
                    <p className="text-xs text-red-700">{item.lineStatusReason}</p>
                  )}
                </div>
                <div className="text-left">
                  <p>{formatMad(item.unitPriceSnapshot)} × {item.quantity}</p>
                  <p className="font-semibold text-brand-orange">{formatMad(item.lineTotal)}</p>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-sm font-bold">
          <span>مجموع المنتجات</span>
          <span className="text-brand-orange">{formatMad(order.itemsSubtotal)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm">
          <span className="text-neutral-500">مصاريف التوصيل</span>
          <span className="font-medium text-neutral-800">
            {order.deliveryFee ? formatMad(order.deliveryFee) : "غير محدَّدة بعد"}
          </span>
        </div>
        {order.finalTotal && (
          <div className="mt-2 flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-bold">
            <span>المبلغ الإجمالي عند الاستلام</span>
            <span className="text-brand-orange">{formatMad(order.finalTotal)}</span>
          </div>
        )}

        {/* تعديل مصاريف التوصيل مقصور على Owner/Admin — ليس ضمن قائمة
            صلاحيات Staff الصريحة (عرض/طباعة/تغيير حالة فقط)، وهو حقل مالي. */}
        {isOwnerAdmin(admin) && (
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <DeliveryFeeForm orderId={order.id} currentDeliveryFee={order.deliveryFee} />
          </div>
        )}
      </div>

      {owner && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-800">تعديل محتوى الطلب</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            لإضافة منتج اتفق عليه الزبون لاحقاً على واتساب، أو تصحيح كمية أو ثمن — بدل فتح طلب
            ثانٍ للزبون نفسه.
          </p>
          <OrderItemsEditForm
            orderId={order.id}
            lines={editableLines}
            deliveryFee={order.deliveryFee ? Number(order.deliveryFee) : 0}
            lockedReason={editLockedReason}
          />
        </div>
      )}

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">حالة الطلب</h2>
        <div className="mt-2">
          <OrderStatusForm orderId={order.id} currentStatus={order.status} />
        </div>

        <h3 className="mt-4 text-xs font-semibold text-neutral-600">سجل الحالات</h3>
        <ul className="mt-1 flex flex-col gap-1 text-xs text-neutral-600">
          {history.map((entry, i) => (
            <li key={i}>
              {new Date(entry.changedAt).toLocaleString("ar-MA")} —{" "}
              {ORDER_STATUS_LABELS[entry.status as OrderStatus] ?? entry.status}
              {entry.note ? ` — ${entry.note}` : ""}
              {entry.changedBy ? ` (${entry.changedBy})` : ""}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">ملاحظة داخلية جديدة</h2>
        <div className="mt-2">
          <OrderNoteForm orderId={order.id} />
        </div>
      </div>

      {/* حذف نهائي — مقصور على Owner/Admin، ومفصول في قسم خاص بإطار أحمر
          حتى لا يُضغط بالخطأ بجوار الإجراءات العادية. الصلاحية تُفحص من
          جديد داخل deleteOrder نفسه. */}
      {isOwnerAdmin(admin) && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-red-700">حذف الطلب</h2>
          <p className="mt-1 text-xs text-neutral-600">
            يحذف الطلب وكل سطوره وسجل حالاته نهائياً. لا يمكن التراجع. حركات
            المخزون تبقى محفوظة في السجل، لكن الحذف لا يُرجع الكمية إلى
            المخزون — إن أردت إرجاعها، ألغِ الطلب أولاً ثم احذفه.
          </p>
          <div className="mt-3">
            <DeleteOrderButton orderId={order.id} orderNumber={order.orderNumber} />
          </div>
        </div>
      )}
    </div>
  );
}
