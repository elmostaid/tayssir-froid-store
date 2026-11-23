/**
 * يولّد PDF حقيقياً على شكل فاتورة BigDelivery (نفس مواضع الأعمدة المقاسة على
 * الفاتورة الأصلية FCT-…-1761)، **بأرقام وهواتف وهمية**.
 *
 * الفاتورة الحقيقية لا تدخل المستودع لأن فيها هواتف الزبناء. هذا المولّد يكتب
 * ملف PDF خاماً (Helvetica، بلا مكتبات) فيمرّ بنفس الطريق الذي تمرّ به
 * الفاتورة المرفوعة: pdfjs-dist ← المواضع ← القارئ.
 */

export type FakeParcel = {
  code: string;
  pickup: string;
  delivery?: string;
  phone: string;
  status?: string;
  /** المدينة قد تلتفّ على عدة أسطر كما في الأصل. */
  cityLines: string[];
  cod: number;
  fee: number;
  /** افتراضياً cod − fee. يُغيَّر لاختبار سطر خاطئ. */
  net?: number;
};

export type FakeInvoiceOptions = {
  number: string;
  date?: string;
  parcels: FakeParcel[];
  rowsPerPage?: number;
  /** تكرار رأس الجدول في كل صفحة (الافتراضي نعم). */
  repeatHeader?: boolean;
  /** لتزوير المجاميع في اختبارات الرفض. */
  overrideTotals?: { brut?: number; frais?: number; net?: number; colis?: number; headerTotal?: number };
  otherFees?: number;
  status?: string;
  companyName?: string;
};

type Text = { x: number; y: number; s: string; size?: number };

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const COL = { no: 34, code: 56, pickup: 147, delivery: 212, phone: 276, status: 341, city: 389, cod: 443, fee: 476, net: 519 };

function tableHeader(y: number): Text[] {
  return [
    { x: COL.no, y, s: "N°" },
    { x: COL.code, y, s: "Code d'envoi" },
    { x: COL.pickup, y, s: "Date de" },
    { x: COL.pickup, y: y - 10, s: "ramassage" },
    { x: COL.delivery, y, s: "Date de" },
    { x: COL.delivery, y: y - 10, s: "livraison" },
    { x: COL.phone, y, s: "Téléphone" },
    { x: COL.status, y, s: "Status" },
    { x: COL.city, y, s: "Ville" },
    { x: COL.cod, y, s: "Crbt" },
    { x: COL.fee, y, s: "Frais" },
    { x: COL.net, y, s: "Total" },
  ];
}

export function buildFakeBigDeliveryPdf(opts: FakeInvoiceOptions): Uint8Array {
  const rowsPerPage = opts.rowsPerPage ?? 15;
  const repeatHeader = opts.repeatHeader ?? true;
  const brut = opts.parcels.reduce((s, p) => s + p.cod, 0);
  const frais = opts.parcels.reduce((s, p) => s + p.fee, 0);
  const other = opts.otherFees ?? 0;
  const net = brut - frais - other;
  const t = opts.overrideTotals ?? {};

  const pages: Text[][] = [];
  let page: Text[] = [];
  let y = 0;

  const startPage = (first: boolean) => {
    page = [];
    pages.push(page);
    if (first) {
      page.push(
        { x: 298, y: 811, s: opts.companyName ?? "Big Delivery" },
        { x: 298, y: 801, s: "Adresse: Marrakech" },
        { x: 34, y: 736, s: "Client :" },
        { x: 71, y: 736, s: "Magasin Test" },
        { x: 312, y: 736, s: "Facture :" },
        { x: 357, y: 736, s: opts.number },
        { x: 312, y: 726, s: "Date :" },
        { x: 342, y: 726, s: `${opts.date ?? "2026-11-20"} 16:23` },
        { x: 312, y: 716, s: "Colis :" },
        { x: 342, y: 716, s: String(t.colis ?? opts.parcels.length) },
        { x: 312, y: 706, s: "Total :" },
        { x: 343, y: 706, s: `${t.headerTotal ?? t.net ?? net} DH` },
        { x: 312, y: 696, s: "Statut :" },
        { x: 349, y: 696, s: opts.status ?? "Payé" }
      );
      page.push(...tableHeader(644));
      y = 613;
    } else if (repeatHeader) {
      page.push(...tableHeader(790));
      y = 760;
    } else {
      y = 800;
    }
  };

  startPage(true);
  opts.parcels.forEach((p, i) => {
    if (i > 0 && i % rowsPerPage === 0) {
      page.push({ x: 560, y: 30, s: `${pages.length}/9` });
      startPage(false);
    }
    const n = String(i + 1);
    page.push({ x: COL.no, y, s: n.length > 1 ? n.slice(0, -1) : n });
    if (n.length > 1) page.push({ x: COL.no, y: y - 10, s: n.slice(-1) });
    page.push(
      { x: COL.code, y, s: p.code },
      { x: COL.pickup, y, s: p.pickup },
      { x: COL.phone, y, s: p.phone },
      { x: COL.status, y, s: p.status ?? "Livré" },
      { x: COL.cod, y, s: String(p.cod) },
      { x: COL.cod, y: y - 10, s: "DH" },
      { x: COL.fee, y, s: `${p.fee} DH` },
      { x: COL.net, y, s: `${p.net ?? p.cod - p.fee} DH` }
    );
    if (p.delivery !== undefined) page.push({ x: COL.delivery, y, s: p.delivery });
    else page.push({ x: COL.delivery, y, s: p.pickup });
    p.cityLines.forEach((line, k) => page.push({ x: COL.city, y: y - 10 * k, s: line }));
    y -= Math.max(31, 10 * p.cityLines.length + 11);
  });

  page.push(
    { x: 410, y: y + 5, s: "Total" },
    { x: COL.cod, y: y + 5, s: String(t.brut ?? brut) },
    { x: COL.fee, y: y + 5, s: `${t.frais ?? frais} DH` },
    { x: COL.net, y: y + 5, s: `${t.net ?? net} DH` }
  );
  const fy = y - 40;
  page.push(
    { x: 34, y: fy, s: "Total Brut" },
    { x: 290, y: fy, s: `${t.brut ?? brut} DH` },
    { x: 34, y: fy - 20, s: "Frais" },
    { x: 290, y: fy - 20, s: `${t.frais ?? frais} DH` },
    { x: 34, y: fy - 40, s: "Autres frais" },
    { x: 290, y: fy - 40, s: `${other} DH` },
    { x: 34, y: fy - 60, s: "Total Net" },
    { x: 290, y: fy - 60, s: `${t.net ?? net} DH` },
    { x: 200, y: fy - 90, s: "Sauf Erreur Ou Omission" },
    { x: 560, y: 30, s: `${pages.length}/${pages.length}` }
  );

  return writePdf(pages);
}

function writePdf(pages: Text[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  for (const texts of pages) {
    const stream = texts
      .map((t) => `BT /F1 ${t.size ?? 8} Tf 1 0 0 1 ${t.x} ${t.y} Tm (${esc(t.s)}) Tj ET`)
      .join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 841] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
