# Smog Zone Front Office

A web and tablet app for **Smog Zone** (10083 Folsom Blvd #D, Rancho Cordova, CA 95670, ARD 238473). It replaces the front-office side of Smog Master 12.5: intake, estimates, invoices, payments, customer signature and reports. The smog test itself still runs on the BAR-97 analyzer.

It follows Smog Master's **Estimate Entry** workflow and adds four things Smog Master can't do:

| # | New capability | How it works |
|---|---|---|
| 1 | **Same login on many machines, synced live** | No single-session rule. Every device registers in `active_sessions`. Edits save field by field and reach the other devices over Supabase Realtime in under a second. A presence banner shows who else has the estimate open. The owner can sign a device out from **Devices**, which deletes that device's auth session and makes RLS reject its token straight away. |
| 2 | **Customer signs alone on a tablet** | **Hand to Customer** opens a locked full-screen view with no menu and no back button. The customer confirms their details, reviews the estimate, ticks the agreements and signs with a finger, in English or Spanish. Leaving the view needs the staff PIN, which is stored bcrypt-hashed. |
| 3 | **Customer signs on their own phone** | **Send link** texts (Twilio) or emails (Resend) a random 256-bit link that works once and expires in 24 hours. Only a SHA-256 hash of the token is stored. The counter screen shows *opened* and *signed* live. Expired or used links show a friendly page with the shop's phone number. |
| 4 | **Automatic Google review request** | Sent once per visit, only with consent. It goes by SMS with "Reply STOP to opt out", falls back to email, honors STOP replies and email unsubscribes, and counts clicks through a short tracked redirect. Every customer gets the same link (no review gating). |

## The editing rule (enforced in the database, not just the UI)

* An estimate in `draft`, `awaiting_signature` or `signed` stays **fully editable**, signed or not. You can change the odometer, VIN, plate, products, prices or anything else as many times as you need. **The customer is never asked to sign again**, and the original signature can't be replaced.
* **Issue** (`issue_estimate()`) turns the estimate into the final invoice and **locks it permanently**. A trigger rejects every later change from anyone, admins included. The only exceptions are payment bookkeeping, PDF bookkeeping and Void.
* Every edit is written quietly to `audit_log` (who, when, before and after).
* Leaving an estimate that was never issued shows Smog Master's warning, *"This Estimate has not been issued so it will be deleted! Click Don't Delete if you want to keep this Estimate."* **Delete** removes a draft that was never signed or sent. Anything signed or sent is voided instead, so the record is kept.

## Stack

* **Frontend:** React 18 + Vite + TypeScript + Tailwind (cobalt `#0057A8`, white, red `#CC2229`). Laid out for desktop and tablet.
* **Backend:** Supabase. That covers Postgres, Auth, Realtime, Storage, RLS on every table scoped by `shop_id`, and Edge Functions.
* **Scanning:** the native `BarcodeDetector` when the browser has it, with ZXing as the fallback (PDF417, Code 39, Code 128, Data Matrix, QR). There is also a text box for USB or Bluetooth handheld scanners. Driver's licenses are read with an AAMVA parser (`src/lib/aamva.ts`). **Only the name and address are kept.** The ID image, the raw barcode and the license number are never stored.
* **VIN decoding:** NHTSA vPIC. **Zip → city:** a built-in table for the Sacramento area, falling back to Zippopotam.us.
* **Signatures:** `signature_pad`. **PDFs** are made on the server with `pdf-lib` (`supabase/functions/_shared/invoicePdf.ts`).
* **SMS:** Twilio. **Email:** Resend. **Hosting:** Vercel or Netlify (SPA rewrites are included).

```
smog-front-office/
  src/
    pages/         Estimate Entry, Document List, Companies, Reports, Settings, Devices, Login
    customer/      CustomerFlow (shared), TabletMode (locked), RemoteSign + InvoiceView (public)
    components/    LineItems, BarcodeScanner, SignatureBox, PinPad, dialogs/ (Issue, Print/Email/View, Payment, …)
    hooks/         useEstimateSync — field-level autosave + realtime merge + presence
    lib/           totals, aamva, registration, vin, zip, reports (all 24 reports), csv, i18n (en/es)
  supabase/
    migrations/    0001 schema · 0002 rules/RPCs/audit · 0003 RLS/realtime/storage · 0004 sessions · 0005 opt-outs/review jobs
    seed.sql       Smog Zone, products, reasons, referral sources, payment types, discount terms, price lists
    functions/     send-signing-link · public-sign · documents · review-dispatch · r · twilio-inbound · invite-user
    tests/         business_rules.sql (database acceptance tests)
  e2e/ui-smoke.cjs Playwright smoke test of every screen against mocked Supabase
```

## Setup

1. **Create a Supabase project.** In Auth settings, **turn off public sign-ups**, because staff are invited by the owner.
2. **Apply the database:**
   ```bash
   supabase link --project-ref YOUR-REF
   supabase db push                         # runs supabase/migrations/*
   psql "$DATABASE_URL" -f supabase/seed.sql
   ```
3. **Create the first user** (Dashboard → Auth → Add user). The first user of the shop automatically becomes **Owner**. After that, invite staff from **Settings → Users**.
4. **Set the Edge Function secrets and deploy:**
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # fill in Twilio, Resend, CRON_SECRET, PUBLIC_APP_URL
   supabase secrets set --env-file supabase/functions/.env
   supabase functions deploy send-signing-link documents invite-user
   supabase functions deploy public-sign r twilio-inbound review-dispatch --no-verify-jwt
   ```
5. **Schedule the review dispatcher** every 5 minutes. The `cron.schedule` snippet is at the bottom of `migrations/0005_optouts.sql`.
6. **Point Twilio's inbound SMS webhook** at `https://YOUR-REF.supabase.co/functions/v1/twilio-inbound`.
7. **Frontend:**
   ```bash
   cp .env.example .env    # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
   npm install && npm run dev
   npm run build           # deploy dist/ to Vercel or Netlify
   ```
8. **Owner's first steps:** go to **Settings → Shop** and set the **staff PIN** (tablet mode stays off until a PIN is set). Then paste the **Google review link**, set the **public app URL** (used in customer links), and upload a logo if you want one.

## Tests

| Command | What it checks |
|---|---|
| `npm test` | 34 unit tests: AAMVA license parsing (and that the license number and date of birth are dropped), VIN check digits, registration-barcode heuristics, totals, tax and discounts, zip lookup, CSV (including formula-injection guard), the status-line flow, price lists, Spanish coverage, all 24 reports in both Summary and Detail, and invoice and statement PDF rendering and pagination. |
| `scripts/test-db.sh` | Applies every migration and the seed to a scratch PostgreSQL database, then runs `supabase/tests/business_rules.sql` (details below). |
| `npm run typecheck` / `npm run typecheck:functions` | Strict TypeScript for the app and for the Edge Functions. |
| `npm run test:ui` | Starts from a running `vite` with `VITE_SUPABASE_URL=http://mock.supabase.test`. Drives Chromium through Estimate Entry (registration scan, license scan, zip auto-fill, autosave, Don't Delete warning), the remote signing flow on a phone (Spanish, agreements, finger signature, submit, expired link), Reports, Settings, Companies, Devices and tablet mode. |

`business_rules.sql` checks:

* sequential estimate numbers (007875…)
* editing after signing with no re-sign and the original signature kept
* direct "issued" status changes rejected
* the issued invoice locked against staff **and owner** for fields, lines, reopening and deletion
* split payment with change
* monthly-company billing, then marking it paid
* review request queued once per visit and claimed exactly once
* click tracking
* the PIN is hashed and can't be read back
* audit entries written
* remote sign-out locks that device but not the same login on other devices
* cross-shop and anonymous RLS isolation
* void freezes the document; unsigned drafts can be deleted

### Acceptance tests from the brief → where they're covered

| Acceptance test | Covered by |
|---|---|
| Same user in two browsers, edit shows on the other within 2 s | `useEstimateSync` (Realtime `postgres_changes` + presence). **Check by hand** against a real Supabase project. |
| Scan registration + license with a tablet camera, fields fill; zip fills city | `test:ui` (scanner input path) + unit tests. **Check the camera itself on the actual tablet.** |
| Sign on tablet, then edit odometer and price: no re-sign, stays open | `business_rules.sql` |
| Issue → locked invoice with original signature, can't be edited | `business_rules.sql` + invoice PDF test |
| Remote link signed on a phone, counter updates live | `test:ui` (phone flow) + `SendLinkDialog` live status. **Check live with Twilio configured.** |
| Paid with a payment type, shows in Sales by Payment Type | `business_rules.sql` + reports unit test |
| Bill to monthly company, mark paid from Companies | `business_rules.sql` (`mark_company_invoices_paid`) |
| Review text sends exactly once per visit, never to opted-out | `business_rules.sql` (`claim_due_reviews`, unique per estimate); opt-out checks are in `review-dispatch` |
| Leaving an unissued estimate shows the Don't Delete warning | `test:ui` |

## Decisions and assumptions to confirm

* **Prices.** Only 01-TEST ($61.75), 015-Test Dealer ($31.75) and 06-CERT ($8.25) came from the Smog Master screens. Every other seed price, and the STAR, Coupon and Groupon list prices, are **placeholders**. Set the real ones in Settings → Products and Price Lists.
* **Sales tax** defaults to 8.75% and applies only to products marked *Taxable* (parts). Smog tests, labor and the certificate are not taxed. Change this in Settings.
* **Payment comes after Issue**, as in Smog Master. Pressing Payment on an open estimate opens Issue first. Split tender and per-card-type fee percentages are supported. No card data is ever entered.
* **Void** works on open estimates and on issued invoices (an accounting cancellation, recorded with a reason). An issued invoice can never be *edited or reopened*.
* **Reprints.** The first PDF made after Issue is the original. Every later copy carries the "REPRINT - NOT AN ORIGINAL DOCUMENT" watermark.
* **Review consent.** The optional checkbox reads "Text or email me about this visit, including a link to review Smog Zone." That one consent covers the SMS and the email fallback. The default timing is *whichever comes first*: the invoice is paid, or 2 hours after signing.
* **Registration barcodes.** DMV registration barcode layouts aren't a published standard. The parser picks out the VIN (preferring one with a valid check digit), plate, year and DMV make code, then fills in the rest from the VIN through NHTSA. Door-jamb VIN barcodes are fully supported. Test with real CA registration cards and adjust `src/lib/registration.ts` if needed.
* **Inventory reports** use the optional *Track stock / On hand* fields on products. Stock goes down when an invoice is issued.
