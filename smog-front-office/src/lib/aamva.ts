/**
 * Parser for the PDF417 barcode on the back of US/Canadian driver's licenses
 * and ID cards (AAMVA DL/ID Card Design Standard, versions 1–10).
 *
 * Only name and address are returned. License number, date of birth, physical
 * description etc. are deliberately dropped and must never be stored.
 */
export interface LicenseData {
  firstName: string; middleName: string; lastName: string;
  street: string; unit: string; city: string; state: string; zip: string;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'\-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase());
}

export function isAamva(raw: string): boolean {
  return /ANSI\s?\d{6}|AAMVA/.test(raw) && /D(CS|AC|AA|AG)/.test(raw);
}

export function extractElements(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\x1e/g, '\n').split('\n');
  for (let line of lines) {
    line = line.replace(/^\s+/, '');
    if (!line) continue;
    if (/^(ANSI|AAMVA|@)/.test(line)) {
      const m = line.match(/(?:DL|ID)(D[A-Z]{2}.*)$/);
      if (!m) continue;
      line = m[1];
    } else if (/^(DL|ID)D[A-Z]{2}/.test(line)) {
      line = line.slice(2);
    }
    const m = line.match(/^(D[A-Z]{2}|Z[A-Z]{2})(.*)$/);
    if (m && !out.has(m[1])) out.set(m[1], m[2].trim());
  }
  return out;
}

const clean = (s: string | undefined) => {
  const v = (s ?? '').trim();
  return /^(NONE|UNAVL|UNKNOWN)$/i.test(v) ? '' : v;
};

export function parseAamva(raw: string): LicenseData | null {
  const el = extractElements(raw);
  let first = clean(el.get('DAC')) || clean(el.get('DCT'));
  let middle = clean(el.get('DAD'));
  let last = clean(el.get('DCS')) || clean(el.get('DAB'));

  // Version 1 combined name "LAST,FIRST,MIDDLE"; DCT may hold "FIRST,MIDDLE" or "FIRST MIDDLE"
  if (!last && el.get('DAA')) {
    const parts = clean(el.get('DAA')).split(/[,$]/).map((p) => p.trim());
    [last, first = '', middle = ''] = parts;
  }
  if (first && !middle && el.has('DCT') && !el.has('DAC')) {
    const parts = first.split(/[,\s]+/);
    first = parts.shift() ?? '';
    middle = parts.join(' ');
  }
  if (!first && !last) return null;

  const zipRaw = clean(el.get('DAK')).replace(/[^0-9]/g, '');
  return {
    firstName: titleCase(first),
    middleName: titleCase(middle),
    lastName: titleCase(last),
    street: titleCase(clean(el.get('DAG'))),
    unit: titleCase(clean(el.get('DAH'))),
    city: titleCase(clean(el.get('DAI'))),
    state: clean(el.get('DAJ')).toUpperCase(),
    zip: zipRaw.slice(0, 5),
  };
}
