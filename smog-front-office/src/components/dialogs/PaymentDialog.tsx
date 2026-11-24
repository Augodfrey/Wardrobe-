import { useMemo, useState } from 'react';
import { ErrorBanner, Field, Modal } from '../Modal';
import { supabase } from '../../lib/supabase';
import { money, round2 } from '../../lib/totals';
import type { Estimate, PaymentType } from '../../lib/types';

interface Row { payment_type_id: string; amount: string; tendered: string; reference: string }

/** Payment: one or more tenders (split payment), optional card fee, change for cash. No card numbers are stored. */
export function PaymentDialog({ est, paymentTypes, onClose, onPaid }: {
  est: Estimate; paymentTypes: PaymentType[]; onClose: () => void; onPaid: (e: Estimate) => void;
}) {
  const types = paymentTypes.filter((p) => p.active && (!p.is_company_account || est.company_id));
  const balance = round2(Number(est.total) - Number(est.amount_paid));
  const [rows, setRows] = useState<Row[]>([{ payment_type_id: types[0]?.id ?? '', amount: balance.toFixed(2), tendered: '', reference: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const allocated = round2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const remaining = round2(balance - allocated);
  const fees = round2(rows.reduce((a, r) => {
    const t = byId.get(r.payment_type_id);
    return a + (t?.is_card ? round2((Number(r.amount) || 0) * Number(t.card_fee_percent) / 100) : 0);
  }, 0));
  const change = round2(rows.reduce((a, r) => a + Math.max(0, (Number(r.tendered) || 0) - (Number(r.amount) || 0)), 0));
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const submit = async () => {
    setErr(null);
    if (rows.some((r) => !r.payment_type_id || !(Number(r.amount) > 0))) return setErr('Each line needs a payment type and an amount');
    if (allocated > balance + 0.001) return setErr(`Payments exceed the balance of ${money(balance)}`);
    setBusy(true);
    const { data, error } = await supabase.rpc('record_payment', {
      p_id: est.id,
      p_lines: rows.map((r) => ({ payment_type_id: r.payment_type_id, amount: Number(r.amount), tendered: r.tendered ? Number(r.tendered) : null, reference: r.reference || null })),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    onPaid(data as Estimate);
  };

  return (
    <Modal title={`Payment — Invoice #${est.estimate_number}`} onClose={onClose} wide footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save payment'}</button>
    </>}>
      <ErrorBanner error={err} />
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <div>Invoice total <b className="text-lg">{money(est.total)}</b></div>
        {Number(est.amount_paid) > 0 && <div>Already paid <b>{money(est.amount_paid)}</b></div>}
        <div>Balance <b className="text-lg text-cobalt">{money(balance)}</b></div>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const t = byId.get(r.payment_type_id);
          return (
            <div key={i} className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-2 sm:grid-cols-[2fr_1fr_1fr_2fr_auto]">
              <Field label="Payment type">
                <select className="input" value={r.payment_type_id} onChange={(e) => set(i, { payment_type_id: e.target.value })}>
                  {types.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Amount"><input className="input" inputMode="decimal" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></Field>
              <Field label={t?.is_card ? 'Card fee' : 'Tendered'}>
                {t?.is_card
                  ? <div className="input bg-slate-50">{money(round2((Number(r.amount) || 0) * Number(t.card_fee_percent) / 100))}</div>
                  : <input className="input" inputMode="decimal" value={r.tendered} placeholder="optional" onChange={(e) => set(i, { tendered: e.target.value })} />}
              </Field>
              <Field label={t?.is_company_account ? 'Statement note' : 'Reference (check #, Zelle conf.)'}>
                <input className="input" value={r.reference} onChange={(e) => set(i, { reference: e.target.value })} />
              </Field>
              <div className="flex items-end">
                {rows.length > 1 && <button className="btn-ghost text-brandred" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove tender">✕</button>}
              </div>
              {t?.is_company_account && <p className="col-span-full text-xs text-amber-700">Billed to the company account — the invoice stays unpaid until the company pays its statement.</p>}
            </div>
          );
        })}
      </div>
      <button className="btn-ghost mt-2" disabled={remaining <= 0}
        onClick={() => setRows([...rows, { payment_type_id: types[0]?.id ?? '', amount: remaining.toFixed(2), tendered: '', reference: '' }])}>
        + Split payment
      </button>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded bg-slate-50 p-3 text-sm">
        <div>Remaining <b className={remaining > 0 ? 'text-brandred' : ''}>{money(remaining)}</b></div>
        <div>Card fees <b>{money(fees)}</b></div>
        <div>Change due <b className="text-lg text-emerald-700">{money(change)}</b></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Card numbers are never entered or stored here. Run cards on the terminal, then record the tender.</p>
    </Modal>
  );
}
