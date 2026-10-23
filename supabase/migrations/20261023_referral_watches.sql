-- GhostFlix "Promote GhostFlix": a referred visitor who actually starts watching counts as one "Watching" for the
-- promoter (no account needed). Once per device ever (device_id), and at most once per visitor IP per code per day.
-- Writes only from the server (service role); promoters can read their own rows (RLS). Safe to re-run.

create table if not exists public.ghostflix_ref_watches (
  id           bigserial   primary key,
  code         text        not null references public.ghostflix_ref_codes(code) on delete cascade on update cascade,
  device_id    text        not null unique check (device_id ~ '^[A-Za-z0-9_-]{16,64}$'), -- random id kept on the device
  visitor_hash text        not null,          -- salted hash of IP + code, never the raw IP
  day          date        not null default (now() at time zone 'utc')::date,
  created_at   timestamptz not null default now(),
  unique (code, visitor_hash, day)
);
create index if not exists ghostflix_ref_watches_code on public.ghostflix_ref_watches (code);

alter table public.ghostflix_ref_watches enable row level security;
drop policy if exists ghostflix_ref_watches_own on public.ghostflix_ref_watches;
create policy ghostflix_ref_watches_own on public.ghostflix_ref_watches for select to authenticated
  using (exists (select 1 from public.ghostflix_ref_codes c where c.code = ghostflix_ref_watches.code and c.user_id = auth.uid()));
revoke all on public.ghostflix_ref_watches from anon, authenticated;
grant select on public.ghostflix_ref_watches to authenticated;
revoke all on sequence public.ghostflix_ref_watches_id_seq from anon, authenticated;

-- Stats view: same columns as before plus "watching" (appended, so create or replace works).
create or replace view public.ghostflix_ref_stats with (security_invoker = true) as
  select c.user_id, c.code, c.display_name, c.discord_id, c.discord_username, c.created_at,
         (select count(*) from public.ghostflix_ref_clicks k where k.code = c.code)::int as clicks,
         (select count(*) from public.ghostflix_ref_signups s where s.referrer_id = c.user_id)::int as signups,
         (select max(s.created_at) from public.ghostflix_ref_signups s where s.referrer_id = c.user_id) as last_signup,
         (select count(*) from public.ghostflix_ref_watches w where w.code = c.code)::int as watching
  from public.ghostflix_ref_codes c;
revoke all on public.ghostflix_ref_stats from anon, authenticated;
grant select on public.ghostflix_ref_stats to service_role;
