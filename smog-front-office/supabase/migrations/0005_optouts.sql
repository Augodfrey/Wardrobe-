-- SMS opt-outs are recorded per phone number (E.164) so they apply to every
-- customer record and every future visit that uses that number.
create table public.sms_opt_outs (
  phone_e164 text primary key,
  opted_out_at timestamptz not null default now(),
  source text not null default 'sms_stop',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sms_opt_outs enable row level security;
create policy sms_opt_outs_owner on public.sms_opt_outs for select to authenticated using (public.is_owner());
create trigger sms_opt_outs_touch before update on public.sms_opt_outs
  for each row execute function public.touch_updated_at();

-- Count clicks atomically from the redirect function
create or replace function public.record_review_click(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  update public.review_requests r set click_count = click_count + 1, clicked_at = coalesce(clicked_at, now())
    where short_code = p_code and status = 'sent'
    returning (select google_review_url from public.shops s where s.id = r.shop_id) into v_url;
  return v_url;
end $$;
revoke all on function public.record_review_click(text) from public, anon, authenticated;

-- Atomically claim due review requests (at-most-once delivery even with overlapping runs)
create or replace function public.claim_due_reviews(p_limit int) returns setof public.review_requests
language sql security definer set search_path = public as $$
  update public.review_requests set status = 'sent', sent_at = now()
  where id in (select id from public.review_requests
               where status = 'pending' and scheduled_for <= now()
               order by scheduled_for limit p_limit for update skip locked)
  returning *
$$;
revoke all on function public.claim_due_reviews(int) from public, anon, authenticated;

-- Schedule the dispatcher every 5 minutes (requires pg_cron + pg_net, both
-- available on Supabase). Replace the URL and secret, then run manually:
--
-- select cron.schedule('review-dispatch', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT.supabase.co/functions/v1/review-dispatch',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
--     body := '{}'::jsonb);
-- $$);
