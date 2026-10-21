-- OPTIONAL: server-side persistence for GhostFlix's admin store (sources, import jobs).
-- Only needed if you set SUPABASE_URL + SUPABASE_SERVICE_KEY on the server.
-- The service-role key bypasses RLS and must only ever live in server env vars.
create table if not exists public.ghostflix_store (
  id   text primary key,
  data jsonb not null
);
alter table public.ghostflix_store enable row level security;   -- no policies: anon/authenticated get nothing
revoke all on public.ghostflix_store from anon, authenticated;
