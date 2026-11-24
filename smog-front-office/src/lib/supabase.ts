import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = !!url && !!anon;
export const supabase = createClient(url || 'http://localhost:54321', anon || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
export const functionsUrl = `${url ?? ''}/functions/v1`;

/** Call an Edge Function as the signed-in user. */
export async function callFunction<T = unknown>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as T;
}

/** Call a public Edge Function (customer pages, no login). */
export async function callPublic<T = unknown>(name: string, init: { method?: string; query?: Record<string, string>; body?: unknown }) {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : '';
  const r = await fetch(`${functionsUrl}/${name}${qs}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', apikey: anon ?? '' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j as T };
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}
