import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";

// ملاحظة مهمة (تم اكتشافها تجريبياً): محرك ترتيب النصوص ثنائية الاتجاه في
// هذا الإصدار من @react-pdf/renderer ينهار (crash) عند وجود شرطة "-"/"–"/"—"
// أو نقطتين ":" أو خط عمودي "|" أو نقطة كبيرة "•" داخل نص واحد يخلط بين
// العربية ولاتيني/أرقام. لذلك في كل قوالب PDF هنا: كل حقل عربي ورمز/رقم
// لاتيني في <Text> منفصل (أو مفصولان بمسافة عادية أو فاصلة عربية "،" فقط)
// — أبداً بشرطة أو نقطتين مباشرة بين عربي ولاتيني/أرقام في نفس السلسلة.
let fontsRegistered = false;

export function registerPdfFonts() {
  if (fontsRegistered) return;
  const fontsDir = path.join(process.cwd(), "src/lib/pdf/fonts");
  Font.register({
    family: "NotoNaskh",
    src: path.join(fontsDir, "NotoNaskhArabic-Regular.woff"),
  });
  Font.register({
    family: "NotoNaskhBold",
    src: path.join(fontsDir, "NotoNaskhArabic-Bold.woff"),
  });
  fontsRegistered = true;
}

export const LOGO_PATH = path.join(process.cwd(), "public/brand/logo-tayssir-froid.png");

export const pdfStyles = StyleSheet.create({
  page: {
    padding: 28,
    fontFamily: "NotoNaskh",
    fontSize: 10,
    color: "#292524",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    borderBottom: "2 solid #03AFB9",
    paddingBottom: 10,
  },
  logo: { width: 90 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontFamily: "NotoNaskhBold", fontSize: 15 },
  subtitle: { fontSize: 9, color: "#737373", marginTop: 2 },
  section: {
    marginTop: 10,
    padding: 8,
    backgroundColor: "#F5F5F4",
    borderRadius: 4,
  },
  sectionTitle: { fontFamily: "NotoNaskhBold", fontSize: 11, marginBottom: 4 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  fieldLabel: { fontSize: 9, color: "#737373" },
  fieldValue: { fontFamily: "NotoNaskhBold", fontSize: 10 },
  table: { marginTop: 10 },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#03AFB9",
    color: "#FFFFFF",
    padding: 6,
    fontFamily: "NotoNaskhBold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    padding: 6,
    borderBottom: "1 solid #E5E5E5",
    fontSize: 9,
  },
  colName: { flexGrow: 1, flexBasis: 0 },
  colSku: { width: 65 },
  colVariant: { width: 65 },
  colQty: { width: 40, textAlign: "center" },
  colUnit: { width: 40, textAlign: "center" },
  colPrice: { width: 55, textAlign: "center" },
  colLineTotal: { width: 60, textAlign: "center" },
  colCheck: { width: 24, textAlign: "center" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1 solid #292524",
  },
  totalLabel: { fontFamily: "NotoNaskhBold", fontSize: 11 },
  totalValue: { fontFamily: "NotoNaskhBold", fontSize: 12, color: "#FB5A01" },
  footerNote: { marginTop: 14, fontSize: 8, color: "#737373" },
});
