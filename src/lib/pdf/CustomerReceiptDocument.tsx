import { Document, Page, Text, View, Image } from "@react-pdf/renderer";
import { pdfStyles, LOGO_PATH } from "@/lib/pdf/theme";
import { formatMad } from "@/lib/format";
import { isFreeDelivery, FREE_DELIVERY_HEADLINE } from "@/lib/delivery";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={pdfStyles.fieldRow}>
      <Text style={pdfStyles.fieldLabel}>{label}</Text>
      <Text style={pdfStyles.fieldValue}>{value}</Text>
    </View>
  );
}

export type ReceiptItem = {
  id: number;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export function CustomerReceiptDocument({
  orderNumber,
  createdAt,
  customerName,
  customerCity,
  itemsSubtotal,
  deliveryFeePerCartonMad,
  items,
}: {
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerCity: string;
  itemsSubtotal: string;
  deliveryFeePerCartonMad: number;
  items: ReceiptItem[];
}) {
  const createdAtLabel = new Date(createdAt).toLocaleString("ar-MA");

  return (
    <Document title={`وصل الطلب ${orderNumber}`}>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.headerRow}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image (PDF canvas), not an HTML <img> */}
          <Image style={pdfStyles.logo} src={LOGO_PATH} />
          <View style={pdfStyles.titleBlock}>
            <Text style={pdfStyles.title}>تأكيد الطلب</Text>
            <Text style={pdfStyles.subtitle}>Bon de commande</Text>
            <Text style={pdfStyles.subtitle}>{orderNumber}</Text>
          </View>
        </View>

        <View style={pdfStyles.section}>
          <Field label="التاريخ" value={createdAtLabel} />
          <Field label="اسم الزبون" value={customerName} />
          <Field label="المدينة" value={customerCity} />
        </View>

        <View style={pdfStyles.table}>
          <View style={pdfStyles.tableHeaderRow}>
            <Text style={pdfStyles.colName}>المنتج</Text>
            <Text style={pdfStyles.colQty}>الكمية</Text>
            <Text style={pdfStyles.colPrice}>ثمن الوحدة</Text>
            <Text style={pdfStyles.colPrice}>المجموع</Text>
          </View>
          {items.map((item) => (
            <View key={item.id} style={pdfStyles.tableRow} wrap={false}>
              <Text style={pdfStyles.colName}>{item.name}</Text>
              <Text style={pdfStyles.colQty}>{item.quantity}</Text>
              <Text style={pdfStyles.colPrice}>{formatMad(item.unitPrice)}</Text>
              <Text style={pdfStyles.colPrice}>{formatMad(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={pdfStyles.totalRow}>
          <Text style={pdfStyles.totalLabel}>مجموع المنتجات</Text>
          <Text style={pdfStyles.totalValue}>{formatMad(itemsSubtotal)}</Text>
        </View>

        <View style={pdfStyles.section}>
          <Text style={pdfStyles.sectionTitle}>معلومات مهمة</Text>
          <Text style={{ fontSize: 9, marginBottom: 2 }}>طريقة الدفع: الدفع عند الاستلام فقط.</Text>
          <Text style={{ fontSize: 9, marginBottom: 2 }}>
            {isFreeDelivery(deliveryFeePerCartonMad)
              ? `${FREE_DELIVERY_HEADLINE}. المبلغ أعلاه هو المبلغ النهائي.`
              : `التوصيل ${formatMad(deliveryFeePerCartonMad)} لكل كرطونة، يُحدَّد عدد الكرطونات بعد تجهيز الطلب.`}
          </Text>
          <Text style={{ fontSize: 9 }}>هذا طلب أولي في انتظار تأكيد فريق Tayssir Froid.</Text>
        </View>

        <Text style={pdfStyles.footerNote}>
          هذا المستند وصل طلب وليس فاتورة ضريبية رسمية. Tayssir Froid.
        </Text>
      </Page>
    </Document>
  );
}
