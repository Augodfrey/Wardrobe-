-- Multi-device: any number of concurrent sessions per login. Each device
-- registers itself; the owner can sign one out remotely. Revocation deletes
-- the Supabase auth session (kills its refresh token) and makes RLS deny that
-- device's current access token immediately.

alter table public.active_sessions add column auth_session_id uuid unique;

create or replace function public.jwt_session_id() returns uuid
language sql stable as $$
  select nullif(coalesce(auth.jwt()->>'session_id', ''), '')::uuid
$$;

create or replace function public.current_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.shop_id from public.profiles p
  where p.id = auth.uid() and p.active
    and not exists (select 1 from public.active_sessions s
                    where s.auth_session_id = public.jwt_session_id() and s.revoked_at is not null)
$$;

create or replace function public.register_session(p_label text, p_user_agent text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sid uuid := public.jwt_session_id(); v_shop uuid := public.current_shop_id();
begin
  if v_shop is null then raise exception 'Not signed in'; end if;
  insert into public.active_sessions (shop_id, user_id, auth_session_id, device_label, user_agent, last_seen_at)
  values (v_shop, auth.uid(), v_sid, p_label, p_user_agent, now())
  on conflict (auth_session_id) do update
    set last_seen_at = now(), device_label = coalesce(excluded.device_label, public.active_sessions.device_label),
        user_agent = excluded.user_agent
    where public.active_sessions.revoked_at is null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_session(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_sid uuid;
begin
  update public.active_sessions set revoked_at = now(), revoked_by = auth.uid()
   where id = p_id and shop_id = public.current_shop_id()
     and (public.is_owner() or user_id = auth.uid())
  returning auth_session_id into v_sid;
  if not found then raise exception 'Session not found'; end if;
  if v_sid is not null then
    delete from auth.sessions where id = v_sid;
  end if;
end $$;
