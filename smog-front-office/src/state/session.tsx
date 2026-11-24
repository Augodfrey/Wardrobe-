import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { deviceLabel } from '../lib/format';
import type {
  Company, DiscountTerm, NamedListItem, PaymentType, PriceList, PriceListItem, Product, Profile, Shop,
} from '../lib/types';

export interface Lookups {
  products: Product[]; priceLists: PriceList[]; priceListItems: PriceListItem[];
  reasons: NamedListItem[]; referralSources: NamedListItem[]; paymentTypes: PaymentType[];
  discountTerms: DiscountTerm[]; profiles: Profile[]; companies: Company[];
}

interface SessionCtx {
  session: Session | null;
  profile: Profile | null;
  shop: Shop | null;
  lookups: Lookups;
  loading: boolean;
  isOwner: boolean;
  deviceSessionId: string | null;
  refreshLookups: () => Promise<void>;
  refreshShop: () => Promise<void>;
  signOut: () => Promise<void>;
}

const empty: Lookups = { products: [], priceLists: [], priceListItems: [], reasons: [], referralSources: [],
  paymentTypes: [], discountTerms: [], profiles: [], companies: [] };

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [lookups, setLookups] = useState<Lookups>(empty);
  const [loading, setLoading] = useState(true);
  const [deviceSessionId, setDeviceSessionId] = useState<string | null>(null);
  const heartbeat = useRef<number>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) setLoading(false); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshShop = useCallback(async () => {
    const { data } = await supabase.from('shop_settings').select('*').single();
    setShop(data as Shop | null);
  }, []);

  const refreshLookups = useCallback(async () => {
    const q = <T,>(table: string, order = 'sort_order') =>
      supabase.from(table).select('*').order(order).then(({ data }) => (data ?? []) as T[]);
    const [products, priceLists, priceListItems, reasons, referralSources, paymentTypes, discountTerms, profiles, companies] =
      await Promise.all([
        q<Product>('products'), q<PriceList>('price_lists'), q<PriceListItem>('price_list_items', 'created_at'),
        q<NamedListItem>('reasons_for_test'), q<NamedListItem>('referral_sources'), q<PaymentType>('payment_types'),
        q<DiscountTerm>('discount_terms'), q<Profile>('profiles', 'full_name'), q<Company>('companies', 'name'),
      ]);
    setLookups({ products, priceLists, priceListItems, reasons, referralSources, paymentTypes, discountTerms, profiles, companies });
  }, []);

  // Load profile + shop + lookups whenever the signed-in user changes
  useEffect(() => {
    if (!session) { setProfile(null); setShop(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (cancelled) return;
      setProfile(p as Profile | null);
      await Promise.all([refreshShop(), refreshLookups()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session?.user.id, refreshShop, refreshLookups]); // eslint-disable-line react-hooks/exhaustive-deps

  // Multi-device: register this device, heartbeat, and obey remote sign-out.
  useEffect(() => {
    if (!session || !profile) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let id: string | null = null;
    const register = async () => {
      const { data, error } = await supabase.rpc('register_session', { p_label: deviceLabel(), p_user_agent: navigator.userAgent });
      if (error || !data) {
        // current_shop_id() is null after a remote sign-out
        if (error?.message?.includes('Not signed in')) await supabase.auth.signOut();
        return;
      }
      id = data as string;
      setDeviceSessionId(id);
      channel?.unsubscribe();
      channel = supabase.channel(`session-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'active_sessions', filter: `id=eq.${id}` }, (payload) => {
          if ((payload.new as { revoked_at: string | null }).revoked_at) {
            alert('This device was signed out by an administrator.');
            supabase.auth.signOut();
          }
        })
        .subscribe();
    };
    register();
    heartbeat.current = window.setInterval(register, 60_000);
    return () => { window.clearInterval(heartbeat.current); channel?.unsubscribe(); };
  }, [session?.user.id, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    if (deviceSessionId) await supabase.from('active_sessions').delete().eq('id', deviceSessionId);
    await supabase.auth.signOut({ scope: 'local' }); // other devices on the same login stay signed in
  }, [deviceSessionId]);

  const value = useMemo<SessionCtx>(() => ({
    session, profile, shop, lookups, loading, isOwner: profile?.role === 'owner', deviceSessionId,
    refreshLookups, refreshShop, signOut,
  }), [session, profile, shop, lookups, loading, deviceSessionId, refreshLookups, refreshShop, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
