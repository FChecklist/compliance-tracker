# PROJEXA — the one Supabase update (2026-10-09)

Everything built since the 2026-10-08 go-live is already live except this. Live database is at migration 0740 (checked 2026-10-09: `awl_update_drawing_0740` is the newest).

Project: VERIDIAN backend `pcrjmlpuqsbocqfwoxod`. Merge PR compliance-tracker#2127 first (it carries both files).

## Step 1 — apply one migration (Supabase MCP `apply_migration`, or the SQL editor)
File: `drizzle/0741_awl_recall_precedent.sql`. Puts `recall_precedent` (read, level 0, member rank) on the AI work link. One row added, idempotent, no data loss.
Check: `select function_id from platform.ai_work_link_functions where function_id='recall_precedent';` returns 1 row, and `select public.ai_work_link__registry_version();` equals the `-- registry version` line in the file.
Undo: `drizzle/down/0741_awl_recall_precedent.down.sql`.

## Step 2 — deploy one Edge function
`ai-work-link` (reads the new registry JSON). From a clean checkout of main, `mkdir C:/ct/deploy-ai-work-link.lock` first:
`npx --yes supabase@latest functions deploy ai-work-link --project-ref pcrjmlpuqsbocqfwoxod --no-verify-jwt --use-api`
Check: a new work link's `/context` lists `recall_precedent`. Links minted before this keep their old function list (re-mint to get it).
Undo: redeploy the previous commit.

Nothing else is pending: no auth settings, no other migration, no other function.
