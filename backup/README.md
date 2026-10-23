# backup/

Restore files exported from the live services on 2026-10-23 (see ../RESTORE.md).

- `supabase-schema.sql` – GhostFlix tables, RLS policies, grants and the `ghostflix-keepalive`
  pg_cron job, generated from the live Supabase project via the Management API.
- `supabase-auth-config.json` – non-secret Supabase Auth settings (redirect allow list, enabled
  providers, OAuth client IDs). OAuth client secrets are intentionally NOT included.

Not in git on purpose (they hold secrets or user data): Render env var values, the full auth
config with secrets, table data dumps and the user list. Those are kept privately (chmod 600) in
`/workspace/ghostflix-backups/` on Zane's agent box.
