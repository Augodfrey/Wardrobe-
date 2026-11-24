import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CustomerFlow, ThankYou, type CustomerEstimateView, type CustomerLine, type SignPayload } from './CustomerFlow';
import { callPublic } from '../lib/supabase';
import { t, type Lang } from '../lib/i18n';
import { money } from '../lib/totals';

interface ShopPublic { name: string; phone: string | null }
interface LoadResult {
  state: 'ok' | 'expired' | 'used' | 'invalid'; purpose?: 'sign' | 'view_invoice'; shop?: ShopPublic; pdfUrl?: string | null;
  already_signed?: boolean;
  estimate?: { estimate_number: string; customer_first_name: string; customer_last_name: string; phone: string | null; email: string | null;
    plate: string | null; year: number | null; make: string | null; model: string | null; subtotal: number; tax: number; total: number };
  items?: CustomerLine[];
}

const browserLang = (): Lang => (navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en');

function Shell({ children, shop }: { children: React.ReactNode; shop?: ShopPublic }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-cobalt px-4 py-3 text-white"><span className="text-lg font-extrabold">{shop?.name ?? 'Smog Zone'}</span></header>
      <div className="h-1 bg-brandred" />
      {children}
    </div>
  );
}

function Problem({ lang, state, shop }: { lang: Lang; state: string; shop?: ShopPublic }) {
  const key = state === 'expired' ? 'link_expired' : state === 'used' ? 'link_used' : 'link_invalid';
  const phone = shop?.phone ?? '(916) 368-9152';
  return (
    <Shell shop={shop}>
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="mb-3 text-2xl font-bold text-slate-800">{t(lang, key)}</h1>
        <p className="text-lg text-slate-600">{t(lang, 'call_us', { phone })}</p>
        <a className="btn-primary mt-6 text-lg" href={`tel:${phone.replace(/\D/g, '')}`}>📞 {phone}</a>
      </div>
    </Shell>
  );
}

/** /s/:token — customer signs on their own phone. No login. */
export function RemoteSign() {
  const { token = '' } = useParams();
  const [lang, setLang] = useState<Lang>(browserLang());
  const [res, setRes] = useState<LoadResult | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    callPublic<LoadResult>('public-sign', { query: { token } }).then(({ data }) => setRes(data.state ? data : { state: 'invalid' }))
      .catch(() => setRes({ state: 'invalid' }));
  }, [token]);

  if (!res) return <Shell><p className="p-10 text-center text-slate-500">{t(lang, 'loading')}</p></Shell>;
  if (res.state !== 'ok' || !res.estimate) return <Problem lang={lang} state={res.state} shop={res.shop} />;
  if (done || res.already_signed) return <Shell shop={res.shop}><ThankYou lang={lang} shopName={res.shop?.name ?? ''} remote /></Shell>;

  const e = res.estimate;
  const view: CustomerEstimateView = {
    estimate_number: e.estimate_number, subtotal: Number(e.subtotal), tax: Number(e.tax), total: Number(e.total),
    details: { customer_first_name: e.customer_first_name ?? '', customer_last_name: e.customer_last_name ?? '', phone: e.phone ?? '',
      email: e.email ?? '', plate: e.plate ?? '', year: e.year ? String(e.year) : '', make: e.make ?? '', model: e.model ?? '' },
    lines: (res.items ?? []).map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price),
      discount_amount: Number(l.discount_amount), total_price: Number(l.total_price) })),
  };
  const submit = async (p: SignPayload) => {
    const { status, data } = await callPublic<{ ok?: boolean; error?: string; state?: string }>('public-sign', { method: 'POST', body: { token, ...p } });
    if (status === 410) { setRes({ ...res, state: (data.state as LoadResult['state']) ?? 'used' }); return; }
    if (!data.ok) throw new Error(data.error ?? 'failed');
    setDone(true);
  };
  return (
    <Shell shop={res.shop}>
      <CustomerFlow remote shopName={res.shop?.name ?? ''} shopPhone={res.shop?.phone ?? ''} estimate={view} lang={lang} setLang={setLang} onSubmit={submit} />
    </Shell>
  );
}

/** /i/:token — customer views their final invoice after Issue. */
export function InvoiceView() {
  const { token = '' } = useParams();
  const [lang, setLang] = useState<Lang>(browserLang());
  const [res, setRes] = useState<LoadResult | null>(null);
  useEffect(() => {
    callPublic<LoadResult>('public-sign', { query: { token } }).then(({ data }) => setRes(data.state ? data : { state: 'invalid' }))
      .catch(() => setRes({ state: 'invalid' }));
  }, [token]);
  if (!res) return <Shell><p className="p-10 text-center text-slate-500">{t(lang, 'loading')}</p></Shell>;
  if (res.state !== 'ok' || !res.estimate) return <Problem lang={lang} state={res.state} shop={res.shop} />;
  return (
    <Shell shop={res.shop}>
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-cobalt">{t(lang, 'invoice_ready', { n: res.estimate.estimate_number })}</h1>
          <button className="btn-ghost" onClick={() => setLang(lang === 'en' ? 'es' : 'en')}>🌐 {t(lang, 'language')}</button>
        </div>
        <div className="card">
          {(res.items ?? []).map((l, i) => (
            <div key={i} className="flex justify-between border-b border-slate-100 py-2 text-lg"><span>{l.quantity} × {l.description}</span><span>{money(l.total_price)}</span></div>
          ))}
          <div className="flex justify-between pt-3 text-2xl font-extrabold text-cobalt"><span>{t(lang, 'total')}</span><span>{money(res.estimate.total)}</span></div>
        </div>
        {res.pdfUrl && <a className="btn-primary mt-4 w-full text-lg" href={res.pdfUrl} target="_blank" rel="noreferrer">{t(lang, 'download_pdf')}</a>}
        <p className="mt-6 text-center text-slate-500">{t(lang, 'call_us', { phone: res.shop?.phone ?? '' })}</p>
      </div>
    </Shell>
  );
}
