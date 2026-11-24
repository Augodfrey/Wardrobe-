// Staff: generate invoice / estimate / monthly statement PDFs; view, print or email them.
//  POST { kind: 'invoice', estimate_id, action: 'view'|'print'|'email', email? }
//  POST { kind: 'statement', company_id, action: 'view'|'email', email? }
// The first PDF made after Issue is the original; every later one is watermarked as a reprint.
import { adminClient, requireStaff } from '../_shared/clients.ts';
import { escapeHtml, fail, json, preflight } from '../_shared/http.ts';
import { renderInvoicePdf, renderStatementPdf } from '../_shared/invoicePdf.ts';
import { fmtDate, loadInvoiceData, shopInfo } from '../_shared/invoiceData.ts';
import { sendEmail } from '../_shared/messaging.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const staff = await requireStaff(req);
  if (!staff) return fail('Not signed in', 401);
  const body = await req.json();
  const admin = adminClient();

  if (body.kind === 'statement') {
    const { data: company } = await staff.sb.from('companies').select('*').eq('id', body.company_id).single();
    if (!company) return fail('Company not found', 404);
    const { data: shop } = await admin.from('shops').select('*').eq('id', company.shop_id).single();
    const { data: invoices } = await staff.sb.from('estimates').select('*')
      .eq('company_id', company.id).eq('status', 'issued').is('paid_at', null).order('issued_at');
    const now = new Date();
    const pdf = await renderStatementPdf({
      shop: shopInfo(shop), company: company.name, contact: company.contact_person ?? '',
      address: [[company.street, company.unit].filter(Boolean).join(' '), [company.city, [company.state, company.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
      periodLabel: `Unpaid invoices as of ${fmtDate(now.toISOString())}`, generated: fmtDate(now.toISOString()),
      // deno-lint-ignore no-explicit-any
      invoices: (invoices ?? []).map((i: any) => ({ number: i.estimate_number, date: fmtDate(i.issued_at), plate: i.plate ?? '',
        vehicle: [i.year, i.make, i.model].filter(Boolean).join(' '), total: Number(i.total), paid: Number(i.amount_paid) })),
    });
    const path = `${company.shop_id}/statements/${company.id}-${now.toISOString().slice(0, 10)}.pdf`;
    await admin.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    const { data: signed } = await admin.storage.from('documents').createSignedUrl(path, 3600);
    let email = null;
    if (body.action === 'email') {
      const to = body.email || company.email;
      if (!to) return fail('No email address for this company');
      email = await sendEmail({ to, subject: `${shop.name} statement for ${company.name}`,
        html: `<p>Hello ${escapeHtml(company.contact_person || company.name)},</p><p>Your statement from ${escapeHtml(shop.name)} is attached.</p><p>${escapeHtml(shop.phone ?? '')}</p>`,
        attachments: [{ filename: `Statement-${company.name.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`, content: pdf }] });
      if (!email.ok) return fail(email.error ?? 'Email failed', 502);
    }
    return json({ ok: true, url: signed?.signedUrl, email });
  }

  // Invoice / estimate
  const { data: visible } = await staff.sb.from('estimates').select('id').eq('id', body.estimate_id).maybeSingle();
  if (!visible) return fail('Document not found', 404);
  const { data: current } = await admin.from('estimates').select('status, print_count, pdf_path').eq('id', body.estimate_id).single();
  const issued = current?.status === 'issued';
  const reprint = issued && (current?.print_count ?? 0) > 0;
  const { estimate, shop, data } = await loadInvoiceData(admin, body.estimate_id, reprint);
  const pdf = await renderInvoicePdf(data);
  const kind = issued ? 'invoice' : 'estimate';
  const path = `${estimate.shop_id}/${kind}s/${estimate.estimate_number}${reprint ? `-reprint-${Date.now()}` : ''}.pdf`;
  const up = await admin.storage.from('documents').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (up.error) return fail('Could not store PDF', 500);
  if (issued) {
    await admin.from('estimates').update({
      print_count: (current?.print_count ?? 0) + 1, ...(reprint ? {} : { pdf_path: path }),
    }).eq('id', estimate.id);
  }
  const { data: signed } = await admin.storage.from('documents').createSignedUrl(path, 3600);

  let email = null;
  if (body.action === 'email') {
    const to = body.email || estimate.email;
    if (!to) return fail('No email address');
    const label = issued ? 'Invoice' : 'Estimate';
    email = await sendEmail({
      to, subject: `${shop.name} ${label} #${estimate.estimate_number}`,
      html: `<p>Hi ${escapeHtml(estimate.customer_first_name || '')},</p><p>Your ${label.toLowerCase()} from ${escapeHtml(shop.name)} is attached.</p>
             <p>Thanks for your business!<br>${escapeHtml(shop.name)} &middot; ${escapeHtml(shop.phone ?? '')}</p>`,
      attachments: [{ filename: `${label}-${estimate.estimate_number}.pdf`, content: pdf }],
    });
    if (!email.ok) return fail(email.error ?? 'Email failed', 502);
    if (body.email && !estimate.email && !issued) await admin.from('estimates').update({ email: body.email }).eq('id', estimate.id);
  }
  return json({ ok: true, url: signed?.signedUrl, reprint, email });
});
