import { env } from './http.ts';
import { bytesToBase64 } from './tokens.ts';

export interface SendResult { ok: boolean; id?: string; error?: string }

/** Twilio SMS. Uses a Messaging Service SID if configured, else a From number. */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = env('TWILIO_ACCOUNT_SID'); const token = env('TWILIO_AUTH_TOKEN');
  if (!sid || !token) return { ok: false, error: 'Twilio is not configured' };
  const form = new URLSearchParams({ To: to, Body: body });
  const svc = env('TWILIO_MESSAGING_SERVICE_SID');
  if (svc) form.set('MessagingServiceSid', svc); else form.set('From', env('TWILIO_FROM_NUMBER'));
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.sid } : { ok: false, error: j.message ?? `Twilio ${r.status}` };
}

export interface EmailAttachment { filename: string; content: Uint8Array }

/** Resend email. */
export async function sendEmail(opts: { to: string; subject: string; html: string; text?: string;
  attachments?: EmailAttachment[]; headers?: Record<string, string> }): Promise<SendResult> {
  const key = env('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'Resend is not configured' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('EMAIL_FROM', 'Smog Zone <no-reply@example.com>'),
      to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text, headers: opts.headers,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: bytesToBase64(a.content) })),
    }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.id } : { ok: false, error: j.message ?? `Resend ${r.status}` };
}

/** Validates Twilio's X-Twilio-Signature (HMAC-SHA1 of URL + sorted POST params). */
export async function validTwilioSignature(url: string, params: URLSearchParams, signature: string | null): Promise<boolean> {
  const token = env('TWILIO_AUTH_TOKEN');
  if (!token || !signature) return false;
  const keys = [...new Set([...params.keys()])].sort();
  const data = url + keys.map((k) => k + params.get(k)).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return bytesToBase64(sig) === signature;
}

export function toE164(s: string | null | undefined): string | null {
  const d = (s ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return null;
}
