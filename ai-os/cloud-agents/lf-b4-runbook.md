# Package lf-b4-runbook (backend repo; docs and scripts only)

Branch `claude/lf-b4-runbook` from `origin/feat/lf-sync-backend`. No migration, no change to `src/` business code.

## 1. Cost model (the owner's top priority: cost near zero)
`scripts/verify/projexa-local-first-cost-model.mjs` (plain node, no dependencies, no network): takes assumptions (users, projects per user, rows per kind, session hours per day, sync intervals, peer share) with sane defaults and prints the estimated monthly Supabase Edge Function invocations, database egress, Realtime messages, Vercel function invocations and static bandwidth versus the FREE-TIER limits (limits are parameters with defaults; cite the source URLs in comments: Supabase free plan: 500K Edge Function invocations/month, 5 GB egress, 200 concurrent Realtime connections / 2M messages; Vercel Hobby: 100 GB bandwidth and a function invocation cap (verify; state the numbers you are not sure of as "to verify"); Cloudflare Pages: unlimited static bandwidth) and says which constraint binds first and at how many users.
Derive per-action call counts by READING `supabase/functions/projexa-sync/handler.ts` and the laptop contract (manifest + per project x kind pulls + /changes + daily /ids + release/current + attest + jobs polling ...) and put the derivation in the doc. Include a unit test (under `src/`) for the arithmetic.

## 2. Deploy runbook
`ai-os/PROJEXA_LOCAL_FIRST_DEPLOY_RUNBOOK.md`: the exact ordered procedure the PM follows to take the finished work live with the owner's required order (everything built and tested on local + Supabase + git first; then deploy; the Vercel deploy is the VERY LAST step):
- PR merge order and the CI required checks (read `.github/workflows` and the branch-protection notes in `CLAUDE.md`).
- The migration apply order 0678..0685 with the verification SQL after each (counts of functions, triggers, tables, a smoke select) and the rollback (down file) for each; how to apply them via the Supabase MCP or the CLI without Vercel.
- The Edge Function deploys (`supabase functions deploy projexa-sync --no-verify-jwt --use-api`; `ai-work-link-exec` with its bundle build `scripts/build-ai-work-link-exec.ts`; `ai-work-link`), including the secrets they need (names only).
- Kill switches and feature flags (`px-local-first`, `PROJEXA_INTERNAL_AI_ENABLED`, `ai_work_link_settings.writes_enabled`, release `min_compatible`).
- The release registration step (`POST /release/register` after the PROJEXA deploy) and the `min_compatible` policy.
- Post-deploy smoke checks (curl commands with placeholders for the token), monitoring of invocation counts (`scripts/verify/vercel-invocations.sh`, `vercel-monthly-cost-check.mjs`, Supabase logs), and a rollback plan per layer.

## 3. Smoke script
`scripts/verify/projexa-sync-smoke.mjs`: given `SYNC_BASE` and a PROJEXA access token from the environment (never printed, never logged), calls manifest, pull of one kind, changes, ids, attest and release/current and prints a PASS/FAIL table with latencies. It must refuse to run against anything but a `supabase.co` function URL. Unit-test its pure parts with a fake fetch.
