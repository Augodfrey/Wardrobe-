import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, errMsg } from '../lib/supabase';
import type { Estimate, EstimateItem } from '../lib/types';
import { lineTotal } from '../lib/totals';

export interface Viewer { key: string; name: string; device: string; since: string }

const SAVE_DELAY = 400;

/**
 * Live, multi-device editing of one estimate.
 *  - Local edits are applied instantly and saved field-by-field after a short pause.
 *  - Changes from other devices arrive over Supabase Realtime and are merged in,
 *    except for fields this device is still saving (local intent wins until saved).
 *  - Presence tells everyone who else has this estimate open.
 */
export function useEstimateSync(id: string | undefined, me: { name: string; device: string }) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [deleted, setDeleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Partial<Estimate>>({});
  const itemPending = useRef<Map<string, Partial<EstimateItem>>>(new Map());
  const timer = useRef<number>();
  const itemTimers = useRef<Map<string, number>>(new Map());
  const presenceKey = useRef(`${Math.random().toString(36).slice(2)}`);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: e, error: ee }, { data: it }] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).maybeSingle(),
      supabase.from('estimate_items').select('*').eq('estimate_id', id).order('line_no').order('created_at'),
    ]);
    if (ee) setError(ee.message);
    if (!e) { setDeleted(true); return; }
    setEst({ ...(e as Estimate), ...pending.current });
    setItems((it ?? []) as EstimateItem[]);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Realtime: row changes + presence
  useEffect(() => {
    if (!id) return;
    const ch: RealtimeChannel = supabase.channel(`estimate:${id}`, { config: { presence: { key: presenceKey.current } } });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'estimates', filter: `id=eq.${id}` }, (p) => {
      if (p.eventType === 'DELETE') { setDeleted(true); return; }
      const incoming = p.new as Estimate;
      setEst((cur) => {
        const merged = { ...(cur ?? incoming), ...incoming } as Estimate;
        for (const k of Object.keys(pending.current) as (keyof Estimate)[]) (merged as unknown as Record<string, unknown>)[k] = pending.current[k];
        return merged;
      });
    });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'estimate_items', filter: `estimate_id=eq.${id}` }, (p) => {
      if (p.eventType === 'DELETE') {
        const old = p.old as EstimateItem;
        setItems((cur) => cur.filter((i) => i.id !== old.id));
        return;
      }
      const row = p.new as EstimateItem;
      setItems((cur) => {
        const local = itemPending.current.get(row.id);
        const merged = local ? { ...row, ...local } : row;
        const exists = cur.some((i) => i.id === row.id);
        const next = exists ? cur.map((i) => (i.id === row.id ? merged : i)) : [...cur, merged];
        return next.sort((a, b) => a.line_no - b.line_no);
      });
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<Viewer>();
      setViewers(Object.entries(state).filter(([k]) => k !== presenceKey.current).map(([k, v]) => ({ ...(v[0] as Viewer), key: k })));
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({ name: me.name, device: me.device, since: new Date().toISOString() });
        load(); // catch anything that changed while connecting
      }
    });
    return () => { ch.unsubscribe(); };
  }, [id, me.name, me.device, load]);

  const flush = useCallback(async () => {
    if (!id) return;
    const patch = { ...pending.current };
    if (!Object.keys(patch).length) return;
    setSaving(true);
    const { error: err } = await supabase.from('estimates').update(patch).eq('id', id);
    setSaving(false);
    if (err) { setError(err.message); pending.current = {}; load(); return; }
    setError(null);
    // clear only the fields that weren't edited again while saving
    for (const k of Object.keys(patch) as (keyof Estimate)[]) if (pending.current[k] === patch[k]) delete pending.current[k];
  }, [id, load]);

  const setFields = useCallback((patch: Partial<Estimate>) => {
    setEst((cur) => (cur ? { ...cur, ...patch } : cur));
    Object.assign(pending.current, patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  const flushItem = useCallback(async (itemId: string) => {
    const patch = itemPending.current.get(itemId);
    if (!patch) return;
    const { error: err } = await supabase.from('estimate_items').update(patch).eq('id', itemId);
    if (err) { setError(err.message); itemPending.current.delete(itemId); load(); return; }
    if (itemPending.current.get(itemId) === patch) itemPending.current.delete(itemId);
  }, [load]);

  const updateItem = useCallback((itemId: string, patch: Partial<EstimateItem>) => {
    setItems((cur) => cur.map((i) => {
      if (i.id !== itemId) return i;
      const n = { ...i, ...patch };
      return { ...n, total_price: lineTotal(n) };
    }));
    itemPending.current.set(itemId, { ...(itemPending.current.get(itemId) ?? {}), ...patch });
    window.clearTimeout(itemTimers.current.get(itemId));
    itemTimers.current.set(itemId, window.setTimeout(() => flushItem(itemId), SAVE_DELAY));
  }, [flushItem]);

  const addItem = useCallback(async (row: Partial<EstimateItem>) => {
    if (!id) return;
    const line_no = (items.at(-1)?.line_no ?? 0) + 1;
    const { data, error: err } = await supabase.from('estimate_items').insert({ estimate_id: id, line_no, ...row }).select().single();
    if (err) { setError(err.message); return; }
    setItems((cur) => (cur.some((i) => i.id === data.id) ? cur : [...cur, data as EstimateItem]));
  }, [id, items]);

  const removeItem = useCallback(async (itemId: string) => {
    setItems((cur) => cur.filter((i) => i.id !== itemId));
    itemPending.current.delete(itemId);
    const { error: err } = await supabase.from('estimate_items').delete().eq('id', itemId);
    if (err) { setError(err.message); load(); }
  }, [load]);

  /** Wait for all queued saves (call before Issue, Print, Hand to Customer). */
  const saveNow = useCallback(async () => {
    window.clearTimeout(timer.current);
    await flush();
    await Promise.all([...itemPending.current.keys()].map((k) => { window.clearTimeout(itemTimers.current.get(k)); return flushItem(k); }));
  }, [flush, flushItem]);

  return { est, items, viewers, deleted, saving, error, setError, setFields, updateItem, addItem, removeItem, saveNow, reload: load,
    hasPending: () => Object.keys(pending.current).length > 0 || itemPending.current.size > 0 };
}

export async function createEstimate(defaultPriceListId: string | null, defaults: { product_id: string; product_code: string;
  product_type: string; description: string; unit_cost: number; unit_price: number; taxable: boolean }[]) {
  const { data, error } = await supabase.from('estimates').insert({ price_list_id: defaultPriceListId }).select().single();
  if (error) throw new Error(errMsg(error));
  if (defaults.length) {
    const { error: e2 } = await supabase.from('estimate_items').insert(defaults.map((d, i) => ({ ...d, estimate_id: data.id, line_no: i + 1, quantity: 1 })));
    if (e2) throw new Error(e2.message);
  }
  return data as Estimate;
}
