import { useEffect, useState } from 'react';
import { ErrorBanner, Field, Modal } from '../Modal';
import { callFunction, supabase } from '../../lib/supabase';
import { fmtDateTime } from '../../lib/format';
import type { Estimate } from '../../lib/types';

interface LinkRow { id: string; channel: string | null; sent_to: string | null; created_at: string; opened_at: string | null; used_at: string | null; expires_at: string; purpose: string }

/** Text or email a single-use 24-hour signing link (or, after Issue, an invoice link). Status updates live. */
export function SendLinkDialog({ est, purpose, onClose }: { est: Estimate; purpose: 'sign' | 'view_invoice'; onClose: () => void }) {
  const [channel, setChannel] = useState<'sms' | 'email' | 'both'>(est.phone ? 'sms' : 'email');
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [phone, setPhone] = useState(est.phone ?? '');
  const [email, setEmail] = useState(est.email ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [lastUrl, setLastUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = () => supabase.from('signing_links').select('*').eq('estimate_id', est.id).eq('purpose', purpose)
      .order('created_at', { ascending: false }).limit(5).then(({ data }) => setLinks((data ?? []) as LinkRow[]));
    load();
    const ch = supabase.channel(`links:${est.id}:${purpose}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signing_links', filter: `estimate_id=eq.${est.id}` }, load).subscribe();
    return () => { ch.unsubscribe(); };
  }, [est.id, purpose]);

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await callFunction<{ url: string; results: Record<string, { ok: boolean; error?: string }> }>('send-signing-link', {
        estimate_id: est.id, channel, purpose, language, to_phone: phone, to_email: email,
      });
      setLastUrl(r.url);
      const failed = Object.entries(r.results ?? {}).filter(([, v]) => !v.ok).map(([k, v]) => `${k}: ${v.error}`);
      if (failed.length) setErr(`Link created but sending failed — ${failed.join('; ')}. You can copy the link below.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const status = (l: LinkRow) => l.used_at ? `✅ Signed ${fmtDateTime(l.used_at)}` : new Date(l.expires_at) < new Date() ? 'Expired'
    : l.opened_at ? `👀 Opened ${fmtDateTime(l.opened_at)}` : 'Sent — not opened yet';

  return (
    <Modal title={purpose === 'sign' ? 'Send signing link' : 'Send invoice link'} onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>Close</button>
      <button className="btn-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send link'}</button>
    </>}>
      <ErrorBanner error={err} />
      <div className="mb-3 flex gap-2">
        {(['sms', 'email', 'both'] as const).map((c) => (
          <button key={c} className={c === channel ? 'btn-primary flex-1' : 'btn-ghost flex-1'} onClick={() => setChannel(c)}>
            {c === 'sms' ? 'Text' : c === 'email' ? 'Email' : 'Both'}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {channel !== 'email' && <Field label="Mobile phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>}
        {channel !== 'sms' && <Field label="Email"><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        <Field label="Message language">
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'es')}>
            <option value="en">English</option><option value="es">Español</option>
          </select>
        </Field>
      </div>
      {purpose === 'sign' && <p className="mt-2 text-xs text-slate-500">The link works once and expires in 24 hours. Sending a new link cancels older unused ones.</p>}
      {lastUrl && (
        <div className="mt-3 flex gap-2">
          <input className="input font-mono text-xs" readOnly value={lastUrl} onFocus={(e) => e.target.select()} />
          <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(lastUrl)}>Copy</button>
        </div>
      )}
      {links.length > 0 && (
        <div className="mt-4">
          <div className="section-title">Recent links (live)</div>
          <ul className="space-y-1 text-sm">
            {links.map((l) => <li key={l.id} className="flex justify-between gap-2 rounded bg-slate-50 px-2 py-1">
              <span className="truncate text-slate-600">{fmtDateTime(l.created_at)} → {l.sent_to}</span><span className="shrink-0 font-semibold">{status(l)}</span>
            </li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}
