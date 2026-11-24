import { useState } from 'react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { ErrorBanner, Field } from '../components/Modal';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  };
  const reset = async () => {
    if (!email) return setErr('Enter your email first');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account` });
    if (error) setErr(error.message); else setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-cobalt to-cobalt-dark p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-5 text-center">
          <div className="inline-flex items-baseline gap-1 rounded bg-cobalt px-3 py-1 text-2xl font-black text-white">SMOG<span className="text-red-200">ZONE</span></div>
          <p className="mt-2 text-sm text-slate-500">Front Office</p>
        </div>
        {!supabaseConfigured && <ErrorBanner error="Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY." />}
        <ErrorBanner error={err} />
        {sent && <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800">Password reset email sent.</p>}
        <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password" className="mt-3"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn-primary mt-5 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="mt-3 w-full text-sm text-cobalt hover:underline" onClick={reset}>Forgot password?</button>
        <p className="mt-4 text-center text-xs text-slate-400">You can stay signed in on as many computers and tablets as you like.</p>
      </form>
    </div>
  );
}

export function AccountPage() {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-sm p-6">
      <h1 className="mb-3 text-xl font-bold text-cobalt">Set password</h1>
      <ErrorBanner error={err} />
      {msg && <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}
      <Field label="New password"><input className="input" type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <button className="btn-primary mt-3" disabled={pw.length < 8} onClick={async () => {
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) setErr(error.message); else { setMsg('Password updated.'); setPw(''); }
      }}>Save password</button>
    </div>
  );
}
