# Wardrobe

Scan the clothes you buy, build a digital wardrobe, and ask an AI stylist
"I've got an event — what should I wear?" It looks at what you actually own and
suggests outfits that match.

## How it works

1. **Add an item** — scan the store tag's barcode (or type the code), snap a
   photo, and Claude's vision model auto-fills the garment's type, color,
   pattern, formality, and seasons. You can correct anything before saving.
2. **Build your wardrobe** — every item you add is stored on your device.
3. **Get dressed** — describe an occasion ("job interview", "summer wedding")
   and Claude reasons over your wardrobe to propose complete outfits, explaining
   why each works and what (if anything) you're missing.

> **On scanning:** there's no universal database mapping a retailer's barcode to
> a garment's attributes — every store has its own private catalog. So the
> barcode is stored as the item's reference code, and the *photo + AI* is what
> actually fills in the wardrobe data. That's what makes the recommendations work
> across stores.

## Architecture

```
app/      Expo (React Native) app — camera scanning, photo capture, wardrobe, stylist UI
server/   Thin TypeScript/Express proxy that calls the Claude API
```

The Anthropic API key lives **only** on the server. The mobile app talks to the
proxy, never directly to Claude — an API key shipped in an app bundle can be
extracted, so it stays server-side.

Both halves use the same garment vocabulary (`types.ts` in each package).

## Running it

### 1. Backend

```bash
cd server
cp .env.example .env        # then paste your Anthropic API key into .env
npm install
npm run dev                 # starts http://localhost:4000
```

Get a key at https://console.anthropic.com/. The proxy uses Claude Opus 4.8 for
both vision tagging (`/api/tag`) and outfit recommendations (`/api/recommend`).

### 2. App

```bash
cd app
npm install
npx expo start
```

Press `i` (iOS simulator), `a` (Android emulator), or scan the QR code with the
Expo Go app on your phone.

**Connecting the app to the backend:**

- iOS simulator / web → `http://localhost:4000` (default)
- Android emulator → `http://10.0.2.2:4000` (default)
- Physical device → the device can't see `localhost`. Copy `app/.env.example`
  to `app/.env` and set `EXPO_PUBLIC_API_URL` to your computer's LAN IP, e.g.
  `http://192.168.1.20:4000`. Make sure the phone and computer are on the same
  network.

## Notes & next steps

- Wardrobe data is stored locally (AsyncStorage). There's no account or sync yet
  — a natural next step is a backend datastore so the wardrobe follows you across
  devices.
- Photos are kept as local file URIs; the base64 is only sent to the proxy at
  tagging time and not persisted server-side.
- Possible extensions: outfit history/favorites, weather-aware suggestions
  (pull the forecast into the recommend prompt), "packing list for a trip", and
  laundry/wear tracking.
