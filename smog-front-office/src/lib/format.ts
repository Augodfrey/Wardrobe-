export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US') : '';
export const fullName = (f?: string | null, l?: string | null) => `${f ?? ''} ${l ?? ''}`.trim();
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', awaiting_signature: 'Awaiting signature', signed: 'Signed (open)', issued: 'Invoice', void: 'Void',
};
export const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-200 text-slate-700', awaiting_signature: 'bg-amber-100 text-amber-800', signed: 'bg-emerald-100 text-emerald-800',
  issued: 'bg-cobalt text-white', void: 'bg-brandred/15 text-brandred',
};
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'Tablet' : /Mobi|iPhone/i.test(ua) ? 'Phone' : 'Desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  return `${kind} · ${browser}`;
}
