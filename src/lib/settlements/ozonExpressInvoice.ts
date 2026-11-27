import { formatMad } from "@/lib/format";
import {
  checkInvoiceTotals,
  groupLines,
  mapCarrierStatus,
  type InvoiceParseResult,
  type Line,
  type ParsedInvoice,
  type ParsedParcel,
} from "./bigDeliveryInvoice";
import type { PdfTextItem } from "./pdfText";
import { parseMadToCents, phoneKey } from "./money";

/**
 * قراءة كشف تحويل OzonExpress (PDF «Virement» من TCPDF).
 *
 * بُني على الكشف الأصلي VRT-N-2846416-261026-81-99416 (26 أكتوبر 2026، 14
 * كرطونة). نفس مبدأ BigDelivery: **لا نقبل كشفاً لا نفهمه بالكامل**، ونفس
 * التحققات (checkInvoiceTotals) بعد القراءة.
 *
 * ## الفروق مع BigDelivery
 *
 * - رقم الكشف هو «Virement»، والتاريخ «Date» فالرأس.
 * - رقم التتبع مكتوب على سطرين («TET102633322208» ثم «MA»)، والهاتف تحتو فنفس
 *   العمود (ولا مكان السطر الثاني إلا كان الرقم قصير). ما كاينش عمود هاتف.
 * - الحالة «Livré» وتحتها «Facturé le <تاريخ>» — كناخدو الكلمة الأولى.
 * - **«Total CRBT» فالرأس هو الصافي المحوَّل** (8,035)، ماشي التحصيل الخام.
 * - **«Total Colis» ما كنعتمدوش عليه:** فالكشف الأصلي كيقول 8,175 ومجموع
 *   التحصيل فالسطور 8,735، والفرق (560) ما كيتفسرش بحتى قاعدة واضحة. فالمقابل،
 *   السطور كتتطابق بالضبط مع «Total Frais Colis» (700) و«Total Net» (8,035) ومع
 *   صف «Total» تحت الجدول. التحصيل الخام كنحسبوه: الصافي + الرسوم + المصاريف
 *   الأخرى، وكيتحقق أنه يساوي مجموع السطور. إلا اختلف «Total Colis» كيبان
 *   تنبيه، بلا ما يرفض الكشف.
 */

const PAGE_MARK_RE = /^\d+\s*\/\s*\d+$/;
const PHONE_RE = /^\+?\d[\d\s.]{8,14}$/;
const CODE_PART_RE = /^[A-Za-z0-9]{1,30}$/;
const MAX_ROW_HEIGHT = 55;

const COLUMN_KEYS = ["no", "code", "pickup", "delivery", "status", "city", "cod", "fee", "net"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
type Columns = { key: ColumnKey; x: number }[];

function findHeader(lines: Line[], page: number): { columns: Columns; y: number } | null {
  for (const line of lines) {
    if (line.page !== page) continue;
    const code = line.items.find((i) => /^Code d.?envoi$/i.test(i.str));
    if (!code) continue;
    const at = (re: RegExp) => line.items.find((i) => re.test(i.str));
    const dates = line.items.filter((i) => /^Date de$/i.test(i.str));
    const found: Partial<Record<ColumnKey, PdfTextItem | undefined>> = {
      no: at(/^N°$|^No$/i),
      code,
      pickup: dates[0],
      delivery: dates[1],
      status: at(/^Stat(us|ut)$/i),
      city: at(/^Ville$/i),
      cod: at(/^Crbt$/i),
      fee: at(/^Frais$/i),
      net: at(/^Total$/i),
    };
    if (COLUMN_KEYS.some((k) => !found[k])) return null;
    return { columns: COLUMN_KEYS.map((key) => ({ key, x: found[key]!.x })), y: line.y };
  }
  return null;
}

function columnOf(columns: Columns, x: number): ColumnKey | null {
  let current: ColumnKey | null = null;
  for (const col of columns) if (x >= col.x - 4) current = col.key;
  return current;
}

function firstMatch(lines: Line[], re: RegExp): string | null {
  for (const line of lines) {
    const m = line.text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

const mad = (c: number) => formatMad(c / 100);

export function isOzonExpressInvoice(items: PdfTextItem[]): boolean {
  return items.some((i) => /ozon\s*express/i.test(i.str));
}

export function parseOzonExpressInvoice(items: PdfTextItem[]): InvoiceParseResult {
  const lines = groupLines(items);
  if (!isOzonExpressInvoice(items)) {
    return { ok: false, problems: ["هاد الملف ماشي كشف OzonExpress (ما لقيتش اسم الشركة فيه)."] };
  }

  const problems: string[] = [];
  const invoiceNumber = firstMatch(lines, /Virement\s*:\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  if (!invoiceNumber) problems.push("ما لقيتش رقم الكشف (Virement).");
  const invoiceDate = firstMatch(lines, /(?:^|\s)Date\s*:\s*(\d{4}-\d{2}-\d{2})/);
  const colis = firstMatch(lines, /Colis\s*:\s*(\d+)/i);
  const declaredNetRaw = firstMatch(lines, /Total CRBT\s*:\s*(-?[\d\s.,]+)\s*DH/i);

  const footer = (label: RegExp) => {
    for (const line of lines) {
      const m = line.text.match(label);
      if (m) return parseMadToCents(m[1]);
    }
    return null;
  };
  const totalColisCents = footer(/^Total Colis\s+(-?[\d\s.,]+)\s*DH$/i);
  const totalFeesCents = footer(/^Total Frais Colis\s+(-?[\d\s.,]+)\s*DH$/i);
  const supplementCents = footer(/^Total Frais Supplementaire\s+(-?[\d\s.,]+)\s*DH$/i);
  const transferFeeCents = footer(/^Frais de virement\s*\(-\)\s+(-?[\d\s.,]+)\s*DH$/i);
  const totalNetCents = footer(/^Total Net\s+(-?[\d\s.,]+)\s*DH$/i);
  // صف «Total» تحت الجدول: مجموع الرسوم ومجموع الصافي كما طبعتهم الشركة.
  let tableFees: number | null = null;
  let tableNet: number | null = null;
  for (const line of lines) {
    const m = line.text.match(/^Total\s+(-?[\d\s.,]+)\s*DH\s+(-?[\d\s.,]+)\s*DH$/i);
    if (m) {
      tableFees = parseMadToCents(m[1]);
      tableNet = parseMadToCents(m[2]);
    }
  }

  const pageCount = items.reduce((m, i) => Math.max(m, i.page), 0);
  const parcels: ParsedParcel[] = [];
  let columns: Columns | null = null;

  for (let page = 1; page <= pageCount; page++) {
    const header = findHeader(lines, page);
    if (header) columns = header.columns;
    if (!columns) continue;
    const cols = columns;
    const noCol = cols.find((c) => c.key === "no")!;
    const codeCol = cols.find((c) => c.key === "code")!;
    const headerY = header ? header.y : Number.POSITIVE_INFINITY;
    const pageItems = items.filter((i) => i.page === page && !PAGE_MARK_RE.test(i.str));

    // بداية كل سطر: رقم السطر فعمود «N°».
    const anchors = pageItems
      .filter((i) => i.y < headerY - 2 && i.x >= noCol.x - 4 && i.x < codeCol.x - 4 && /^\d{1,4}$/.test(i.str))
      .sort((a, b) => b.y - a.y);
    const summaryYs = lines
      .filter((l) => l.page === page && (/^Total\b/i.test(l.text) || /Sauf Erreur/i.test(l.text)))
      .map((l) => l.y);

    anchors.forEach((anchor, idx) => {
      const next = anchors[idx + 1];
      const summaryBelow = summaryYs.filter((y) => y < anchor.y - 1).sort((a, b) => b - a)[0];
      const floor = Math.max(
        next ? next.y + 1 : Number.NEGATIVE_INFINITY,
        summaryBelow !== undefined ? summaryBelow + 1 : Number.NEGATIVE_INFINITY,
        anchor.y - MAX_ROW_HEIGHT
      );
      const cells: Record<ColumnKey, string[]> = {
        no: [], code: [], pickup: [], delivery: [], status: [], city: [], cod: [], fee: [], net: [],
      };
      for (const it of pageItems
        .filter((i) => i.y <= anchor.y + 2 && i.y > floor)
        .sort((a, b) => b.y - a.y || a.x - b.x)) {
        const key = columnOf(cols, it.x);
        if (key) cells[key].push(it.str);
      }
      const join = (k: ColumnKey, sep = " ") => cells[k].join(sep).replace(/\s+/g, " ").trim();
      const lineNo = Number(anchor.str);

      // عمود الرمز: أجزاء رقم التتبع (فوق) + الهاتف (رقم من 10 أرقام).
      const phones = cells.code.filter((c) => PHONE_RE.test(c) && c.replace(/\D/g, "").length >= 9);
      const codeParts = cells.code.filter((c) => !phones.includes(c));
      const trackingCode = codeParts.join("");
      if (!trackingCode || codeParts.some((c) => !CODE_PART_RE.test(c))) {
        problems.push(`السطر ${lineNo}: ما قدرتش نقرا رقم التتبع («${cells.code.join(" ")}»).`);
        return;
      }
      const cod = parseMadToCents(join("cod"));
      const fee = parseMadToCents(join("fee"));
      const net = parseMadToCents(join("net"));
      if (cod === null || fee === null || net === null) {
        problems.push(
          `الكرطونة ${trackingCode} (سطر ${lineNo}): ما قدرتش نقرا المبالغ («${join("cod")}» / «${join("fee")}» / «${join("net")}»).`
        );
        return;
      }
      const phone = phones[0]?.replace(/[^\d+]/g, "") ?? null;
      // «Livré» ثم «Facturé le …»: الحالة هي الكلمة الأولى.
      const statusRaw = cells.status[0] ?? "";
      parcels.push({
        lineNo,
        trackingCode,
        pickupDate: join("pickup").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
        deliveryDate: join("delivery").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
        phone,
        phoneKey: phoneKey(phone),
        statusRaw,
        status: mapCarrierStatus(statusRaw),
        city: join("city"),
        codCents: cod,
        feeCents: fee,
        netCents: net,
      });
    });
  }
  if (!columns) problems.push("ما لقيتش جدول الكرطونات فالكشف.");

  const otherFeesCents = (supplementCents ?? 0) + (transferFeeCents ?? 0);
  if (totalFeesCents === null) problems.push("ما لقيتش «Total Frais Colis» فالكشف.");
  if (totalNetCents === null) problems.push("ما لقيتش «Total Net» فالكشف.");
  const sumNetLines = parcels.reduce((s, p) => s + p.netCents, 0);
  if (tableNet !== null && tableNet !== sumNetLines)
    problems.push(`صف «Total» تحت الجدول كيقول ${mad(tableNet)} ومجموع السطور ${mad(sumNetLines)}.`);
  if (tableFees !== null && totalFeesCents !== null && tableFees !== totalFeesCents)
    problems.push(`رسوم صف «Total» ${mad(tableFees)} و«Total Frais Colis» ${mad(totalFeesCents)}.`);

  const invoice: ParsedInvoice = {
    carrier: "ozonexpress",
    invoiceNumber: invoiceNumber ?? "",
    invoiceDate,
    carrierStatus: "Virement",
    declaredParcelCount: colis === null ? null : Number(colis),
    declaredNetCents: declaredNetRaw === null ? null : parseMadToCents(declaredNetRaw),
    // التحصيل الخام كما يُستنتَج من الكشف نفسه (الصافي + الرسوم + المصاريف)؛
    // checkInvoiceTotals كيتأكد أنه يساوي مجموع السطور بالضبط.
    totalCodCents:
      totalNetCents === null || totalFeesCents === null ? null : totalNetCents + totalFeesCents + otherFeesCents,
    totalFeesCents,
    otherFeesCents,
    totalNetCents,
    pageCount,
    parcels,
  };

  problems.push(...checkInvoiceTotals(invoice));
  if (problems.length > 0) return { ok: false, problems, invoice };

  const warnings: string[] = [];
  const sumCod = parcels.reduce((s, p) => s + p.codCents, 0);
  if (totalColisCents !== null && totalColisCents !== sumCod)
    warnings.push(
      `«Total Colis» فالكشف ${mad(totalColisCents)} ومجموع التحصيل فالسطور ${mad(sumCod)} (فرق ${mad(sumCod - totalColisCents)}). ما اعتمدناش عليه: السطور متطابقة بالضبط مع الرسوم (${mad(totalFeesCents ?? 0)}) والصافي المحوَّل (${mad(totalNetCents ?? 0)}).`
    );
  return { ok: true, invoice, warnings };
}
