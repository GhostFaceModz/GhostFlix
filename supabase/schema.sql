-- GhostFlix: per-user watchlist + watch history synced from the browser (Supabase Auth + RLS).
-- Run once in Supabase Dashboard -> SQL editor (or `supabase db push`). Safe to re-run.
-- Table names are prefixed with ghostflix_ so they can live in a project shared with other apps.

create table if not exists public.ghostflix_watchlist (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  media_type text        not null check (media_type in ('movie','tv')),
  tmdb_id    bigint      not null,
  data       jsonb       not null default '{}'::jsonb,   -- title, year, poster, ... (display cache)
  added_at   timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id)
);

alter table public.ghostflix_watchlist enable row level security;

drop policy if exists "ghostflix watchlist: own rows" on public.ghostflix_watchlist;
create policy "ghostflix watchlist: own rows" on public.ghostflix_watchlist
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ghostflix_watchlist to authenticated;
revoke all on public.ghostflix_watchlist from anon;

create index if not exists ghostflix_watchlist_user_added on public.ghostflix_watchlist (user_id, added_at desc);

-- Watch history / continue watching (newest entry per title).
create table if not exists public.ghostflix_history (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  media_type text        not null check (media_type in ('movie','tv')),
  tmdb_id    bigint      not null,
  season     int,
  episode    int,
  progress   real,                                  -- percent watched (HTML5 sources only)
  time       real,                                  -- seconds into the video
  data       jsonb       not null default '{}'::jsonb,
  watched_at timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id)
);
alter table public.ghostflix_history enable row level security;
drop policy if exists "ghostflix history: own rows" on public.ghostflix_history;
create policy "ghostflix history: own rows" on public.ghostflix_history
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.ghostflix_history to authenticated;
revoke all on public.ghostflix_history from anon;
