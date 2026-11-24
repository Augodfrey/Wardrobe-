import { findVin, titleMake } from './vin';
import { isAamva } from './aamva';

/**
 * Heuristic reader for DMV registration-card barcodes and door-jamb labels.
 * Registration barcode layouts are not a published standard and vary by state,
 * so we pull out what is recognisable (VIN, plate, year, make) and let the
 * NHTSA decoder fill the rest from the VIN.
 */
export interface RegistrationData {
  vin: string | null; plate: string | null; year: number | null; make: string | null;
}

// CA DMV uses 4–5 letter make abbreviations on registration documents
export const DMV_MAKES: Record<string, string> = {
  ACUR: 'Acura', AUDI: 'Audi', BMW: 'BMW', BUIC: 'Buick', CADI: 'Cadillac', CHEV: 'Chevrolet',
  CHRY: 'Chrysler', DODG: 'Dodge', FIAT: 'FIAT', FORD: 'Ford', GMC: 'GMC', HOND: 'Honda',
  HYUN: 'Hyundai', INFI: 'Infiniti', ISU: 'Isuzu', JAGU: 'Jaguar', JEEP: 'Jeep', KIA: 'KIA',
  LAND: 'Land Rover', LEXS: 'Lexus', LINC: 'Lincoln', MAZD: 'Mazda', MERZ: 'Mercedes-Benz',
  MERC: 'Mercury', MINI: 'MINI', MITS: 'Mitsubishi', NISS: 'Nissan', PONT: 'Pontiac',
  PORS: 'Porsche', RAM: 'RAM', SATR: 'Saturn', SCIO: 'Scion', SUBA: 'Subaru', SUZI: 'Suzuki',
  TESL: 'Tesla', TOYT: 'Toyota', VOLK: 'Volkswagen', VOLV: 'Volvo',
};

export function parseRegistrationBarcode(raw: string, now = new Date()): RegistrationData {
  const text = raw.toUpperCase();
  const vin = findVin(text);
  const tokens = text.split(/[\s|,;:^~*\t\r\n\x1d\x1e]+/).map((t) => t.trim()).filter(Boolean);
  const maxYear = now.getFullYear() + 1;

  let year: number | null = null;
  let make: string | null = null;
  let plate: string | null = null;

  for (const t of tokens) {
    if (vin && t.includes(vin)) continue;
    if (!year && /^(19[5-9]\d|20\d\d)$/.test(t) && Number(t) <= maxYear) year = Number(t);
    if (!make && DMV_MAKES[t]) make = DMV_MAKES[t];
  }
  // Prefer the standard CA passenger pattern (1ABC234), then any 2–8 char mixed token
  const plateTokens = tokens.filter((t) => t !== vin && /^[A-Z0-9]{2,8}$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t));
  plate = plateTokens.find((t) => /^\d[A-Z]{3}\d{3}$/.test(t))
    ?? plateTokens.find((t) => /^\d[A-Z]\d{5}$/.test(t) || /^\d{5}[A-Z]\d$/.test(t)) // commercial
    ?? plateTokens.find((t) => !DMV_MAKES[t] && t.length >= 5)
    ?? null;
  return { vin, plate, year, make: make ? titleMake(make) : null };
}

export type ScanKind = 'license' | 'registration' | 'vin';
export function classifyScan(raw: string): ScanKind {
  if (isAamva(raw)) return 'license';
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length <= 18 && findVin(compact)) return 'vin';
  return 'registration';
}
