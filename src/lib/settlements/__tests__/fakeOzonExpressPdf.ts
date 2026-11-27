import { writePdf, type Text } from "./fakeBigDeliveryPdf";

/**
 * يولّد PDF على شكل كشف تحويل OzonExpress (نفس مواضع الأعمدة المقاسة على
 * الكشف الأصلي VRT-N-2846416-261026-81-99416)، **بأرقام وهواتف وهمية**.
 *
 * خصائص الأصل اللي كيعاود يصنعها: رقم التتبع على سطرين (الجزء الثاني تحت)،
 * الهاتف تحت الرمز (ولا فالسطر الثاني إلا ما كانش جزء ثاني)، «Livré» ثم
 * «Facturé le»، الصفحة الثانية بلا رأس جدول، و«Total Colis» اللي ممكن يختلف.
 */

export type FakeOzonParcel = {
  /** الجزء الأول من رقم التتبع (السطر الأول). */
  code: string;
  /** الجزء الثاني تحت (مثلاً «MA»). فارغ = الهاتف كيطلع للسطر الثاني. */
  suffix?: string;
  phone: string;
  pickup: string;
  delivery: string;
  status?: string;
  city: string;
  cod: number;
  fee: number;
  net?: number;
};

export type FakeOzonOptions = {
  number: string;
  date?: string;
  parcels: FakeOzonParcel[];
  rowsPerPage?: number;
  /** «Total Colis» كما تطبعه الشركة (الأصل: 8175 مقابل 8735 فالسطور). */
  totalColis?: number;
  overrideTotals?: { frais?: number; net?: number; headerNet?: number; tableNet?: number; colis?: number };
  supplement?: number;
  transferFee?: number;
};

const COL = { no: 34, code: 66, pickup: 169, delivery: 233, status: 298, city: 352, cod: 422, fee: 476, net: 519 };

export function buildFakeOzonExpressPdf(opts: FakeOzonOptions): Uint8Array {
  const rowsPerPage = opts.rowsPerPage ?? 12;
  const brut = opts.parcels.reduce((s, p) => s + p.cod, 0);
  const frais = opts.parcels.reduce((s, p) => s + p.fee, 0);
  const other = (opts.supplement ?? 0) + (opts.transferFee ?? 0);
  const net = brut - frais - other;
  const t = opts.overrideTotals ?? {};
  const date = opts.date ?? "2026-10-26";

  const pages: Text[][] = [];
  let page: Text[] = [];
  let y = 0;
  const startPage = (first: boolean) => {
    page = [];
    pages.push(page);
    if (first) {
      page.push(
        { x: 298, y: 811, s: "Ozon Express" },
        { x: 298, y: 801, s: "Adresse: Casablanca" },
        { x: 34, y: 736, s: "Client :" },
        { x: 71, y: 736, s: "Magasin Test" },
        { x: 312, y: 736, s: "Virement :" },
        { x: 364, y: 736, s: opts.number },
        { x: 312, y: 726, s: "Date :" },
        { x: 342, y: 726, s: `${date} 20:16` },
        { x: 312, y: 716, s: "Colis :" },
        { x: 342, y: 716, s: String(t.colis ?? opts.parcels.length) },
        { x: 312, y: 706, s: "Total CRBT :" },
        { x: 370, y: 706, s: `${t.headerNet ?? t.net ?? net}.00 DH` },
        { x: 34, y: 654, s: "N°" },
        { x: COL.code, y: 654, s: "Code denvoi" },
        { x: COL.pickup, y: 654, s: "Date de" },
        { x: COL.pickup, y: 644, s: "ramassage" },
        { x: COL.delivery, y: 654, s: "Date de" },
        { x: COL.delivery, y: 644, s: "livraison" },
        { x: COL.status, y: 654, s: "Status" },
        { x: COL.city, y: 654, s: "Ville" },
        { x: COL.cod, y: 654, s: "Crbt" },
        { x: COL.fee, y: 654, s: "Frais" },
        { x: COL.net, y: 654, s: "Total" }
      );
      y = 623;
    } else {
      y = 800;
    }
  };

  startPage(true);
  opts.parcels.forEach((p, i) => {
    if (i > 0 && i % rowsPerPage === 0) {
      page.push({ x: 534, y: 20, s: `${pages.length} / 9` });
      startPage(false);
    }
    page.push(
      { x: COL.no, y, s: String(i + 1) },
      { x: COL.code, y, s: p.code },
      { x: COL.pickup, y, s: p.pickup },
      { x: COL.delivery, y, s: p.delivery },
      { x: COL.status, y, s: p.status ?? "Livré" },
      { x: COL.city, y, s: p.city },
      { x: COL.cod, y, s: `${p.cod} DH` },
      { x: COL.fee, y, s: `${p.fee} DH` },
      { x: COL.net, y, s: `${p.net ?? p.cod - p.fee} DH` },
      { x: COL.pickup, y: y - 10, s: "22:20" },
      { x: COL.delivery, y: y - 10, s: "19:39" },
      { x: COL.status, y: y - 10, s: "Facturé le" },
      { x: COL.status, y: y - 17, s: date },
      { x: COL.status, y: y - 25, s: "20:16" }
    );
    if (p.suffix) page.push({ x: COL.code, y: y - 10, s: p.suffix }, { x: COL.code, y: y - 20, s: p.phone });
    else page.push({ x: COL.code, y: y - 10, s: p.phone });
    y -= 47;
  });

  page.push(
    { x: 436, y: y + 5, s: "Total" },
    { x: COL.fee, y: y + 5, s: `${t.frais ?? frais} DH` },
    // صف «Total» تحت الجدول = مجموع عمود Total (قبل المصاريف الإضافية).
    { x: COL.net, y: y + 5, s: `${t.tableNet ?? (t.net !== undefined ? t.net : brut - frais)} DH` }
  );
  const fy = y - 56;
  page.push(
    { x: 34, y: fy, s: "Total Colis" },
    { x: 303, y: fy, s: `${opts.totalColis ?? brut} DH` },
    { x: 34, y: fy - 22, s: "Total Frais Colis" },
    { x: 303, y: fy - 22, s: `${t.frais ?? frais} DH` },
    { x: 34, y: fy - 43, s: "Total Frais Supplementaire" },
    { x: 303, y: fy - 43, s: `${opts.supplement ?? 0} DH` },
    { x: 34, y: fy - 64, s: "Frais de virement (-)" },
    { x: 303, y: fy - 64, s: `${opts.transferFee ?? 0} DH` },
    { x: 34, y: fy - 86, s: "Total Net" },
    { x: 303, y: fy - 86, s: `${t.net ?? net}.00 DH` },
    { x: 239, y: fy - 107, s: "Sauf Erreur Ou Omission" },
    { x: 534, y: 20, s: `${pages.length} / ${pages.length}` }
  );
  return writePdf(pages);
}
