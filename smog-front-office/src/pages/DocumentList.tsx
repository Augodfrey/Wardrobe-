import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDateTime, fullName, STATUS_COLOR, STATUS_LABEL } from '../lib/format';
import { money } from '../lib/totals';
import { useSession } from '../state/session';
import { OutputDialog } from '../components/dialogs/OutputDialog';
import { QuickFindDialog } from '../components/dialogs/SearchDialogs';
import type { Estimate } from '../lib/types';

const PAGE = 100;

export default function DocumentList() {
  const nav = useNavigate();
  const { lookups } = useSession();
  const [rows, setRows] = useState<Estimate[]>([]);
  const [status, setStatus] = useState<string>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [output, setOutput] = useState<Estimate | null>(null);
  const [quick, setQuick] = useState(false);
  const pt = new Map(lookups.paymentTypes.map((p) => [p.id, p.name]));

  useEffect(() => {
    let query = supabase.from('estimates').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (status === 'open') query = query.in('status', ['draft', 'awaiting_signature', 'signed']);
    else if (status === 'unpaid') query = query.eq('status', 'issued').is('paid_at', null);
    else if (status !== 'all') query = query.eq('status', status);
    if (from) query = query.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte('created_at', new Date(`${to}T23:59:59`).toISOString());
    const s = q.replace(/[%,()*\\]/g, ' ').trim();
    if (s) query = query.or([`customer_first_name.ilike.%${s}%`, `customer_last_name.ilike.%${s}%`, `plate.ilike.%${s}%`, `vin.ilike.%${s}%`,
      `estimate_number.ilike.%${s}%`, `phone.ilike.%${s.replace(/\D/g, '') || s}%`].join(','));
    const h = setTimeout(() => query.then(({ data, count: c }) => { setRows((data ?? []) as Estimate[]); setCount(c ?? 0); }), 200);
    return () => clearTimeout(h);
  }, [status, q, from, to, page]);

  // live: new and changed documents from any device
  useEffect(() => {
    const ch = supabase.channel('doclist').on('postgres_changes', { event: '*', schema: 'public', table: 'estimates' }, (p) => {
      setRows((cur) => {
        if (p.eventType === 'DELETE') return cur.filter((r) => r.id !== (p.old as Estimate).id);
        const n = p.new as Estimate;
        return cur.some((r) => r.id === n.id) ? cur.map((r) => (r.id === n.id ? n : r)) : page === 0 && status === 'all' && !q ? [n, ...cur] : cur;
      });
    }).subscribe();
    return () => { ch.unsubscribe(); };
  }, [page, status, q]);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <h1 className="mr-auto text-xl font-extrabold text-cobalt">Document List</h1>
        <button className="btn-ghost" onClick={() => setQuick(true)}>Quick Find</button>
        <button className="btn-primary" onClick={() => nav('/estimate/new')}>+ New estimate</button>
      </div>
      <div className="card mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input className="input col-span-2" placeholder="Search name, plate, VIN, phone, #" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="all">All documents</option><option value="open">Open estimates</option><option value="awaiting_signature">Awaiting signature</option>
          <option value="signed">Signed (open)</option><option value="issued">Invoices</option><option value="unpaid">Unpaid invoices</option><option value="void">Void</option>
        </select>
        <input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} aria-label="From date" />
        <input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} aria-label="To date" />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="tbl min-w-[900px]">
          <thead><tr><th>#</th><th>Created</th><th>Status</th><th>Customer</th><th>Phone</th><th>Vehicle</th><th>Plate</th><th>Result</th><th>Paid by</th><th className="text-right">Total</th><th /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-cobalt-light" onClick={() => nav(`/estimate/${e.id}`)}>
                <td className="font-mono font-semibold">{e.estimate_number}</td>
                <td className="whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                <td><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[e.status]}`}>{STATUS_LABEL[e.status]}</span></td>
                <td>{fullName(e.customer_first_name, e.customer_last_name)}</td>
                <td className="whitespace-nowrap">{e.phone}</td>
                <td>{[e.year, e.make, e.model].filter(Boolean).join(' ')}</td>
                <td className="font-mono">{e.plate}</td>
                <td className={e.result === 'FAIL' ? 'font-bold text-brandred' : 'font-bold text-emerald-700'}>{e.result}</td>
                <td>{e.paid_at ? pt.get(e.payment_type_id ?? '') : e.billed_to_company ? 'Company acct' : e.status === 'issued' ? <span className="text-brandred">Unpaid</span> : ''}</td>
                <td className="text-right tabular-nums">{money(e.total)}</td>
                <td onClick={(ev) => ev.stopPropagation()}>{e.status === 'issued' && <button className="btn-ghost h-8 min-h-0 px-2 text-xs" onClick={() => setOutput(e)}>Reprint</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="py-8 text-center text-slate-500">No documents match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
        <span>{count} documents</span>
        <div className="flex gap-2">
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn-ghost" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
      {output && <OutputDialog estimateId={output.id} number={output.estimate_number} defaultEmail={output.email} isReprint onClose={() => setOutput(null)} />}
      {quick && <QuickFindDialog onClose={() => setQuick(false)} />}
    </div>
  );
}
