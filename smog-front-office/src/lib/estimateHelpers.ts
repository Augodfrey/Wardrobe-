import type { Estimate, PriceListItem, Product } from './types';

export function priceFor(product: Product, priceListId: string | null, items: PriceListItem[]): number {
  if (priceListId) {
    const hit = items.find((i) => i.price_list_id === priceListId && i.product_id === product.id);
    if (hit) return Number(hit.unit_price);
  }
  return Number(product.unit_price);
}

/** The guiding status line under the Estimate Entry title. */
export function statusLine(e: Pick<Estimate, 'status' | 'plate' | 'plate_none' | 'vin' | 'customer_first_name' | 'phone' |
  'reason_for_test' | 'referral_source_id' | 'signature_id' | 'paid_at' | 'billed_to_company'>, itemCount: number): string {
  if (e.status === 'void') return 'This document is VOID';
  if (e.status === 'issued') {
    if (e.paid_at) return 'Invoice issued and paid — closed';
    if (e.billed_to_company) return 'Invoice issued — billed to company account';
    return 'Invoice issued — press Payment to take payment';
  }
  if (!e.plate && !e.plate_none && !e.vin) return 'Ready to scan DMV Registration';
  if (!e.customer_first_name) return "Ready to scan Driver's License or type the customer name";
  if (!e.phone) return 'Enter the customer phone number';
  if (!e.reason_for_test) return 'Select Reason for Smog Test';
  if (!e.referral_source_id) return 'Select Referral Source';
  if (itemCount === 0) return 'Add a product line';
  if (e.status === 'awaiting_signature') return 'Waiting for the customer to sign the link we sent';
  if (!e.signature_id) return 'Ready for customer signature — Hand to Customer or Send Link';
  return 'Signed — keep editing as needed, then Issue when the work is done';
}

/** Fields the customer/staff typed that must be present before Issue. */
export function issueProblems(e: Pick<Estimate, 'phone'>, itemCount: number): string[] {
  const p: string[] = [];
  if (!e.phone) p.push('Phone number must be entered');
  if (itemCount === 0) p.push('Add at least one line item');
  return p;
}
