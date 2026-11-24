// UI smoke test: renders every screen against mocked Supabase endpoints (no backend needed).
// Run: VITE_SUPABASE_URL=http://mock.supabase.test VITE_SUPABASE_ANON_KEY=anon npx vite --port 5199 --strictPort &
//      node e2e/ui-smoke.cjs e2e/screenshots
const { chromium } = require('playwright');
const OUT = process.argv[2] || 'e2e/screenshots';
require('fs').mkdirSync(OUT, { recursive: true });
const SHOP = '00000000-0000-0000-0000-000000238473';
const UID = '11111111-1111-1111-1111-111111111111';
const EID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const now = new Date().toISOString();
const products = [
  { id: 'p1', code: '01-TEST', description: 'Inspection 2000 and newer', product_type: 'test', unit_cost: 61.75, unit_price: 61.75, taxable: false, track_inventory: false, on_hand: 0, sort_order: 1, active: true },
  { id: 'p2', code: '06-CERT', description: 'Smog Certificate', product_type: 'certificate', unit_cost: 8.25, unit_price: 8.25, taxable: false, track_inventory: false, on_hand: 0, sort_order: 10, active: true },
  { id: 'p3', code: '015-Test', description: 'Dealer', product_type: 'test', unit_cost: 31.75, unit_price: 31.75, taxable: false, track_inventory: false, on_hand: 0, sort_order: 5, active: true },
];
let estimate = { id: EID, shop_id: SHOP, estimate_number: '007875', manual_estimate_number: null, po_number: null, account_id: '0', status: 'draft',
  vehicle_id: null, plate: null, plate_none: false, plate_state: 'CA', year: null, make: null, model: null, odometer: null, odometer_none: false, vin: null,
  customer_id: null, company_id: null, customer_first_name: '', customer_last_name: '', owner_first_name: '', owner_last_name: '', owner_same_as_customer: true,
  street: null, unit: null, zip: null, city: null, state: 'CA', phone: null, email: null, registration_due_date: null, retest_of_invoice_number: null, retest_of_date: null,
  reason_for_test: null, referral_source_id: null, price_list_id: 'pl1', is_star: false, tire_pressure_check: null, notes: null,
  subtotal: 70, subtotal_parts: 0, subtotal_labor: 61.75, state_certificate: 8.25, dmv_fees: 0, discount_total: 0, tax: 0, total: 70,
  issued_at: null, time_in: now, time_out: null, result: null, certificate_number: null, technician_id: null, bay: null, payment_type_id: null, amount_paid: 0,
  change_due: 0, card_fee_total: 0, paid_at: null, billed_to_company: false, signature_id: null, sms_consent: false, pdf_path: null, print_count: 0,
  voided_at: null, void_reason: null, created_by: UID, created_at: now, updated_at: now };
const items = [
  { id: 'i1', estimate_id: EID, line_no: 1, product_id: 'p1', product_code: '01-TEST', product_type: 'test', description: 'Inspection 2000 and newer', quantity: 1, unit_cost: 61.75, unit_price: 61.75, price_overridden: false, taxable: false, discount_term_id: null, discount_amount: 0, total_price: 61.75 },
  { id: 'i2', estimate_id: EID, line_no: 2, product_id: 'p2', product_code: '06-CERT', product_type: 'certificate', description: 'Smog Certificate', quantity: 1, unit_cost: 8.25, unit_price: 8.25, price_overridden: false, taxable: false, discount_term_id: null, discount_amount: 0, total_price: 8.25 },
];
const fixtures = {
  profiles: [{ id: UID, shop_id: SHOP, full_name: 'Owner Olivia', role: 'owner', is_technician: true, active: true }],
  shop_settings: { id: SHOP, name: 'Smog Zone', street: '10083 Folsom Blvd #D', city: 'Rancho Cordova', state: 'CA', zip: '95670', phone: '(916) 368-9152', ard_number: '238473', tax_rate: 0.0875, google_review_url: null, review_trigger: 'first', review_delay_minutes: 120, public_app_url: null, has_staff_pin: true },
  products, price_lists: [{ id: 'pl1', name: 'Regular', is_default: true, sort_order: 1, active: true }, { id: 'pl2', name: 'Dealer', is_default: false, sort_order: 2, active: true }],
  price_list_items: [{ id: 'x', price_list_id: 'pl2', product_id: 'p1', unit_price: 31.75 }],
  reasons_for_test: ['Change of Ownership', 'Directed', 'Gross Polluter', 'Out of State', 'Smog Test'].map((n, i) => ({ id: 'r' + i, name: n, sort_order: i, active: true })),
  referral_sources: ['Coupon', 'Internet', 'Repeat Customer', 'Walk in', 'Yellow Pages'].map((n, i) => ({ id: 'rs' + i, name: n, sort_order: i, active: true })),
  payment_types: ['Cash', 'Visa', 'Mastercard'].map((n, i) => ({ id: 'pt' + i, name: n, sort_order: i, active: true, is_card: i > 0, card_fee_percent: i > 0 ? 3 : 0, is_company_account: false })),
  discount_terms: [{ id: 'd1', name: '10% Off', percent: 10, amount: 0, sort_order: 1, active: true }],
  companies: [{ id: 'c1', name: 'Acme Fleet', billing_mode: 'monthly', active: true, contact_person: 'Bob', phone: '9165550199', email: 'ap@acme.test', street: '1 Fleet Way', unit: null, city: 'Sacramento', state: 'CA', zip: '95827', notes: null }],
  estimates: () => [estimate], estimate_items: () => items, signatures: [], vehicles: [], active_sessions: [], signing_links: [],
};
const patches = [];
const errors = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await ctx.addInitScript(([uid]) => {
    const s = { access_token: 'x.eyJzdWIiOiIxIn0.y', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 36000,
      user: { id: uid, email: 'owner@smogzone.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
    localStorage.setItem('sb-mock-auth-token', JSON.stringify(s));
  }, [UID]);
  await ctx.route('http://mock.supabase.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.startsWith('/auth/v1/user')) return json({ id: UID, email: 'owner@smogzone.test' });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.split('/').pop();
      patches.push({ rpc: fn, body: req.postDataJSON?.() });
      if (fn === 'register_session') return json('ssssssss-ssss-ssss-ssss-ssssssssssss');
      if (fn === 'verify_staff_pin') return json(true);
      return json(null);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/')[3];
      if (req.method() === 'PATCH') {
        const body = req.postDataJSON();
        patches.push({ table, body });
        if (table === 'estimates') estimate = { ...estimate, ...body };
        return json(single ? estimate : [estimate]);
      }
      if (req.method() === 'POST') { patches.push({ table, body: req.postDataJSON() }); const row = { id: 'new' + patches.length, ...(req.postDataJSON() || {}) }; return json(single ? row : [row], 201); }
      let data = fixtures[table]; if (typeof data === 'function') data = data();
      if (data === undefined) data = [];
      if (single) return json(Array.isArray(data) ? data[0] ?? null : data);
      return json(Array.isArray(data) ? data : [data]);
    }
    if (url.pathname.startsWith('/functions/v1/public-sign')) {
      if (req.method() === 'POST') { patches.push({ fn: 'public-sign', body: Object.keys(req.postDataJSON()) }); return json({ ok: true }); }
      if (url.searchParams.get('token') === 'expired-token-xxxxxxxxxxxxxxxxxxxxxxxxxxx') return json({ state: 'expired', shop: { name: 'Smog Zone', phone: '(916) 368-9152' } }, 410);
      return json({ state: 'ok', purpose: 'sign', shop: { name: 'Smog Zone', phone: '(916) 368-9152' }, already_signed: false,
        estimate: { estimate_number: '007875', customer_first_name: 'Maria', customer_last_name: 'Garcia', phone: '(916) 555-0101', email: '', plate: '7ABC123', year: 2003, make: 'Honda', model: 'Accord', subtotal: 70, tax: 0, total: 70 },
        items: items.map(({ product_code, description, quantity, unit_price, discount_amount, total_price }) => ({ product_code, description, quantity, unit_price, discount_amount, total_price })) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  // Block zip API from real network: answer locally
  await ctx.route('https://api.zippopotam.us/**', (r) => r.fulfill({ status: 404, body: '{}' }));
  await ctx.route('https://vpic.nhtsa.dot.gov/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ Results: [{ ModelYear: '2003', Make: 'HONDA', Model: 'Accord' }] }) }));

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_|404/.test(m.text())) errors.push('console: ' + m.text()); });

  // 1. Estimate Entry
  await page.goto(`http://localhost:5199/estimate/${EID}`);
  await page.getByRole('heading', { name: 'Estimate Entry' }).waitFor();
  await page.getByText('Ready to scan DMV Registration').waitFor();
  // Scan a registration via the handheld-scanner box
  await page.getByRole('button', { name: /Scan DMV Registration/ }).click();
  await page.locator('#scan-manual').fill('7ABC123|1HGCM82633A004352|2003|HOND|ACCORD');
  await page.getByRole('button', { name: 'Use scanned text' }).click();
  await page.getByText(/Registration scanned/).waitFor();
  // Scan a license
  await page.getByRole('button', { name: /Scan Driver's License/ }).click();
  await page.locator('#scan-manual').fill('@\n\x1e\rANSI 636014080102DL00410279ZC03200024DLDAQY1234567\nDCSGARCIA\nDACMARIA\nDADELENA\nDAG10083 FOLSOM BLVD\nDAIRANCHO CORDOVA\nDAJCA\nDAK956700000\n');
  await page.getByRole('button', { name: 'Use scanned text' }).click();
  await page.getByText(/License scanned: Maria Garcia/).waitFor();
  // zip auto-fill
  const zip = page.getByLabel('Zip');
  await zip.fill('95827');
  await page.waitForTimeout(600);
  const city = await page.getByLabel('City', { exact: true }).inputValue();
  if (city !== 'Sacramento') errors.push('zip autofill failed: ' + city);
  await page.getByLabel('Phone *').fill('9165550101');
  await page.getByLabel('Phone *').blur();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/01-estimate-entry.png`, fullPage: true });
  const estPatches = patches.filter((p) => p.table === 'estimates').map((p) => Object.keys(p.body)).flat();
  for (const k of ['plate', 'vin', 'customer_first_name', 'zip', 'city', 'phone']) if (!estPatches.includes(k)) errors.push('field not saved: ' + k);
  if (patches.some((p) => JSON.stringify(p).includes('Y1234567'))) errors.push('LICENSE NUMBER LEAKED');
  const status = await page.getByRole('status').innerText();

  // 2. Payment & output dialog rendering (simulate issued)
  // 3. Leave warning
  await page.getByRole('button', { name: 'Document List' }).first().click();
  await page.getByText("This Estimate has not been issued so it will be deleted!").waitFor();
  await page.screenshot({ path: `${OUT}/02-leave-warning.png` });
  await page.getByRole('button', { name: "Don't Delete" }).click();
  await page.getByText('Document List', { exact: true }).first().waitFor();

  // 4. Remote signing on a phone
  const p2 = await ctx.newPage();
  await p2.setViewportSize({ width: 390, height: 844 });
  p2.on('pageerror', (e) => errors.push('pageerror(remote): ' + e.message));
  await p2.goto('http://localhost:5199/s/valid-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  await p2.getByText('Welcome to Smog Zone').waitFor();
  await p2.screenshot({ path: `${OUT}/03-remote-details.png`, fullPage: true });
  await p2.getByRole('button', { name: 'Change language' }).click();
  await p2.getByText('Bienvenido a Smog Zone').waitFor();
  await p2.getByRole('button', { name: 'Siguiente' }).click();
  await p2.screenshot({ path: `${OUT}/04-remote-review-es.png`, fullPage: true });
  await p2.getByRole('button', { name: 'Siguiente' }).click();
  await p2.getByRole('button', { name: 'Siguiente' }).click();
  await p2.getByText('Marque las dos casillas').waitFor();
  const boxes = p2.locator('input[type=checkbox]');
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await p2.getByRole('button', { name: 'Siguiente' }).click();
  const canvas = p2.locator('canvas');
  const b = await canvas.boundingBox();
  await p2.mouse.move(b.x + 30, b.y + 100); await p2.mouse.down();
  for (let i = 0; i < 20; i++) await p2.mouse.move(b.x + 30 + i * 12, b.y + 100 + Math.sin(i) * 30);
  await p2.mouse.up();
  await p2.screenshot({ path: `${OUT}/05-remote-sign.png`, fullPage: true });
  await p2.getByRole('button', { name: 'Firmar y enviar' }).click();
  await p2.getByText('¡Gracias!').waitFor();
  if (!patches.some((p) => p.fn === 'public-sign')) errors.push('signature not submitted');
  // expired link page
  await p2.goto('http://localhost:5199/s/expired-token-xxxxxxxxxxxxxxxxxxxxxxxxxxx');
  await p2.getByText(/expired|vencido/).waitFor();
  await p2.screenshot({ path: `${OUT}/06-expired.png` });

  // 5. Reports & settings & documents render
  for (const [path, file, text] of [['/reports', '07-reports.png', 'Main Reports'], ['/settings', '08-settings.png', 'Google review request'], ['/companies', '09-companies.png', 'Acme Fleet'], ['/devices', '10-devices.png', 'Devices']]) {
    await page.goto(`http://localhost:5199${path}`);
    await page.getByText(text).first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  }
  // run a report
  await page.goto('http://localhost:5199/reports');
  await page.getByRole('button', { name: 'Sales by Payment Type' }).click();
  await page.getByText(/rows/).first().waitFor();

  // 6. Tablet mode
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`http://localhost:5199/tablet/${EID}`);
  await page.getByText('Welcome to Smog Zone').waitFor();
  await page.screenshot({ path: `${OUT}/11-tablet.png` });

  if (errors.length) process.exitCode = 1;
  console.log(JSON.stringify({ status, errors, rpcs: [...new Set(patches.filter((p) => p.rpc).map((p) => p.rpc))] }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message, errors); process.exit(1); });
