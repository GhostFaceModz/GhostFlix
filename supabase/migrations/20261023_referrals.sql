-- GhostFlix "Promote GhostFlix": per-user referral codes, link clicks and attributed sign-ups.
-- Writes only happen from the server (service role). Signed-in users can read their own rows (RLS); anon gets nothing.
-- Safe to re-run.

create table if not exists public.ghostflix_ref_codes (
  user_id          uuid        primary key references auth.users(id) on delete cascade,
  code             text        not null unique check (code ~ '^[A-Za-z0-9]{4,16}$'),
  display_name     text        not null default '',
  discord_id       text,
  discord_username text,
  created_at       timestamptz not null default now()
);

create table if not exists public.ghostflix_ref_clicks (
  id           bigserial   primary key,
  code         text        not null references public.ghostflix_ref_codes(code) on delete cascade on update cascade,
  visitor_hash text        not null,          -- salted hash of IP + code, never the raw IP
  day          date        not null default (now() at time zone 'utc')::date,
  created_at   timestamptz not null default now(),
  unique (code, visitor_hash, day)
);
create index if not exists ghostflix_ref_clicks_code on public.ghostflix_ref_clicks (code);

create table if not exists public.ghostflix_ref_signups (
  referred_user_id uuid        primary key references auth.users(id) on delete cascade, -- an account is attributed at most once
  referrer_id      uuid        not null references auth.users(id) on delete cascade,
  code             text        not null references public.ghostflix_ref_codes(code) on delete cascade on update cascade,
  created_at       timestamptz not null default now(),
  check (referrer_id <> referred_user_id)
);
create index if not exists ghostflix_ref_signups_referrer on public.ghostflix_ref_signups (referrer_id);

alter table public.ghostflix_ref_codes   enable row level security;
alter table public.ghostflix_ref_clicks  enable row level security;
alter table public.ghostflix_ref_signups enable row level security;

drop policy if exists ghostflix_ref_codes_own on public.ghostflix_ref_codes;
create policy ghostflix_ref_codes_own on public.ghostflix_ref_codes for select to authenticated using (auth.uid() = user_id);
drop policy if exists ghostflix_ref_clicks_own on public.ghostflix_ref_clicks;
create policy ghostflix_ref_clicks_own on public.ghostflix_ref_clicks for select to authenticated
  using (exists (select 1 from public.ghostflix_ref_codes c where c.code = ghostflix_ref_clicks.code and c.user_id = auth.uid()));
drop policy if exists ghostflix_ref_signups_own on public.ghostflix_ref_signups;
create policy ghostflix_ref_signups_own on public.ghostflix_ref_signups for select to authenticated
  using (auth.uid() = referrer_id or auth.uid() = referred_user_id);

revoke all on public.ghostflix_ref_codes, public.ghostflix_ref_clicks, public.ghostflix_ref_signups from anon, authenticated;
grant select on public.ghostflix_ref_codes, public.ghostflix_ref_clicks, public.ghostflix_ref_signups to authenticated;
revoke all on sequence public.ghostflix_ref_clicks_id_seq from anon, authenticated;

-- Per-promoter totals for the leaderboard and the admin view (server only).
create or replace view public.ghostflix_ref_stats with (security_invoker = true) as
  select c.user_id, c.code, c.display_name, c.discord_id, c.discord_username, c.created_at,
         (select count(*) from public.ghostflix_ref_clicks k where k.code = c.code)::int as clicks,
         (select count(*) from public.ghostflix_ref_signups s where s.referrer_id = c.user_id)::int as signups,
         (select max(s.created_at) from public.ghostflix_ref_signups s where s.referrer_id = c.user_id) as last_signup
  from public.ghostflix_ref_codes c;
revoke all on public.ghostflix_ref_stats from anon, authenticated;
grant select on public.ghostflix_ref_stats to service_role;
