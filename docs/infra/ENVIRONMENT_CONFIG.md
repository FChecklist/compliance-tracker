# Environment Configuration Management

Cloud Deployment / Deployment Operations review, "Environment Configuration
Management" finding (Medium): *no formal dev/staging/prod environment
variable separation.* This doc records the real, current state and points
at the two artifacts that close the gap, rather than re-deriving V2-7's
already-verified infra facts from scratch.

## 1. What "environment" means here

Vercel gives this project (Hobby plan) exactly 3 real deployment targets --
confirmed live against the Vercel REST API, see
`ai-os/STAGING_ENV_2026-07-20.md` §2 for the full verification:

| Target | Trigger | Real domain |
|---|---|---|
| `production` | push/merge to `main` | the live app |
| `preview` | push to any other branch | `<branch>-<hash>-<project>.vercel.app` |
| `development` | `vercel dev` / local `.env.local` | localhost |

A named Vercel *custom environment* called "staging" would need the Pro
plan (Hobby caps custom environments at 0 -- verified live, not assumed).
The tier-honest equivalent, already designed and now wired (§2 below): a
long-lived `staging` git branch, whose `preview` deployments carry
staging-only variable values via Vercel's `gitBranch` scoping field (free on
every plan).

## 2. What's real today

- **Per-target env vars already exist.** Every var on the live Vercel
  project already has separate rows per `target` (e.g. `DATABASE_URL` has 3
  rows: production/preview/development) -- this was already true before
  this finding, per V2-7's live audit. The finding's real gap was narrower:
  no *documented*, *repeatable* process for adding a new var correctly
  scoped, and no staging-branch-specific scoping mechanism wired into the
  sync workflow.
- **`.env.example`** (repo root, added alongside this doc): every env var
  this codebase's own source reads from `process.env`, grouped by concern,
  with a one-line note on which Vercel target(s) it's expected to differ
  across. Copy to `.env.local` for local dev.
- **`.github/workflows/sync-vercel-env.yml`**: the V2-7 patch
  (`ai-os/v2-7-workflow-change.patch`, staged 2026-07-20, applied
  2026-08-07 -- see that file's own header for why it sat unapplied) is now
  live in this workflow. It documents and provides the `target=["preview"],
  gitBranch="staging"` scoping pattern for any future staging-only secret,
  with a commented example block ready to uncomment once a real
  `STAGING_*` GitHub secret is provisioned.
- **`src/app/api/internal/secrets-audit/run/route.ts`**: a daily cron
  (`vercel.json`, `0 7 * * *`) that fails loudly (logs to
  `application_errors`) if any of the vars its own `REQUIRED_ENV_VARS` list
  names is missing in production. This is a *presence* check, not a
  *per-environment-correctness* check -- it confirms a var is set, not that
  it holds the right value for that environment.

## 3. What's still genuinely open (disclosed, not silently claimed done)

- **No staging Supabase project / staging secrets provisioned yet.** The
  `staging` branch currently reuses the same `preview`-scoped vars as every
  other non-`main` branch (safe -- previews are non-production -- but not
  yet a fully isolated staging *database*). Provisioning a dedicated
  staging Supabase project is a real infra decision with its own cost, left
  to the Owner per V2-7 §6.
- **No `staging` branch protection.** `main` has the PR/CI gate (Rule 6);
  `staging` does not yet. Recommended, not applied here (a GitHub settings
  change, not a code change) -- see V2-7 §6.
- **The `REQUIRED_ENV_VARS` presence-check list is deliberately partial**
  (its own header says so) -- extend it as new load-bearing secrets are
  introduced, per that file's own comment.

## 4. Adding a new environment variable (the repeatable process this
   finding was missing)

1. Add it to `.env.example` under the right section, with a one-line note
   on which target(s) it applies to.
2. If it's load-bearing in production (the app breaks without it), add its
   name to `REQUIRED_ENV_VARS` in
   `src/app/api/internal/secrets-audit/run/route.ts` so a missing value is
   caught by the daily cron instead of discovered as a live incident.
3. Set the real value in Vercel: production-only values via the Vercel
   dashboard or `sync-vercel-env.yml`'s pattern (`target=["production"]`);
   values that should differ on the `staging` branch via
   `target=["preview"], gitBranch="staging"` (see that workflow's own
   comment block for the exact `curl` shape).
4. For local dev, add the real value to your own `.env.local` (never
   committed).
