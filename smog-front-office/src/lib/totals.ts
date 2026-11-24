import type { DiscountTerm, ProductType } from './types';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineInput {
  quantity: number; unit_price: number; discount_amount: number; taxable: boolean; product_type: ProductType;
}

export function lineTotal(l: Pick<LineInput, 'quantity' | 'unit_price' | 'discount_amount'>): number {
  return round2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) - (Number(l.discount_amount) || 0));
}

/** Discount for one line from a discount term: percent of the line, or a flat amount (capped at the line). */
export function discountFor(term: Pick<DiscountTerm, 'percent' | 'amount'> | null | undefined,
  quantity: number, unitPrice: number): number {
  if (!term) return 0;
  const gross = round2(quantity * unitPrice);
  const d = Number(term.percent) > 0 ? round2(gross * Number(term.percent) / 100) : Number(term.amount) || 0;
  return Math.min(round2(d), gross);
}

export interface Totals {
  subtotal: number; subtotal_parts: number; subtotal_labor: number; state_certificate: number;
  dmv_fees: number; discount_total: number; tax: number; total: number;
}

/** Mirrors public.recalc_estimate() in SQL. Keep the two in sync. */
export function computeTotals(lines: LineInput[], taxRate: number): Totals {
  let sub = 0, parts = 0, labor = 0, cert = 0, dmv = 0, disc = 0, taxable = 0;
  for (const l of lines) {
    const t = lineTotal(l);
    sub += t;
    disc += Number(l.discount_amount) || 0;
    if (l.product_type === 'parts' || l.product_type === 'other') parts += t;
    else if (l.product_type === 'test' || l.product_type === 'labor') labor += t;
    else if (l.product_type === 'certificate') cert += t;
    else if (l.product_type === 'dmv_fee') dmv += t;
    if (l.taxable) taxable += t;
  }
  const tax = round2(round2(taxable) * taxRate);
  return {
    subtotal: round2(sub), subtotal_parts: round2(parts), subtotal_labor: round2(labor),
    state_certificate: round2(cert), dmv_fees: round2(dmv), discount_total: round2(disc),
    tax, total: round2(round2(sub) + tax),
  };
}

export const money = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
