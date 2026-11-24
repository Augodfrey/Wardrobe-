import { useState } from 'react';
import { ErrorBanner, Field, Modal } from '../Modal';
import { callFunction } from '../../lib/supabase';
import { isEmail } from '../../lib/phone';

/** "Print, Email, or View?" — shown after Issue and from the Document List. */
export function OutputDialog({ estimateId, number, defaultEmail, onClose, isReprint }: {
  estimateId: string; number: string; defaultEmail: string | null; onClose: () => void; isReprint?: boolean;
}) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (action: 'view' | 'email' | 'print') => {
    setErr(null); setMsg(null);
    if (action === 'email' && !isEmail(email)) return setErr('Enter a valid email address');
    // Open the window synchronously so pop-up blockers allow it
    const win = action !== 'email' ? window.open('', '_blank') : null;
    setBusy(action);
    try {
      const r = await callFunction<{ url: string }>('documents', { kind: 'invoice', estimate_id: estimateId, action, email });
      if (win) {
        win.location.href = r.url;
        if (action === 'print') setTimeout(() => { try { win.print(); } catch { /* cross-origin PDF viewer */ } }, 1500);
      }
      if (action === 'email') setMsg(`Emailed to ${email}`); else onClose();
    } catch (e) {
      win?.close();
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  return (
    <Modal title="Print, Email, or View?" onClose={onClose} footer={<>
      <button className="btn-ghost" disabled={!!busy} onClick={() => run('view')}>{busy === 'view' ? 'Opening…' : 'View Only'}</button>
      <button className="btn-ghost" disabled={!!busy} onClick={() => run('email')}>{busy === 'email' ? 'Sending…' : 'Email Only'}</button>
      <button className="btn-primary" disabled={!!busy} onClick={() => run('print')}>{busy === 'print' ? 'Preparing…' : 'Print Only'}</button>
    </>}>
      <ErrorBanner error={err} />
      {msg && <div className="mb-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</div>}
      <p className="mb-3 text-sm text-slate-600">Invoice #{number}{isReprint ? ' — copies after the original are marked REPRINT.' : ''}</p>
      <Field label="Email address"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    </Modal>
  );
}
