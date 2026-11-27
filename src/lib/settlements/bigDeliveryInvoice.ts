import { formatMad } from "@/lib/format";
import type { PdfTextItem } from "./pdfText";
import { parseMadToCents, phoneKey, type Cents } from "./money";

/**
 * قراءة فاتورة BigDelivery النهائية (صفحة «Factures»، PDF من TCPDF).
 *
 * الشكل الذي بُني عليه هذا الملف هو الفاتورة الأصلية FCT-…-1761 (10 كرطونات،
 * 7,693 / 450 / 7,243): رأس فيه رقم الفاتورة والتاريخ وعدد الكرطونات والصافي،
 * ثم جدول بأعمدة ثابتة، ثم مجاميع (Total Brut / Frais / Autres frais / Total Net).
 *
 * **المبدأ: لا نقبل فاتورة لا نفهمها بالكامل.** كل رقم يُتحقَّق منه مرتين على
 * الأقل (السطر: تحصيل − رسوم = صافي، والمجاميع: مجموع السطور = مجموع الفاتورة
 * = الرأس). أي فرق ولو درهماً واحداً يرفض الفاتورة كلها ويقول أين الفرق — لأن
 * فاتورة مقروءة نصفَ قراءة أخطر من فاتورة مرفوضة.
 */

export type CarrierParcelStatus = "delivered" | "returned" | "refused" | "other";

export type ParsedParcel = {
  lineNo: number;
  trackingCode: string;
  pickupDate: string | null;
  deliveryDate: string | null;
  phone: string | null;
  phoneKey: string | null;
  statusRaw: string;
  status: CarrierParcelStatus;
  city: string;
  codCents: Cents;
  feeCents: Cents;
  netCents: Cents;
};

export type ParsedInvoice = {
  carrier: "bigdelivery" | "ozonexpress";
  invoiceNumber: string;
  invoiceDate: string | null;
  carrierStatus: string | null;
  declaredParcelCount: number | null;
  declaredNetCents: Cents | null;
  totalCodCents: Cents | null;
  totalFeesCents: Cents | null;
  otherFeesCents: Cents;
  totalNetCents: Cents | null;
  pageCount: number;
  parcels: ParsedParcel[];
};

export type InvoiceParseResult =
  /** warnings: ملاحظات ما كترفضش الفاتورة (مثلاً خانة ما كنعتمدوش عليها ومختلفة). */
  | { ok: true; invoice: ParsedInvoice; warnings?: string[] }
  | { ok: false; problems: string[]; invoice?: ParsedInvoice };

export function mapCarrierStatus(raw: string): CarrierParcelStatus {
  const s = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/^livre/.test(s)) return "delivered";
  if (/retour/.test(s)) return "returned";
  if (/refus/.test(s)) return "refused";
  return "other";
}

export type Line = { page: number; y: number; items: PdfTextItem[]; text: string };

export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2) {
      last.items.push(it);
    } else {
      lines.push({ page: it.page, y: it.y, items: [it], text: "" });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((i) => i.str).join(" ");
  }
  return lines;
}

const COLUMN_KEYS = [
  "no",
  "code",
  "pickup",
  "delivery",
  "phone",
  "status",
  "city",
  "cod",
  "fee",
  "net",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
type Columns = { key: ColumnKey; x: number }[];

/** يجد صفّ عناوين الجدول ويُرجع بداية كل عمود (x) ومستواه (y). */
function findHeader(lines: Line[], page: number): { columns: Columns; y: number } | null {
  for (const line of lines) {
    if (line.page !== page) continue;
    const code = line.items.find((i) => /^Code d.envoi$/i.test(i.str));
    if (!code) continue;
    const at = (re: RegExp, from = 0) => line.items.filter((i) => re.test(i.str))[from];
    const dates = line.items.filter((i) => /^Date de$/i.test(i.str));
    const found: Partial<Record<ColumnKey, PdfTextItem | undefined>> = {
      no: at(/^N°$|^No$/i),
      code,
      pickup: dates[0],
      delivery: dates[1],
      phone: at(/^T[ée]l[ée]phone$/i),
      status: at(/^Stat(us|ut)$/i),
      city: at(/^Ville$/i),
      cod: at(/^Crbt$/i),
      fee: at(/^Frais$/i),
      net: at(/^Total$/i),
    };
    if (COLUMN_KEYS.some((k) => !found[k])) return null;
    const columns = COLUMN_KEYS.map((key) => ({ key, x: found[key]!.x }));
    return { columns, y: line.y };
  }
  return null;
}

function columnOf(columns: Columns, x: number): ColumnKey | null {
  let current: ColumnKey | null = null;
  for (const col of columns) {
    if (x >= col.x - 4) current = col.key;
  }
  return current;
}

const TRACKING_RE = /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{5,20}$/;
const PAGE_MARK_RE = /^\d+\s*\/\s*\d+$/;
/** أطول ارتفاع لسطر واحد في الجدول (المدينة على 4 أسطر تقريباً). */
const MAX_ROW_HEIGHT = 50;

function firstMatch(lines: Line[], re: RegExp): string | null {
  for (const line of lines) {
    const m = line.text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

export function parseBigDeliveryInvoice(items: PdfTextItem[]): InvoiceParseResult {
  const lines = groupLines(items);
  const allText = lines.map((l) => l.text).join("\n");
  if (!/big\s*delivery/i.test(allText)) {
    return { ok: false, problems: ["هاد الملف ماشي فاتورة BigDelivery (ما لقيتش اسم الشركة فيه)."] };
  }

  const problems: string[] = [];
  const invoiceNumber = firstMatch(lines, /Facture\s*:\s*([A-Z0-9][A-Z0-9-]{3,})/i);
  if (!invoiceNumber) problems.push("ما لقيتش رقم الفاتورة (Facture).");
  const invoiceDate = firstMatch(lines, /Date\s*:\s*(\d{4}-\d{2}-\d{2})/);
  const colis = firstMatch(lines, /Colis\s*:\s*(\d+)/i);
  const declaredNetRaw = firstMatch(lines, /(?:^|\s)Total\s*:\s*(-?[\d\s.,]+)\s*DH/i);
  const carrierStatus = firstMatch(lines, /Statut\s*:\s*(\S+)/i);

  const footer = (label: RegExp) => {
    for (const line of lines) {
      const m = line.text.match(label);
      if (m) return parseMadToCents(m[1]);
    }
    return null;
  };
  const totalCodCents = footer(/^Total Brut\s+(-?[\d\s.,]+)\s*DH$/i);
  const totalFeesCents = footer(/^Frais\s+(-?[\d\s.,]+)\s*DH$/i);
  const otherFeesCents = footer(/^Autres frais\s+(-?[\d\s.,]+)\s*DH$/i);
  const totalNetCents = footer(/^Total Net\s+(-?[\d\s.,]+)\s*DH$/i);

  const pageCount = items.reduce((m, i) => Math.max(m, i.page), 0);
  const parcels: ParsedParcel[] = [];
  let columns: Columns | null = null;

  for (let page = 1; page <= pageCount; page++) {
    const header = findHeader(lines, page);
    if (header) columns = header.columns;
    if (!columns) continue;
    const cols = columns;
    const codeCol = cols.find((c) => c.key === "code")!;
    const pickupCol = cols.find((c) => c.key === "pickup")!;
    const headerY = header ? header.y : Number.POSITIVE_INFINITY;

    const pageItems = items.filter((i) => i.page === page && !PAGE_MARK_RE.test(i.str));
    const anchors = pageItems
      .filter(
        (i) =>
          i.y < headerY - 2 &&
          i.x >= codeCol.x - 4 &&
          i.x < pickupCol.x - 4 &&
          TRACKING_RE.test(i.str)
      )
      .sort((a, b) => b.y - a.y);

    // نهاية آخر سطر في الصفحة: سطر «Total» الملخِّص، أو «Total Brut»، أو حدّ الارتفاع.
    const summaryYs = lines
      .filter(
        (l) =>
          l.page === page &&
          (/^Total\s+-?\d/i.test(l.text) || /Total Brut/i.test(l.text) || /Sauf Erreur/i.test(l.text))
      )
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
        no: [], code: [], pickup: [], delivery: [], phone: [], status: [], city: [], cod: [], fee: [], net: [],
      };
      for (const it of pageItems
        .filter((i) => i.y <= anchor.y + 2 && i.y > floor)
        .sort((a, b) => b.y - a.y || a.x - b.x)) {
        const key = columnOf(cols, it.x);
        if (key) cells[key].push(it.str);
      }
      const join = (k: ColumnKey, sep = " ") => cells[k].join(sep).replace(/\s+/g, " ").trim();
      const rowLabel = parcels.length + 1;
      const cod = parseMadToCents(join("cod"));
      const fee = parseMadToCents(join("fee"));
      const net = parseMadToCents(join("net"));
      const lineNo = Number(join("no", "").replace(/\D/g, "")) || rowLabel;
      if (cod === null || fee === null || net === null) {
        problems.push(
          `الكرطونة ${anchor.str} (سطر ${lineNo}): ما قدرتش نقرا المبالغ («${join("cod")}» / «${join("fee")}» / «${join("net")}»).`
        );
        return;
      }
      const phone = join("phone", "").replace(/[^\d+]/g, "") || null;
      const statusRaw = join("status");
      const pickup = join("pickup").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
      const delivery = join("delivery").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
      parcels.push({
        lineNo,
        trackingCode: anchor.str,
        pickupDate: pickup,
        deliveryDate: delivery,
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

  if (!columns) problems.push("ما لقيتش جدول الكرطونات فالفاتورة.");

  const invoice: ParsedInvoice = {
    carrier: "bigdelivery",
    invoiceNumber: invoiceNumber ?? "",
    invoiceDate,
    carrierStatus,
    declaredParcelCount: colis === null ? null : Number(colis),
    declaredNetCents: declaredNetRaw === null ? null : parseMadToCents(declaredNetRaw),
    totalCodCents,
    totalFeesCents,
    otherFeesCents: otherFeesCents ?? 0,
    totalNetCents,
    pageCount,
    parcels,
  };

  problems.push(...checkInvoiceTotals(invoice));
  return problems.length === 0 ? { ok: true, invoice } : { ok: false, problems, invoice };
}

const mad = (c: number) => formatMad(c / 100);

/** كل التحققات الحسابية. قائمة فارغة = الفاتورة سليمة. */
export function checkInvoiceTotals(inv: ParsedInvoice): string[] {
  const problems: string[] = [];
  if (inv.parcels.length === 0) problems.push("ما لقيتش حتى كرطونة فالفاتورة.");

  for (const p of inv.parcels) {
    if (p.codCents - p.feeCents !== p.netCents) {
      problems.push(
        `الكرطونة ${p.trackingCode}: التحصيل ${mad(p.codCents)} ناقص الرسوم ${mad(p.feeCents)} كيعطي ${mad(p.codCents - p.feeCents)} ماشي ${mad(p.netCents)}.`
      );
    }
    if (p.feeCents < 0 || p.codCents < 0) problems.push(`الكرطونة ${p.trackingCode}: مبلغ سالب.`);
    if (!p.phoneKey) problems.push(`الكرطونة ${p.trackingCode}: الهاتف ناقص أو غير مقروء.`);
  }

  const seen = new Set<string>();
  for (const p of inv.parcels) {
    if (seen.has(p.trackingCode)) problems.push(`الكرطونة ${p.trackingCode} مكررة داخل نفس الفاتورة.`);
    seen.add(p.trackingCode);
  }

  const sumCod = inv.parcels.reduce((s, p) => s + p.codCents, 0);
  const sumFee = inv.parcels.reduce((s, p) => s + p.feeCents, 0);

  if (inv.totalCodCents === null) problems.push("ما لقيتش «Total Brut» فالفاتورة.");
  else if (inv.totalCodCents !== sumCod)
    problems.push(`مجموع التحصيل فالسطور ${mad(sumCod)} والفاتورة كتقول ${mad(inv.totalCodCents)} (فرق ${mad(inv.totalCodCents - sumCod)}).`);

  if (inv.totalFeesCents === null) problems.push("ما لقيتش «Frais» فمجاميع الفاتورة.");
  else if (inv.totalFeesCents !== sumFee)
    problems.push(`مجموع الرسوم فالسطور ${mad(sumFee)} والفاتورة كتقول ${mad(inv.totalFeesCents)} (فرق ${mad(inv.totalFeesCents - sumFee)}).`);

  if (inv.totalNetCents === null) problems.push("ما لقيتش «Total Net» فالفاتورة.");
  else if (inv.totalCodCents !== null && inv.totalFeesCents !== null) {
    const expected = inv.totalCodCents - inv.totalFeesCents - inv.otherFeesCents;
    if (expected !== inv.totalNetCents)
      problems.push(`الصافي ${mad(inv.totalNetCents)} ماشي هو التحصيل ناقص الرسوم والمصاريف الأخرى (${mad(expected)}).`);
  }

  if (inv.declaredNetCents !== null && inv.totalNetCents !== null && inv.declaredNetCents !== inv.totalNetCents)
    problems.push(`الصافي فراس الفاتورة ${mad(inv.declaredNetCents)} وفالأسفل ${mad(inv.totalNetCents)}.`);

  if (inv.declaredParcelCount !== null && inv.declaredParcelCount !== inv.parcels.length)
    problems.push(`الفاتورة كتقول ${inv.declaredParcelCount} كرطونة وقريت ${inv.parcels.length}.`);

  return problems;
}
