// PUBLIC Twilio webhook for inbound SMS. Records STOP / START so review texts
// honour opt-outs (Twilio also blocks delivery itself after STOP).
import { adminClient } from '../_shared/clients.ts';
import { env } from '../_shared/http.ts';
import { toE164, validTwilioSignature } from '../_shared/messaging.ts';
import { START_WORDS, STOP_WORDS } from '../_shared/messages.ts';

const twiml = (msg = '') => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg}</Message>` : ''}</Response>`,
  { headers: { 'Content-Type': 'text/xml' } });

Deno.serve(async (req) => {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const publicUrl = env('TWILIO_WEBHOOK_URL', req.url);
  if (!(await validTwilioSignature(publicUrl, params, req.headers.get('X-Twilio-Signature')))) {
    return new Response('Forbidden', { status: 403 });
  }
  const from = toE164(params.get('From'));
  const word = (params.get('Body') ?? '').trim().toUpperCase();
  if (!from) return twiml();
  const admin = adminClient();
  const digits = from.slice(2);
  if (STOP_WORDS.includes(word)) {
    await admin.from('sms_opt_outs').upsert({ phone_e164: from, opted_out_at: new Date().toISOString() });
    await admin.from('customers').update({ sms_opt_out: true }).or(`phone.eq.${digits},phone.eq.${from},phone.eq.(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
  } else if (START_WORDS.includes(word)) {
    await admin.from('sms_opt_outs').delete().eq('phone_e164', from);
    await admin.from('customers').update({ sms_opt_out: false }).or(`phone.eq.${digits},phone.eq.${from},phone.eq.(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`);
  }
  return twiml();
});
