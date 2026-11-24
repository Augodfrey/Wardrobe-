import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/session';
import { REPORTS, type ReportDataset, type ReportResult } from '../lib/reports';
import { downloadCsv, toCsv } from '../lib/csv';
import { money } from '../lib/totals';
import { ErrorBanner, Field } from '../components/Modal';
import type { ActiveSession, AuditEntry, Estimate, EstimateItem, Payment, ReviewRequest } from '../lib/types';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fetch every row of a query in 1000-row pages. */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export default function Reports() {
  const nav = useNavigate();
  const { lookups } = useSession();
  const now = new Date();
  const [begin, setBegin] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [end, setEnd] = useState(iso(now));
  const [detail, setDetail] = useState(false);
  const [active, setActive] = useState<{ id: string; title: string; result: ReportResult } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async (id: string) => {
    const def = REPORTS.find((r) => r.id === id)!;
    setBusy(id); setErr(null);
    try {
      const b = new Date(`${begin}T00:00:00`); const e = new Date(`${end}T23:59:59.999`);
      // month-to-date needs the start of the end date's month
      const fetchFrom = new Date(Math.min(b.getTime(), new Date(e.getFullYear(), e.getMonth(), 1).getTime()));
      const fIso = fetchFrom.toISOString(); const eIso = e.toISOString();
      const [inRange, open] = await Promise.all([
        all<Estimate>((f, t) => supabase.from('estimates').select('*').or(`and(created_at.gte.${fIso},created_at.lte.${eIso}),and(issued_at.gte.${fIso},issued_at.lte.${eIso})`).range(f, t)),
        all<Estimate>((f, t) => supabase.from('estimates').select('*').in('status', ['draft', 'awaiting_signature', 'signed']).range(f, t)),
      ]);
      const payments = await all<Payment>((f, t) => supabase.from('payments').select('*').gte('received_at', fIso).lte('received_at', eIso).range(f, t));
      const extraIds = [...new Set(payments.map((p) => p.estimate_id))];
      const known = new Map([...inRange, ...open].map((x) => [x.id, x]));
      const missing = extraIds.filter((x) => !known.has(x));
      if (missing.length) {
        const { data } = await supabase.from('estimates').select('*').in('id', missing.slice(0, 500));
        for (const x of (data ?? []) as Estimate[]) known.set(x.id, x);
      }
      // company balances need every unpaid company invoice regardless of date
      if (id === 'accounts') {
        const unpaid = await all<Estimate>((f, t) => supabase.from('estimates').select('*').eq('status', 'issued').is('paid_at', null).not('company_id', 'is', null).range(f, t));
        for (const x of unpaid) known.set(x.id, x);
      }
      const estimates = [...known.values()];
      const ids = estimates.filter((x) => x.status === 'issued').map((x) => x.id);
      const items: EstimateItem[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('estimate_items').select('*').in('estimate_id', ids.slice(i, i + 200));
        items.push(...((data ?? []) as EstimateItem[]));
      }
      const [reviewRequests, audit, sessions] = await Promise.all([
        id === 'review-requests' ? all<ReviewRequest>((f, t) => supabase.from('review_requests').select('*').gte('created_at', fIso).lte('created_at', eIso).range(f, t)) : Promise.resolve([]),
        id === 'system-usage' ? all<AuditEntry>((f, t) => supabase.from('audit_log').select('id, table_name, row_id, action, actor_id, after, created_at').gte('created_at', fIso).lte('created_at', eIso).order('created_at', { ascending: false }).range(f, t)) : Promise.resolve([]),
        id === 'system-usage' ? all<ActiveSession>((f, t) => supabase.from('active_sessions').select('*').gte('created_at', fIso).lte('created_at', eIso).range(f, t)) : Promise.resolve([]),
      ]);
      const ds: ReportDataset = { estimates, items, payments, products: lookups.products, paymentTypes: lookups.paymentTypes,
        referralSources: lookups.referralSources, discountTerms: lookups.discountTerms, profiles: lookups.profiles,
        companies: lookups.companies, reviewRequests, audit, sessions };
      setActive({ id, title: def.title, result: def.run(ds, { begin: b, end: e, detail }) });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };

  const exportCsv = () => {
    if (!active) return;
    const rows = active.result.footer ? [...active.result.rows, active.result.footer] : active.result.rows;
    downloadCsv(`${active.id}_${begin}_${end}${detail ? '_detail' : ''}.csv`, toCsv(active.result.columns, rows));
  };
  const cell = (v: unknown, isMoney?: boolean) => (isMoney && typeof v === 'number' ? money(v) : v === null || v === undefined ? '' : String(v));

  return (
    <div className="p-3 sm:p-4">
      <h1 className="no-print mb-3 text-xl font-extrabold text-cobalt">Main Reports</h1>
      <div className="no-print card mb-3 flex flex-wrap items-end gap-3">
        <Field label="Begin date"><input type="date" className="input" value={begin} onChange={(e) => setBegin(e.target.value)} /></Field>
        <Field label="End date"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <div>
          <span className="field-label">Format</span>
          <div className="flex overflow-hidden rounded border border-slate-300">
            {[false, true].map((d) => <button key={String(d)} className={`px-4 py-2 text-sm font-semibold ${detail === d ? 'bg-cobalt text-white' : 'bg-white'}`} onClick={() => setDetail(d)}>{d ? 'Detail' : 'Summary'}</button>)}
          </div>
        </div>
      </div>
      <ErrorBanner error={err} />
      <div className="no-print mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {REPORTS.map((r) => (
          <button key={r.id} className={`btn-ghost h-auto min-h-[48px] justify-start text-left text-xs ${active?.id === r.id ? 'border-cobalt ring-2 ring-cobalt/30' : ''}`} disabled={!!busy} onClick={() => run(r.id)}>
            {busy === r.id ? 'Running…' : r.title}
          </button>
        ))}
        <button className="btn-ghost h-auto min-h-[48px] justify-start text-xs" onClick={() => nav('/documents')}>Document List</button>
      </div>

      {active && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">{active.title}</h2>
              <p className="text-xs text-slate-500">{begin} to {end} · {detail ? 'Detail' : 'Summary'} · {active.result.rows.length} rows</p>
            </div>
            <div className="no-print flex gap-2">
              <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
              <button className="btn-ghost" onClick={() => window.print()}>Print</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr>{active.result.columns.map((c) => <th key={c.key} className={c.money ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {active.result.rows.map((r, i) => <tr key={i}>{active.result.columns.map((c) => <td key={c.key} className={c.money || typeof r[c.key] === 'number' ? 'text-right tabular-nums' : ''}>{cell(r[c.key], c.money)}</td>)}</tr>)}
                {!active.result.rows.length && <tr><td colSpan={active.result.columns.length} className="py-6 text-center text-slate-500">No data for this period.</td></tr>}
              </tbody>
              {active.result.footer && (
                <tfoot><tr className="font-bold">{active.result.columns.map((c) => <td key={c.key} className={`border-t-2 border-slate-300 px-2 py-1.5 ${c.money ? 'text-right tabular-nums' : ''}`}>{cell(active.result.footer![c.key], c.money)}</td>)}</tr></tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
