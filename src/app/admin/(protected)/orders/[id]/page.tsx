import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/requireAdmin";
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
import { CopyDeliveryInfoButton } from "@/components/admin/CopyDeliveryInfoButton";

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

  const [items, history] = await Promise.all([
    getAdminOrderItems(orderId),
    getAdminOrderStatusHistory(orderId),
  ]);

  return (
    <div>
      <Link href="/admin/orders" className="text-xs text-neutral-500 hover:underline">
        ← الرجوع إلى الطلبات
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 dir="ltr" className="font-mono text-xl font-bold text-neutral-800">
          {order.orderNumber}
        </h1>
        <div className="flex flex-wrap gap-2">
          <CopyBonButton order={order} items={items} />
          <a
            href={`/admin/orders/${order.id}/print`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            طباعة البون
          </a>
          <a
            href={`/admin/orders/${order.id}/picking-slip.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
          >
            تحميل PDF
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
            <dd className="font-medium text-neutral-800">{order.customerAddress}</dd>
          </div>
          {order.customerNotes && (
            <div className="col-span-2">
              <dt className="text-neutral-500">ملاحظة الزبون</dt>
              <dd className="font-medium text-neutral-800">{order.customerNotes}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">المنتجات</h2>
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
                  </p>
                  <p className="text-xs text-neutral-500" dir="ltr">{item.skuSnapshot}</p>
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

        <div className="mt-4 border-t border-neutral-200 pt-4">
          <DeliveryFeeForm orderId={order.id} currentDeliveryFee={order.deliveryFee} />
        </div>
      </div>

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
    </div>
  );
}
