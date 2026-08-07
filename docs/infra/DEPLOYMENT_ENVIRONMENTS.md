# Deployment Environments Strategy

**VERIDIAN Review Framework gap-closure, Cloud Deployment / Deployment
Automation (2026-08-07).** Gap: "Single-region deployment; no staging/
preview environment strategy documented." This doc is that strategy,
written against the real, live state of the Vercel project (verified
2026-08-07, not assumed from the review's original wording):

- Project: `veridian-compliance-ai` (`prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`),
  confirmed live via `vercel projects ls` / the Vercel API — note this is
  the project's *current* name; `docs/SEV1_INCIDENT_RUNBOOK.md` and some
  older comments still say `compliance-tracker-ai`, the pre-rename name,
  same project ID throughout.
- Plan: **Hobby** (confirmed by this repo's own recurring "Hobby-plan cron
  limit" notes, e.g. `ai-os/boss/ACTIVE-CLAIMS.yaml`). This matters
  directly for the design below.
- Region: `sin1` (Singapore) only, per `vercel.json`. Single-region is a
  real, accurate observation, not a gap this doc closes — Vercel's
  multi-region deployment for serverless functions is a Pro/Enterprise
  feature, and there is no measured latency complaint anywhere in this
  repo's testing docs to justify the added cost/complexity. Not actioned
  here; noted so it isn't silently forgotten.

## Why not Vercel's native "Custom Environments"

Vercel's own multi-environment feature (an arbitrary `staging` environment
alongside Production/Preview/Development, each with independently branded
URLs and env var scopes) is a **Pro/Enterprise-only** feature. This project
is Hobby, and enabling it means an unattended agent making a paid-plan
upgrade decision on the owner's account — an outward-facing, billing-
affecting action squarely inside `AGENTS.md` Rule 7(e)'s "requires explicit
confirmation from the repository owner" carve-out. Not done here; the
owner can enable it directly if they want the fuller feature later.

## What's actually implemented instead: branch-scoped Preview env vars

Every Vercel plan, including Hobby, already gives every non-`main` branch
its own automatic **Preview** deployment, and lets an env var be scoped to
one specific branch via the `gitBranch` field on `POST /v10/projects/{id}/env`
(`target: ["preview"], gitBranch: "<branch>"`). That's a real per-branch
environment scope without needing the paid feature:

- **Production** — `main` branch, `target: ["production"]` env vars (the
  existing `sync-vercel-env.yml` workflow).
- **Staging** — the `staging` branch. Every push to `staging` gets a real
  Preview deployment, and any env var pushed via the new
  `.github/workflows/sync-vercel-env-staging.yml` workflow
  (`workflow_dispatch`) is scoped with `gitBranch: "staging"` — it is
  invisible to every other branch's Preview deployment, including ad hoc PR
  branches. This is the "own env var scope" the finding asked for.
- **Preview (ad hoc)** — any other branch/PR. Gets Vercel's default
  Preview env var scope (everything targeted `["preview"]` with no
  `gitBranch` restriction) — unchanged from today.

To use it: push to (or open a PR that merges into) a branch literally named
`staging`, then run the `Sync Env Vars to Vercel (staging)` workflow once
(`workflow_dispatch`, same manual-trigger posture as the existing
production sync workflow — neither runs automatically on push, both are an
explicit operator action). The `staging` branch does not exist yet as of
this writing; create it whenever a real staging deploy is first needed
(`git push origin main:staging`) — no need to pre-create an unused branch
today just because this doc names it.

## What staging does NOT do yet (honest gaps, not silently implied)

- **No separate data layer.** `DATABASE_URL`/`SUPABASE_*` are not
  overridden for the `staging` branch — a staging deployment today runs
  against the same Supabase project as production and every ad hoc PR
  preview already does (this was already true before this change; nothing
  here makes it worse). Standing up an isolated staging Supabase project is
  a real, larger, separate piece of work (new project, new migrations
  baseline, seed data) — out of scope for this env-var-scoping change and
  not invented here.
- **No automatic promotion pipeline.** There is no CI step that
  auto-deploys `main` → `staging` first and gates production on a staging
  smoke test passing. Today `staging` is a manually-pushed branch an
  operator uses when they specifically want a shareable, isolated-env-var
  preview before merging to `main`. Building an automatic staging-gate
  pipeline is a reasonable next step but a distinct piece of work from "does
  a staging environment with its own env var scope exist" (the finding this
  doc closes).

## Related

- Rollback: `docs/runbooks/rollback.md`.
- Production reliability SLO (built off the same webhook data this repo's
  deployment automation already produces): `src/lib/services/
  deployment-slo-service.ts`, `GET /api/deployment-slo`.
- Incident response: `docs/SEV1_INCIDENT_RUNBOOK.md`.
