// Staff: create a single-use, 24-hour signing link (or an invoice view link) and text/email it.
import { adminClient, requireStaff } from '../_shared/clients.ts';
import { env, fail, json, preflight, escapeHtml } from '../_shared/http.ts';
import { sendEmail, sendSms, toE164 } from '../_shared/messaging.ts';
import { invoiceSms, signingSms, type Lang } from '../_shared/messages.ts';
import { randomToken, sha256Hex } from '../_shared/tokens.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const staff = await requireStaff(req);
  if (!staff) return fail('Not signed in', 401);
  const { estimate_id, channel = 'sms', purpose = 'sign', language = 'en', to_phone, to_email } = await req.json();

  // RLS check: the caller must be able to see this estimate
  const { data: e } = await staff.sb.from('estimates').select('*').eq('id', estimate_id).single();
  if (!e) return fail('Estimate not found', 404);
  if (purpose === 'sign' && ['issued', 'void'].includes(e.status)) return fail('This document is closed');
  if (purpose === 'sign' && e.signature_id) return fail('Already signed. The customer is never asked to sign again.');
  if (purpose === 'view_invoice' && e.status !== 'issued') return fail('Issue the invoice first');

  const admin = adminClient();
  const { data: shop } = await admin.from('shops').select('*').eq('id', e.shop_id).single();
  const phone = to_phone ?? e.phone; const email = to_email ?? e.email;
  const token = randomToken();
  const hours = purpose === 'sign' ? 24 : 24 * 30;
  const base = (shop?.public_app_url || env('PUBLIC_APP_URL')).replace(/\/$/, '');
  const url = `${base}/${purpose === 'sign' ? 's' : 'i'}/${token}`;

  const { error } = await admin.from('signing_links').insert({
    shop_id: e.shop_id, estimate_id: e.id, token_hash: await sha256Hex(token), purpose, channel,
    sent_to: [channel !== 'email' ? phone : null, channel !== 'sms' ? email : null].filter(Boolean).join(', '),
    expires_at: new Date(Date.now() + hours * 3600_000).toISOString(), created_by: staff.profile.id,
  });
  if (error) return fail(error.message, 500);

  // Older unused sign links for this estimate stop working
  if (purpose === 'sign') {
    await admin.from('signing_links').update({ expires_at: new Date().toISOString() })
      .eq('estimate_id', e.id).eq('purpose', 'sign').is('used_at', null).neq('token_hash', await sha256Hex(token));
    if (e.status === 'draft') await admin.from('estimates').update({ status: 'awaiting_signature' }).eq('id', e.id);
  }

  const lang = (language === 'es' ? 'es' : 'en') as Lang;
  const results: Record<string, unknown> = {};
  if (channel !== 'email') {
    if (!phone) return fail('No phone number on the estimate');
    const e164 = toE164(phone);
    if (!e164) return fail('The phone number is not a valid US number');
    const body = purpose === 'sign' ? signingSms(lang, shop.name, e.estimate_number, url) : invoiceSms(lang, shop.name, e.estimate_number, url);
    results.sms = await sendSms(e164, body);
  }
  if (channel !== 'sms') {
    if (!email) return fail('No email address on the estimate');
    const what = purpose === 'sign' ? `review and sign estimate #${e.estimate_number}` : `view invoice #${e.estimate_number}`;
    results.email = await sendEmail({
      to: email, subject: `${shop.name}: ${purpose === 'sign' ? 'Please review and sign your estimate' : 'Your invoice'}`,
      html: `<p>Hi ${escapeHtml(e.customer_first_name || '')},</p><p>Tap the button below to ${what}.</p>
        <p><a href="${url}" style="background:#0057A8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Open</a></p>
        <p style="color:#666;font-size:12px">${purpose === 'sign' ? 'This link works once and expires in 24 hours.' : ''} ${escapeHtml(shop.name)}, ${escapeHtml(shop.phone ?? '')}</p>`,
      text: `${what}: ${url}`,
    });
  }
  return json({ ok: true, url, results });
});
