// Bundled lookups for the shop's service area; anything else falls back to Zippopotam.us.
const LOCAL: Record<string, string> = {
  '95670': 'Rancho Cordova', '95742': 'Rancho Cordova', '95655': 'Mather', '95827': 'Sacramento',
  '95826': 'Sacramento', '95825': 'Sacramento', '95821': 'Sacramento', '95823': 'Sacramento',
  '95824': 'Sacramento', '95828': 'Sacramento', '95829': 'Sacramento', '95830': 'Sacramento',
  '95811': 'Sacramento', '95814': 'Sacramento', '95815': 'Sacramento', '95816': 'Sacramento',
  '95817': 'Sacramento', '95818': 'Sacramento', '95819': 'Sacramento', '95820': 'Sacramento',
  '95822': 'Sacramento', '95831': 'Sacramento', '95832': 'Sacramento', '95833': 'Sacramento',
  '95834': 'Sacramento', '95835': 'Sacramento', '95838': 'Sacramento', '95841': 'Sacramento',
  '95842': 'Sacramento', '95864': 'Sacramento', '95608': 'Carmichael', '95610': 'Citrus Heights',
  '95621': 'Citrus Heights', '95628': 'Fair Oaks', '95630': 'Folsom', '95662': 'Orangevale',
  '95683': 'Sloughhouse', '95693': 'Wilton', '95624': 'Elk Grove', '95757': 'Elk Grove',
  '95758': 'Elk Grove', '95660': 'North Highlands', '95673': 'Rio Linda', '95843': 'Antelope',
  '95762': 'El Dorado Hills', '95682': 'Shingle Springs', '95667': 'Placerville',
  '95677': 'Rocklin', '95765': 'Rocklin', '95678': 'Roseville', '95661': 'Roseville',
  '95747': 'Roseville', '95691': 'West Sacramento', '95605': 'West Sacramento', '95632': 'Galt',
  '95638': 'Herald', '95690': 'Walnut Grove', '95615': 'Courtland', '95639': 'Hood',
};

export interface ZipResult { city: string; state: string }

export function lookupZipLocal(zip: string): ZipResult | null {
  const z = zip.trim().slice(0, 5);
  return LOCAL[z] ? { city: LOCAL[z], state: 'CA' } : null;
}

const cache = new Map<string, ZipResult | null>();
export async function lookupZip(zip: string, fetchImpl: typeof fetch = fetch): Promise<ZipResult | null> {
  const z = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return null;
  const local = lookupZipLocal(z);
  if (local) return local;
  if (cache.has(z)) return cache.get(z)!;
  try {
    const r = await fetchImpl(`https://api.zippopotam.us/us/${z}`);
    const j = r.ok ? await r.json() : null;
    const place = j?.places?.[0];
    const res = place ? { city: String(place['place name']), state: String(place['state abbreviation']) } : null;
    cache.set(z, res);
    return res;
  } catch {
    return null;
  }
}
