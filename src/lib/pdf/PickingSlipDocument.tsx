import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { pdfStyles, LOGO_PATH } from "@/lib/pdf/theme";
import type { AdminOrderDetail, AdminOrderItem } from "@/lib/queries/adminOrders";
import { formatMad } from "@/lib/format";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={pdfStyles.fieldRow}>
      <Text style={pdfStyles.fieldLabel}>{label}</Text>
      <Text style={pdfStyles.fieldValue}>{value}</Text>
    </View>
  );
}

export function PickingSlipDocument({
  order,
  items,
}: {
  order: AdminOrderDetail;
  items: AdminOrderItem[];
}) {
  const createdAtLabel = new Date(order.createdAt).toLocaleString("ar-MA");

  return (
    <Document title={`بون تحضير ${order.orderNumber}`}>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image (PDF canvas), not an HTML <img> */}
          <Image style={pdfStyles.logo} src={LOGO_PATH} />
          <View style={pdfStyles.titleBlock}>
            <Text style={pdfStyles.title}>بون تحضير الطلب</Text>
            <Text style={pdfStyles.subtitle}>{order.orderNumber}</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>معلومات الطلب</Text>
          <Field label="التاريخ" value={createdAtLabel} />
          <Field label="اسم الزبون" value={order.customerName} />
          <Field label="رقم الهاتف" value={order.customerPhone} />
          <Field label="المدينة" value={order.customerCity} />
          <Field label="العنوان" value={order.customerAddress} />
          {order.customerNotes && <Field label="ملاحظة الزبون" value={order.customerNotes} />}
        </View>

        <View style={pdfStyles.table}>
          <View style={pdfStyles.tableHeaderRow}>
            <Text style={pdfStyles.colName}>المنتج</Text>
            <Text style={pdfStyles.colSku}>SKU</Text>
            <Text style={pdfStyles.colQty}>الكمية</Text>
            <Text style={pdfStyles.colUnit}>الوحدة</Text>
            <Text style={pdfStyles.colCheck}>✓</Text>
          </View>
          {items.map((item) => (
            <View key={item.id} style={pdfStyles.tableRow} wrap={false}>
              <Text style={pdfStyles.colName}>{item.productNameSnapshot}</Text>
              <Text style={pdfStyles.colSku}>{item.skuSnapshot}</Text>
              <Text style={pdfStyles.colQty}>{item.quantity}</Text>
              <Text style={pdfStyles.colUnit}>{item.unitLabel ?? ""}</Text>
              <Text style={pdfStyles.colCheck}>[ ]</Text>
            </View>
          ))}
        </View>

        <View style={pdfStyles.totalRow}>
          <Text style={pdfStyles.totalLabel}>مجموع المنتجات</Text>
          <Text style={pdfStyles.totalValue}>{formatMad(order.itemsSubtotal)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Field label="طريقة الدفع" value="الدفع عند الاستلام" />
        </View>

        <View style={{ marginTop: 20 }}>
          <Text style={pdfStyles.fieldLabel}>توقيع الشخص المسؤول عن التحضير</Text>
          <View style={{ marginTop: 24, borderBottom: "1 solid #999999", width: 220 }} />
        </View>

        <Text style={pdfStyles.footerNote}>
          مستند داخلي لتحضير الطلب فقط، لا يُعرض للزبون
        </Text>
        <Text style={pdfStyles.footerNote}>Tayssir Froid</Text>
      </Page>
    </Document>
  );
}
