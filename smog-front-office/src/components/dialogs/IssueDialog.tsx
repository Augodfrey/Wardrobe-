import { useState } from 'react';
import { ErrorBanner, Field, Modal } from '../Modal';
import { supabase } from '../../lib/supabase';
import type { Estimate, Profile } from '../../lib/types';
import { money } from '../../lib/totals';

/** Issue (Close): converts the estimate into the final, locked invoice. */
export function IssueDialog({ est, profiles, onClose, onIssued }: {
  est: Estimate; profiles: Profile[]; onClose: () => void; onIssued: (e: Estimate) => void;
}) {
  const [result, setResult] = useState<'PASS' | 'FAIL' | ''>(est.result ?? '');
  const [cert, setCert] = useState(est.certificate_number ?? '');
  const [tech, setTech] = useState(est.technician_id ?? '');
  const [bay, setBay] = useState(est.bay ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const techs = profiles.filter((p) => p.active && (p.is_technician || p.role === 'owner'));

  const issue = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('issue_estimate', {
      p_id: est.id, p_result: result || null, p_certificate: cert, p_technician: tech || null, p_bay: bay, p_time_out: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onIssued(data as Estimate);
  };

  return (
    <Modal title={`Issue Invoice #${est.estimate_number}`} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy} onClick={issue}>{busy ? 'Issuing…' : `Issue invoice (${money(est.total)})`}</button>
    </>}>
      <ErrorBanner error={err} />
      <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
        Issuing creates the final invoice with the customer's original signature and <b>locks it permanently</b>. It cannot be edited or reopened afterwards.
      </p>
      {!est.signature_id && <p className="mb-3 rounded bg-brandred/10 p-2 text-sm text-brandred">This estimate has not been signed by the customer.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Results">
          <div className="flex gap-2">
            {(['PASS', 'FAIL'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setResult(r)}
                className={`btn flex-1 ${result === r ? (r === 'PASS' ? 'bg-emerald-600 text-white' : 'bg-brandred text-white') : 'btn-ghost'}`}>{r}</button>
            ))}
          </div>
        </Field>
        <Field label="Certificate #"><input className="input" value={cert} onChange={(e) => setCert(e.target.value.toUpperCase())} /></Field>
        <Field label="Service performed by">
          <select className="input" value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">—</option>
            {techs.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field label="Test lane (bay)"><input className="input" value={bay} onChange={(e) => setBay(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
