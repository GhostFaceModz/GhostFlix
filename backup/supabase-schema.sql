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
