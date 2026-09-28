# How the DPDP product runs itself (WO-DPDP-015)

Nothing here needs a person on a Monday. This page says what runs by itself, how each piece is proved, and what a red light means.

## What runs by itself

| What | Where | When | If it fails |
|---|---|---|---|
| Monday digest emails (one per active member) | pg_cron `dpdp-monday-digest` → Edge Function `dpdp-monday-email` | Mon 00:30 UTC (06:00 IST) | `dpdp-monday-retry` tries again at 01:30, 03:30 and 06:30 UTC, but only if this week has no complete run |
| Leak-clock / rights-clock reminders | pg_cron `dpdp-legal-clocks` | daily 03:30 UTC | the next day's run |
| Public site + external AI work link check | GitHub `DPDP live smoke` | daily 05:15 UTC and after every site deploy | the run turns red; GitHub emails the watchers |
| The site itself | GitHub `dpdp-app deploy` → Cloudflare Pages | every merge that touches `dpdp-app/` | the deploy run turns red |

The Monday run goes through one organisation at a time, so one slow or broken organisation cannot stop the others. Every run writes one row to `dpdp.timer_run` (`ok`, `partial`, counts, error). A digest is unique per person per week, so running it again never sends anyone a second copy.

**Look at this week's Monday run** (Supabase SQL editor):

```sql
select week_key, ok, partial, orgs, digests, sent, skipped, failed, started_at
from dpdp.timer_run where job = 'monday' order by started_at desc limit 5;
select public.dpdp_timer_monday_done(now());   -- true once this week's run is complete
```

`ok = false` means at least one organisation failed or the time budget ran out: read `error`, the retry job has already been asked to go again. To run it by hand, POST `{"job":"monday"}` to the function with the timer secret (the cron reads it from Vault `dpdp_timer_secret`); add `"orgId":"…"` and `"dryRun":true` to try one organisation without sending.

Addresses on reserved test domains (`*.test`, `example.*`, `*.invalid`, `localhost`) are never sent to, only recorded as skipped.

## How it is proved

| Proof | Command | What it covers |
|---|---|---|
| Every role, both editions, on the real database | `bun test --env-file=.env.local src/lib/services/dpdp-editions-roles.test.ts` (set `DPDP_REQUIRE_DB=1` so an unreachable database fails instead of skipping) | a new visitor opens their own organisation; owner, Grievance Officer, coordinator, staff, group members, the CA and the client's owner each see the right page and only their own jobs, act, get their Monday digest, and use the external AI work link at the right authority. It runs inside one transaction that is rolled back, so it leaves nothing behind. |
| The Monday timer | `bun test --env-file=.env.local src/lib/services/dpdp-timer.test.ts` | digests, escalation, email links, unsubscribe |
| The static app in a browser | `cd dpdp-app && VITE_MOCK=1 bun run build && bunx playwright test` | 126 checks: the 70 acceptance checks, each role's screens, both landing pages start to finish |
| The live site | `node dpdp-app/scripts/live-smoke.mjs` | every public page, the two landings' links, the external AI link's refusals, the Monday worker's bearer check |

## What a red light means

- **DPDP live smoke red, "Start free"/"Sign in" lines:** the deployed site is older than `main`. Check the `dpdp-app deploy` run.
- **DPDP live smoke red, `/ai/…` lines:** the external AI work link path is broken (Cloudflare function or the `dpdp-ai-link` Edge Function). Redeploy `dpdp-ai-link`.
- **`dpdp_timer_monday_done` false on Monday afternoon:** read `dpdp.timer_run.error` and the Edge Function logs for `dpdp-monday-email`.
- **`dpdp-editions-roles.test.ts` red:** a role saw something it should not, or could not do something it should. The failure message names the role.

## Switches

- `DPDP_INTERNAL_AI_ENABLED=1` (Next.js app only) brings back the older in-app AI pages. Off by default; the external AI work link is the DPDP way.
