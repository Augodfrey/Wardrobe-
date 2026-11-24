import { round2 } from './totals';
import type {
  ActiveSession, AuditEntry, Company, DiscountTerm, Estimate, EstimateItem, Payment, PaymentType,
  Product, Profile, NamedListItem, ReviewRequest,
} from './types';

export interface ReportDataset {
  estimates: Estimate[];          // every document created OR issued in range (plus open ones)
  items: EstimateItem[];
  payments: Payment[];
  products: Product[];
  paymentTypes: PaymentType[];
  referralSources: NamedListItem[];
  discountTerms: DiscountTerm[];
  profiles: Profile[];
  companies: Company[];
  reviewRequests: ReviewRequest[];
  audit: AuditEntry[];
  sessions: ActiveSession[];
}

export interface ReportOptions { begin: Date; end: Date; detail: boolean }
export interface Column { key: string; label: string; money?: boolean }
export interface ReportResult { columns: Column[]; rows: Record<string, unknown>[]; footer?: Record<string, unknown> }
export interface ReportDef { id: string; title: string; run: (d: ReportDataset, o: ReportOptions) => ReportResult }

const inRange = (iso: string | null | undefined, o: ReportOptions) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= o.begin.getTime() && t <= o.end.getTime();
};
const invoicesIn = (d: ReportDataset, o: ReportOptions) =>
  d.estimates.filter((e) => e.status === 'issued' && inRange(e.issued_at, o));
const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US') : '');
const name = (e: Estimate) => `${e.customer_first_name} ${e.customer_last_name}`.trim();
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + (Number(b) || 0), 0));
const minutesBetween = (a: string | null, b: string | null) =>
  a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : null;

const DETAIL_COLS: Column[] = [
  { key: 'invoice', label: 'Invoice #' }, { key: 'date', label: 'Date' }, { key: 'customer', label: 'Customer' },
  { key: 'plate', label: 'Plate' }, { key: 'subtotal', label: 'Subtotal', money: true },
  { key: 'tax', label: 'Tax', money: true }, { key: 'total', label: 'Total', money: true },
];
const invoiceRow = (e: Estimate) => ({
  invoice: e.estimate_number, date: fmtDate(e.issued_at), customer: name(e), plate: e.plate ?? '',
  subtotal: Number(e.subtotal), tax: Number(e.tax), total: Number(e.total),
});

/** Group invoices by a key: summary = one row per group; detail = invoice rows tagged with the group. */
function groupInvoices(label: string, keyOf: (e: Estimate) => string, d: ReportDataset, o: ReportOptions): ReportResult {
  const inv = invoicesIn(d, o);
  if (o.detail) {
    const rows = inv.map((e) => ({ group: keyOf(e) || '(none)', ...invoiceRow(e) }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.invoice.localeCompare(b.invoice));
    return {
      columns: [{ key: 'group', label }, ...DETAIL_COLS], rows,
      footer: { group: 'TOTAL', subtotal: sum(rows.map((r) => r.subtotal)), tax: sum(rows.map((r) => r.tax)), total: sum(rows.map((r) => r.total)) },
    };
  }
  const g = new Map<string, { count: number; subtotal: number; tax: number; total: number }>();
  for (const e of inv) {
    const k = keyOf(e) || '(none)';
    const cur = g.get(k) ?? { count: 0, subtotal: 0, tax: 0, total: 0 };
    cur.count++; cur.subtotal += Number(e.subtotal); cur.tax += Number(e.tax); cur.total += Number(e.total);
    g.set(k, cur);
  }
  const rows = [...g.entries()].sort((a, b) => b[1].total - a[1].total)
    .map(([k, v]) => ({ group: k, count: v.count, subtotal: round2(v.subtotal), tax: round2(v.tax), total: round2(v.total) }));
  return {
    columns: [{ key: 'group', label }, { key: 'count', label: 'Invoices' }, { key: 'subtotal', label: 'Subtotal', money: true },
      { key: 'tax', label: 'Tax', money: true }, { key: 'total', label: 'Total', money: true }],
    rows,
    footer: { group: 'TOTAL', count: inv.length, subtotal: sum(rows.map((r) => r.subtotal)), tax: sum(rows.map((r) => r.tax)), total: sum(rows.map((r) => r.total)) },
  };
}

/** Group line items of issued invoices by a key. */
function groupItems(label: string, keyOf: (i: EstimateItem, p?: Product) => string, d: ReportDataset, o: ReportOptions): ReportResult {
  const inv = byId(invoicesIn(d, o));
  const prods = byId(d.products);
  const items = d.items.filter((i) => inv.has(i.estimate_id));
  if (o.detail) {
    const rows = items.map((i) => {
      const e = inv.get(i.estimate_id)!;
      return {
        group: keyOf(i, i.product_id ? prods.get(i.product_id) : undefined) || '(none)', invoice: e.estimate_number,
        date: fmtDate(e.issued_at), code: i.product_code ?? '', description: i.description, qty: Number(i.quantity),
        price: Number(i.unit_price), discount: Number(i.discount_amount), total: Number(i.total_price),
      };
    }).sort((a, b) => a.group.localeCompare(b.group) || a.invoice.localeCompare(b.invoice));
    return {
      columns: [{ key: 'group', label }, { key: 'invoice', label: 'Invoice #' }, { key: 'date', label: 'Date' },
        { key: 'code', label: 'Product' }, { key: 'description', label: 'Description' }, { key: 'qty', label: 'Qty' },
        { key: 'price', label: 'Unit Price', money: true }, { key: 'discount', label: 'Discount', money: true },
        { key: 'total', label: 'Total', money: true }],
      rows, footer: { group: 'TOTAL', total: sum(rows.map((r) => r.total)), discount: sum(rows.map((r) => r.discount)) },
    };
  }
  const g = new Map<string, { qty: number; cost: number; discount: number; total: number }>();
  for (const i of items) {
    const k = keyOf(i, i.product_id ? prods.get(i.product_id) : undefined) || '(none)';
    const cur = g.get(k) ?? { qty: 0, cost: 0, discount: 0, total: 0 };
    cur.qty += Number(i.quantity); cur.cost += Number(i.unit_cost) * Number(i.quantity);
    cur.discount += Number(i.discount_amount); cur.total += Number(i.total_price);
    g.set(k, cur);
  }
  const rows = [...g.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({
    group: k, qty: round2(v.qty), cost: round2(v.cost), discount: round2(v.discount), total: round2(v.total),
    margin: round2(v.total - v.cost),
  }));
  return {
    columns: [{ key: 'group', label }, { key: 'qty', label: 'Qty' }, { key: 'cost', label: 'Cost', money: true },
      { key: 'discount', label: 'Discounts', money: true }, { key: 'total', label: 'Sales', money: true },
      { key: 'margin', label: 'Margin', money: true }],
    rows,
    footer: { group: 'TOTAL', qty: sum(rows.map((r) => r.qty)), cost: sum(rows.map((r) => r.cost)),
      discount: sum(rows.map((r) => r.discount)), total: sum(rows.map((r) => r.total)), margin: sum(rows.map((r) => r.margin)) },
  };
}

function countBy(label: string, values: string[], order?: string[]): ReportResult {
  const g = new Map<string, number>();
  for (const v of values) g.set(v, (g.get(v) ?? 0) + 1);
  const keys = order ?? [...g.keys()].sort();
  const rows = keys.map((k) => ({ group: k, count: g.get(k) ?? 0 }));
  return { columns: [{ key: 'group', label }, { key: 'count', label: 'Documents' }], rows, footer: { group: 'TOTAL', count: values.length } };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

function durationReport(label: string, pick: (e: Estimate) => [string | null, string | null], d: ReportDataset, o: ReportOptions): ReportResult {
  const rows = invoicesIn(d, o).map((e) => {
    const [a, b] = pick(e);
    return { invoice: e.estimate_number, customer: name(e), start: fmtDate(a), end: fmtDate(b), minutes: minutesBetween(a, b) };
  }).filter((r) => r.minutes !== null && r.minutes >= 0);
  const mins = rows.map((r) => r.minutes as number);
  const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
  const sorted = [...mins].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  if (!o.detail) {
    return {
      columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: label }],
      rows: [{ metric: 'Invoices measured', value: mins.length }, { metric: 'Average minutes', value: avg },
        { metric: 'Median minutes', value: median }, { metric: 'Longest minutes', value: sorted.at(-1) ?? 0 }],
    };
  }
  return {
    columns: [{ key: 'invoice', label: 'Invoice #' }, { key: 'customer', label: 'Customer' }, { key: 'start', label: 'Start' },
      { key: 'end', label: 'End' }, { key: 'minutes', label: 'Minutes' }],
    rows, footer: { invoice: 'AVERAGE', minutes: avg },
  };
}

export const REPORTS: ReportDef[] = [
  {
    id: 'certificate-audit', title: 'Certificate Audit',
    run: (d, o) => {
      const inv = invoicesIn(d, o).filter((e) => e.certificate_number || e.result === 'PASS')
        .sort((a, b) => (a.certificate_number ?? '').localeCompare(b.certificate_number ?? ''));
      const seen = new Map<string, number>();
      for (const e of inv) if (e.certificate_number) seen.set(e.certificate_number, (seen.get(e.certificate_number) ?? 0) + 1);
      const rows = inv.map((e) => {
        const flags: string[] = [];
        if (!e.certificate_number) flags.push('PASS without certificate #');
        else if ((seen.get(e.certificate_number) ?? 0) > 1) flags.push('Duplicate certificate #');
        const certLines = d.items.filter((i) => i.estimate_id === e.id && i.product_type === 'certificate').length;
        if (e.result === 'PASS' && certLines === 0) flags.push('No certificate line billed');
        return { certificate: e.certificate_number ?? '', invoice: e.estimate_number, date: fmtDate(e.issued_at),
          vin: e.vin ?? '', plate: e.plate ?? '', result: e.result ?? '', flags: flags.join('; ') };
      });
      return { columns: [{ key: 'certificate', label: 'Certificate #' }, { key: 'invoice', label: 'Invoice #' },
        { key: 'date', label: 'Date' }, { key: 'vin', label: 'VIN' }, { key: 'plate', label: 'Plate' },
        { key: 'result', label: 'Result' }, { key: 'flags', label: 'Exceptions' }], rows,
        footer: { certificate: `${rows.length} certificates`, flags: `${rows.filter((r) => r.flags).length} exceptions` } };
    },
  },
  {
    id: 'open-estimates', title: 'Open Estimates',
    run: (d) => {
      const rows = d.estimates.filter((e) => ['draft', 'awaiting_signature', 'signed'].includes(e.status))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => ({ estimate: e.estimate_number, created: fmtDate(e.created_at), status: e.status, customer: name(e),
          plate: e.plate ?? '', total: Number(e.total), signed: e.signature_id ? 'Yes' : 'No' }));
      return { columns: [{ key: 'estimate', label: 'Estimate #' }, { key: 'created', label: 'Created' }, { key: 'status', label: 'Status' },
        { key: 'customer', label: 'Customer' }, { key: 'plate', label: 'Plate' }, { key: 'signed', label: 'Signed' },
        { key: 'total', label: 'Total', money: true }], rows, footer: { estimate: `${rows.length} open`, total: sum(rows.map((r) => r.total)) } };
    },
  },
  {
    id: 'mtd-sales', title: 'Month-To-Date Sales',
    run: (d, o) => {
      const end = o.end;
      const mtd = { ...o, begin: new Date(end.getFullYear(), end.getMonth(), 1) };
      return groupInvoices('Day', (e) => (e.issued_at ?? '').slice(0, 10), d, mtd);
    },
  },
  {
    id: 'receipts-by-payment-type', title: 'Receipts by Payment Type',
    run: (d, o) => {
      const pts = byId(d.paymentTypes); const est = byId(d.estimates);
      const pays = d.payments.filter((p) => inRange(p.received_at, o));
      if (o.detail) {
        const rows = pays.map((p) => ({ group: pts.get(p.payment_type_id)?.name ?? '?', invoice: est.get(p.estimate_id)?.estimate_number ?? '',
          date: fmtDate(p.received_at), amount: Number(p.amount), fee: Number(p.card_fee), reference: p.reference ?? '' }))
          .sort((a, b) => a.group.localeCompare(b.group));
        return { columns: [{ key: 'group', label: 'Payment Type' }, { key: 'invoice', label: 'Invoice #' }, { key: 'date', label: 'Received' },
          { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', money: true }, { key: 'fee', label: 'Card Fee', money: true }],
          rows, footer: { group: 'TOTAL', amount: sum(rows.map((r) => r.amount)), fee: sum(rows.map((r) => r.fee)) } };
      }
      const g = new Map<string, { n: number; amt: number; fee: number }>();
      for (const p of pays) {
        const k = pts.get(p.payment_type_id)?.name ?? '?';
        const c = g.get(k) ?? { n: 0, amt: 0, fee: 0 };
        c.n++; c.amt += Number(p.amount); c.fee += Number(p.card_fee); g.set(k, c);
      }
      const rows = [...g].map(([k, v]) => ({ group: k, count: v.n, amount: round2(v.amt), fee: round2(v.fee) }));
      return { columns: [{ key: 'group', label: 'Payment Type' }, { key: 'count', label: 'Payments' },
        { key: 'amount', label: 'Amount', money: true }, { key: 'fee', label: 'Card Fees', money: true }], rows,
        footer: { group: 'TOTAL', count: pays.length, amount: sum(rows.map((r) => r.amount)), fee: sum(rows.map((r) => r.fee)) } };
    },
  },
  {
    id: 'sales-by-payment-type', title: 'Sales by Payment Type',
    run: (d, o) => {
      const pts = byId(d.paymentTypes);
      return groupInvoices('Payment Type', (e) => (e.payment_type_id ? pts.get(e.payment_type_id)?.name ?? '?' : 'Unpaid'), d, o);
    },
  },
  { id: 'sales-by-product-type', title: 'Sales by Product Type', run: (d, o) => groupItems('Product Type', (i) => i.product_type, d, o) },
  { id: 'sales-by-product-id', title: 'Sales by Product ID', run: (d, o) => groupItems('Product', (i) => `${i.product_code ?? ''} ${i.description}`.trim(), d, o) },
  { id: 'sales-by-reason', title: 'Sales by Reason for Test', run: (d, o) => groupInvoices('Reason for Test', (e) => e.reason_for_test ?? '', d, o) },
  {
    id: 'sales-by-referral', title: 'Sales by Referral Source',
    run: (d, o) => { const m = byId(d.referralSources); return groupInvoices('Referred From', (e) => (e.referral_source_id ? m.get(e.referral_source_id)?.name ?? '' : ''), d, o); },
  },
  { id: 'sales-by-zip', title: 'Sales by Customer Zip Code', run: (d, o) => groupInvoices('Zip Code', (e) => e.zip ?? '', d, o) },
  { id: 'sales-by-city', title: 'Sales by Customer City', run: (d, o) => groupInvoices('City', (e) => e.city ?? '', d, o) },
  {
    id: 'sales-by-discount', title: 'Sales by Discount Terms',
    run: (d, o) => { const m = byId(d.discountTerms); return groupItems('Discount Terms', (i) => (i.discount_term_id ? m.get(i.discount_term_id)?.name ?? '' : 'None'), d, o); },
  },
  { id: 'sales-by-bay', title: 'Sales by Test Lane (Bay)', run: (d, o) => groupInvoices('Bay', (e) => e.bay ?? '', d, o) },
  {
    id: 'sales-tax', title: 'Sales Tax Report',
    run: (d, o) => {
      const inv = invoicesIn(d, o);
      const items = d.items.filter((i) => inv.some((e) => e.id === i.estimate_id));
      const taxable = sum(items.filter((i) => i.taxable).map((i) => Number(i.total_price)));
      const nontax = sum(items.filter((i) => !i.taxable).map((i) => Number(i.total_price)));
      const rows = [
        { metric: 'Gross sales', value: sum(inv.map((e) => Number(e.subtotal))) },
        { metric: 'Taxable sales', value: taxable }, { metric: 'Non-taxable sales', value: nontax },
        { metric: 'Sales tax collected', value: sum(inv.map((e) => Number(e.tax))) },
        { metric: 'Total with tax', value: sum(inv.map((e) => Number(e.total))) },
      ];
      if (o.detail) {
        return { columns: DETAIL_COLS, rows: inv.map(invoiceRow), footer: { invoice: 'TOTAL', tax: rows[3].value, total: rows[4].value } };
      }
      return { columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Amount', money: true }], rows };
    },
  },
  {
    id: 'card-fees', title: 'Credit Card Fees Report',
    run: (d, o) => {
      const pts = byId(d.paymentTypes); const est = byId(d.estimates);
      const rows = d.payments.filter((p) => inRange(p.received_at, o) && Number(p.card_fee) > 0).map((p) => ({
        group: pts.get(p.payment_type_id)?.name ?? '?', invoice: est.get(p.estimate_id)?.estimate_number ?? '',
        date: fmtDate(p.received_at), amount: Number(p.amount), fee: Number(p.card_fee) }));
      return { columns: [{ key: 'group', label: 'Card' }, { key: 'invoice', label: 'Invoice #' }, { key: 'date', label: 'Date' },
        { key: 'amount', label: 'Charged', money: true }, { key: 'fee', label: 'Fee', money: true }], rows,
        footer: { group: 'TOTAL', amount: sum(rows.map((r) => r.amount)), fee: sum(rows.map((r) => r.fee)) } };
    },
  },
  {
    id: 'sales-by-employee', title: 'Sales by Employee',
    run: (d, o) => { const m = byId(d.profiles); return groupInvoices('Technician', (e) => m.get(e.technician_id ?? e.created_by ?? '')?.full_name ?? '', d, o); },
  },
  {
    id: 'time-to-tender', title: 'Time Between Estimate Creation and Invoice Tender',
    run: (d, o) => durationReport('Minutes', (e) => [e.created_at, e.paid_at], d, o),
  },
  {
    id: 'estimates-by-hour', title: 'Estimates Created by Time of Day',
    run: (d, o) => countBy('Hour', d.estimates.filter((e) => inRange(e.created_at, o)).map((e) => HOURS[new Date(e.created_at).getHours()]), HOURS),
  },
  {
    id: 'docs-by-weekday', title: 'Documents Created by Day of Week',
    run: (d, o) => countBy('Day', d.estimates.filter((e) => inRange(e.created_at, o)).map((e) => DAYS[new Date(e.created_at).getDay()]), DAYS),
  },
  {
    id: 'avg-test-time', title: 'Average Time to Perform Smog Tests',
    run: (d, o) => durationReport('Minutes', (e) => [e.time_in, e.time_out], d, o),
  },
  {
    id: 'accounts', title: 'Account Reports (Companies & Unpaid Balances)',
    run: (d, o) => {
      const unpaid = d.estimates.filter((e) => e.status === 'issued' && e.company_id && !e.paid_at);
      const comp = byId(d.companies);
      if (o.detail) {
        const rows = unpaid.map((e) => ({ group: comp.get(e.company_id!)?.name ?? '?', invoice: e.estimate_number, date: fmtDate(e.issued_at),
          plate: e.plate ?? '', balance: round2(Number(e.total) - Number(e.amount_paid)) })).sort((a, b) => a.group.localeCompare(b.group));
        return { columns: [{ key: 'group', label: 'Company' }, { key: 'invoice', label: 'Invoice #' }, { key: 'date', label: 'Date' },
          { key: 'plate', label: 'Plate' }, { key: 'balance', label: 'Balance', money: true }], rows,
          footer: { group: 'TOTAL', balance: sum(rows.map((r) => r.balance)) } };
      }
      const rows = d.companies.map((c) => {
        const mine = unpaid.filter((e) => e.company_id === c.id);
        return { group: c.name, mode: c.billing_mode === 'monthly' ? 'Monthly' : 'Pay on the spot', count: mine.length,
          balance: sum(mine.map((e) => Number(e.total) - Number(e.amount_paid))) };
      }).sort((a, b) => b.balance - a.balance);
      return { columns: [{ key: 'group', label: 'Company' }, { key: 'mode', label: 'Billing' }, { key: 'count', label: 'Unpaid Invoices' },
        { key: 'balance', label: 'Balance', money: true }], rows, footer: { group: 'TOTAL', balance: sum(rows.map((r) => r.balance)) } };
    },
  },
  {
    id: 'system-usage', title: 'System Usage Report',
    run: (d, o) => {
      const prof = byId(d.profiles);
      const entries = d.audit.filter((a) => inRange(a.created_at, o));
      if (o.detail) {
        const rows = entries.map((a) => ({ when: fmtDate(a.created_at), user: prof.get(a.actor_id ?? '')?.full_name ?? 'System / customer',
          table: a.table_name, action: a.action, fields: Object.keys(a.after ?? {}).filter((k) => k !== 'updated_at').slice(0, 8).join(', ') }));
        return { columns: [{ key: 'when', label: 'When' }, { key: 'user', label: 'User' }, { key: 'table', label: 'Table' },
          { key: 'action', label: 'Action' }, { key: 'fields', label: 'Fields' }], rows };
      }
      const g = new Map<string, { inserts: number; updates: number; deletes: number }>();
      for (const a of entries) {
        const k = prof.get(a.actor_id ?? '')?.full_name ?? 'System / customer';
        const c = g.get(k) ?? { inserts: 0, updates: 0, deletes: 0 };
        if (a.action === 'insert') c.inserts++; else if (a.action === 'update') c.updates++; else c.deletes++;
        g.set(k, c);
      }
      const sessions = d.sessions.filter((s) => inRange(s.created_at, o));
      const rows = [...g].map(([k, v]) => ({ user: k, ...v,
        sessions: sessions.filter((s) => prof.get(s.user_id)?.full_name === k).length }));
      return { columns: [{ key: 'user', label: 'User' }, { key: 'sessions', label: 'Logins' }, { key: 'inserts', label: 'Created' },
        { key: 'updates', label: 'Edits' }, { key: 'deletes', label: 'Deletes' }], rows };
    },
  },
  {
    id: 'inventory', title: 'Inventory Reports',
    run: (d, o) => {
      const sold = groupItems('Product', (i) => i.product_id ?? '', d, { ...o, detail: false });
      const soldBy = new Map(sold.rows.map((r) => [r.group as string, r]));
      const rows = d.products.map((p) => ({ code: p.code, description: p.description, type: p.product_type,
        active: p.active ? 'Yes' : 'No', tracked: p.track_inventory ? 'Yes' : 'No', on_hand: p.track_inventory ? p.on_hand : '',
        sold: Number(soldBy.get(p.id)?.qty ?? 0), cost: Number(p.unit_cost), price: Number(p.unit_price) }));
      return { columns: [{ key: 'code', label: 'Product' }, { key: 'description', label: 'Description' }, { key: 'type', label: 'Type' },
        { key: 'active', label: 'Active' }, { key: 'tracked', label: 'Tracked' }, { key: 'on_hand', label: 'On Hand' },
        { key: 'sold', label: 'Sold in Range' }, { key: 'cost', label: 'Unit Cost', money: true }, { key: 'price', label: 'Unit Price', money: true }], rows };
    },
  },
  {
    id: 'review-requests', title: 'Review Requests: Sent & Click Rate',
    run: (d, o) => {
      const rr = d.reviewRequests.filter((r) => inRange(r.sent_at ?? r.created_at, o));
      const sent = rr.filter((r) => r.status === 'sent');
      const clicked = sent.filter((r) => r.clicked_at);
      if (o.detail) {
        const est = byId(d.estimates);
        const rows = rr.map((r) => ({ invoice: est.get(r.estimate_id)?.estimate_number ?? '', customer: est.get(r.estimate_id) ? name(est.get(r.estimate_id)!) : '',
          status: r.status, channel: r.channel ?? '', sent: fmtDate(r.sent_at), clicked: fmtDate(r.clicked_at), clicks: r.click_count }));
        return { columns: [{ key: 'invoice', label: 'Estimate #' }, { key: 'customer', label: 'Customer' }, { key: 'status', label: 'Status' },
          { key: 'channel', label: 'Channel' }, { key: 'sent', label: 'Sent' }, { key: 'clicked', label: 'First Click' }, { key: 'clicks', label: 'Clicks' }], rows };
      }
      const rate = sent.length ? `${Math.round((clicked.length / sent.length) * 1000) / 10}%` : '0%';
      return { columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }], rows: [
        { metric: 'Requests sent', value: sent.length },
        { metric: 'By text', value: sent.filter((r) => r.channel === 'sms').length },
        { metric: 'By email', value: sent.filter((r) => r.channel === 'email').length },
        { metric: 'Skipped (no consent / opted out)', value: rr.filter((r) => r.status === 'skipped').length },
        { metric: 'Failed', value: rr.filter((r) => r.status === 'failed').length },
        { metric: 'Clicked', value: clicked.length },
        { metric: 'Click rate', value: rate },
      ] };
    },
  },
];

export const reportById = (id: string) => REPORTS.find((r) => r.id === id);
