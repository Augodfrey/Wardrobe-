import { useEffect, useMemo, useState } from 'react';
import { callFunction, supabase } from '../lib/supabase';
import { useSession } from '../state/session';
import { ErrorBanner, Field } from '../components/Modal';
import type { Profile, Shop } from '../lib/types';

type ColType = 'text' | 'number' | 'bool' | 'select';
interface Col { key: string; label: string; type?: ColType; options?: { value: string; label: string }[]; width?: string }

const TABS = ['Shop', 'Products', 'Price Lists', 'Reasons for Test', 'Referral Sources', 'Payment Types', 'Discount Terms', 'Users'] as const;
type Tab = typeof TABS[number];

export default function Settings() {
  const [tab, setTab] = useState<Tab>('Shop');
  const { lookups, refreshLookups } = useSession();
  return (
    <div className="p-3 sm:p-4">
      <h1 className="mb-3 text-xl font-extrabold text-cobalt">Settings</h1>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? 'border-cobalt text-cobalt' : 'border-transparent text-slate-500'}`}>{t}</button>)}
      </div>
      {tab === 'Shop' && <ShopSettings />}
      {tab === 'Products' && <ListEditor table="products" rows={lookups.products as never} onSaved={refreshLookups} newRow={{ code: '', description: '', product_type: 'test', unit_cost: 0, unit_price: 0, taxable: false, track_inventory: false, on_hand: 0 }}
        cols={[{ key: 'code', label: 'Code', width: 'w-28' }, { key: 'description', label: 'Description' },
          { key: 'product_type', label: 'Type', type: 'select', options: ['test', 'certificate', 'labor', 'parts', 'dmv_fee', 'other'].map((v) => ({ value: v, label: v })) },
          { key: 'unit_cost', label: 'Unit Cost', type: 'number', width: 'w-24' }, { key: 'unit_price', label: 'Unit Price', type: 'number', width: 'w-24' },
          { key: 'taxable', label: 'Taxable', type: 'bool' }, { key: 'track_inventory', label: 'Track stock', type: 'bool' }, { key: 'on_hand', label: 'On hand', type: 'number', width: 'w-20' }]} />}
      {tab === 'Price Lists' && <PriceLists />}
      {tab === 'Reasons for Test' && <ListEditor table="reasons_for_test" rows={lookups.reasons as never} onSaved={refreshLookups} newRow={{ name: '' }} cols={[{ key: 'name', label: 'Reason' }]} />}
      {tab === 'Referral Sources' && <ListEditor table="referral_sources" rows={lookups.referralSources as never} onSaved={refreshLookups} newRow={{ name: '' }} cols={[{ key: 'name', label: 'Referred from' }]} />}
      {tab === 'Payment Types' && <ListEditor table="payment_types" rows={lookups.paymentTypes as never} onSaved={refreshLookups} newRow={{ name: '', is_card: false, card_fee_percent: 0, is_company_account: false }}
        cols={[{ key: 'name', label: 'Payment type' }, { key: 'is_card', label: 'Card', type: 'bool' }, { key: 'card_fee_percent', label: 'Card fee %', type: 'number', width: 'w-24' }, { key: 'is_company_account', label: 'Company account', type: 'bool' }]} />}
      {tab === 'Discount Terms' && <ListEditor table="discount_terms" rows={lookups.discountTerms as never} onSaved={refreshLookups} newRow={{ name: '', percent: 0, amount: 0 }}
        cols={[{ key: 'name', label: 'Terms' }, { key: 'percent', label: 'Percent off', type: 'number', width: 'w-24' }, { key: 'amount', label: 'or Amount off', type: 'number', width: 'w-24' }]} />}
      {tab === 'Users' && <Users />}
    </div>
  );
}

type Row = Record<string, unknown> & { id?: string; active?: boolean; sort_order?: number };

/** Inline editor for admin-managed lists: add, rename/edit, reorder, deactivate. Nothing is ever hard-deleted. */
function ListEditor({ table, rows, cols, newRow, onSaved }: { table: string; rows: Row[]; cols: Col[]; newRow: Row; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Row[]>(rows);
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDraft(rows); setDirty(new Set()); }, [rows]);
  const set = (i: number, k: string, v: unknown) => { setDraft(draft.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(new Set(dirty).add(i)); };
  const save = async () => {
    setErr(null); setMsg(null);
    for (const i of dirty) {
      const { id, created_at: _c, updated_at: _u, shop_id: _s, ...rest } = draft[i] as Row & { created_at?: string; updated_at?: string; shop_id?: string };
      const r = id ? await supabase.from(table).update(rest).eq('id', id) : await supabase.from(table).insert(rest);
      if (r.error) { setErr(`${String(rest.name ?? rest.code ?? 'Row')}: ${r.error.message}`); return; }
    }
    await onSaved();
    setMsg('Saved.');
  };
  return (
    <div className="card">
      <ErrorBanner error={err} />
      {msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th className="w-16">Order</th>{cols.map((c) => <th key={c.key}>{c.label}</th>)}<th>Active</th></tr></thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={(r.id as string) ?? `new-${i}`} className={r.active === false ? 'opacity-50' : ''}>
                <td><input className="input w-16 px-1" type="number" value={Number(r.sort_order ?? 0)} onChange={(e) => set(i, 'sort_order', Number(e.target.value))} /></td>
                {cols.map((c) => (
                  <td key={c.key} className={c.width}>
                    {c.type === 'bool' ? <input type="checkbox" checked={!!r[c.key]} onChange={(e) => set(i, c.key, e.target.checked)} />
                      : c.type === 'select' ? <select className="input" value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)}>{c.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                      : <input className={`input ${c.type === 'number' ? 'text-right' : ''}`} inputMode={c.type === 'number' ? 'decimal' : undefined}
                          value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, c.type === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value)} />}
                  </td>
                ))}
                <td><input type="checkbox" checked={r.active !== false} onChange={(e) => set(i, 'active', e.target.checked)} aria-label="Active" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-ghost" onClick={() => { setDraft([...draft, { ...newRow, active: true, sort_order: draft.length + 1 }]); setDirty(new Set(dirty).add(draft.length)); }}>+ Add</button>
        <button className="btn-primary" disabled={!dirty.size} onClick={save}>Save changes</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Uncheck Active to retire an option. Old documents keep their value; it just stops appearing in dropdowns.</p>
    </div>
  );
}

function PriceLists() {
  const { lookups, refreshLookups } = useSession();
  const [listId, setListId] = useState<string>(lookups.priceLists[0]?.id ?? '');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const m: Record<string, string> = {};
    for (const p of lookups.priceListItems.filter((x) => x.price_list_id === listId)) m[p.product_id] = String(p.unit_price);
    setPrices(m);
  }, [listId, lookups.priceListItems]);
  const save = async () => {
    setErr(null);
    const rows = Object.entries(prices).filter(([, v]) => v !== '').map(([product_id, v]) => ({ price_list_id: listId, product_id, unit_price: Number(v) }));
    const cleared = lookups.priceListItems.filter((x) => x.price_list_id === listId && (prices[x.product_id] ?? '') === '').map((x) => x.id);
    const r = await supabase.from('price_list_items').upsert(rows, { onConflict: 'price_list_id,product_id' });
    if (r.error) return setErr(r.error.message);
    if (cleared.length) await supabase.from('price_list_items').delete().in('id', cleared);
    await refreshLookups(); setMsg('Prices saved.');
  };
  const products = lookups.products.filter((p) => p.active);
  return (
    <div className="space-y-3">
      <ListEditor table="price_lists" rows={lookups.priceLists as never} onSaved={refreshLookups} newRow={{ name: '', is_default: false }}
        cols={[{ key: 'name', label: 'Price list name' }, { key: 'is_default', label: 'Default for new estimates', type: 'bool' }]} />
      <div className="card">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <Field label="Edit prices for"><select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>{lookups.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <button className="btn-primary" onClick={save} disabled={!listId}>Save prices</button>
        </div>
        <ErrorBanner error={err} />{msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
        <table className="tbl max-w-2xl">
          <thead><tr><th>Product</th><th className="text-right">Catalog price</th><th className="w-32 text-right">List price</th></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.id}><td>{p.code} {p.description}</td><td className="text-right text-slate-500">{Number(p.unit_price).toFixed(2)}</td>
              <td><input className="input text-right" inputMode="decimal" placeholder="catalog" value={prices[p.id] ?? ''} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} /></td></tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Leave blank to use the catalog price. Staff can still override any line price on a single estimate.</p>
      </div>
    </div>
  );
}

function ShopSettings() {
  const { shop, refreshShop } = useSession();
  const [s, setS] = useState<Partial<Shop>>(shop ?? {});
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (shop) setS(shop); }, [shop]);
  const f = (k: keyof Shop) => ({ value: String(s[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: e.target.value }) });
  const save = async () => {
    setErr(null); setMsg(null);
    const { error } = await supabase.from('shops').update({
      name: s.name, street: s.street, city: s.city, state: s.state, zip: s.zip, phone: s.phone, ard_number: s.ard_number,
      tax_rate: Number(s.tax_rate), google_review_url: s.google_review_url || null, review_trigger: s.review_trigger,
      review_delay_minutes: Number(s.review_delay_minutes), public_app_url: s.public_app_url || null,
    }).eq('id', shop!.id);
    if (error) return setErr(error.message);
    await refreshShop(); setMsg('Saved.');
  };
  const savePin = async () => {
    const { error } = await supabase.rpc('set_staff_pin', { p_pin: pin });
    if (error) setErr(error.message); else { setPin(''); setMsg('Staff PIN updated.'); refreshShop(); }
  };
  const uploadLogo = async (file: File) => {
    const path = `${shop!.id}/logo.png`;
    const up = await supabase.storage.from('branding').upload(path, file, { upsert: true, contentType: 'image/png' });
    if (up.error) return setErr(up.error.message);
    await supabase.from('shops').update({ logo_path: path }).eq('id', shop!.id);
    setMsg('Logo uploaded.'); refreshShop();
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="card">
        <div className="section-title">Shop (printed on documents)</div>
        <ErrorBanner error={err} />{msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Business name" className="col-span-2"><input className="input" {...f('name')} /></Field>
          <Field label="Street" className="col-span-2"><input className="input" {...f('street')} /></Field>
          <Field label="City"><input className="input" {...f('city')} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="State"><input className="input" {...f('state')} /></Field><Field label="Zip"><input className="input" {...f('zip')} /></Field></div>
          <Field label="Phone"><input className="input" {...f('phone')} /></Field>
          <Field label="ARD number"><input className="input" {...f('ard_number')} /></Field>
          <Field label="Sales tax rate (0.0875 = 8.75%)"><input className="input" inputMode="decimal" {...f('tax_rate')} /></Field>
          <Field label="Public app URL (for customer links)"><input className="input" placeholder="https://…" {...f('public_app_url')} /></Field>
          <Field label="Logo (PNG)" className="col-span-2"><input type="file" accept="image/png" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></Field>
        </div>
        <button className="btn-primary mt-3" onClick={save}>Save shop settings</button>
      </div>
      <div className="space-y-3">
        <div className="card">
          <div className="section-title">Google review request</div>
          <div className="grid gap-2">
            <Field label="Google review link"><input className="input" placeholder="https://g.page/r/…/review" {...f('google_review_url')} /></Field>
            <Field label="Send when">
              <select className="input" {...f('review_trigger')}>
                <option value="first">Whichever comes first: invoice paid, or the delay after signing</option>
                <option value="signed">Right after signing</option>
                <option value="paid">When the invoice is paid</option>
              </select>
            </Field>
            <Field label="Delay after signing (minutes)"><input className="input" inputMode="numeric" {...f('review_delay_minutes')} /></Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">Sent once per visit, only to customers who consented, never to opted-out numbers. Every customer gets the same link.</p>
          <button className="btn-primary mt-3" onClick={save}>Save</button>
        </div>
        <div className="card">
          <div className="section-title">Staff PIN (exits tablet mode)</div>
          <p className="mb-2 text-sm text-slate-600">{shop?.has_staff_pin ? 'A PIN is set.' : <b className="text-brandred">No PIN set — tablet mode is disabled until you set one.</b>} Stored hashed; nobody can read it back.</p>
          <div className="flex gap-2">
            <input className="input w-40" type="password" inputMode="numeric" maxLength={8} placeholder="4–8 digits" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-primary" disabled={pin.length < 4} onClick={savePin}>Set PIN</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Users() {
  const { lookups, refreshLookups, profile } = useSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'staff' | 'owner'>('staff');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const users = useMemo(() => lookups.profiles, [lookups.profiles]);
  const update = async (p: Profile, patch: Partial<Profile>) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) setErr(error.message); else refreshLookups();
  };
  const invite = async () => {
    setErr(null); setMsg(null);
    try { await callFunction('invite-user', { email, full_name: name, role }); setMsg(`Invitation sent to ${email}.`); setEmail(''); setName(''); refreshLookups(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <ErrorBanner error={err} />{msg && <p className="mb-2 text-sm text-emerald-700">{msg}</p>}
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Technician</th><th>Active</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}>
              <td><input className="input" defaultValue={u.full_name} onBlur={(e) => e.target.value !== u.full_name && update(u, { full_name: e.target.value })} /></td>
              <td><select className="input" value={u.role} disabled={u.id === profile?.id} onChange={(e) => update(u, { role: e.target.value as Profile['role'] })}><option value="staff">Staff</option><option value="owner">Owner / Admin</option></select></td>
              <td><input type="checkbox" checked={u.is_technician} onChange={(e) => update(u, { is_technician: e.target.checked })} /></td>
              <td><input type="checkbox" checked={u.active} disabled={u.id === profile?.id} onChange={(e) => update(u, { active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <div className="section-title">Invite a user</div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as 'staff' | 'owner')}><option value="staff">Staff</option><option value="owner">Owner / Admin</option></select>
          <button className="btn-primary" disabled={!email} onClick={invite}>Send invite</button>
        </div>
      </div>
    </div>
  );
}
