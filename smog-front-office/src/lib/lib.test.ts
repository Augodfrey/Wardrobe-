import { describe, expect, it } from 'vitest';
import { parseAamva, isAamva } from './aamva';
import { findVin, normalizeVin, vinCheckDigitValid } from './vin';
import { classifyScan, parseRegistrationBarcode } from './registration';
import { computeTotals, discountFor, lineTotal } from './totals';
import { lookupZip, lookupZipLocal } from './zip';
import { toCsv } from './csv';
import { formatPhone, toE164 } from './phone';
import { REPORTS, type ReportDataset } from './reports';
import type { Estimate, EstimateItem, Payment, PaymentType } from './types';

const LICENSE_V8 = '@\n\x1e\rANSI 636014080102DL00410279ZC03200024DLDAQY1234567\nDCSGARCIA-LOPEZ\nDDEN\nDACMARIA\nDDFN\nDADELENA\nDDGN\nDCAC\nDCBNONE\nDCDNONE\nDBD08012020\nDBB01151985\nDBA01152028\nDBC2\nDAU065 IN\nDAYBRO\nDAG10083 FOLSOM BLVD\nDAHAPT 4\nDAIRANCHO CORDOVA\nDAJCA\nDAK956700000  \nDCF00/00/0000NNNAN/ANFD/YY\nDCGUSA\n';
const LICENSE_V1 = '@\n\x1e\rANSI 6360150101DL00290192DLDAQ123\nDAAMCDONALD,JOHN,Q\nDAG1 MAIN ST\nDAIAUSTIN\nDAJTX\nDAK78701\n';

describe('AAMVA driver license parsing', () => {
  it('parses v8 names and address, title-cased', () => {
    expect(isAamva(LICENSE_V8)).toBe(true);
    expect(parseAamva(LICENSE_V8)).toEqual({
      firstName: 'Maria', middleName: 'Elena', lastName: 'Garcia-Lopez', street: '10083 Folsom Blvd',
      unit: 'Apt 4', city: 'Rancho Cordova', state: 'CA', zip: '95670',
    });
  });
  it('never returns license number or DOB', () => {
    const r = parseAamva(LICENSE_V8)!;
    expect(JSON.stringify(r)).not.toContain('Y1234567');
    expect(JSON.stringify(r)).not.toContain('1985');
  });
  it('parses v1 combined DAA name', () => {
    const r = parseAamva(LICENSE_V1)!;
    expect(r.lastName).toBe('McDonald');
    expect(r.firstName).toBe('John');
    expect(r.middleName).toBe('Q');
    expect(r.zip).toBe('78701');
  });
  it('returns null for non-license data', () => {
    expect(parseAamva('hello world')).toBeNull();
  });
});

describe('VIN helpers', () => {
  it('validates check digits', () => {
    expect(vinCheckDigitValid('1HGCM82633A004352')).toBe(true);
    expect(vinCheckDigitValid('1HGCM82633A004353')).toBe(false);
  });
  it('strips the door-jamb I prefix', () => {
    expect(normalizeVin('I1HGCM82633A004352')).toBe('1HGCM82633A004352');
  });
  it('prefers a check-digit-valid candidate', () => {
    expect(findVin('XXXXXXXXXXXXXXXXX 1HGCM82633A004352')).toBe('1HGCM82633A004352');
  });
});

describe('registration barcode heuristics', () => {
  it('pulls VIN, plate, year, make', () => {
    const r = parseRegistrationBarcode('7ABC123|1HGCM82633A004352|2003|HOND|ACCORD|SMITH JOHN', new Date('2026-11-24'));
    expect(r).toEqual({ vin: '1HGCM82633A004352', plate: '7ABC123', year: 2003, make: 'Honda' });
  });
  it('classifies scans', () => {
    expect(classifyScan(LICENSE_V8)).toBe('license');
    expect(classifyScan('I1HGCM82633A004352')).toBe('vin');
    expect(classifyScan('7ABC123|1HGCM82633A004352|2003')).toBe('registration');
  });
});

describe('totals', () => {
  const lines = [
    { quantity: 1, unit_price: 61.75, discount_amount: 0, taxable: false, product_type: 'test' as const },
    { quantity: 1, unit_price: 8.25, discount_amount: 0, taxable: false, product_type: 'certificate' as const },
    { quantity: 2, unit_price: 10, discount_amount: 2, taxable: true, product_type: 'parts' as const },
  ];
  it('computes line totals', () => {
    expect(lineTotal(lines[2])).toBe(18);
  });
  it('default estimate (01-TEST + 06-CERT) totals $70.00 with no tax', () => {
    const t = computeTotals(lines.slice(0, 2), 0.0875);
    expect(t.total).toBe(70);
    expect(t.subtotal_labor).toBe(61.75);
    expect(t.state_certificate).toBe(8.25);
    expect(t.tax).toBe(0);
  });
  it('taxes only taxable lines', () => {
    const t = computeTotals(lines, 0.0875);
    expect(t.tax).toBe(1.58);
    expect(t.subtotal_parts).toBe(18);
    expect(t.total).toBe(89.58);
  });
  it('discount terms: percent or flat, capped', () => {
    expect(discountFor({ percent: 10, amount: 0 }, 1, 61.75)).toBe(6.18);
    expect(discountFor({ percent: 0, amount: 100 }, 1, 8.25)).toBe(8.25);
    expect(discountFor(null, 1, 10)).toBe(0);
  });
});

describe('zip lookup', () => {
  it('fills Rancho Cordova locally', () => {
    expect(lookupZipLocal('95670')?.city).toBe('Rancho Cordova');
  });
  it('falls back to the API', async () => {
    const fake = (async () => new Response(JSON.stringify({ places: [{ 'place name': 'Beverly Hills', 'state abbreviation': 'CA' }] }))) as unknown as typeof fetch;
    expect(await lookupZip('90210', fake)).toEqual({ city: 'Beverly Hills', state: 'CA' });
  });
  it('ignores incomplete zips', async () => {
    expect(await lookupZip('956')).toBeNull();
  });
});

describe('csv + phone', () => {
  it('escapes and blocks formula injection', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'x,"y"', b: '=HYPERLINK()' }, { a: -5, b: null }]);
    expect(csv).toBe('A,B\r\n"x,""y""",\'=HYPERLINK()\r\n-5,\r\n');
  });
  it('formats phones', () => {
    expect(formatPhone('9163689152')).toBe('(916) 368-9152');
    expect(toE164('(916) 368-9152')).toBe('+19163689152');
    expect(toE164('123')).toBeNull();
  });
});

describe('reports', () => {
  const pt: PaymentType[] = [
    { id: 'cash', name: 'Cash', sort_order: 1, active: true, is_card: false, card_fee_percent: 0, is_company_account: false },
    { id: 'visa', name: 'Visa', sort_order: 2, active: true, is_card: true, card_fee_percent: 3, is_company_account: false },
  ];
  const base = { status: 'issued', subtotal: 70, tax: 0, total: 70, amount_paid: 70, created_at: '2026-11-02T16:00:00Z',
    time_in: '2026-11-02T16:00:00Z', time_out: '2026-11-02T16:30:00Z', issued_at: '2026-11-02T16:30:00Z',
    paid_at: '2026-11-02T16:35:00Z', customer_first_name: 'A', customer_last_name: 'B', certificate_number: 'C1', result: 'PASS' };
  const estimates = [
    { ...base, id: 'e1', estimate_number: '007875', payment_type_id: 'cash' },
    { ...base, id: 'e2', estimate_number: '007876', payment_type_id: 'visa', certificate_number: 'C1' },
    { ...base, id: 'e3', estimate_number: '007877', status: 'draft', issued_at: null },
  ] as unknown as Estimate[];
  const items = [
    { id: 'i1', estimate_id: 'e1', product_type: 'certificate', total_price: 8.25, quantity: 1, unit_cost: 8.25, discount_amount: 0 },
  ] as unknown as EstimateItem[];
  const payments = [
    { id: 'p1', estimate_id: 'e2', payment_type_id: 'visa', amount: 70, card_fee: 2.1, received_at: '2026-11-02T16:35:00Z' },
  ] as unknown as Payment[];
  const ds: ReportDataset = { estimates, items, payments, products: [], paymentTypes: pt, referralSources: [], discountTerms: [],
    profiles: [], companies: [], reviewRequests: [], audit: [], sessions: [] };
  const o = { begin: new Date('2026-11-01T00:00:00Z'), end: new Date('2026-11-30T23:59:59Z'), detail: false };
  const run = (id: string, detail = false) => REPORTS.find((r) => r.id === id)!.run(ds, { ...o, detail });

  it('sales by payment type groups issued invoices', () => {
    const r = run('sales-by-payment-type');
    expect(r.rows).toEqual(expect.arrayContaining([expect.objectContaining({ group: 'Cash', count: 1, total: 70 }),
      expect.objectContaining({ group: 'Visa', count: 1, total: 70 })]));
    expect(r.footer?.total).toBe(140);
  });
  it('certificate audit flags duplicates and missing cert lines', () => {
    const r = run('certificate-audit');
    expect(r.rows.every((x) => String(x.flags).includes('Duplicate'))).toBe(true);
    expect(String(r.rows.find((x) => x.invoice === '007876')!.flags)).toContain('No certificate line');
  });
  it('open estimates excludes issued', () => {
    expect(run('open-estimates').rows.map((r) => r.estimate)).toEqual(['007877']);
  });
  it('average test time', () => {
    expect(run('avg-test-time').rows[1]).toEqual({ metric: 'Average minutes', value: 30 });
  });
  it('card fees', () => {
    expect(run('card-fees').footer?.fee).toBe(2.1);
  });
  it('every report runs in both modes without throwing', () => {
    for (const r of REPORTS) { r.run(ds, o); r.run(ds, { ...o, detail: true }); }
  });
});
