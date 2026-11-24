// Invoice + monthly statement PDFs. Mirrors the Smog Master invoice layout.
// Pure module: runs in Deno (Edge Functions, via the import map) and in Node (tests).
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';

export interface ShopInfo { name: string; street: string; cityStateZip: string; phone: string; ard: string }

export interface InvoiceLine {
  quantity: number; code: string; description: string; unitPrice: number; discount: number; extended: number;
}

export interface InvoicePdfData {
  shop: ShopInfo;
  invoiceNumber: string;
  isInvoice: boolean;             // false = still an estimate
  reprint: boolean;
  customer: string; ownerDriver: string; address: string[]; phone: string;
  registrationDue: string; email: string;
  timeIn: string; timeOut: string; result: string; certificate: string; technician: string;
  manualEst: string; poNumber: string;
  plate: string; plateState: string; yearMakeModel: string; odometer: string; vin: string; reason: string;
  lines: InvoiceLine[];
  notes: string;
  totals: { parts: number; tax: number; certificate: number; labor: number; dmv: number; total: number };
  paidBy: { name: string; amount: number }[];
  cardFees: number;
  change: number;
  billedTo?: string;
  signaturePng?: Uint8Array | null;
  signerName?: string; signedAt?: string;
  logoPng?: Uint8Array | null;
}

const COBALT = rgb(0, 0x57 / 255, 0xa8 / 255);
const RED = rgb(0xcc / 255, 0x22 / 255, 0x29 / 255);
const GREY = rgb(0.35, 0.35, 0.35);
const LIGHT = rgb(0.9, 0.93, 0.97);
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

// ---- Code 39 barcode (digits) ------------------------------------------------
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  '*': 'nwnnwnwnn',
};
/** Returns bar rectangles [x, width] for a Code 39 symbol (narrow = 1 unit, wide = 3). */
export function code39Bars(text: string): { bars: [number, number][]; width: number } {
  const s = `*${text.replace(/[^0-9]/g, '')}*`;
  const bars: [number, number][] = [];
  let x = 0;
  for (const ch of s) {
    const p = CODE39[ch];
    for (let i = 0; i < 9; i++) {
      const w = p[i] === 'w' ? 3 : 1;
      if (i % 2 === 0) bars.push([x, w]);
      x += w;
    }
    x += 1; // inter-character gap
  }
  return { bars, width: x - 1 };
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, unit: number, h: number) {
  const { bars } = code39Bars(text);
  for (const [bx, w] of bars) page.drawRectangle({ x: x + bx * unit, y, width: w * unit, height: h, color: rgb(0, 0, 0) });
}

// ---- helpers ------------------------------------------------------------------
class Writer {
  constructor(public page: PDFPage, public font: PDFFont, public bold: PDFFont) {}
  text(s: string, x: number, y: number, size = 9, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; right?: boolean; maxWidth?: number } = {}) {
    const f = opts.bold ? this.bold : this.font;
    let str = sanitize(s);
    if (opts.maxWidth) while (str.length > 1 && f.widthOfTextAtSize(str, size) > opts.maxWidth) str = str.slice(0, -1);
    const w = f.widthOfTextAtSize(str, size);
    this.page.drawText(str, { x: opts.right ? x - w : x, y, size, font: f, color: opts.color ?? rgb(0, 0, 0) });
  }
  label(l: string, v: string, x: number, y: number, labelW = 92, maxWidth = 170) {
    this.text(l, x, y, 8, { color: GREY });
    this.text(v, x + labelW, y, 9, { bold: true, maxWidth });
  }
  line(x1: number, y1: number, x2: number, y2: number, t = 0.6, color = rgb(0.7, 0.7, 0.7)) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
  }
}

// WinAnsi standard fonts cannot encode everything; keep Latin-1 and replace the rest
function sanitize(s: string): string {
  return (s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '');
}

function wrap(font: PDFFont, s: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of sanitize(s).split(/\n/)) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && cur) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

async function header(doc: PDFDocument, w: Writer, shop: ShopInfo, logoPng?: Uint8Array | null) {
  const { page } = w;
  const H = page.getHeight();
  w.text(shop.name, 40, H - 52, 18, { bold: true, color: COBALT });
  w.text(shop.street, 40, H - 68, 9);
  w.text(shop.cityStateZip, 40, H - 80, 9);
  w.text(`Phone ${shop.phone}`, 40, H - 92, 9);
  w.text(`ARD # ${shop.ard}`, 40, H - 104, 9, { bold: true });
  if (logoPng && logoPng.length) {
    try {
      const img = await doc.embedPng(logoPng);
      const s = Math.min(150 / img.width, 60 / img.height);
      page.drawImage(img, { x: 572 - img.width * s, y: H - 104, width: img.width * s, height: img.height * s });
      return;
    } catch { /* fall through to text logo */ }
  }
  // Text logo in brand colours
  page.drawRectangle({ x: 422, y: H - 100, width: 150, height: 52, color: COBALT });
  page.drawRectangle({ x: 422, y: H - 100, width: 150, height: 8, color: RED });
  w.text('SMOG', 497, H - 70, 20, { bold: true, color: rgb(1, 1, 1), right: true });
  w.text('ZONE', 501, H - 70, 20, { bold: true, color: rgb(1, 0.85, 0.85) });
  w.text('STAR CERTIFIED', 497, H - 86, 7, { color: rgb(1, 1, 1) });
}

function watermark(w: Writer) {
  const { page } = w;
  const t = 'REPRINT - NOT AN ORIGINAL DOCUMENT';
  const size = 28;
  const width = w.bold.widthOfTextAtSize(t, size);
  page.drawText(t, { x: 306 - (width / 2) * 0.82, y: 396 - (width / 2) * 0.57, size, font: w.bold,
    color: RED, opacity: 0.18, rotate: degrees(35) });
}

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.isInvoice ? 'Invoice' : 'Estimate'} ${d.invoiceNumber} - ${d.shop.name}`);
  doc.setProducer('Smog Zone Front Office');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let w = new Writer(page, font, bold);
  await header(doc, w, d.shop, d.logoPng);

  let y = 792 - 128;
  const title = d.isInvoice ? 'INVOICE' : 'ESTIMATE';
  w.text(title, 306 - bold.widthOfTextAtSize(title, 13) / 2, y + 6, 13, { bold: true, color: COBALT });
  y -= 14;
  w.line(40, y, 572, y, 1, COBALT);
  y -= 14;

  // Left / right info blocks
  const left: [string, string][] = [
    ['Customer', d.customer], ['Owner/Driver', d.ownerDriver], ['Address', d.address[0] ?? ''],
    ['', d.address[1] ?? ''], ['Phone', d.phone], ['Registration Due', d.registrationDue], ['Email Address', d.email],
  ];
  const right: [string, string][] = [
    [d.isInvoice ? 'Invoice #' : 'Estimate #', d.invoiceNumber], ['Date/Time In', d.timeIn], ['Date/Time Out', d.timeOut],
    ['Results', d.result], ['Certificate #', d.certificate], ['Service performed by', d.technician],
    ['Manual Est #', d.manualEst], ['PO #', d.poNumber],
  ];
  const top = y;
  left.forEach(([l, v], i) => w.label(l, v, 40, top - i * 13, 88, 175));
  right.forEach(([l, v], i) => w.label(l, v, 330, top - i * 13, 104, 138));
  y = top - Math.max(left.length, right.length) * 13 - 6;

  // Vehicle row
  page.drawRectangle({ x: 40, y: y - 30, width: 532, height: 30, color: LIGHT });
  const veh: [string, string, number][] = [
    ['License', d.plate, 46], ['State', d.plateState, 112], ['Year/Make/Model', d.yearMakeModel, 150],
    ['Odometer', d.odometer, 300], ['VIN', d.vin, 360], ['Reason for Service', d.reason, 482],
  ];
  for (const [l, v, x] of veh) {
    w.text(l, x, y - 11, 7, { color: GREY });
    w.text(v, x, y - 24, 8.5, { bold: true, maxWidth: l === 'Year/Make/Model' ? 145 : l === 'VIN' ? 120 : 88 });
  }
  y -= 46;

  // Lines
  const cols = { qty: 40, item: 74, desc: 150, unit: 430, disc: 490, ext: 572 };
  const drawHead = () => {
    w.text('Qty', cols.qty, y, 8, { bold: true }); w.text('Item #', cols.item, y, 8, { bold: true });
    w.text('Description', cols.desc, y, 8, { bold: true }); w.text('Unit Price', cols.unit, y, 8, { bold: true, right: true });
    w.text('Discount', cols.disc, y, 8, { bold: true, right: true }); w.text('Extended Price', cols.ext, y, 8, { bold: true, right: true });
    y -= 5; w.line(40, y, 572, y); y -= 12;
  };
  drawHead();
  for (const l of d.lines) {
    if (y < 260) {
      page = doc.addPage([612, 792]); w = new Writer(page, font, bold); y = 740;
      w.text(`${d.isInvoice ? 'Invoice' : 'Estimate'} ${d.invoiceNumber} (continued)`, 40, y, 10, { bold: true }); y -= 22;
      drawHead();
    }
    w.text(String(l.quantity), cols.qty, y, 9); w.text(l.code, cols.item, y, 9, { maxWidth: 72 });
    w.text(l.description, cols.desc, y, 9, { maxWidth: 230 }); w.text(money(l.unitPrice), cols.unit, y, 9, { right: true });
    w.text(l.discount ? money(l.discount) : '', cols.disc, y, 9, { right: true }); w.text(money(l.extended), cols.ext, y, 9, { right: true });
    y -= 14;
  }
  w.line(40, y + 4, 572, y + 4);
  if (d.notes) {
    y -= 6;
    w.text('Notes', 40, y, 8, { bold: true, color: GREY }); y -= 11;
    for (const ln of wrap(font, d.notes, 8.5, 330).slice(0, 6)) { w.text(ln, 40, y, 8.5); y -= 11; }
  }

  // Totals block (right) and legal notice (left)
  let ty = Math.min(y - 6, 250 + 150);
  if (ty < 270) { page = doc.addPage([612, 792]); w = new Writer(page, font, bold); ty = 700; }
  const totals: [string, string, boolean?][] = [
    ['Subtotal Parts', money(d.totals.parts)], ['Sales Tax', money(d.totals.tax)],
    ['State Certificate', money(d.totals.certificate)], ['Subtotal Labor', money(d.totals.labor)],
    ['DMV Fees', money(d.totals.dmv)], ['TOTAL PRICE', money(d.totals.total), true],
  ];
  for (const p of d.paidBy) totals.push([`PAID BY ${p.name.toUpperCase()}`, money(p.amount)]);
  if (d.billedTo) totals.push([`BILLED TO ${d.billedTo.toUpperCase()}`, money(d.totals.total - d.paidBy.reduce((a, b) => a + b.amount, 0))]);
  if (d.cardFees) totals.push(['Card Fee', money(d.cardFees)]);
  totals.push(['Change', money(d.change)]);
  let yy = ty;
  for (const [l, v, strong] of totals) {
    if (strong) { w.page.drawRectangle({ x: 392, y: yy - 4, width: 180, height: 15, color: LIGHT }); }
    w.text(l, 470, yy, strong ? 10 : 8.5, { bold: !!strong, right: true });
    w.text(v, 572, yy, strong ? 10 : 9, { bold: !!strong, right: true });
    yy -= strong ? 16 : 12;
  }
  let ly = ty;
  for (const ln of wrap(font, 'You may choose another Smog Check Station to perform the needed repairs, installations, adjustments, or subsequent tests.', 8.5, 300)) {
    w.text(ln, 40, ly, 8.5, { bold: true }); ly -= 11;
  }

  // Footer: acknowledgement + signature + thanks + barcode
  const fy = Math.min(yy, ly) - 18;
  w.text('I acknowledge receipt of the above services and/or products', 40, fy, 8.5);
  const sigY = fy - 52;
  if (d.signaturePng && d.signaturePng.length) {
    try {
      const img = await doc.embedPng(d.signaturePng);
      const s = Math.min(220 / img.width, 44 / img.height);
      w.page.drawImage(img, { x: 44, y: sigY + 2, width: img.width * s, height: img.height * s });
    } catch { /* ignore bad image */ }
  }
  w.line(40, sigY, 300, sigY, 0.8, rgb(0, 0, 0));
  w.text(`Customer Signature${d.signerName ? `: ${d.signerName}` : ''}${d.signedAt ? `   Signed ${d.signedAt}` : ''}`, 40, sigY - 10, 7.5, { color: GREY, maxWidth: 300 });
  w.text('Thanks for your business!', 40, sigY - 30, 11, { bold: true, color: COBALT });
  drawBarcode(w.page, d.invoiceNumber, 400, sigY - 14, 0.9, 34);
  w.text(d.invoiceNumber, 400, sigY - 26, 8);

  if (d.reprint) for (const p of doc.getPages()) watermark(new Writer(p, font, bold));
  return await doc.save();
}

// ---- Monthly company statement -------------------------------------------------
export interface StatementData {
  shop: ShopInfo; company: string; contact: string; address: string[]; periodLabel: string; generated: string;
  invoices: { number: string; date: string; plate: string; vehicle: string; total: number; paid: number }[];
}

export async function renderStatementPdf(d: StatementData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Statement - ${d.company}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let w = new Writer(page, font, bold);
  await header(doc, w, d.shop);
  let y = 792 - 134;
  w.text('ACCOUNT STATEMENT', 40, y, 14, { bold: true, color: COBALT });
  w.text(`Generated ${d.generated}`, 572, y, 8.5, { right: true, color: GREY });
  y -= 20;
  w.text(d.company, 40, y, 11, { bold: true }); y -= 12;
  if (d.contact) { w.text(`Attn: ${d.contact}`, 40, y, 9); y -= 12; }
  for (const a of d.address.filter(Boolean)) { w.text(a, 40, y, 9); y -= 12; }
  w.text(d.periodLabel, 572, y + 12, 9, { right: true });
  y -= 10;
  const head = () => {
    w.text('Invoice #', 40, y, 8, { bold: true }); w.text('Date', 110, y, 8, { bold: true });
    w.text('Plate', 200, y, 8, { bold: true }); w.text('Vehicle', 270, y, 8, { bold: true });
    w.text('Amount', 470, y, 8, { bold: true, right: true }); w.text('Balance', 572, y, 8, { bold: true, right: true });
    y -= 5; w.line(40, y, 572, y); y -= 12;
  };
  head();
  let balance = 0;
  for (const inv of d.invoices) {
    if (y < 90) { page = doc.addPage([612, 792]); w = new Writer(page, font, bold); y = 740; head(); }
    const due = Math.round((inv.total - inv.paid) * 100) / 100;
    balance += due;
    w.text(inv.number, 40, y, 9); w.text(inv.date, 110, y, 9); w.text(inv.plate, 200, y, 9);
    w.text(inv.vehicle, 270, y, 9, { maxWidth: 150 }); w.text(money(inv.total), 470, y, 9, { right: true });
    w.text(money(due), 572, y, 9, { right: true });
    y -= 13;
  }
  w.line(40, y + 4, 572, y + 4, 1, COBALT);
  y -= 10;
  w.text('BALANCE DUE', 470, y, 11, { bold: true, right: true });
  w.text(money(balance), 572, y, 11, { bold: true, right: true });
  y -= 30;
  w.text(`Please make checks payable to ${d.shop.name}. Questions? Call ${d.shop.phone}.`, 40, y, 9);
  return await doc.save();
}
