import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { callFunction, supabase } from '../lib/supabase';
import { useSession } from '../state/session';
import { ErrorBanner, Field, Modal } from '../components/Modal';
import { lookupZip } from '../lib/zip';
import { fmtDate } from '../lib/format';
import { money, round2 } from '../lib/totals';
import type { Company, Estimate, Vehicle } from '../lib/types';

const blank: Partial<Company> = { name: '', billing_mode: 'on_the_spot', state: 'CA', active: true };

/** Registered companies: profiles, vehicles on file, unpaid invoices, monthly statements. */
export default function Companies() {
  const { lookups, refreshLookups } = useSession();
  const nav = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Company> | null>(null);
  const [unpaidAll, setUnpaidAll] = useState<Estimate[]>([]);
  const [filter, setFilter] = useState('');

  const loadUnpaid = useCallback(() => supabase.from('estimates').select('*').eq('status', 'issued').is('paid_at', null).not('company_id', 'is', null)
    .then(({ data }) => setUnpaidAll((data ?? []) as Estimate[])), []);
  useEffect(() => { loadUnpaid(); }, [loadUnpaid]);

  const balance = (cid: string) => round2(unpaidAll.filter((e) => e.company_id === cid).reduce((a, e) => a + Number(e.total) - Number(e.amount_paid), 0));
  const list = lookups.companies.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
  const company = lookups.companies.find((c) => c.id === selected) ?? null;

  return (
    <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[360px_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-extrabold text-cobalt">Companies</h1>
          <button className="btn-primary" onClick={() => setEditing({ ...blank })}>+ Add</button>
        </div>
        <input className="input mb-2" placeholder="Search companies" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="card divide-y divide-slate-100 p-0">
          {list.map((c) => (
            <button key={c.id} className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-cobalt-light ${selected === c.id ? 'bg-cobalt-light' : ''}`} onClick={() => setSelected(c.id)}>
              <div>
                <div className={`font-semibold ${c.active ? '' : 'text-slate-400 line-through'}`}>{c.name}</div>
                <div className="text-xs text-slate-500">{c.billing_mode === 'monthly' ? 'Billed monthly' : 'Pays on the spot'}{c.contact_person ? ` · ${c.contact_person}` : ''}</div>
              </div>
              {balance(c.id) > 0 && <span className="rounded bg-brandred/10 px-2 py-0.5 text-sm font-bold text-brandred">{money(balance(c.id))}</span>}
            </button>
          ))}
          {!list.length && <p className="p-4 text-sm text-slate-500">No companies yet.</p>}
        </div>
      </div>
      <div>{company ? <CompanyDetail company={company} onEdit={() => setEditing(company)} onChanged={loadUnpaid} onOpen={(id) => nav(`/estimate/${id}`)} />
        : <p className="p-6 text-slate-500">Select a company to see its vehicles, unpaid invoices and statement.</p>}</div>
      {editing && <CompanyForm value={editing} onClose={() => setEditing(null)} onSaved={async (id) => { setEditing(null); await refreshLookups(); setSelected(id); }} />}
    </div>
  );
}

function CompanyDetail({ company, onEdit, onChanged, onOpen }: { company: Company; onEdit: () => void; onChanged: () => void; onOpen: (id: string) => void }) {
  const { lookups } = useSession();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [invoices, setInvoices] = useState<Estimate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payType, setPayType] = useState('');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newVeh, setNewVeh] = useState<Partial<Vehicle> | null>(null);

  const load = useCallback(async () => {
    const [{ data: v }, { data: i }] = await Promise.all([
      supabase.from('vehicles').select('*').eq('company_id', company.id).order('plate'),
      supabase.from('estimates').select('*').eq('company_id', company.id).eq('status', 'issued').is('paid_at', null).order('issued_at'),
    ]);
    setVehicles((v ?? []) as Vehicle[]); setInvoices((i ?? []) as Estimate[]); setPicked(new Set());
  }, [company.id]);
  useEffect(() => { load(); setMsg(null); setErr(null); }, [load]);

  const payTypes = lookups.paymentTypes.filter((p) => p.active && !p.is_company_account);
  const pickedTotal = useMemo(() => round2(invoices.filter((i) => picked.has(i.id)).reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0)), [invoices, picked]);

  const markPaid = async () => {
    if (!payType) return setErr('Choose how the company paid');
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc('mark_company_invoices_paid', { p_ids: [...picked], p_payment_type: payType, p_reference: ref || null });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`${data} invoice(s) marked paid.`); setRef(''); load(); onChanged();
  };
  const statement = async (action: 'view' | 'email') => {
    setErr(null); setMsg(null);
    const win = action === 'view' ? window.open('', '_blank') : null;
    try {
      const r = await callFunction<{ url: string }>('documents', { kind: 'statement', company_id: company.id, action });
      if (win) win.location.href = r.url; else setMsg(`Statement emailed to ${company.email}`);
    } catch (e) { win?.close(); setErr(e instanceof Error ? e.message : String(e)); }
  };
  const saveVehicle = async () => {
    if (!newVeh) return;
    const { error } = await supabase.from('vehicles').insert({ ...newVeh, company_id: company.id });
    if (error) setErr(error.message); else { setNewVeh(null); load(); }
  };

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">{company.name}</h2>
            <p className="text-sm text-slate-600">{[company.contact_person, company.phone, company.email].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-slate-600">{[company.street, company.unit, company.city, company.state, company.zip].filter(Boolean).join(', ')}</p>
            {company.notes && <p className="mt-1 text-sm italic text-slate-500">{company.notes}</p>}
          </div>
          <div className="flex gap-2">
            <span className={`rounded px-2 py-1 text-xs font-bold ${company.billing_mode === 'monthly' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
              {company.billing_mode === 'monthly' ? 'Billed monthly' : 'Pay on the spot'}</span>
            <button className="btn-ghost" onClick={onEdit}>Edit</button>
          </div>
        </div>
      </div>
      <ErrorBanner error={err} />
      {msg && <div className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="section-title mb-0">Unpaid invoices</div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => statement('view')}>View / print statement</button>
            <button className="btn-ghost" disabled={!company.email} onClick={() => statement('email')}>Email statement</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th><input type="checkbox" aria-label="Select all" checked={!!invoices.length && picked.size === invoices.length} onChange={(e) => setPicked(e.target.checked ? new Set(invoices.map((i) => i.id)) : new Set())} /></th>
              <th>Invoice #</th><th>Date</th><th>Plate</th><th>Vehicle</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td><input type="checkbox" checked={picked.has(i.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(i.id); else n.delete(i.id); setPicked(n); }} /></td>
                  <td><button className="font-mono text-cobalt hover:underline" onClick={() => onOpen(i.id)}>{i.estimate_number}</button></td>
                  <td>{fmtDate(i.issued_at)}</td><td className="font-mono">{i.plate}</td><td>{[i.year, i.make, i.model].filter(Boolean).join(' ')}</td>
                  <td className="text-right tabular-nums">{money(Number(i.total) - Number(i.amount_paid))}</td>
                </tr>
              ))}
              {!invoices.length && <tr><td colSpan={6} className="py-4 text-center text-slate-500">Nothing owed.</td></tr>}
            </tbody>
            {!!invoices.length && <tfoot><tr><td colSpan={5} className="text-right font-bold">Balance due</td>
              <td className="text-right font-bold tabular-nums">{money(invoices.reduce((a, i) => a + Number(i.total) - Number(i.amount_paid), 0))}</td></tr></tfoot>}
          </table>
        </div>
        {picked.size > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_auto]">
            <select className="input" value={payType} onChange={(e) => setPayType(e.target.value)} aria-label="Payment type">
              <option value="">Paid by…</option>{payTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="input" placeholder="Check # / reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            <button className="btn-primary" disabled={busy} onClick={markPaid}>Mark {picked.size} paid ({money(pickedTotal)})</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <div className="section-title mb-0">Vehicles on file</div>
          <button className="btn-ghost" onClick={() => setNewVeh({ plate_state: 'CA' })}>+ Add vehicle</button>
        </div>
        <table className="tbl">
          <thead><tr><th>Plate</th><th>VIN</th><th>Vehicle</th><th /></tr></thead>
          <tbody>
            {vehicles.map((v) => <tr key={v.id}><td className="font-mono">{v.plate} {v.plate_state}</td><td className="font-mono text-xs">{v.vin}</td><td>{[v.year, v.make, v.model].filter(Boolean).join(' ')}</td>
              <td><button className="text-xs text-brandred" onClick={async () => { await supabase.from('vehicles').update({ company_id: null }).eq('id', v.id); load(); }}>Remove</button></td></tr>)}
            {newVeh && (
              <tr>
                <td><input className="input uppercase" placeholder="Plate" value={newVeh.plate ?? ''} onChange={(e) => setNewVeh({ ...newVeh, plate: e.target.value.toUpperCase() })} /></td>
                <td><input className="input font-mono uppercase" placeholder="VIN" maxLength={17} value={newVeh.vin ?? ''} onChange={(e) => setNewVeh({ ...newVeh, vin: e.target.value.toUpperCase() })} /></td>
                <td className="flex gap-1"><input className="input w-16" placeholder="Year" value={newVeh.year ?? ''} onChange={(e) => setNewVeh({ ...newVeh, year: Number(e.target.value) || null })} />
                  <input className="input" placeholder="Make" value={newVeh.make ?? ''} onChange={(e) => setNewVeh({ ...newVeh, make: e.target.value })} />
                  <input className="input" placeholder="Model" value={newVeh.model ?? ''} onChange={(e) => setNewVeh({ ...newVeh, model: e.target.value })} /></td>
                <td><button className="btn-primary h-8 min-h-0 px-2 text-xs" onClick={saveVehicle}>Save</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompanyForm({ value, onClose, onSaved }: { value: Partial<Company>; onClose: () => void; onSaved: (id: string) => void }) {
  const [c, setC] = useState<Partial<Company>>(value);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setC({ ...c, [k]: e.target.value });
  const save = async () => {
    if (!c.name?.trim()) return setErr('Name is required');
    const { id, ...rest } = c;
    const payload = { name: rest.name, contact_person: rest.contact_person ?? null, phone: rest.phone ?? null, email: rest.email ?? null,
      street: rest.street ?? null, unit: rest.unit ?? null, city: rest.city ?? null, state: rest.state ?? 'CA', zip: rest.zip ?? null,
      notes: rest.notes ?? null, billing_mode: rest.billing_mode ?? 'on_the_spot', active: rest.active ?? true };
    const r = id ? await supabase.from('companies').update(payload).eq('id', id).select().single()
      : await supabase.from('companies').insert(payload).select().single();
    if (r.error) return setErr(r.error.message);
    onSaved(r.data.id);
  };
  return (
    <Modal title={c.id ? 'Edit company' : 'New company'} onClose={onClose} footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <ErrorBanner error={err} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Company name" className="col-span-2"><input className="input" value={c.name ?? ''} onChange={set('name')} /></Field>
        <Field label="Contact person"><input className="input" value={c.contact_person ?? ''} onChange={set('contact_person')} /></Field>
        <Field label="Phone"><input className="input" value={c.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email" className="col-span-2"><input className="input" type="email" value={c.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Billing address"><input className="input" value={c.street ?? ''} onChange={set('street')} /></Field>
        <Field label="Unit"><input className="input" value={c.unit ?? ''} onChange={set('unit')} /></Field>
        <Field label="Zip"><input className="input" value={c.zip ?? ''} onChange={async (e) => { const zip = e.target.value; setC((p) => ({ ...p, zip }));
          if (/^\d{5}$/.test(zip)) { const z = await lookupZip(zip); if (z) setC((p) => ({ ...p, city: z.city, state: z.state })); } }} /></Field>
        <Field label="City"><input className="input" value={c.city ?? ''} onChange={set('city')} /></Field>
        <Field label="Billing" className="col-span-2">
          <select className="input" value={c.billing_mode} onChange={set('billing_mode')}>
            <option value="on_the_spot">Pay on the spot</option><option value="monthly">Billed monthly (invoice left unpaid until statement is paid)</option>
          </select>
        </Field>
        <Field label="Notes" className="col-span-2"><textarea className="input h-16" value={c.notes ?? ''} onChange={set('notes')} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={c.active ?? true} onChange={(e) => setC({ ...c, active: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  );
}
