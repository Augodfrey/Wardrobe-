import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../Modal';
import { supabase } from '../../lib/supabase';
import { fmtDate, fmtDateTime, fullName, STATUS_COLOR, STATUS_LABEL } from '../../lib/format';
import { money } from '../../lib/totals';
import type { Estimate } from '../../lib/types';

const COLS = 'id, estimate_number, status, created_at, issued_at, customer_first_name, customer_last_name, phone, plate, vin, year, make, model, total, result, certificate_number, odometer';

/** Escape a user term for a PostgREST or() filter */
const term = (s: string) => s.replace(/[%,()*\\]/g, ' ').trim();

export function QuickFindDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Estimate[]>([]);
  useEffect(() => {
    const s = term(q);
    if (s.length < 2) { setRows([]); return; }
    const h = setTimeout(async () => {
      const digits = s.replace(/\D/g, '');
      const ors = [`customer_first_name.ilike.%${s}%`, `customer_last_name.ilike.%${s}%`, `plate.ilike.%${s}%`, `vin.ilike.%${s}%`,
        `estimate_number.ilike.%${s}%`, `manual_estimate_number.ilike.%${s}%`, `email.ilike.%${s}%`];
      if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`);
      const { data } = await supabase.from('estimates').select(COLS).or(ors.join(',')).order('created_at', { ascending: false }).limit(50);
      setRows((data ?? []) as Estimate[]);
    }, 250);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <Modal title="Quick Find" onClose={onClose} wide>
      <input autoFocus className="input mb-3 text-base" placeholder="Name, plate, VIN, phone, or invoice #" value={q} onChange={(e) => setQ(e.target.value)} />
      <ResultTable rows={rows} onPick={(e) => { onClose(); nav(`/estimate/${e.id}`); }} />
    </Modal>
  );
}

export function VehicleHistoryDialog({ vin, plate, currentId, onClose, onUseAsRetest }: {
  vin: string | null; plate: string | null; currentId: string; onClose: () => void; onUseAsRetest: (e: Estimate) => void;
}) {
  const nav = useNavigate();
  const [q, setQ] = useState(vin || plate || '');
  const [rows, setRows] = useState<Estimate[]>([]);
  useEffect(() => {
    const s = term(q).toUpperCase();
    if (s.length < 2) { setRows([]); return; }
    const h = setTimeout(async () => {
      const { data } = await supabase.from('estimates').select(COLS).or(`vin.eq.${s},plate.eq.${s},vin.ilike.%${s}%`)
        .neq('id', currentId).order('created_at', { ascending: false }).limit(50);
      setRows((data ?? []) as Estimate[]);
    }, 250);
    return () => clearTimeout(h);
  }, [q, currentId]);
  return (
    <Modal title="Lookup Vehicle Test History" onClose={onClose} wide>
      <input autoFocus className="input mb-3 font-mono uppercase" placeholder="VIN or plate" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length === 0 && q.length > 1 && <p className="text-sm text-slate-500">No previous visits found.</p>}
      <ResultTable rows={rows} showResult onPick={(e) => { onClose(); nav(`/estimate/${e.id}`); }}
        action={(e) => e.status === 'issued' ? <button className="btn-ghost text-xs" onClick={() => { onUseAsRetest(e); onClose(); }}>Use as re-test</button> : null} />
    </Modal>
  );
}

function ResultTable({ rows, onPick, showResult, action }: { rows: Estimate[]; onPick: (e: Estimate) => void; showResult?: boolean; action?: (e: Estimate) => React.ReactNode }) {
  if (!rows.length) return null;
  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="tbl">
        <thead><tr><th>#</th><th>Date</th><th>Status</th><th>Customer</th><th>Vehicle</th><th>Plate</th>{showResult && <th>Result</th>}<th className="text-right">Total</th>{action && <th />}</tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="cursor-pointer hover:bg-cobalt-light" onClick={() => onPick(e)}>
              <td className="font-mono">{e.estimate_number}</td>
              <td>{showResult ? fmtDate(e.issued_at ?? e.created_at) : fmtDateTime(e.created_at)}</td>
              <td><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[e.status]}`}>{STATUS_LABEL[e.status]}</span></td>
              <td>{fullName(e.customer_first_name, e.customer_last_name)}</td>
              <td>{[e.year, e.make, e.model].filter(Boolean).join(' ')}</td>
              <td className="font-mono">{e.plate}</td>
              {showResult && <td className={e.result === 'FAIL' ? 'font-bold text-brandred' : 'font-bold text-emerald-700'}>{e.result}{e.certificate_number ? ` · ${e.certificate_number}` : ''}</td>}
              <td className="text-right">{money(e.total)}</td>
              {action && <td onClick={(ev) => ev.stopPropagation()}>{action(e)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
