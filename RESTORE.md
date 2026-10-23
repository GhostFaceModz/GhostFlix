# Relaunching GhostFlix from scratch

Plain step-by-step guide for bringing https://ghostflix.uk back if the site, the Render
service or the Supabase project is lost. Last checked against the live setup on 2026-10-23.

What you need:
- The code: GitHub repo `GhostFaceModz/GhostFlix`, branch `main` (backup tags: `backup-YYYY-MM-DD`).
  If GitHub itself is gone, use the offline snapshot `ghostflix-<date>.tar.gz` (contains the repo
  and a `ghostflix.bundle` git bundle: `git clone ghostflix.bundle GhostFlix`).
- The private backup folder (NOT in git): `/workspace/ghostflix-backups/` on Zane's agent box:
  - `render-env.secret` – every Render env var value (KEY=value).
  - `supabase-auth-config.secret.json` – full Supabase auth settings, including OAuth secrets.
  - `ghostflix-data-<date>.sql` / `.json` – watchlist, history and admin-store rows.
  - `ghostflix-users-<date>.json` – the user IDs/emails/providers those rows belong to.
- Access to: Render, Supabase, Fasthosts (DNS), Google Cloud Console, Discord Developer Portal.

---

## 1. Supabase (database + sign-in)

GhostFlix shares Supabase project `rswtambjckwmlagydsvf` with GhostGames. If that project still
exists, skip to step 1.3 and just check things. If it's gone, create a new free project and:

1.1 **Schema** – Dashboard > SQL editor, paste and run `backup/supabase-schema.sql`.
    It creates `ghostflix_watchlist`, `ghostflix_history`, `ghostflix_store`, their row-level
    security policies and grants, and the keep-alive cron job (enables `pg_cron` + `pg_net`).
    (`supabase/schema.sql` + `supabase/store.sql` are the original hand-written versions.)

1.2 **Data (optional)** – run `ghostflix-data-<date>.sql` from the private backup folder.
    Watchlist/history rows point at `auth.users` IDs, so they only restore cleanly in the same
    project or after users have been re-created with the same IDs. `ghostflix_store` (admin
    sources/imports) has no user link and always restores.

1.3 **Auth URL settings** – Authentication > URL Configuration. Redirect URLs must include:
    ```
    https://ghostflix.uk
    https://ghostflix.uk/**
    https://www.ghostflix.uk/**
    https://ghostflix.onrender.com
    https://ghostflix.onrender.com/**
    ```
    (Site URL is GhostGames' `https://ghostgames.app/ghostgames/` – leave it if the project is
    shared.) The full current list is in `backup/supabase-auth-config.json`.

1.4 **OAuth providers** – Authentication > Providers. Same sign-in setup as GhostGames:
    - **Google**: enabled. Client ID is in `backup/supabase-auth-config.json`; the client secret is
      in Google Cloud Console > APIs & Services > Credentials (or the private
      `supabase-auth-config.secret.json`). In Google Cloud, the OAuth client's "Authorised
      redirect URI" must be `https://<project-ref>.supabase.co/auth/v1/callback`.
    - **Discord**: enabled. Client ID in `backup/supabase-auth-config.json`; secret in the Discord
      Developer Portal > your app > OAuth2 (or the private secret file). Add redirect
      `https://<project-ref>.supabase.co/auth/v1/callback` there too.
    - Email provider is also enabled (project default).
    If you made a NEW project, update the redirect URIs in Google/Discord to the new project ref.

1.5 **Keys for Render** – Project Settings > API: copy the Project URL, the anon/publishable
    key and the service_role key (for step 2).

## 2. Render (the web server)

Free plan, Node 20, region Frankfurt. Either:

- **Blueprint (easiest):** Render Dashboard > New > Blueprint > connect GitHub repo
  `GhostFaceModz/GhostFlix`, branch `main`. Render reads `render.yaml` and asks for the secret
  values; or
- **Manual:** New > Web Service > the repo, branch `main`, Runtime Node, Plan Free,
  Build command `npm ci --omit=dev`, Start command `npm start`, Health check path `/healthz`.

Environment variables (values: private `render-env.secret`, or regenerate from the source shown):

| Name | Needed? | Where the value comes from |
|---|---|---|
| `NODE_VERSION` | yes | `20` |
| `TMDB_API_KEY` | yes (else demo catalogue) | themoviedb.org > Settings > API (free) |
| `TMDB_REGION` | yes | `GB` |
| `SUPABASE_PUBLIC_URL` | for sign-in | Supabase > Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | for sign-in | Supabase > Settings > API > anon / publishable key |
| `SUPABASE_URL` | for saving admin edits | same Project URL |
| `SUPABASE_SERVICE_KEY` | for saving admin edits | Supabase > Settings > API > service_role key (server only!) |
| `ADMIN_DISCORD_ID` | for admin via Discord | `803606154365632555` (Zane's Discord user ID) |
| `ADMIN_PASSWORD` | for /admin password login | choose one (or set `ADMIN_PASSWORD_SHA256` instead) |
| `ADMIN_PASSWORD_SHA256` | optional | `printf '%s' 'password' \| sha256sum` |
| `SESSION_SECRET` | yes | any long random string, e.g. `openssl rand -hex 32` |
| `NEXSTREAM_API_KEY` | not used by current code | kept only for parity with the old service |

Optional extras the code understands: `YOUTUBE_API_KEY`, `CRON_SECRET`, `DISCORD_INVITE_URL`,
`GITHUB_URL`, `AUTH_GOOGLE=false` / `AUTH_DISCORD=false`, `ENABLE_WATCH_PARTIES=1` (keep unset –
Watch Parties are postponed). See `.env.example`.

Deploy, then check `https://<service>.onrender.com/healthz` returns `{"ok":true,"mode":"tmdb"}`.
Note: the live service has auto-deploy ON (every push to `main` deploys) and health check path `/healthz`. You can still force one with "Manual Deploy > Deploy latest commit".

**Admin:** sign in with Discord as user ID `803606154365632555` – the server compares that ID and
shows the Admin link. Nobody else gets admin.

## 3. Custom domain + Fasthosts DNS

3.1 Render > the service > Settings > Custom Domains: add `ghostflix.uk` and `www.ghostflix.uk`.

3.2 Fasthosts > Domains > ghostflix.uk > DNS. Records (as of 2026-10-23):

| Type | Host | Value |
|---|---|---|
| A | `@` (ghostflix.uk) | `216.24.57.1` (Render's load balancer IP – confirm in Render's domain screen) |
| CNAME | `www` | `<service-name>.onrender.com` (currently `ghostflix.onrender.com`) |

Remove any other A/AAAA records on `@` (Fasthosts parking). If the new service gets a different
`.onrender.com` name, update the CNAME. Wait for Render to show both domains "Verified" and
issue certificates. `www` redirects to the apex.

## 4. Keep-alive cron (stops the free instance sleeping)

Already included at the end of `backup/supabase-schema.sql`. It's a pg_cron job in Supabase:
```sql
select cron.schedule('ghostflix-keepalive', '*/5 * * * *',
  $$select net.http_get(url := 'https://ghostflix.onrender.com/healthz',
     headers := '{"User-Agent": "gg-keepalive"}'::jsonb, timeout_milliseconds := 30000)$$);
```
If the Render URL changes, unschedule and re-create it with the new URL. Check it runs:
`select * from cron.job_run_details order by start_time desc limit 5;`

## 5. Final checks

- https://ghostflix.uk loads; Movies, Series, Live TV and search work (TMDB key OK).
- Sign in with Google and with Discord; add to My List; reload; the item is still there.
- Discord sign-in as the admin ID shows the Admin link; `/admin` opens.
- **PWA / installable app:** open the site in Chrome (desktop or Android) > DevTools >
  Application: `manifest.webmanifest` loads with name GhostFlix and 192/512/maskable icons, and
  `/sw.js` is "activated and running". The menu shows "Install app" (Chrome/Edge) and installing
  opens it standalone. On iPhone: Safari > Share > Add to Home Screen. Turn the network off and
  reload: the cached app shell should still appear.
- Supabase > Integrations > Cron: `ghostflix-keepalive` shows successful runs every 5 minutes.
