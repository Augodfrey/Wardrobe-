// PUBLIC (no login). A customer opens /s/<token> (sign) or /i/<token> (view invoice).
// Exposes exactly one document, only while the link is valid.
import { adminClient } from '../_shared/clients.ts';
import { clientIp, fail, json, preflight } from '../_shared/http.ts';
import { sha256Hex } from '../_shared/tokens.ts';

const MAX_SIG_BYTES = 600_000;

// deno-lint-ignore no-explicit-any
async function findLink(admin: any, token: string) {
  if (!token || token.length < 30 || token.length > 100) return null;
  const { data } = await admin.from('signing_links').select('*').eq('token_hash', await sha256Hex(token)).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const admin = adminClient();
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const token = (req.method === 'GET' ? url.searchParams.get('token') : body.token) ?? '';
  const link = await findLink(admin, token);
  if (!link) return json({ state: 'invalid' }, 404);

  const { data: shop } = await admin.from('shops').select('name, phone, street, city, state, zip, ard_number').eq('id', link.shop_id).single();
  const expired = new Date(link.expires_at).getTime() < Date.now();
  if (expired) return json({ state: 'expired', shop }, 410);
  if (link.purpose === 'sign' && link.used_at) return json({ state: 'used', shop }, 410);

  const { data: e } = await admin.from('estimates').select('*').eq('id', link.estimate_id).single();
  if (!e || e.status === 'void') return json({ state: 'invalid', shop }, 404);

  if (req.method === 'GET') {
    if (!link.opened_at) await admin.from('signing_links').update({ opened_at: new Date().toISOString() }).eq('id', link.id);
    const { data: items } = await admin.from('estimate_items')
      .select('product_code, description, quantity, unit_price, discount_amount, total_price').eq('estimate_id', e.id).order('line_no');
    let pdfUrl: string | null = null;
    if (link.purpose === 'view_invoice' && e.pdf_path) {
      const { data } = await admin.storage.from('documents').createSignedUrl(e.pdf_path, 3600);
      pdfUrl = data?.signedUrl ?? null;
    }
    return json({
      state: 'ok', purpose: link.purpose, shop, pdfUrl,
      already_signed: !!e.signature_id,
      estimate: {
        estimate_number: e.estimate_number, status: e.status, created_at: e.created_at,
        customer_first_name: e.customer_first_name, customer_last_name: e.customer_last_name,
        phone: e.phone, email: e.email, plate: e.plate, year: e.year, make: e.make, model: e.model,
        reason_for_test: e.reason_for_test, subtotal: e.subtotal, tax: e.tax, total: e.total,
      },
      items: items ?? [],
    });
  }

  if (req.method !== 'POST') return fail('Method not allowed', 405);
  if (link.purpose !== 'sign') return fail('This link is view-only');
  if (['issued'].includes(e.status)) return json({ state: 'used', shop }, 410);

  const { signer_name, signature_png, acks = {}, language = 'en', details = {} } = body;
  if (!acks.authorize || !acks.price) return fail('Please accept the authorization and price');
  if (typeof signer_name !== 'string' || !signer_name.trim() || signer_name.length > 120) return fail('Please type your name');
  const m = typeof signature_png === 'string' && signature_png.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return fail('Signature missing');
  const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_SIG_BYTES || bytes[0] !== 0x89 || bytes[1] !== 0x50) return fail('Invalid signature image');

  // Only whitelisted, length-limited detail fields reach the database
  const allowed = ['customer_first_name', 'customer_last_name', 'phone', 'email', 'plate', 'year', 'make', 'model'];
  const clean: Record<string, string> = {};
  for (const k of allowed) if (typeof details[k] === 'string' || typeof details[k] === 'number') clean[k] = String(details[k]).slice(0, 80);
  if (clean.year && !/^\d{4}$/.test(clean.year)) delete clean.year;

  const path = `${e.shop_id}/${e.id}-${Date.now()}.png`;
  const up = await admin.storage.from('signatures').upload(path, bytes, { contentType: 'image/png', upsert: false });
  if (up.error) return fail('Could not save signature', 500);

  const { error } = await admin.rpc('apply_signature', {
    p_estimate: e.id, p_image_path: path, p_signer: signer_name.trim(), p_method: 'remote',
    p_ip: clientIp(req), p_user_agent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
    p_acks: { authorize: !!acks.authorize, price: !!acks.price, sms_consent: !!acks.sms_consent },
    p_language: language === 'es' ? 'es' : 'en', p_details: clean,
  });
  if (error) return fail(error.message, 500);
  return json({ ok: true });
});
