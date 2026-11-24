import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/session';
import { fmtDateTime } from '../lib/format';
import type { ActiveSession } from '../lib/types';
import { ErrorBanner } from '../components/Modal';

/** Every device currently signed in. The same login may be open on many machines at once. */
export default function Devices() {
  const { lookups, deviceSessionId, isOwner } = useSession();
  const [rows, setRows] = useState<ActiveSession[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const names = new Map(lookups.profiles.map((p) => [p.id, p.full_name]));
  const load = useCallback(() => supabase.from('active_sessions').select('*').is('revoked_at', null)
    .gte('last_seen_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('last_seen_at', { ascending: false })
    .then(({ data }) => setRows((data ?? []) as ActiveSession[])), []);
  useEffect(() => {
    load();
    const ch = supabase.channel('devices').on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, load).subscribe();
    const t = setInterval(load, 30_000);
    return () => { ch.unsubscribe(); clearInterval(t); };
  }, [load]);
  const online = (s: ActiveSession) => Date.now() - new Date(s.last_seen_at).getTime() < 3 * 60_000;
  const revoke = async (id: string) => {
    if (!confirm('Sign this device out now?')) return;
    const { error } = await supabase.rpc('revoke_session', { p_id: id });
    if (error) setErr(error.message); else load();
  };
  return (
    <div className="mx-auto max-w-4xl p-3 sm:p-4">
      <h1 className="mb-1 text-xl font-extrabold text-cobalt">Devices</h1>
      <p className="mb-3 text-sm text-slate-600">{isOwner ? 'All devices signed in to the shop in the last 7 days.' : 'Your signed-in devices.'} Signing a device out takes effect immediately.</p>
      <ErrorBanner error={err} />
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>User</th><th>Device</th><th>Status</th><th>Signed in</th><th>Last seen</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{names.get(s.user_id) ?? '—'}</td>
                <td>{s.device_label}{s.id === deviceSessionId && <span className="ml-1 rounded bg-cobalt-light px-1 text-xs text-cobalt">this device</span>}</td>
                <td>{online(s) ? <span className="text-emerald-700">● Online</span> : <span className="text-slate-400">○ Idle</span>}</td>
                <td>{fmtDateTime(s.created_at)}</td>
                <td>{fmtDateTime(s.last_seen_at)}</td>
                <td>{s.id !== deviceSessionId && <button className="btn-ghost h-8 min-h-0 px-2 text-xs text-brandred" onClick={() => revoke(s.id)}>Sign out</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
