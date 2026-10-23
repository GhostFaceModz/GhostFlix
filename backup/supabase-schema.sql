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

-- ===== GhostFlix-related functions / triggers =====
-- None found in the live project (checked public functions and triggers referencing 'ghostflix').

-- ===== pg_cron keep-alive (stops the Render free instance from sleeping) =====
select cron.unschedule('ghostflix-keepalive') where exists (select 1 from cron.job where jobname = 'ghostflix-keepalive');
select cron.schedule('ghostflix-keepalive', '*/5 * * * *', $cron$select net.http_get(url := 'https://ghostflix.onrender.com/healthz', headers := '{"User-Agent": "gg-keepalive"}'::jsonb, timeout_milliseconds := 30000)$cron$);  -- active=True
