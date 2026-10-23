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

-- ===== Stage E/F + moderator panel (migration: ghostflix_stage_e_f_community_mod, applied 2026-10-23) =====
-- GhostFlix Stages E/F: community (public profiles, friends, chat, activity), inbox (requests, bug reports, chat reports,
-- moderator flags & suggestions), roles (moderators), bans, moderator activity log. Additive only; RLS on everything.
-- Default: no policies (server-only via the service key). Moderators get narrow RLS policies so the /api/mod routes,
-- which call PostgREST with the moderator's own JWT, are limited by the database itself.

create table if not exists public.ghostflix_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('moderator')),
  granted_at timestamptz not null default now(),
  granted_by text not null default ''
);
create table if not exists public.ghostflix_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null default '',
  banned_at timestamptz not null default now(),
  banned_by text not null default ''
);
create table if not exists public.ghostflix_social (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  friend_code text unique check (friend_code ~ '^[a-z0-9]{8}$'),
  friends_on boolean not null default false,
  share_watching boolean not null default false,
  watching jsonb,
  watching_at timestamptz,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ghostflix_public_profiles (
  slug text primary key check (slug ~ '^[a-z0-9]{10}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null,
  enabled boolean not null default false,
  name text not null default '',
  color text not null default '#5fe3ff',
  avatar text,
  bio text not null default '' check (char_length(bio) <= 300),
  genres int[] not null default '{}',
  lists jsonb not null default '[]'::jsonb,
  show_history boolean not null default false,
  history jsonb not null default '[]'::jsonb,
  badges jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, profile_id)
);
create table if not exists public.ghostflix_friends (
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists ghostflix_friends_b on public.ghostflix_friends (b);
create table if not exists public.ghostflix_chat (
  id bigint generated always as identity primary key,
  room text not null check (room ~ '^(movie|tv):[0-9]{1,10}(:[0-9]{1,3}:[0-9]{1,4})?$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  body text not null check (char_length(body) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ghostflix_chat_room on public.ghostflix_chat (room, created_at desc);
create table if not exists public.ghostflix_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id text not null default 'main',
  day date not null,
  minutes int not null default 0 check (minutes between 0 and 1440),
  plays int not null default 0,
  genres jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, day)
);
create table if not exists public.ghostflix_inbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('request','bug','chat','flag_title','flag_kids','flag_user','flag_chat','flag_comment','announce')),
  status text not null default 'open' check (status in ('open','in_progress','done','wontfix')),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 2000),
  data jsonb not null default '{}'::jsonb,
  screenshot text check (screenshot is null or char_length(screenshot) <= 900000),
  user_id uuid,
  visitor text,
  by_mod uuid,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ghostflix_inbox_kind on public.ghostflix_inbox (kind, status, created_at desc);
create table if not exists public.ghostflix_mod_log (
  id bigint generated always as identity primary key,
  mod_id uuid not null,
  mod_name text not null default '',
  action text not null,
  target text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.ghostflix_source_reports add column if not exists status text not null default 'open';
alter table public.ghostflix_source_reports add column if not exists notes jsonb not null default '[]'::jsonb;
alter table public.ghostflix_source_reports add column if not exists updated_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ghostflix_source_reports_status_check') then
    alter table public.ghostflix_source_reports add constraint ghostflix_source_reports_status_check check (status in ('open','in_progress','done','wontfix'));
  end if;
end $$;

-- helpers (security definer so policies can use them without exposing the role/ban/friend tables)
create or replace function public.ghostflix_is_banned(uid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.ghostflix_bans where user_id = uid) $$;
create or replace function public.ghostflix_is_mod(uid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.ghostflix_roles r where r.user_id = uid and r.role = 'moderator') and not public.ghostflix_is_banned(uid) $$;
create or replace function public.ghostflix_are_friends(x uuid, y uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.ghostflix_friends f where f.status = 'accepted' and f.a = least(x, y) and f.b = greatest(x, y)) $$;
revoke all on function public.ghostflix_is_banned(uuid), public.ghostflix_is_mod(uuid), public.ghostflix_are_friends(uuid, uuid) from public, anon;
grant execute on function public.ghostflix_is_banned(uuid), public.ghostflix_is_mod(uuid), public.ghostflix_are_friends(uuid, uuid) to authenticated, service_role;

-- RLS on, no default access
do $$ declare t text; begin
  foreach t in array array['ghostflix_roles','ghostflix_bans','ghostflix_social','ghostflix_public_profiles','ghostflix_friends','ghostflix_chat','ghostflix_activity','ghostflix_inbox','ghostflix_mod_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- roles: a signed-in user can see their own role row (to show the Moderator menu link)
grant select on public.ghostflix_roles to authenticated;
drop policy if exists ghostflix_roles_own on public.ghostflix_roles;
create policy ghostflix_roles_own on public.ghostflix_roles for select to authenticated using (user_id = auth.uid());

-- chat: Realtime subscribers only receive their own messages and messages from accepted friends; never hidden ones.
grant select on public.ghostflix_chat to authenticated;
drop policy if exists ghostflix_chat_friends on public.ghostflix_chat;
create policy ghostflix_chat_friends on public.ghostflix_chat for select to authenticated
  using (not hidden and not public.ghostflix_is_banned(auth.uid()) and (user_id = auth.uid() or public.ghostflix_are_friends(auth.uid(), user_id)));

-- activity (streaks/achievements): own rows only
grant select, insert, update on public.ghostflix_activity to authenticated;
drop policy if exists ghostflix_activity_own on public.ghostflix_activity;
create policy ghostflix_activity_own on public.ghostflix_activity for all to authenticated
  using (user_id = auth.uid() and not public.ghostflix_is_banned(auth.uid())) with check (user_id = auth.uid() and not public.ghostflix_is_banned(auth.uid()));

-- moderators: inbox (read all; update status/notes only; insert flags & suggestions as themselves)
grant select on public.ghostflix_inbox to authenticated;
grant update (status, notes, updated_at) on public.ghostflix_inbox to authenticated;
grant insert (kind, title, body, data, by_mod) on public.ghostflix_inbox to authenticated;
grant usage on sequence public.ghostflix_inbox_id_seq to authenticated;
drop policy if exists ghostflix_inbox_mod_read on public.ghostflix_inbox;
drop policy if exists ghostflix_inbox_mod_update on public.ghostflix_inbox;
drop policy if exists ghostflix_inbox_mod_insert on public.ghostflix_inbox;
create policy ghostflix_inbox_mod_read on public.ghostflix_inbox for select to authenticated using (public.ghostflix_is_mod(auth.uid()));
create policy ghostflix_inbox_mod_update on public.ghostflix_inbox for update to authenticated using (public.ghostflix_is_mod(auth.uid())) with check (public.ghostflix_is_mod(auth.uid()));
create policy ghostflix_inbox_mod_insert on public.ghostflix_inbox for insert to authenticated
  with check (public.ghostflix_is_mod(auth.uid()) and by_mod = auth.uid() and kind in ('flag_title','flag_kids','flag_user','flag_chat','flag_comment','announce'));

-- moderators: broken-source reports (read; update status/notes only — "tested, works now")
grant select on public.ghostflix_source_reports to authenticated;
grant update (status, notes, updated_at) on public.ghostflix_source_reports to authenticated;
drop policy if exists ghostflix_reports_mod_read on public.ghostflix_source_reports;
drop policy if exists ghostflix_reports_mod_update on public.ghostflix_source_reports;
create policy ghostflix_reports_mod_read on public.ghostflix_source_reports for select to authenticated using (public.ghostflix_is_mod(auth.uid()));
create policy ghostflix_reports_mod_update on public.ghostflix_source_reports for update to authenticated using (public.ghostflix_is_mod(auth.uid())) with check (public.ghostflix_is_mod(auth.uid()));

-- moderators: users = display name + last seen only (column grant; no emails live in this table)
grant select (user_id, display_name, last_seen) on public.ghostflix_social to authenticated;
drop policy if exists ghostflix_social_mod_read on public.ghostflix_social;
create policy ghostflix_social_mod_read on public.ghostflix_social for select to authenticated using (public.ghostflix_is_mod(auth.uid()));

-- moderators: activity log (insert as themselves, read their own; the admin reads all via the server)
grant select, insert (mod_id, mod_name, action, target, detail) on public.ghostflix_mod_log to authenticated;
grant usage on sequence public.ghostflix_mod_log_id_seq to authenticated;
drop policy if exists ghostflix_modlog_insert on public.ghostflix_mod_log;
drop policy if exists ghostflix_modlog_read on public.ghostflix_mod_log;
create policy ghostflix_modlog_insert on public.ghostflix_mod_log for insert to authenticated with check (public.ghostflix_is_mod(auth.uid()) and mod_id = auth.uid());
create policy ghostflix_modlog_read on public.ghostflix_mod_log for select to authenticated using (public.ghostflix_is_mod(auth.uid()) and mod_id = auth.uid());

-- bans: banned users lose account features immediately (restrictive policies on the existing per-user tables; additive)
do $$ declare t text; begin
  foreach t in array array['ghostflix_watchlist','ghostflix_history','ghostflix_profiles','ghostflix_profile_data'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists ghostflix_not_banned on public.%I', t);
      execute format('create policy ghostflix_not_banned on public.%I as restrictive for all to authenticated using (not public.ghostflix_is_banned(auth.uid())) with check (not public.ghostflix_is_banned(auth.uid()))', t);
    end if;
  end loop;
end $$;

-- Realtime for the watch-together chat
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ghostflix_chat') then
    alter publication supabase_realtime add table public.ghostflix_chat;
  end if;
end $$;

-- Top 10 this week (anonymous plays; distinct visitors per title). Service only.
create or replace function public.ghostflix_top10(days int default 7) returns table (title_key text, title text, viewers bigint, plays bigint)
language sql stable security definer set search_path = public as $$
  select title_key, (array_agg(title order by at desc) filter (where title is not null and title <> ''))[1], count(distinct visitor), count(*)
  from public.ghostflix_events where kind = 'play' and title_key is not null and at > now() - make_interval(days => greatest(1, least(days, 31)))
  group by title_key order by 3 desc, 4 desc limit 30 $$;
-- Visitor charts: page views by hour of day (UK time) for the peak-hours chart. Service only.
create or replace function public.ghostflix_hours(days int default 30) returns table (hour int, views bigint, visitors bigint)
language sql stable security definer set search_path = public as $$
  select extract(hour from at at time zone 'Europe/London')::int, count(*), count(distinct visitor)
  from public.ghostflix_events where kind = 'pv' and at > now() - make_interval(days => greatest(1, least(days, 90))) group by 1 order by 1 $$;
-- Site health: GhostFlix pg_cron jobs' last runs + keep-alive uptime (last 6 h of net responses from /healthz). Service only.
create or replace function public.ghostflix_health() returns jsonb language plpgsql stable security definer set search_path = public, cron, net as $$
declare jobs jsonb; ka jsonb;
begin
  select coalesce(jsonb_agg(x order by x->>'job'), '[]'::jsonb) into jobs from (
    select jsonb_build_object('job', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last', (select jsonb_build_object('status', d.status, 'start', d.start_time, 'end', d.end_time) from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      'runs24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours'),
      'failed24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours' and d.status <> 'succeeded')) x
    from cron.job j where j.jobname like 'ghostflix%') s;
  select jsonb_build_object(
    'pings', (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'ghostflix-keepalive' and d.start_time > now() - interval '6 hours'),
    'ok', (select count(*) from net._http_response r where r.created > now() - interval '6 hours' and r.status_code = 200 and r.content like '%"mode":"tmdb"%'),
    'window_hours', 6) into ka;
  return jsonb_build_object('cron', jobs, 'keepalive', ka);
end $$;
revoke all on function public.ghostflix_top10(int), public.ghostflix_hours(int), public.ghostflix_health() from public, anon, authenticated;
grant execute on function public.ghostflix_top10(int), public.ghostflix_hours(int), public.ghostflix_health() to service_role;
