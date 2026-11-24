import { describe, expect, it } from 'vitest';
import { issueProblems, priceFor, statusLine } from './estimateHelpers';
import { allKeysTranslated, t } from './i18n';
import type { Estimate, PriceListItem, Product } from './types';

const base = { status: 'draft', plate: null, plate_none: false, vin: null, customer_first_name: '', phone: null, reason_for_test: null,
  referral_source_id: null, signature_id: null, paid_at: null, billed_to_company: false } as unknown as Estimate;

describe('status line guides the user step by step', () => {
  it('walks through intake', () => {
    expect(statusLine(base, 2)).toBe('Ready to scan DMV Registration');
    const v = { ...base, plate: '7ABC123' };
    expect(statusLine(v, 2)).toMatch(/Driver's License/);
    const c = { ...v, customer_first_name: 'Maria' };
    expect(statusLine(c, 2)).toMatch(/phone/);
    const p = { ...c, phone: '9165550101' };
    expect(statusLine(p, 2)).toBe('Select Reason for Smog Test');
    const r = { ...p, reason_for_test: 'Smog Test' };
    expect(statusLine(r, 2)).toBe('Select Referral Source');
    const s = { ...r, referral_source_id: 'x' };
    expect(statusLine(s, 2)).toMatch(/signature/);
    expect(statusLine({ ...s, signature_id: 'sig', status: 'signed' }, 2)).toMatch(/keep editing/);
  });
  it('issued / void', () => {
    expect(statusLine({ ...base, status: 'issued' }, 1)).toMatch(/Payment/);
    expect(statusLine({ ...base, status: 'issued', paid_at: 'x' }, 1)).toMatch(/paid/);
    expect(statusLine({ ...base, status: 'void' }, 1)).toMatch(/VOID/);
  });
  it('blocks issue without phone or lines', () => {
    expect(issueProblems({ phone: null }, 0)).toHaveLength(2);
    expect(issueProblems({ phone: '1' }, 1)).toHaveLength(0);
  });
});

describe('price lists', () => {
  const p = { id: 'p1', unit_price: 61.75 } as Product;
  const items = [{ price_list_id: 'dealer', product_id: 'p1', unit_price: 31.75 }] as PriceListItem[];
  it('uses list price, falls back to catalog', () => {
    expect(priceFor(p, 'dealer', items)).toBe(31.75);
    expect(priceFor(p, 'regular', items)).toBe(61.75);
    expect(priceFor(p, null, items)).toBe(61.75);
  });
});

describe('i18n', () => {
  it('every customer string has a Spanish translation', () => expect(allKeysTranslated()).toBe(true));
  it('interpolates', () => expect(t('es', 'estimate_no', { n: '007875' })).toBe('Presupuesto #007875'));
});
