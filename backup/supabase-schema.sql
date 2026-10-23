-- GhostFlix Supabase schema — exported from the LIVE project rswtambjckwmlagydsvf on 2026-10-23
-- via the Supabase Management API (/v1/projects/{ref}/database/query). Safe to re-run.
-- The project is shared with GhostGames; only GhostFlix objects (ghostflix_* tables + keep-alive cron) are here.
-- Required extensions (enabled by default on Supabase, or via Dashboard > Database > Extensions):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===== public.ghostflix_history =====
create table if not exists public.ghostflix_history (
  user_id uuid not null,
  media_type text not null,
  tmdb_id bigint not null,
  season integer,
  episode integer,
  progress real,
  time real,
  data jsonb not null default '{}'::jsonb,
  watched_at timestamp with time zone not null default now(),
  constraint ghostflix_history_pkey PRIMARY KEY (user_id, media_type, tmdb_id),
  constraint ghostflix_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint ghostflix_history_media_type_check CHECK ((media_type = ANY (ARRAY['movie'::text, 'tv'::text])))
);
alter table public.ghostflix_history enable row level security;
drop policy if exists "ghostflix history: own rows" on public.ghostflix_history;
create policy "ghostflix history: own rows" on public.ghostflix_history as permissive for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
revoke all on public.ghostflix_history from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.ghostflix_history to authenticated;

-- ===== public.ghostflix_store =====
create table if not exists public.ghostflix_store (
  id text not null,
  data jsonb not null,
  constraint ghostflix_store_pkey PRIMARY KEY (id)
);
alter table public.ghostflix_store enable row level security;
revoke all on public.ghostflix_store from anon, authenticated;

-- ===== public.ghostflix_watchlist =====
create table if not exists public.ghostflix_watchlist (
  user_id uuid not null,
  media_type text not null,
  tmdb_id bigint not null,
  data jsonb not null default '{}'::jsonb,
  added_at timestamp with time zone not null default now(),
  constraint ghostflix_watchlist_pkey PRIMARY KEY (user_id, media_type, tmdb_id),
  constraint ghostflix_watchlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint ghostflix_watchlist_media_type_check CHECK ((media_type = ANY (ARRAY['movie'::text, 'tv'::text])))
);
alter table public.ghostflix_watchlist enable row level security;
CREATE INDEX IF NOT EXISTS ghostflix_watchlist_user_added ON public.ghostflix_watchlist USING btree (user_id, added_at DESC);
drop policy if exists "ghostflix watchlist: own rows" on public.ghostflix_watchlist;
create policy "ghostflix watchlist: own rows" on public.ghostflix_watchlist as permissive for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
revoke all on public.ghostflix_watchlist from anon, authenticated;
grant delete, insert, references, select, trigger, truncate, update on public.ghostflix_watchlist to authenticated;

-- ===== public.ghostflix_source_reports (player "Report broken"; written/read only by the server via the service key) =====
create table if not exists public.ghostflix_source_reports (
  id bigserial primary key,
  created_at timestamp with time zone not null default now(),
  media_type text not null check (media_type in ('movie','tv')),
  tmdb_id bigint not null,
  season integer,
  episode integer,
  source text not null,
  reason text,
  device text,
  visitor text  -- anonymous daily hash, not an IP
);
create index if not exists ghostflix_source_reports_created on public.ghostflix_source_reports (created_at desc);
alter table public.ghostflix_source_reports enable row level security;  -- no policies: anon/authenticated can't touch it
revoke all on public.ghostflix_source_reports from anon, authenticated;
revoke all on sequence public.ghostflix_source_reports_id_seq from anon, authenticated;

-- ===== public.ghostflix_profiles (Who's watching? — up to 5 per account; kids flag + age limit + PIN hash) =====
create table if not exists public.ghostflix_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-z0-9]{1,16}$'),
  name text not null check (char_length(name) between 1 and 24),
  color text not null default '#5fe3ff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  kids boolean not null default false,
  max_age integer check (max_age in (0, 8, 14, 15)),
  pin_hash text check (pin_hash is null or char_length(pin_hash) = 64),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.ghostflix_profiles enable row level security;
create or replace function public.ghostflix_profiles_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.ghostflix_profiles where user_id = new.user_id) >= 5 then
    raise exception 'GhostFlix allows up to 5 profiles per account' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.ghostflix_profiles_limit() from public, anon, authenticated;
drop trigger if exists ghostflix_profiles_limit on public.ghostflix_profiles;
create trigger ghostflix_profiles_limit before insert on public.ghostflix_profiles for each row execute function public.ghostflix_profiles_limit();
drop policy if exists "ghostflix profiles: own rows" on public.ghostflix_profiles;
create policy "ghostflix profiles: own rows" on public.ghostflix_profiles as permissive for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.ghostflix_profiles from anon, authenticated;
grant select, insert, update, delete on public.ghostflix_profiles to authenticated;

-- ===== public.ghostflix_profile_data (per-profile list / continue / ratings / episode log / reminders, one JSON blob per kind;
-- the 'main' profile keeps list + history in ghostflix_watchlist / ghostflix_history) =====
create table if not exists public.ghostflix_profile_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  kind text not null check (kind in ('list','continue','ratings','eps','remind')),
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, kind)
);
alter table public.ghostflix_profile_data enable row level security;
drop policy if exists "ghostflix profile data: own rows" on public.ghostflix_profile_data;
create policy "ghostflix profile data: own rows" on public.ghostflix_profile_data as permissive for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.ghostflix_profile_data from anon, authenticated;
grant select, insert, update, delete on public.ghostflix_profile_data to authenticated;

-- ===== GhostFlix-related functions / triggers =====
-- ghostflix_profiles_limit() + trigger: defined with ghostflix_profiles above.

-- ===== pg_cron keep-alive (stops the Render free instance from sleeping) =====
select cron.unschedule('ghostflix-keepalive') where exists (select 1 from cron.job where jobname = 'ghostflix-keepalive');
select cron.schedule('ghostflix-keepalive', '*/5 * * * *', $cron$select net.http_get(url := 'https://ghostflix.onrender.com/healthz', headers := '{"User-Agent": "gg-keepalive"}'::jsonb, timeout_milliseconds := 30000)$cron$);  -- active=True

-- ===== Stage D: first-party stats + web push (RLS on, no policies: only the service role / server can read or write) =====
-- GhostFlix Stage D: first-party visitor stats + web push.
create table if not exists public.ghostflix_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  day date not null default ((now() at time zone 'utc')::date),
  kind text not null check (kind in ('pv','play')),
  visitor text not null check (char_length(visitor) between 8 and 64),
  path text check (char_length(path) <= 200),
  title_key text check (title_key ~ '^(movie|tv):[0-9]{1,10}$'),
  title text check (char_length(title) <= 200),
  device text check (device in ('mobile','tablet','desktop','tv','other')),
  standalone boolean not null default false,
  signed_in boolean not null default false,
  ref text check (char_length(ref) <= 120),
  country text check (char_length(country) <= 2),
  source text check (char_length(source) <= 80)
);
create index if not exists ghostflix_events_day_idx on public.ghostflix_events (day, kind);
create index if not exists ghostflix_events_at_idx on public.ghostflix_events (at);
alter table public.ghostflix_events enable row level security;
-- No policies: only the server (service role) can read or write; admins read aggregates through the server.
revoke all on public.ghostflix_events from anon, authenticated;

create table if not exists public.ghostflix_push_subs (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  user_id uuid references auth.users(id) on delete cascade,
  ua text check (char_length(ua) <= 60),
  shows jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  sent jsonb not null default '{}'::jsonb,
  fails int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz
);
alter table public.ghostflix_push_subs enable row level security;
revoke all on public.ghostflix_push_subs from anon, authenticated;

-- Cron secret lives only in Vault; the server checks the header through this function (service role only).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'ghostflix_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ghostflix_cron_secret', 'GhostFlix push sender cron key');
  end if;
end $$;
create or replace function public.ghostflix_cron_ok(k text) returns boolean
language sql security definer set search_path = '' stable as $$
  select coalesce(k = (select decrypted_secret from vault.decrypted_secrets where name = 'ghostflix_cron_secret' limit 1), false);
$$;
revoke all on function public.ghostflix_cron_ok(text) from public, anon, authenticated;
grant execute on function public.ghostflix_cron_ok(text) to service_role;

-- Aggregated stats for the admin panel (service role only).
create or replace function public.ghostflix_stats(days int default 30) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare
  t date := (now() at time zone 'utc')::date;
  since date := t - (greatest(1, least(days, 90)) - 1);
  r jsonb;
begin
  with e as (select * from public.ghostflix_events where day >= since),
  dv as (select day, visitor, bool_or(standalone) sa, bool_or(signed_in) si, max(device) dev, max(country) cc from e group by day, visitor)
  select jsonb_build_object(
    'today', jsonb_build_object(
      'visitors', (select count(*) from dv where day = t),
      'pageviews', (select count(*) from e where day = t and kind = 'pv'),
      'plays', (select count(*) from e where day = t and kind = 'play'),
      'installed', (select count(*) from dv where day = t and sa),
      'signed_in', (select count(*) from dv where day = t and si)),
    'visitors_7d', (select count(*) from dv where day > t - 7),
    'visitors_30d', (select count(*) from dv where day > t - 30),
    'pageviews_7d', (select count(*) from e where day > t - 7 and kind = 'pv'),
    'plays_7d', (select count(*) from e where day > t - 7 and kind = 'play'),
    'chart', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'pv', (select count(*) from e where e.day = d::date and kind = 'pv'), 'visitors', (select count(*) from dv where dv.day = d::date), 'plays', (select count(*) from e where e.day = d::date and kind = 'play')) order by d), '[]') from generate_series(since, t, interval '1 day') d),
    'pages', (select coalesce(jsonb_agg(x), '[]') from (select path, count(*) n from e where kind = 'pv' and path is not null group by path order by n desc limit 12) x),
    'titles', (select coalesce(jsonb_agg(x), '[]') from (select title_key, max(title) title, count(*) filter (where kind = 'play') plays, count(*) filter (where kind = 'pv') views from e where title_key is not null group by title_key order by count(*) filter (where kind = 'play') desc, count(*) desc limit 12) x),
    'devices', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(dev, 'other') device, count(*) n from dv group by 1 order by n desc) x),
    'app', jsonb_build_object('installed', (select count(*) from dv where sa), 'browser', (select count(*) from dv where not sa)),
    'signed', jsonb_build_object('yes', (select count(*) from dv where si), 'no', (select count(*) from dv where not si)),
    'referrers', (select coalesce(jsonb_agg(x), '[]') from (select ref, count(*) n from e where kind = 'pv' and ref is not null group by ref order by n desc limit 10) x),
    'countries', (select coalesce(jsonb_agg(x), '[]') from (select coalesce(cc, '??') country, count(*) n from dv group by 1 order by n desc limit 12) x),
    'sources', (select coalesce(jsonb_agg(x), '[]') from (select source, count(*) n from e where kind = 'play' and source is not null group by source order by n desc limit 10) x),
    'reports', (select coalesce(jsonb_agg(x), '[]') from (select media_type, tmdb_id, season, episode, source, count(*) n, max(created_at) last, string_agg(distinct reason, ', ') reasons from public.ghostflix_source_reports where created_at >= since group by 1,2,3,4,5 order by n desc, last desc limit 25) x),
    'reports_by_source', (select coalesce(jsonb_agg(x), '[]') from (select source, count(*) n from public.ghostflix_source_reports where created_at >= since group by source order by n desc limit 10) x),
    'days', greatest(1, least(days, 90)), 'since', since
  ) into r;
  return r;
end $$;
revoke all on function public.ghostflix_stats(int) from public, anon, authenticated;
grant execute on function public.ghostflix_stats(int) to service_role;

-- ===== pg_cron: hourly web-push sender (secret is read from Vault inside the job, never stored in plain text) =====
select cron.unschedule('ghostflix-push') where exists (select 1 from cron.job where jobname = 'ghostflix-push');
select cron.schedule('ghostflix-push', '17 * * * *', $cron$select net.http_post(url := 'https://ghostflix.uk/api/cron/push', body := '{}'::jsonb, headers := jsonb_build_object('Content-Type', 'application/json', 'User-Agent', 'gg-cron', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ghostflix_cron_secret' limit 1)), timeout_milliseconds := 60000)$cron$);
