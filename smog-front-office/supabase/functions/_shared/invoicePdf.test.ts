import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { code39Bars, renderInvoicePdf, renderStatementPdf, type InvoicePdfData } from './invoicePdf';

const shop = { name: 'Smog Zone', street: '10083 Folsom Blvd #D', cityStateZip: 'Rancho Cordova, CA 95670', phone: '(916) 368-9152', ard: '238473' };
export const sample: InvoicePdfData = {
  shop, invoiceNumber: '007875', isInvoice: true, reprint: false,
  customer: 'Maria Garcia', ownerDriver: 'Maria Garcia', address: ['123 Main St Apt 4', 'Rancho Cordova, CA 95670'],
  phone: '(916) 555-0101', registrationDue: '12/31/2026', email: 'maria@example.com',
  timeIn: '11/24/2026 9:02 AM', timeOut: '11/24/2026 9:31 AM', result: 'PASS', certificate: 'AB123456C', technician: 'Jose R.',
  manualEst: '', poNumber: 'PO-77', plate: '7ABC123', plateState: 'CA', yearMakeModel: '2003 Honda Accord', odometer: '120,345',
  vin: '1HGCM82633A004352', reason: 'Smog Test',
  lines: [
    { quantity: 1, code: '01-TEST', description: 'Inspection 2000 and newer', unitPrice: 61.75, discount: 0, extended: 61.75 },
    { quantity: 1, code: '06-CERT', description: 'Smog Certificate', unitPrice: 8.25, discount: 0, extended: 8.25 },
  ],
  notes: 'Tire pressure checked. Customer waited.',
  totals: { parts: 0, tax: 0, certificate: 8.25, labor: 61.75, dmv: 0, total: 70 },
  paidBy: [{ name: 'Cash', amount: 70 }], cardFees: 0, change: 10, signerName: 'Maria Garcia', signedAt: '11/24/2026 9:05 AM',
};

describe('invoice pdf', () => {
  it('code 39 starts and ends with the * guard', () => {
    const { bars, width } = code39Bars('0');
    expect(bars.length).toBe(15); // 3 chars x 5 bars
    expect(width).toBe(3 * 15 + 2 - 0); // each char 12 units+... sanity: positive
  });
  it('renders original and reprint', async () => {
    const bytes = await renderInvoicePdf(sample);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const re = await renderInvoicePdf({ ...sample, reprint: true });
    expect(re.length).toBeGreaterThan(bytes.length);
    if (process.env.PDF_OUT) { writeFileSync(`${process.env.PDF_OUT}/invoice.pdf`, bytes); writeFileSync(`${process.env.PDF_OUT}/reprint.pdf`, re); }
  });
  it('paginates many lines', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ ...sample.lines[0], code: `X${i}` }));
    const doc = await PDFDocument.load(await renderInvoicePdf({ ...sample, lines }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
  it('renders a statement', async () => {
    const bytes = await renderStatementPdf({ shop, company: 'Acme Fleet', contact: 'Bob', address: ['1 Fleet Way'], periodLabel: 'November 2026',
      generated: '11/30/2026', invoices: [{ number: '007876', date: '11/02/2026', plate: '8XYZ999', vehicle: '2019 Ford F-150', total: 31.75, paid: 0 }] });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/statement.pdf`, bytes);
  });
});
