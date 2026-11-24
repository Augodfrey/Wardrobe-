import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../state/session';
import { useEstimateSync, createEstimate } from '../hooks/useEstimateSync';
import { LineItems } from '../components/LineItems';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ErrorBanner, Field } from '../components/Modal';
import { IssueDialog } from '../components/dialogs/IssueDialog';
import { OutputDialog } from '../components/dialogs/OutputDialog';
import { PaymentDialog } from '../components/dialogs/PaymentDialog';
import { SendLinkDialog } from '../components/dialogs/SendLinkDialog';
import { QuickFindDialog, VehicleHistoryDialog } from '../components/dialogs/SearchDialogs';
import { LeaveWarningDialog, VoidDialog } from '../components/dialogs/ConfirmDialogs';
import { supabase } from '../lib/supabase';
import { computeTotals, money } from '../lib/totals';
import { priceFor, statusLine } from '../lib/estimateHelpers';
import { parseAamva } from '../lib/aamva';
import { classifyScan, parseRegistrationBarcode } from '../lib/registration';
import { decodeVin, findVin } from '../lib/vin';
import { lookupZip } from '../lib/zip';
import { deviceLabel, fmtDateTime, STATUS_COLOR, STATUS_LABEL } from '../lib/format';
import { formatPhone } from '../lib/phone';
import type { Estimate, Signature, Vehicle } from '../lib/types';

type Dialog = null | 'scanReg' | 'scanDl' | 'history' | 'quickfind' | 'issue' | 'output' | 'payment' | 'sendSign' | 'sendInvoice' | 'void';

export function NewEstimate() {
  const nav = useNavigate();
  const { lookups, loading } = useSession();
  const started = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    const pl = lookups.priceLists.find((p) => p.is_default && p.active) ?? lookups.priceLists.find((p) => p.active) ?? null;
    const defaults = ['01-TEST', '06-CERT'].map((c) => lookups.products.find((p) => p.code === c && p.active)).filter(Boolean)
      .map((p) => ({ product_id: p!.id, product_code: p!.code, product_type: p!.product_type, description: p!.description,
        unit_cost: Number(p!.unit_cost), unit_price: priceFor(p!, pl?.id ?? null, lookups.priceListItems), taxable: p!.taxable }));
    createEstimate(pl?.id ?? null, defaults).then((e) => nav(`/estimate/${e.id}`, { replace: true })).catch((e) => setErr(e.message));
  }, [loading, lookups, nav]);
  return <div className="p-6">{err ? <ErrorBanner error={err} /> : <p className="text-slate-500">Creating estimate…</p>}</div>;
}

export default function EstimateEntry() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profile, shop, lookups } = useSession();
  const me = useMemo(() => ({ name: profile?.full_name ?? 'Staff', device: deviceLabel() }), [profile?.full_name]);
  const s = useEstimateSync(id, me);
  const { est, items } = s;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState<(Signature & { url?: string }) | null>(null);
  const [companyVehicles, setCompanyVehicles] = useState<Vehicle[]>([]);
  const [clock, setClock] = useState(new Date());
  const allowLeave = useRef(false);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 15_000); return () => clearInterval(t); }, []);

  const locked = !est || est.status === 'issued' || est.status === 'void';
  const totals = useMemo(() => computeTotals(items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price),
    discount_amount: Number(i.discount_amount) })), Number(shop?.tax_rate ?? 0)), [items, shop?.tax_rate]);
  const shownTotals = locked && est ? { tax: Number(est.tax), total: Number(est.total) } : totals;

  // Signature (live: appears on every device the moment the customer signs)
  useEffect(() => {
    if (!est?.signature_id) { setSignature(null); return; }
    supabase.from('signatures').select('*').eq('id', est.signature_id).single().then(async ({ data }) => {
      if (!data) return;
      const { data: u } = await supabase.storage.from('signatures').createSignedUrl(data.image_path, 600);
      setSignature({ ...(data as Signature), url: u?.signedUrl });
    });
  }, [est?.signature_id]);

  useEffect(() => {
    if (!est?.company_id) { setCompanyVehicles([]); return; }
    supabase.from('vehicles').select('*').eq('company_id', est.company_id).order('plate').then(({ data }) => setCompanyVehicles((data ?? []) as Vehicle[]));
  }, [est?.company_id]);

  // ---- leaving an unissued estimate -----------------------------------------
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !allowLeave.current && !!est && !['issued', 'void'].includes(est.status) && !s.deleted
    && currentLocation.pathname !== nextLocation.pathname && !nextLocation.pathname.startsWith('/tablet/'));
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (est && !['issued', 'void'].includes(est.status)) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [est]);
  const deleteAndLeave = async () => {
    if (!est) return;
    await s.saveNow();
    if (est.signature_id || est.status !== 'draft') {
      // keep signed / sent documents for the record
      await supabase.rpc('void_document', { p_id: est.id, p_reason: 'Deleted when leaving (never issued)' });
    } else {
      await supabase.from('estimates').delete().eq('id', est.id);
    }
    blocker.proceed?.();
  };

  // ---- field helpers -------------------------------------------------------
  const set = useCallback(<K extends keyof Estimate>(k: K, v: Estimate[K]) => {
    if (!est) return;
    const patch: Partial<Estimate> = { [k]: v } as Partial<Estimate>;
    if (est.owner_same_as_customer && (k === 'customer_first_name' || k === 'customer_last_name')) {
      patch[k === 'customer_first_name' ? 'owner_first_name' : 'owner_last_name'] = v as string;
    }
    s.setFields(patch);
  }, [est, s]);
  const text = (k: keyof Estimate, upper = false) => ({
    value: (est?.[k] as string | null) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(k, (upper ? e.target.value.toUpperCase() : e.target.value) as never),
  });

  const onZip = async (zip: string) => {
    set('zip', zip);
    if (/^\d{5}$/.test(zip)) {
      const r = await lookupZip(zip);
      if (r) s.setFields({ zip, city: r.city, state: r.state });
    }
  };

  const fillFromVin = async (vin: string, patch: Partial<Estimate> = {}) => {
    const decoded = await decodeVin(vin);
    s.setFields({
      vin, ...patch,
      year: patch.year ?? est?.year ?? decoded?.year ?? null,
      make: patch.make ?? (est?.make || decoded?.make || null),
      model: est?.model || decoded?.model || null,
    });
  };

  const onRegistrationScan = async (raw: string) => {
    setDialog(null);
    const kind = classifyScan(raw);
    if (kind === 'license') return onLicenseScan(raw);
    if (kind === 'vin') {
      const vin = findVin(raw)!;
      setNotice(`VIN ${vin} scanned — decoding vehicle…`);
      await fillFromVin(vin);
      setNotice(`VIN ${vin} scanned.`);
      return;
    }
    const r = parseRegistrationBarcode(raw);
    const patch: Partial<Estimate> = {};
    if (r.plate) { patch.plate = r.plate; patch.plate_none = false; }
    if (r.year) patch.year = r.year;
    if (r.make) patch.make = r.make;
    if (r.vin) await fillFromVin(r.vin, patch); else s.setFields(patch);
    setNotice(r.vin || r.plate ? `Registration scanned: ${[r.plate, r.vin].filter(Boolean).join(' · ')}` : 'Could not read vehicle data from that barcode — please type it.');
  };

  const onLicenseScan = async (raw: string) => {
    setDialog(null);
    const dl = parseAamva(raw); // raw barcode is discarded right here; only name/address are kept
    if (!dl) { setNotice("That doesn't look like a driver's license barcode. Type the name and address instead."); return; }
    const patch: Partial<Estimate> = {
      customer_first_name: dl.firstName, customer_last_name: dl.lastName, street: dl.street, unit: dl.unit || null,
      city: dl.city, state: dl.state || 'CA', zip: dl.zip,
    };
    if (est?.owner_same_as_customer) { patch.owner_first_name = dl.firstName; patch.owner_last_name = dl.lastName; }
    if (dl.zip && !dl.city) { const z = await lookupZip(dl.zip); if (z) patch.city = z.city; }
    s.setFields(patch);
    setNotice(`License scanned: ${dl.firstName} ${dl.lastName}`);
  };

  const pickCompany = (companyId: string) => {
    const c = lookups.companies.find((x) => x.id === companyId);
    if (!c) return s.setFields({ company_id: null });
    s.setFields({
      company_id: c.id, customer_first_name: c.name, customer_last_name: '', phone: c.phone ?? est?.phone ?? null, email: c.email ?? null,
      street: c.street, unit: c.unit, city: c.city, state: c.state ?? 'CA', zip: c.zip,
      ...(est?.owner_same_as_customer ? { owner_first_name: c.name, owner_last_name: '' } : {}),
    });
  };
  const pickVehicle = (vid: string) => {
    const v = companyVehicles.find((x) => x.id === vid);
    if (v) s.setFields({ vehicle_id: v.id, plate: v.plate, plate_state: v.plate_state, vin: v.vin, year: v.year, make: v.make, model: v.model, plate_none: false });
  };

  const changePriceList = (plId: string) => {
    s.setFields({ price_list_id: plId || null });
    for (const i of items) {
      const p = lookups.products.find((x) => x.id === i.product_id);
      if (p && !i.price_overridden) s.updateItem(i.id, { unit_price: priceFor(p, plId || null, lookups.priceListItems) });
    }
  };

  const addLine = () => s.addItem({ description: '', quantity: 1, unit_price: 0, unit_cost: 0, product_type: 'other' });

  const handToCustomer = async () => {
    await s.saveNow();
    allowLeave.current = true;
    nav(`/tablet/${est!.id}`);
  };

  const doVoid = async (reason: string) => {
    setDialog(null);
    const { error } = await supabase.rpc('void_document', { p_id: est!.id, p_reason: reason });
    if (error) s.setError(error.message); else s.reload();
  };

  // ---- render ---------------------------------------------------------------
  if (s.deleted) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="mb-2 text-xl font-bold">This estimate no longer exists</h1>
        <p className="mb-4 text-slate-600">It was deleted, possibly from another device.</p>
        <button className="btn-primary" onClick={() => { allowLeave.current = true; nav('/documents'); }}>Document List</button>
      </div>
    );
  }
  if (!est) return <p className="p-6 text-slate-500">Loading…</p>;

  const reasons = lookups.reasons.filter((r) => r.active || r.name === est.reason_for_test);
  const referrals = lookups.referralSources.filter((r) => r.active || r.id === est.referral_source_id);
  const line = statusLine(est, items.length);

  return (
    <div className="pb-28">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-cobalt">Estimate Entry</h1>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${STATUS_COLOR[est.status]}`}>{STATUS_LABEL[est.status]}</span>
              {s.saving && <span className="text-xs text-slate-400">Saving…</span>}
            </div>
            <p className="text-xs text-slate-500">{shop?.name} · ARD # {shop?.ard_number} · {clock.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div><div className="field-label">{est.status === 'issued' ? 'Invoice #' : 'Estimate #'}</div><div className="font-mono text-2xl font-bold">{est.estimate_number}</div></div>
            <div><div className="field-label">Created</div><div>{fmtDateTime(est.created_at)}</div></div>
            <Field label="Manual Estimate #"><input className="input w-28" disabled={locked} {...text('manual_estimate_number')} /></Field>
          </div>
        </div>
        <div className={`mt-2 rounded px-3 py-1.5 text-sm font-semibold ${est.status === 'void' ? 'bg-brandred text-white' : 'bg-cobalt-light text-cobalt'}`} role="status">▶ {line}</div>
      </div>

      <div className="space-y-3 p-3 sm:p-4">
        {s.viewers.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            ⚠ Also open on {s.viewers.map((v) => `${v.name} (${v.device})`).join(', ')}. Changes sync live.
          </div>
        )}
        <ErrorBanner error={s.error} />
        {notice && <div className="flex justify-between rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

        {!locked && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setDialog('scanReg')}>📷 Scan DMV Registration</button>
            <button className="btn-primary" onClick={() => setDialog('scanDl')}>🪪 Scan Driver's License</button>
            <button className="btn-ghost" onClick={() => setDialog('history')}>Lookup Vehicle Test History</button>
          </div>
        )}

        <fieldset disabled={locked} className="grid gap-3 lg:grid-cols-3">
          {/* Vehicle */}
          <section className="card">
            <div className="section-title">Vehicle info</div>
            <div className="grid grid-cols-6 gap-2">
              <Field label="License plate #" className="col-span-4"><input className="input font-mono uppercase" disabled={est.plate_none} {...text('plate', true)} /></Field>
              <label className="col-span-2 flex items-end gap-1 pb-2 text-sm"><input type="checkbox" checked={est.plate_none} onChange={(e) => s.setFields({ plate_none: e.target.checked, ...(e.target.checked ? { plate: null } : {}) })} /> None</label>
              <Field label="State" className="col-span-2"><input className="input uppercase" maxLength={2} {...text('plate_state', true)} /></Field>
              <Field label="Year" className="col-span-2"><input className="input" inputMode="numeric" maxLength={4} value={est.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)} /></Field>
              <Field label="Make" className="col-span-2"><input className="input" {...text('make')} /></Field>
              <Field label="Model" className="col-span-3"><input className="input" {...text('model')} /></Field>
              <Field label="Odometer" className="col-span-2"><input className="input" inputMode="numeric" disabled={est.odometer_none} value={est.odometer ?? ''} onChange={(e) => set('odometer', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)} /></Field>
              <label className="col-span-1 flex items-end gap-1 pb-2 text-sm"><input type="checkbox" checked={est.odometer_none} onChange={(e) => s.setFields({ odometer_none: e.target.checked, ...(e.target.checked ? { odometer: null } : {}) })} /> None</label>
              <Field label="VIN" className="col-span-6">
                <div className="flex gap-1">
                  <input className="input font-mono uppercase" maxLength={17} {...text('vin', true)} />
                  <button type="button" className="btn-ghost shrink-0 px-2 text-xs" disabled={(est.vin ?? '').length !== 17} onClick={() => fillFromVin(est.vin!)}>Decode</button>
                </div>
              </Field>
              <Field label="PO #" className="col-span-3"><input className="input" {...text('po_number')} /></Field>
              <Field label="Account ID" className="col-span-3"><input className="input" {...text('account_id')} /></Field>
            </div>
            {companyVehicles.length > 0 && (
              <Field label="Company vehicles on file" className="mt-2">
                <select className="input" value={est.vehicle_id ?? ''} onChange={(e) => pickVehicle(e.target.value)}>
                  <option value="">— pick a vehicle —</option>
                  {companyVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {[v.year, v.make, v.model].filter(Boolean).join(' ')}</option>)}
                </select>
              </Field>
            )}
            <div className="mt-3 rounded border border-dashed border-slate-300 p-2">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-500">Re-test only</div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="First test invoice #"><input className="input" {...text('retest_of_invoice_number')} /></Field>
                <Field label="First test date"><input type="date" className="input" value={est.retest_of_date ?? ''} onChange={(e) => set('retest_of_date', e.target.value || null)} /></Field>
              </div>
            </div>
          </section>

          {/* Customer */}
          <section className="card">
            <div className="section-title">Customer</div>
            <Field label="Registered company" className="mb-2">
              <select className="input" value={est.company_id ?? ''} onChange={(e) => pickCompany(e.target.value)}>
                <option value="">— walk-in customer —</option>
                {lookups.companies.filter((c) => c.active || c.id === est.company_id).map((c) => <option key={c.id} value={c.id}>{c.name}{c.billing_mode === 'monthly' ? ' (monthly)' : ''}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="First name / company"><input className="input" {...text('customer_first_name')} /></Field>
              <Field label="Last name"><input className="input" {...text('customer_last_name')} /></Field>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="field-label mb-0">Owner / driver</span>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={est.owner_same_as_customer}
                onChange={(e) => s.setFields({ owner_same_as_customer: e.target.checked, ...(e.target.checked ? { owner_first_name: est.customer_first_name, owner_last_name: est.customer_last_name } : {}) })} /> Same as customer</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" aria-label="Owner first name" disabled={est.owner_same_as_customer} {...text('owner_first_name')} />
              <input className="input" aria-label="Owner last name" disabled={est.owner_same_as_customer} {...text('owner_last_name')} />
            </div>
            <div className="mt-2 grid grid-cols-6 gap-2">
              <Field label="Street address" className="col-span-4"><input className="input" {...text('street')} /></Field>
              <Field label="Unit / Apt" className="col-span-2"><input className="input" {...text('unit')} /></Field>
              <Field label="Zip" className="col-span-2"><input className="input" inputMode="numeric" maxLength={10} value={est.zip ?? ''} onChange={(e) => onZip(e.target.value)} /></Field>
              <Field label="City" className="col-span-3"><input className="input" {...text('city')} /></Field>
              <Field label="State" className="col-span-1"><input className="input uppercase" maxLength={2} {...text('state', true)} /></Field>
            </div>
          </section>

          {/* Contact & reason */}
          <section className="card">
            <div className="section-title">Contact</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Phone *"><input className={`input ${!est.phone ? 'border-brandred/60' : ''}`} inputMode="tel" value={est.phone ?? ''} onChange={(e) => set('phone', e.target.value)} onBlur={(e) => set('phone', formatPhone(e.target.value))} /></Field>
              <Field label="Registration due"><input type="date" className="input" value={est.registration_due_date ?? ''} onChange={(e) => set('registration_due_date', e.target.value || null)} /></Field>
              <Field label="Email address" className="col-span-2"><input className="input" type="email" {...text('email')} /></Field>
              <Field label="Reason for test">
                <select className={`input ${!est.reason_for_test ? 'border-amber-400' : ''}`} value={est.reason_for_test ?? ''} onChange={(e) => set('reason_for_test', e.target.value || null)}>
                  <option value="">— select —</option>
                  {reasons.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </Field>
              <Field label="Referred from">
                <select className={`input ${!est.referral_source_id ? 'border-amber-400' : ''}`} value={est.referral_source_id ?? ''} onChange={(e) => set('referral_source_id', e.target.value || null)}>
                  <option value="">— select —</option>
                  {referrals.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label="Price list">
                <select className="input" value={est.price_list_id ?? ''} onChange={(e) => changePriceList(e.target.value)}>
                  <option value="">Catalog prices</option>
                  {lookups.priceLists.filter((p) => p.active || p.id === est.price_list_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Inspection">
                <div className="flex gap-1">
                  {[false, true].map((star) => (
                    <button key={String(star)} type="button" onClick={() => s.setFields({ is_star: star })}
                      className={`btn flex-1 px-1 text-xs ${est.is_star === star ? 'bg-cobalt text-white' : 'btn-ghost'}`}>{star ? 'STAR' : 'Non-STAR'}</button>
                  ))}
                </div>
              </Field>
              <Field label="Tire pressure check" className="col-span-2"><input className="input" {...text('tire_pressure_check')} placeholder="e.g. All 4 set to 35 PSI" /></Field>
              <Field label="Notes" className="col-span-2"><textarea className="input h-16" {...text('notes')} /></Field>
            </div>
          </section>
        </fieldset>

        <section className="card">
          <div className="section-title">Line items</div>
          <LineItems items={items} products={lookups.products} discountTerms={lookups.discountTerms} priceListId={est.price_list_id}
            priceListItems={lookups.priceListItems} locked={locked} onUpdate={s.updateItem} onAdd={addLine} onRemove={s.removeItem} totals={shownTotals} />
        </section>

        <section className="card flex flex-wrap items-center gap-4">
          <div className="section-title mb-0 w-full">Customer signature</div>
          {signature ? (
            <>
              {signature.url && <img src={signature.url} alt="Customer signature" className="h-16 rounded border border-slate-200 bg-white" />}
              <div className="text-sm">
                <div className="font-semibold">Signed by {signature.signer_name}</div>
                <div className="text-slate-500">{fmtDateTime(signature.signed_at)} · {signature.method === 'tablet' ? 'on the counter tablet' : 'from a remote link'}</div>
                {!locked && <div className="text-xs text-emerald-700">The estimate stays open — edit freely. The customer will not be asked to sign again.</div>}
              </div>
            </>
          ) : locked ? <span className="text-sm text-slate-500">Not signed.</span> : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={handToCustomer}>🖐 Hand to Customer</button>
              <button className="btn-ghost" onClick={async () => { await s.saveNow(); setDialog('sendSign'); }}>📲 Send link (text / email)</button>
            </div>
          )}
        </section>
      </div>

      {/* Bottom bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-300 bg-white/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => nav('/documents')}>Document List</button>
            <button className="btn-ghost" onClick={() => setDialog('quickfind')}>Quick Find</button>
            <button className="btn-ghost" onClick={() => { allowLeave.current = false; nav('/estimate/new'); }}>New</button>
          </div>
          <div className="text-right text-lg font-extrabold text-cobalt tabular-nums">{money(shownTotals.total)}</div>
          <div className="flex flex-wrap gap-2">
            {est.status !== 'void' && <button className="btn-danger" onClick={() => setDialog('void')}>Void</button>}
            {!locked && <button className="btn-primary" onClick={async () => { await s.saveNow(); setDialog('issue'); }}>Issue</button>}
            {est.status === 'issued' && <button className="btn-ghost" onClick={() => setDialog('output')}>Print / Email / View</button>}
            {est.status === 'issued' && <button className="btn-ghost" onClick={() => setDialog('sendInvoice')}>Text invoice link</button>}
            <button className="btn-primary" disabled={est.status === 'void' || !!est.paid_at}
              onClick={async () => { if (!locked) { await s.saveNow(); setDialog('issue'); } else setDialog('payment'); }}
              title={!locked ? 'Issue the invoice first, then take payment' : ''}>
              {est.paid_at ? 'Paid' : 'Payment'}
            </button>
          </div>
        </div>
      </div>

      {dialog === 'scanReg' && <BarcodeScanner title="Scan DMV Registration" hint="Point the camera at the barcode on the DMV registration card or the VIN barcode in the driver's door jamb." onResult={onRegistrationScan} onClose={() => setDialog(null)} />}
      {dialog === 'scanDl' && <BarcodeScanner title="Scan Driver's License" hint="Scan the large barcode on the back of the license or ID. Only the name and address are kept." onResult={onLicenseScan} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <VehicleHistoryDialog vin={est.vin} plate={est.plate} currentId={est.id} onClose={() => setDialog(null)}
        onUseAsRetest={(prev) => s.setFields({ retest_of_invoice_number: prev.estimate_number, retest_of_date: (prev.issued_at ?? prev.created_at).slice(0, 10),
          plate: est.plate || prev.plate, vin: est.vin || prev.vin, year: est.year ?? prev.year, make: est.make || prev.make, model: est.model || prev.model,
          customer_first_name: est.customer_first_name || prev.customer_first_name, customer_last_name: est.customer_last_name || prev.customer_last_name,
          phone: est.phone || prev.phone })} />}
      {dialog === 'quickfind' && <QuickFindDialog onClose={() => setDialog(null)} />}
      {dialog === 'issue' && <IssueDialog est={est} profiles={lookups.profiles} onClose={() => setDialog(null)} onIssued={() => { s.reload(); setDialog('output'); }} />}
      {dialog === 'output' && <OutputDialog estimateId={est.id} number={est.estimate_number} defaultEmail={est.email} isReprint={est.print_count > 0}
        onClose={() => setDialog(est.status === 'issued' && !est.paid_at && !est.billed_to_company ? 'payment' : null)} />}
      {dialog === 'payment' && est.status === 'issued' && <PaymentDialog est={est} paymentTypes={lookups.paymentTypes} onClose={() => setDialog(null)} onPaid={() => { s.reload(); setDialog(null); setNotice('Payment recorded.'); }} />}
      {dialog === 'sendSign' && <SendLinkDialog est={est} purpose="sign" onClose={() => setDialog(null)} />}
      {dialog === 'sendInvoice' && <SendLinkDialog est={est} purpose="view_invoice" onClose={() => setDialog(null)} />}
      {dialog === 'void' && <VoidDialog number={est.estimate_number} onClose={() => setDialog(null)} onConfirm={doVoid} />}
      {blocker.state === 'blocked' && <LeaveWarningDialog onKeep={() => blocker.proceed()} onDelete={deleteAndLeave} />}
    </div>
  );
}
