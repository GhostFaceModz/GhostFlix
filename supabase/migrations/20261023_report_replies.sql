-- Replies to bug reports / title requests (owner + moderators -> the reporter).
-- Reporters read only replies on their OWN reports; only moderators (as themselves) or the server (service role,
-- used by the owner's admin panel) can write. The internal `notes` on ghostflix_inbox stay staff-only.
create table if not exists public.ghostflix_inbox_replies (
  id bigint generated always as identity primary key,
  inbox_id bigint not null references public.ghostflix_inbox(id) on delete cascade,
  by_user uuid,                       -- moderator's user id (null = owner via the admin panel)
  by_name text not null default 'GhostFlix',
  by_role text not null default 'owner' check (by_role in ('owner', 'mod')),
  body text not null check (char_length(body) between 1 and 1000),
  status text check (status in ('open', 'in_progress', 'done', 'wontfix')),
  delivered text,                     -- 'bell', 'bell+push', 'notifications off', 'daily cap', 'not signed in'
  created_at timestamptz not null default now()
);
create index if not exists ghostflix_inbox_replies_inbox on public.ghostflix_inbox_replies (inbox_id, created_at);
alter table public.ghostflix_inbox_replies enable row level security;

-- ghostflix_inbox itself is mod-only under RLS, so the ownership check runs as a tiny SECURITY DEFINER helper.
create or replace function public.ghostflix_owns_report(rid bigint) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.ghostflix_inbox i where i.id = rid and i.user_id = auth.uid()) $$;
revoke all on function public.ghostflix_owns_report(bigint) from public, anon;
grant execute on function public.ghostflix_owns_report(bigint) to authenticated;

drop policy if exists ghostflix_inbox_replies_own_read on public.ghostflix_inbox_replies;
create policy ghostflix_inbox_replies_own_read on public.ghostflix_inbox_replies for select to authenticated
  using (public.ghostflix_owns_report(inbox_id));
drop policy if exists ghostflix_inbox_replies_mod_read on public.ghostflix_inbox_replies;
create policy ghostflix_inbox_replies_mod_read on public.ghostflix_inbox_replies for select to authenticated
  using (public.ghostflix_is_mod(auth.uid()));
drop policy if exists ghostflix_inbox_replies_mod_insert on public.ghostflix_inbox_replies;
create policy ghostflix_inbox_replies_mod_insert on public.ghostflix_inbox_replies for insert to authenticated
  with check (public.ghostflix_is_mod(auth.uid()) and by_user = auth.uid() and by_role = 'mod');

revoke all on public.ghostflix_inbox_replies from anon, authenticated;
grant select on public.ghostflix_inbox_replies to authenticated;
grant insert (inbox_id, by_user, by_name, by_role, body, status) on public.ghostflix_inbox_replies to authenticated;
revoke all on sequence public.ghostflix_inbox_replies_id_seq from anon, authenticated;

-- Reporters may read their own reports (safe columns only are returned by the API; RLS is the backstop).
-- Note: ghostflix_inbox has no own-read policy on purpose: its `notes`/`visitor` columns are staff-only, so the
-- reporter's "My reports" list is served by GET /api/me/reports, which filters by the caller's user id.
