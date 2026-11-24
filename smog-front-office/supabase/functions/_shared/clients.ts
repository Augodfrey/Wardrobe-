import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './http.ts';

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

/** Client acting as the calling staff member (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

/** Returns the caller's profile or null. */
export async function requireStaff(req: Request) {
  const sb = userClient(req);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from('profiles').select('id, shop_id, role, full_name, active').eq('id', user.id).single();
  if (!profile?.active) return null;
  // current_shop_id() is null when this device's session was revoked
  const { data: shopId } = await sb.rpc('current_shop_id');
  if (!shopId) return null;
  return { sb, user, profile: profile as { id: string; shop_id: string; role: 'owner' | 'staff'; full_name: string } };
}
