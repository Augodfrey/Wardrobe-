export function digitsOnly(s: string) { return s.replace(/\D/g, ''); }

export function formatPhone(s: string | null | undefined): string {
  const d = digitsOnly(s ?? '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (n.length !== 10) return s ?? '';
  return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}

export function toE164(s: string | null | undefined): string | null {
  const d = digitsOnly(s ?? '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return null;
}

export const isEmail = (s: string | null | undefined) => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
