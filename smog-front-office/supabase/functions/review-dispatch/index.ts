// Cron (every 5 min): send due Google review requests. Exactly once per visit,
// only with consent, never to opted-out numbers/addresses; SMS first, email fallback.
// The same review link goes to every customer (no review gating).
import { adminClient } from '../_shared/clients.ts';
import { env, escapeHtml, fail, json } from '../_shared/http.ts';
import { sendEmail, sendSms, toE164 } from '../_shared/messaging.ts';
import { reviewSms, type Lang } from '../_shared/messages.ts';
import { safeEqual } from '../_shared/tokens.ts';

Deno.serve(async (req) => {
  const secret = env('CRON_SECRET');
  const auth = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || !safeEqual(auth, secret)) return fail('Forbidden', 403);

  const admin = adminClient();
  const { data: claimed, error } = await admin.rpc('claim_due_reviews', { p_limit: 50 });
  if (error) return fail(error.message, 500);
  const redirectBase = env('REVIEW_REDIRECT_BASE', `${env('SUPABASE_URL')}/functions/v1/r`).replace(/\/$/, '');
  const outcomes: Record<string, string> = {};

  // deno-lint-ignore no-explicit-any
  const finish = async (id: string, patch: Record<string, any>, label: string) => {
    await admin.from('review_requests').update(patch).eq('id', id);
    outcomes[id] = label;
  };

  for (const rr of claimed ?? []) {
    const { data: e } = await admin.from('estimates').select('*').eq('id', rr.estimate_id).single();
    const { data: shop } = await admin.from('shops').select('*').eq('id', rr.shop_id).single();
    const custId = e?.customer_id ?? rr.customer_id;
    const { data: cust } = custId ? await admin.from('customers').select('*').eq('id', custId).single() : { data: null };
    const skip = (reason: string) => finish(rr.id, { status: 'skipped', skip_reason: reason, sent_at: null }, `skipped: ${reason}`);

    if (!e || e.status === 'void') { await skip('voided'); continue; }
    if (!shop?.google_review_url) { await skip('no Google review link in settings'); continue; }
    const consent = !!(e.sms_consent || cust?.sms_consent);
    if (!consent) { await skip('no consent'); continue; }

    const { data: sig } = e.signature_id ? await admin.from('signatures').select('language').eq('id', e.signature_id).single() : { data: null };
    const lang = ((cust?.preferred_language ?? sig?.language) === 'es' ? 'es' : 'en') as Lang;
    const link = `${redirectBase}/${rr.short_code}`;
    const phone = toE164(e.phone ?? cust?.phone);
    let optedOut = !!cust?.sms_opt_out;
    if (phone && !optedOut) {
      const { data: oo } = await admin.from('sms_opt_outs').select('phone_e164').eq('phone_e164', phone).maybeSingle();
      optedOut = !!oo;
    }

    if (phone && !optedOut) {
      const r = await sendSms(phone, reviewSms(lang, shop.name, e.customer_first_name ?? '', link));
      if (r.ok) { await finish(rr.id, { channel: 'sms', sent_to: phone }, 'sms'); continue; }
    }
    const email = e.email ?? cust?.email;
    if (email && !cust?.email_opt_out) {
      const unsub = `${redirectBase}/u/${rr.short_code}`;
      const name = escapeHtml(e.customer_first_name || (lang === 'es' ? 'amigo' : 'there'));
      const r = await sendEmail({
        to: email,
        subject: lang === 'es' ? `Gracias por elegir ${shop.name}` : `Thanks for choosing ${shop.name}`,
        html: lang === 'es'
          ? `<p>¡Gracias por elegir ${escapeHtml(shop.name)}, ${name}!</p><p>Si nos lo ganamos, una reseña rápida en Google nos ayuda mucho:</p><p><a href="${link}">Dejar una reseña</a></p><p style="font-size:12px;color:#666"><a href="${unsub}">Cancelar suscripción</a></p>`
          : `<p>Thanks for choosing ${escapeHtml(shop.name)}, ${name}!</p><p>If we earned it, a quick Google review helps us a lot:</p><p><a href="${link}">Leave a review</a></p><p style="font-size:12px;color:#666"><a href="${unsub}">Unsubscribe</a></p>`,
        headers: { 'List-Unsubscribe': `<${unsub}>` },
      });
      if (r.ok) { await finish(rr.id, { channel: 'email', sent_to: email }, 'email'); continue; }
      await finish(rr.id, { status: 'failed', error: r.error, sent_at: null }, `failed: ${r.error}`);
      continue;
    }
    if (optedOut) await skip('opted out'); else if (phone) await finish(rr.id, { status: 'failed', error: 'SMS failed and no email', sent_at: null }, 'failed');
    else await skip('no phone or email');
  }
  return json({ processed: (claimed ?? []).length, outcomes });
});
