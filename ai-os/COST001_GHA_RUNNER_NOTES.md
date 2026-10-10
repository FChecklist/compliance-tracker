# PROJEXA-COST-001 — GitHub Actions cron runner, notes

**Status: PREPARE-ONLY.** No schedule is enabled, no secret was created, `vercel.json`
is untouched. Files: `scripts/run-internal-cron.ts` (+ its test), `scripts/db-role-preflight.ts`,
`.github/workflows/cost001-cron-runner.yml`. Owner: Rajat Agarwal.

## What this replaces

Seven Vercel crons need this app's own TypeScript/LLM stack (org discovery, prompt
resolution, the model router, per-cron business logic) and were verified as
`MOVE → a scheduled GitHub Actions runner` — both `FChecklist/compliance-tracker`
and `FChecklist/projexa` are public repos, so Actions minutes are free:

| Cron | Vercel schedule (UTC) |
|---|---|
| `loops` | `0 3 * * *` |
| `instruction-audit` | `0 4 * * *` |
| `dispatch-completion-monitor` | `30 8 * * *` |
| `capability-audit` | `0 9 * * *` |
| `exchange-rate-refresh` | `30 9 * * *` |
| `l2-phrase-promotion` | `30 10 * * *` |
| `crm-lead-scoring` | `0 11 * * *` |

Each is a route at `src/app/api/internal/<path>/run/route.ts` exporting `GET`
(`POST` aliases it), authenticating with `Authorization: Bearer $CRON_SECRET`,
failing closed (401) when the secret is unset or wrong. `run-internal-cron.ts`
invokes exactly one of these in-process under Bun — no Next.js server starts —
by dynamically importing the route module and calling its `GET` with the same
request shape Vercel Cron sends.

## Two real blockers, documented not solved

1. **No GitHub Actions workflow in this org has ever successfully connected to
   Supabase.** `.github/workflows/db-migrate.yml`'s recorded runs show 0
   successes (password authentication failure). `cost001-cron-runner.yml`'s
   preflight step (`scripts/db-role-preflight.ts`) exists specifically so this
   failure surfaces as "the connection string is bad," at the first step, in
   plain text — not three steps later as a cron that looks broken.
2. **`CRON_SECRET` is not a GitHub secret today** (confirmed via `gh secret
   list`, both 2026-09-22 and re-checked 2026-09-24: repo secrets are
   `ANTHROPIC_API_KEY`, `APP_RUNTIME_DATABASE_URL`, `CEREBRAS_API_KEY`,
   `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `GROQ_API_KEY`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `OPENROUTER_API_KEY`, `PAT_FCHECKLIST`, `PROJEXA_DATABASE_URL`,
   `RESEND_API_KEY`, `SUPABASE_DB_PASS`, `SUPABASE_PROJECT_REF`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `VERCEL_ACCESS_TOKEN`,
   `VERIDIAN_API_KEY` — no `CRON_SECRET`). Without it every one of these
   routes answers 401, by design. The workflow's "Verify CRON_SECRET" step
   fails loudly and by name before ever invoking a route.

## Real local mechanics check (2026-09-24, no live database touched)

Ran `run-internal-cron.ts` against `secrets-audit` (not one of the 7 GHA
crons, but the smallest route to prove the mechanics with) in a bare
environment with no `DATABASE_URL`:

- **No `CRON_SECRET` set:** the script sent no auth header (by design — "absent"
  is more honest than `Bearer undefined`); the route answered `401
  {"error":"Unauthorized"}` in 1 ms; exit code 1. No database was touched.
- **`CRON_SECRET` set to an arbitrary value** (and sent back as the same value,
  since both the sender and the route read the same env var — this proves the
  auth check passes on a match, not that an attacker's guess would win): the
  route's own logic then ran for real — it printed "Secrets audit: 8 required
  env var(s) missing in production: DATABASE_URL, APP_RUNTIME_DATABASE_URL,
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, AI_CONFIG_ENCRYPTION_KEY,
  PROVISIONING_DATABASE_URL, SUPABASE_DB_PASSWORD" (genuinely correct for this
  bare shell) — then failed with a real `500 {"error":"Secrets audit run
  failed"}` when it tried to write that finding to `application_errors`,
  because no real database connection string was available
  (`getConnectionString()` threw). Exit code 1.

This is exactly the intended shape: the script never bypasses the route's own
authorization, and a route that needs the database fails loudly rather than
silently when the database is unreachable. The 7 GHA-target crons will behave
the same way until blocker 1 is resolved — the preflight step is what turns
that from a confusing cron failure into an explicit, first-step diagnostic.

## Per-cron notes for whoever flips the schedule on

- **`loops`** — the route's `Promise.all` over ~16 sub-jobs has no per-job
  try/catch; one throw (e.g. the freshness-audit loop when neither embedding
  key is set) skips every job after it, including the Google Sheets
  projection. `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` / `GOOGLE_SHEETS_SPREADSHEET_ID`
  are not GitHub secrets — that projection will always skip here.
- **`instruction-audit`** — needs `AI_CONFIG_ENCRYPTION_KEY` to decrypt a
  stored BYOK model key; it is not a GitHub secret. Falls through to platform
  keys otherwise (`GROQ_API_KEY`/`OPENROUTER_API_KEY`, both present).
- **`dispatch-completion-monitor`** — one LLM call per stuck `activity_log`
  row across ~278 orgs, with no cap in the route itself. Live today: 0 stuck
  rows (see the COST-001 cron-plan handout), so first runs cost nothing, but
  a cap should be added before this is trusted unattended long-term.
- **`capability-audit`** — bounded to 25 capabilities/run × up to (2+N) LLM
  calls each (N = GUARDRAIL_PLATFORM roster roles); live today 0 due.
- **`exchange-rate-refresh`** — fetches `open.er-api.com` (keyless), no
  secret needed beyond the DB ones.
- **`l2-phrase-promotion`** — needs `AI_PROVIDER_PIPELINE_L2=openrouter` (set
  in the workflow's run step) or it throws under the default `claude-cli`
  provider, which this runner cannot reach.
- **`crm-lead-scoring`** — no BYO model configs exist today, so the platform
  `OPENROUTER_API_KEY`/`GROQ_API_KEY` pays; live worst case ~318 calls on the
  first run (27 sales-enabled orgs × up to 20 leads), ~37/day steady after.

## How the owner runs the first dry run

1. GitHub → this repo → Actions → "COST-001 internal cron runner" →
   "Run workflow" → pick any of the 7 crons from the dropdown → leave
   `dry_run: true` (the default) → Run. This executes only the database-role
   preflight (`scripts/db-role-preflight.ts`) and invokes nothing — safe to
   run today even without `CRON_SECRET`.
2. To actually invoke a route by hand once `CRON_SECRET` exists as a repo
   secret: same dispatch, set `dry_run: false`.
3. To turn scheduling on: both blockers above must be resolved, then
   uncomment the `schedule:` block in `cost001-cron-runner.yml` — nothing
   else needs to change, the cron→path mapping and concurrency group are
   already wired for it.
