import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvoicePdfData, ShopInfo } from './invoicePdf.ts';

const TZ = 'America/Los_Angeles';
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
const phoneFmt = (s?: string | null) => {
  const d = (s ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (s ?? '');
};

// deno-lint-ignore no-explicit-any
export function shopInfo(shop: any): ShopInfo {
  return {
    name: shop.name, street: shop.street ?? '', phone: shop.phone ?? '', ard: shop.ard_number ?? '',
    cityStateZip: [shop.city, [shop.state, shop.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  };
}

async function download(admin: SupabaseClient, bucket: string, path?: string | null): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await admin.storage.from(bucket).download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

/** Loads everything an invoice PDF needs. Uses the service-role client; callers must authorise first. */
export async function loadInvoiceData(admin: SupabaseClient, estimateId: string, reprint: boolean) {
  const { data: e, error } = await admin.from('estimates').select('*').eq('id', estimateId).single();
  if (error || !e) throw new Error('Document not found');
  const [{ data: shop }, { data: items }, { data: payments }, { data: types }, sig, tech, company] = await Promise.all([
    admin.from('shops').select('*').eq('id', e.shop_id).single(),
    admin.from('estimate_items').select('*').eq('estimate_id', e.id).order('line_no'),
    admin.from('payments').select('*').eq('estimate_id', e.id).order('received_at'),
    admin.from('payment_types').select('*').eq('shop_id', e.shop_id),
    e.signature_id ? admin.from('signatures').select('*').eq('id', e.signature_id).single() : Promise.resolve({ data: null }),
    e.technician_id ? admin.from('profiles').select('full_name').eq('id', e.technician_id).single() : Promise.resolve({ data: null }),
    e.company_id ? admin.from('companies').select('name').eq('id', e.company_id).single() : Promise.resolve({ data: null }),
  ]);
  // deno-lint-ignore no-explicit-any
  const typeName = new Map((types ?? []).map((t: any) => [t.id, t]));
  // deno-lint-ignore no-explicit-any
  const paidBy = (payments ?? []).filter((p: any) => !typeName.get(p.payment_type_id)?.is_company_account)
    // deno-lint-ignore no-explicit-any
    .map((p: any) => ({ name: typeName.get(p.payment_type_id)?.name ?? 'Payment', amount: Number(p.amount) }));
  const signature = sig.data;
  const [signaturePng, logoPng] = await Promise.all([
    download(admin, 'signatures', signature?.image_path), shop?.logo_path ? download(admin, 'branding', shop.logo_path) : Promise.resolve(null),
  ]);
  const owner = e.owner_same_as_customer ? `${e.customer_first_name} ${e.customer_last_name}` : `${e.owner_first_name} ${e.owner_last_name}`;
  const data: InvoicePdfData = {
    shop: shopInfo(shop), invoiceNumber: e.estimate_number, isInvoice: e.status === 'issued', reprint,
    customer: `${e.customer_first_name} ${e.customer_last_name}`.trim(), ownerDriver: owner.trim(),
    address: [[e.street, e.unit].filter(Boolean).join(' '), [e.city, [e.state, e.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    phone: phoneFmt(e.phone), registrationDue: fmtDate(e.registration_due_date), email: e.email ?? '',
    timeIn: fmtDateTime(e.time_in), timeOut: fmtDateTime(e.time_out), result: e.result ?? '', certificate: e.certificate_number ?? '',
    technician: tech.data?.full_name ?? '', manualEst: e.manual_estimate_number ?? '', poNumber: e.po_number ?? '',
    plate: e.plate_none ? 'NONE' : (e.plate ?? ''), plateState: e.plate_state ?? '',
    yearMakeModel: [e.year, e.make, e.model].filter(Boolean).join(' '),
    odometer: e.odometer_none ? 'NONE' : (e.odometer != null ? Number(e.odometer).toLocaleString('en-US') : ''),
    vin: e.vin ?? '', reason: e.reason_for_test ?? '',
    // deno-lint-ignore no-explicit-any
    lines: (items ?? []).map((i: any) => ({ quantity: Number(i.quantity), code: i.product_code ?? '', description: i.description,
      unitPrice: Number(i.unit_price), discount: Number(i.discount_amount), extended: Number(i.total_price) })),
    notes: [e.tire_pressure_check ? `Tire pressure: ${e.tire_pressure_check}` : '', e.notes ?? ''].filter(Boolean).join('\n'),
    totals: { parts: Number(e.subtotal_parts), tax: Number(e.tax), certificate: Number(e.state_certificate),
      labor: Number(e.subtotal_labor), dmv: Number(e.dmv_fees), total: Number(e.total) },
    paidBy, cardFees: Number(e.card_fee_total), change: Number(e.change_due),
    billedTo: e.billed_to_company && !e.paid_at ? company.data?.name ?? 'Company Account' : undefined,
    signaturePng, signerName: signature?.signer_name, signedAt: signature ? fmtDateTime(signature.signed_at) : undefined, logoPng,
  };
  return { estimate: e, shop, data };
}
