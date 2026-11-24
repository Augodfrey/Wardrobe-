const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
export const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/g;

export function normalizeVin(s: string): string {
  let v = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Door-jamb Code 39 labels often prefix the VIN with "I" (import) or a check char
  if (v.length === 18 && (v[0] === 'I' || v[0] === 'A')) v = v.slice(1);
  return v;
}

export function vinCheckDigitValid(vin: string): boolean {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const n = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += n * WEIGHTS[i];
  }
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  return vin[8] === check;
}

/** Find the most plausible VIN in arbitrary text (prefers check-digit-valid candidates). */
export function findVin(text: string): string | null {
  const up = text.toUpperCase();
  const candidates = new Set<string>();
  for (const m of up.matchAll(VIN_RE)) candidates.add(m[0]);
  const whole = normalizeVin(up);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(whole)) candidates.add(whole);
  const list = [...candidates];
  return list.find(vinCheckDigitValid) ?? list[0] ?? null;
}

export interface DecodedVehicle { year: number | null; make: string; model: string }

/** NHTSA vPIC decoder (free, no key). */
export async function decodeVin(vin: string, fetchImpl: typeof fetch = fetch): Promise<DecodedVehicle | null> {
  try {
    const r = await fetchImpl(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`);
    if (!r.ok) return null;
    const j = await r.json();
    const row = j?.Results?.[0];
    if (!row || (!row.Make && !row.ModelYear)) return null;
    return {
      year: row.ModelYear ? Number(row.ModelYear) : null,
      make: titleMake(String(row.Make ?? '')),
      model: String(row.Model ?? ''),
    };
  } catch {
    return null;
  }
}

const UPPER_MAKES = new Set(['BMW', 'GMC', 'RAM', 'MINI', 'FIAT', 'KIA']);
export function titleMake(m: string): string {
  const u = m.trim().toUpperCase();
  if (UPPER_MAKES.has(u)) return u;
  return u.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}
