import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CustomerFlow, ThankYou, type CustomerEstimateView, type SignPayload } from './CustomerFlow';
import { PinPad } from '../components/PinPad';
import { supabase } from '../lib/supabase';
import { t, type Lang } from '../lib/i18n';
import type { Estimate, EstimateItem } from '../lib/types';
import { useSession } from '../state/session';

/**
 * Locked, full-screen customer view. No menu, no back button. Exiting needs the
 * staff PIN (verified server-side against a bcrypt hash).
 */
export default function TabletMode() {
  const { id } = useParams();
  const nav = useNavigate();
  const { shop } = useSession();
  const [lang, setLang] = useState<Lang>('en');
  const [est, setEst] = useState<Estimate | null>(null);
  const [view, setView] = useState<CustomerEstimateView | null>(null);
  const [done, setDone] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: e }, { data: items }] = await Promise.all([
        supabase.from('estimates').select('*').eq('id', id).single(),
        supabase.from('estimate_items').select('*').eq('estimate_id', id).order('line_no'),
      ]);
      if (!e) return;
      const est = e as Estimate;
      setEst(est);
      if (est.signature_id) setDone(true);
      setView({
        estimate_number: est.estimate_number, subtotal: Number(est.subtotal), tax: Number(est.tax), total: Number(est.total),
        details: {
          customer_first_name: est.customer_first_name ?? '', customer_last_name: est.customer_last_name ?? '',
          phone: est.phone ?? '', email: est.email ?? '', plate: est.plate ?? '', year: est.year ? String(est.year) : '',
          make: est.make ?? '', model: est.model ?? '',
        },
        lines: ((items ?? []) as EstimateItem[]).map((l) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price),
          discount_amount: Number(l.discount_amount), total_price: Number(l.total_price) })),
      });
    })();
  }, [id]);

  // Lock: full screen, swallow the back button, warn on reload
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    history.pushState(null, '', location.href);
    const pop = () => history.pushState(null, '', location.href);
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('popstate', pop);
    window.addEventListener('beforeunload', unload);
    const ctx = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', ctx);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('contextmenu', ctx);
    };
  }, []);

  const submit = async (p: SignPayload) => {
    if (!est) return;
    const blob = await (await fetch(p.signature_png)).blob();
    const path = `${est.shop_id}/${est.id}-${Date.now()}.png`;
    const up = await supabase.storage.from('signatures').upload(path, blob, { contentType: 'image/png' });
    if (up.error) throw up.error;
    const details = { ...p.details };
    const { error } = await supabase.rpc('submit_tablet_signature', {
      p_estimate: est.id, p_image_path: path, p_signer: p.signer_name, p_acks: p.acks, p_language: p.language,
      p_details: details, p_user_agent: navigator.userAgent,
    });
    if (error) throw error;
    setDone(true);
  };

  const tryPin = async (pin: string) => {
    const { data, error } = await supabase.rpc('verify_staff_pin', { p_pin: pin });
    if (error || !data) { setPinErr('Incorrect PIN'); return; }
    document.exitFullscreen?.().catch(() => undefined);
    nav(`/estimate/${id}`, { replace: true });
  };

  if (!shop?.has_staff_pin) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-brandred">Set a staff PIN first</h1>
        <p className="mb-4 text-slate-600">Tablet mode needs a staff PIN so customers cannot leave the locked screen. The owner can set it in Settings → Shop.</p>
        <button className="btn-primary" onClick={() => nav(`/estimate/${id}`)}>Back to estimate</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen select-none bg-slate-50" style={{ WebkitUserSelect: 'none' }}>
      <div className="h-2 bg-cobalt" /><div className="h-1 bg-brandred" />
      {!view ? <p className="p-10 text-center text-slate-500">{t(lang, 'loading')}</p>
        : done ? <ThankYou lang={lang} shopName={shop?.name ?? ''} />
        : <CustomerFlow shopName={shop?.name ?? ''} shopPhone={shop?.phone ?? ''} estimate={view} lang={lang} setLang={setLang} onSubmit={submit} />}
      <div className="fixed bottom-2 right-2">
        {unlocking ? (
          <div className="rounded-lg border bg-white p-4 shadow-xl">
            <PinPad title={t(lang, 'staff_only')} onSubmit={tryPin} error={pinErr} />
            <button className="mt-2 w-full text-sm text-slate-500" onClick={() => { setUnlocking(false); setPinErr(null); }}>Cancel</button>
          </div>
        ) : (
          <button className="rounded-full bg-slate-200/70 px-3 py-1 text-xs text-slate-500" onClick={() => setUnlocking(true)} aria-label="Staff unlock">🔒 Staff</button>
        )}
      </div>
    </div>
  );
}
