// PUBLIC short tracked redirect:  /r/<code>  -> logs the click, 302 to the Google review page
//                                 /r/u/<code> -> email unsubscribe
import { adminClient } from '../_shared/clients.ts';

const page = (title: string, msg: string) => new Response(
  `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${title}</title>
   <body style="font-family:system-ui;text-align:center;padding:48px 16px;color:#0f172a"><h1 style="color:#0057A8">${title}</h1><p>${msg}</p></body>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const i = parts.indexOf('r');
  const rest = parts.slice(i + 1);
  const admin = adminClient();

  if (rest[0] === 'u' && rest[1]) {
    const { data: rr } = await admin.from('review_requests').select('customer_id, estimate_id').eq('short_code', rest[1]).maybeSingle();
    if (rr?.customer_id) await admin.from('customers').update({ email_opt_out: true }).eq('id', rr.customer_id);
    else if (rr) {
      const { data: e } = await admin.from('estimates').select('customer_id').eq('id', rr.estimate_id).single();
      if (e?.customer_id) await admin.from('customers').update({ email_opt_out: true }).eq('id', e.customer_id);
    }
    return page('Unsubscribed', 'You will not receive more emails like this from us.');
  }
  const code = rest[0] ?? '';
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return page('Link not found', 'This link is not valid.');
  const { data: url } = await admin.rpc('record_review_click', { p_code: code });
  if (!url) return page('Link not found', 'This link is not valid.');
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
});
