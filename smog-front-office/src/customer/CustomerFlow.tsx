import { useRef, useState } from 'react';
import { SignatureBox, type SignatureHandle } from '../components/SignatureBox';
import { t, type Lang, type MsgKey } from '../lib/i18n';
import { money } from '../lib/totals';

export interface CustomerDetails {
  customer_first_name: string; customer_last_name: string; phone: string; email: string;
  plate: string; year: string; make: string; model: string;
}
export interface CustomerLine { product_code: string | null; description: string; quantity: number; unit_price: number; discount_amount: number; total_price: number }
export interface CustomerEstimateView {
  estimate_number: string; subtotal: number; tax: number; total: number; details: CustomerDetails; lines: CustomerLine[];
}
export interface SignPayload {
  details: CustomerDetails; signer_name: string; signature_png: string; language: Lang;
  acks: { authorize: boolean; price: boolean; sms_consent: boolean };
}

const STEPS: MsgKey[] = ['step_details', 'step_review', 'step_agree', 'step_sign'];

/**
 * The customer-facing signing flow, shared by tablet mode and the remote phone link:
 * confirm details → review estimate in large type → acknowledgments → finger signature.
 */
export function CustomerFlow({ shopName, shopPhone, estimate, lang, setLang, onSubmit, remote }: {
  shopName: string; shopPhone: string; estimate: CustomerEstimateView; lang: Lang; setLang: (l: Lang) => void;
  onSubmit: (p: SignPayload) => Promise<void>; remote?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<CustomerDetails>(estimate.details);
  const [acks, setAcks] = useState({ authorize: false, price: false, sms_consent: false });
  const [signer, setSigner] = useState(`${estimate.details.customer_first_name} ${estimate.details.customer_last_name}`.trim());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sig = useRef<SignatureHandle>(null);
  const tt = (k: MsgKey, v?: Record<string, string | number>) => t(lang, k, { shop: shopName, phone: shopPhone, ...v });
  const set = (k: keyof CustomerDetails) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  const next = () => {
    setErr(null);
    if (step === 0 && d.phone.replace(/\D/g, '').length < 10) return setErr(tt('phone_required'));
    if (step === 2 && !(acks.authorize && acks.price)) return setErr(tt('ack_required'));
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    setErr(null);
    if (sig.current?.isEmpty()) return setErr(tt('sign_required'));
    if (!signer.trim()) return setErr(tt('name_required'));
    setBusy(true);
    try {
      await onSubmit({ details: d, signer_name: signer.trim(), signature_png: sig.current!.toPng(), language: lang, acks });
    } catch {
      setErr(tt('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const big = 'w-full rounded-lg border border-slate-300 px-4 py-3 text-lg focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/30';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 text-slate-900 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-cobalt sm:text-3xl">{tt('welcome')}</h1>
          <p className="text-slate-500">{tt('estimate_no', { n: estimate.estimate_number })}</p>
        </div>
        <button className="btn-ghost shrink-0 text-base" onClick={() => setLang(lang === 'en' ? 'es' : 'en')} aria-label="Change language">
          🌐 {tt('language')}
        </button>
      </div>

      <ol className="mb-5 grid grid-cols-4 gap-1 text-center text-xs font-semibold sm:text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded py-2 ${i === step ? 'bg-cobalt text-white' : i < step ? 'bg-cobalt-light text-cobalt' : 'bg-slate-100 text-slate-500'}`}>
            {i + 1}. {tt(s)}
          </li>
        ))}
      </ol>

      {err && <div className="mb-3 rounded-lg bg-brandred/10 px-4 py-3 text-base font-semibold text-brandred" role="alert">{err}</div>}

      {step === 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">{tt('confirm_details')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="text-sm text-slate-600">{tt('first_name')}</span><input className={big} value={d.customer_first_name} onChange={set('customer_first_name')} autoComplete="given-name" /></label>
            <label><span className="text-sm text-slate-600">{tt('last_name')}</span><input className={big} value={d.customer_last_name} onChange={set('customer_last_name')} autoComplete="family-name" /></label>
            <label><span className="text-sm text-slate-600">{tt('phone')} *</span><input className={big} value={d.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" /></label>
            <label><span className="text-sm text-slate-600">{tt('email')}</span><input className={big} value={d.email} onChange={set('email')} inputMode="email" autoComplete="email" /></label>
          </div>
          <h3 className="pt-2 text-lg font-bold">{tt('vehicle')}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label><span className="text-sm text-slate-600">{tt('plate')}</span><input className={big} value={d.plate} onChange={(e) => setD({ ...d, plate: e.target.value.toUpperCase() })} /></label>
            <label><span className="text-sm text-slate-600">{tt('year')}</span><input className={big} value={d.year} onChange={set('year')} inputMode="numeric" maxLength={4} /></label>
            <label><span className="text-sm text-slate-600">{tt('make')}</span><input className={big} value={d.make} onChange={set('make')} /></label>
            <label><span className="text-sm text-slate-600">{tt('model')}</span><input className={big} value={d.model} onChange={set('model')} /></label>
          </div>
        </section>
      )}

      {step === 1 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">{tt('step_review')}</h2>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-base sm:text-lg">
              <thead className="bg-slate-50 text-left text-sm text-slate-600">
                <tr><th className="px-3 py-2">{tt('description')}</th><th className="px-3 py-2 text-right">{tt('qty')}</th><th className="px-3 py-2 text-right">{tt('price')}</th></tr>
              </thead>
              <tbody>
                {estimate.lines.map((l, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-3">{l.description}{l.discount_amount > 0 && <div className="text-sm text-emerald-700">{tt('discount')}: −{money(l.discount_amount)}</div>}</td>
                    <td className="px-3 py-3 text-right">{l.quantity}</td>
                    <td className="px-3 py-3 text-right">{money(l.total_price)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr><td className="px-3 py-1 text-right" colSpan={2}>{tt('subtotal')}</td><td className="px-3 py-1 text-right">{money(estimate.subtotal)}</td></tr>
                <tr><td className="px-3 py-1 text-right" colSpan={2}>{tt('tax')}</td><td className="px-3 py-1 text-right">{money(estimate.tax)}</td></tr>
                <tr className="text-2xl font-extrabold text-cobalt"><td className="px-3 py-3 text-right" colSpan={2}>{tt('total')}</td><td className="px-3 py-3 text-right">{money(estimate.total)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-600">{tt('legal_notice')}</p>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">{tt('step_agree')}</h2>
          {([['authorize', tt('ack_authorize'), true], ['price', tt('ack_price', { total: money(estimate.total) }), true], ['sms_consent', tt('ack_sms'), false]] as const).map(([k, label, req]) => (
            <label key={k} className={`flex cursor-pointer items-start gap-4 rounded-lg border p-4 text-base sm:text-lg ${acks[k] ? 'border-cobalt bg-cobalt-light' : 'border-slate-300 bg-white'}`}>
              <input type="checkbox" className="mt-1 h-7 w-7 shrink-0 accent-cobalt" checked={acks[k]} onChange={(e) => setAcks({ ...acks, [k]: e.target.checked })} />
              <span>{label}{req && <span className="text-brandred"> *</span>}</span>
            </label>
          ))}
        </section>
      )}

      {step === 3 && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">{tt('sign_here')}</h2>
          <SignatureBox ref={sig} label={tt('sign_here')} clearLabel={tt('clear')} />
          <label className="block"><span className="text-sm text-slate-600">{tt('type_name')}</span>
            <input className={big} value={signer} onChange={(e) => setSigner(e.target.value)} autoComplete="name" /></label>
          {remote && <p className="text-sm text-slate-500">{tt('call_us')}</p>}
        </section>
      )}

      <div className="mt-6 flex justify-between gap-3">
        <button className="btn-ghost h-14 px-6 text-lg" disabled={step === 0 || busy} onClick={() => { setErr(null); setStep(step - 1); }}>{tt('back')}</button>
        {step < 3
          ? <button className="btn-primary h-14 flex-1 text-lg sm:flex-none sm:px-10" onClick={next}>{tt('next')}</button>
          : <button className="btn-primary h-14 flex-1 text-lg sm:flex-none sm:px-10" disabled={busy} onClick={submit}>{busy ? tt('submitting') : tt('submit')}</button>}
      </div>
    </div>
  );
}

export function ThankYou({ lang, shopName, remote }: { lang: Lang; shopName: string; remote?: boolean }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-700">✓</div>
      <h1 className="mb-2 text-3xl font-extrabold text-cobalt">{t(lang, 'thanks_title')}</h1>
      <p className="text-lg text-slate-700">{t(lang, remote ? 'thanks_body_remote' : 'thanks_body')}</p>
      <p className="mt-6 text-sm text-slate-400">{shopName}</p>
    </div>
  );
}
