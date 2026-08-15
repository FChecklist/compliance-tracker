# Persistent Vercel Staging Environment (V2-7)

> **Status:** design + smoke-test doc. Decision record for CSV rows #37/#39
> (D8 — "persistent staging env + per-env var scoping"). Authoritative
> live-infra facts in this doc were verified against the Vercel REST API on
> **2026-07-20** with `VERCEL_ACCESS_TOKEN`; they supersede the v2 plan's
> D8 line where the two disagree (see §3).

---

## 1. Goal

Give VERIDIAN AI OS a **persistent `staging` environment**: a place where
pre-production integration work runs against a stable, non-production stack
with its own environment variables, before any change reaches `main` /
production. Closes CSV rows #37 (staging env) and #39 (per-env var scoping).

## 2. Live-infra ground truth (verified 2026-07-20)

Queried the real Vercel project `prj_mRRWcMvhyuxgRZtcfp4ArSzcOvII`
(team `meet-track-s-projects`, owner `raajat.agarwal@gmail.com`):

| Fact | Value | How verified |
|---|---|---|
| Account plan | **Hobby** (`billing.plan = "hobby"`) | `GET /v2/user` |
| Custom environments present | **0** (`customEnvironments: []`) | `GET /v9/projects/{id}/environments` |
| Custom environments **allowed** on Hobby | **0** | `POST /v9/projects/{id}/custom-environments` → `400 "Cannot create more than 0 custom environments."` |
| System environments | `production` (branch `main`), `preview` (all unassigned branches), `development` (local) | same |
| Env vars on project | 19, already scoped per-target (e.g. `DATABASE_URL` has 3 separate rows: production / preview / development) | `GET /v10/projects/{id}/env` |
| Env-var API per-branch scoping | `gitBranch` field on `POST /v10/projects/{id}/env` — "If defined, the git branch of the environment variable (must have `target=preview`)" | Vercel REST API reference |

### 2.1 What this means in plain terms

- A **named "staging" custom environment** (the thing Vercel calls a *custom
  environment*, reachable via `/v9/.../custom-environments`, with its own
  slug, branch matcher, and domains) **requires the Pro plan** ($20/mo per
  team member). At Hobby, the cap is **zero** — the API refuses to create
  one. This is a paid-plan change, which V2-7 explicitly forbids
  ("No paid Vercel plan change").

- The **`gitBranch` field** on a normal env var, however, is **free on every
  plan**. An env var created with `target=["preview"]` +
  `gitBranch="staging"` applies **only** to preview deployments built from
  the `staging` git branch. This is the tier-honest lever for per-env-var
  scoping to a "staging" deployment.

## 3. Correction to the v2 plan's D8 line

`SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md` line 80 / task V2-7 says:

> enable a persistent `staging` environment via Vercel env-var scoping
> **(already supported, no extra spend at current tier)**

**The parenthetical is inaccurate at the current (Hobby) tier** for a
*custom environment*. Creating a custom environment named `staging` is
**not** free on Hobby — it is blocked until the plan is upgraded to Pro.
This doc records that correction so the CSV re-score (rows #37/#39) is
grounded in what the infra actually permits, not the plan's assumption.

The **objective** of V2-7 (a persistent staging place + per-env var
scoping, no extra spend) is still achievable at Hobby — just not via a
custom environment. The mechanism is below.

## 4. The tier-honest design (Hobby-compatible, no plan change)

**Persistent staging = a long-lived `staging` git branch.** Vercel builds a
preview deployment for every push to every non-`main` branch; the `staging`
branch therefore gets a continuous stream of preview deployments. The
*latest* successful `staging` preview URL is the "persistent" staging
target — persistent in the sense of "a stable, known staging pointer that
advances on every staging push," not in the sense of "one never-changing
deployment."

**Per-env var scoping = `target=["preview"]` + `gitBranch="staging"`.**
Staging-only variables (e.g. a staging `DATABASE_URL` pointing at a
staging Supabase project) are attached only to `staging`-branch previews
and never leak into production or `development`.

This satisfies V2-7's DONE CRITERIA — "staging env scoped; workflow
updated" — without a paid plan change:

| V2-7 requirement | How it's met |
|---|---|
| Persistent `staging` env | long-lived `staging` git branch → continuous Vercel preview deployments |
| Per-env var scoping | `target=["preview"]` + `gitBranch="staging"` on staging-only vars (free env-var API field) |
| No paid plan change | uses only Hobby-tier features (preview deployments + `gitBranch` scoping) |
| Workflow updated | `.github/workflows/sync-vercel-env.yml` extended with the scoping pattern + a staging-only block |
| Smoke-test documented | §5 below |

### 4.1 What this does NOT give you (honest limitation)

- **No fixed staging domain / alias.** Preview URLs are
  `<branch>-<hash>-<project>.vercel.app`; the hash changes per deployment.
  A stable `staging.veridian.ai` domain attached *only* to the `staging`
  branch requires a **custom environment** (Pro) to bind a domain to a
  branch matcher, OR manual alias management. Out of scope at Hobby; if a
  stable staging domain is later required, that is the trigger to revisit a
  Pro upgrade (an Owner decision, not an agent one).
- **No separate cron schedule for staging.** `vercel.json` crons run on the
  production deployment only. Staging previews do not execute cron jobs.
  This is the correct behavior for a staging env (cron side-effects should
  not fire from pre-production).
- **`gitBranch`-scoped vars override `preview`-scoped vars for that branch
  only.** A var set on `target=["preview"]` (no branch) still applies to all
  other preview branches; the `gitBranch="staging"` row is an
  *additional*, branch-specific value. Plan the var matrix accordingly.

## 5. Smoke-test expectation (staging previews)

When the `staging` branch is pushed and Vercel builds its preview:

1. **Build succeeds** — `bun run build` passes on the `staging` ref the same
   way it passes on `main` (CI's Lint/Type-Check/Build gate already
   enforces this on PRs; a direct `staging` push should be opened as a PR
   against `staging` first so CI runs, mirroring Rule 6's branch-protection
   discipline — `staging` itself should carry the same PR/CI gate).
2. **Staging-only vars are present in the runtime, production-only vars are
   absent (or hold staging values).** Concretely, on a `staging`-branch
   preview deployment:
   - `process.env.DATABASE_URL` resolves to the **staging** value (the row
     scoped `target=["preview"], gitBranch="staging"`), NOT the production
     value. Verify with a read-only route that echoes the DB host / a
     staging-only marker env var (e.g. `STAGING_MARKER=1`).
   - Production-only sensitive vars (`AI_TEAM_LOG_SECRET`, `CRON_SECRET` set
     `target=["production"]`) are **not** present in the staging preview
     runtime. (They are scoped to production only by their existing
     `target`.)
3. **Auth still required.** Every `src/app/api/**` route still calls
   `requireAuth()` — staging is not an open surface. A smoke test hitting
   `/api/...` unauthenticated returns 401, same as production.
4. **No cron fires from staging.** Confirm no `vercel.json` cron executes
   against the staging preview (see §4.1). Crons are production-deployment
   only by Vercel's design.
5. **Redeploy trigger is opt-in.** The workflow's `redeploy` input defaults
   to `true` for production redeploy of `main` only; it must never redeploy
   staging (staging advances by git push, not by a workflow trigger).

### 5.1 How to actually run the smoke test

```bash
# 1. Provision a staging-only var (one-time, via the workflow or CLI):
#    POST /v10/projects/<id>/env with
#    {key:"STAGING_MARKER", value:"1", type:"plain",
#     target:["preview"], gitBranch:"staging"}

# 2. Push to the staging branch (CI builds the preview):
git checkout -b staging && git push origin staging

# 3. Grab the latest staging preview URL:
curl -sf "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT_ID&limit=5&target=preview" \
  -H "Authorization: Bearer $VERCEL_ACCESS_TOKEN" \
  | jq -r '.deployments[] | select(.meta.githubCommitRef=="staging") | .url' | head -1

# 4. Hit a staging route that should reflect the staging var (auth as a
#    staging user). Expect STAGING_MARKER=1 and the staging DATABASE_URL host.
```

## 6. Open items (not blocking V2-7 close; recorded for the Owner)

- **Provision staging secrets.** No `STAGING_*` GitHub secrets exist yet.
  When a staging Supabase project / staging API keys are provisioned, add
  them as repo secrets and uncomment the corresponding block in
  `sync-vercel-env.yml`. Until then the staging branch reuses the
  existing `preview`-scoped vars (which is safe — previews are
  non-production).
- **Revisit Pro upgrade if a stable staging domain is needed** (§4.1). That
  is an Owner money decision, recorded here, not pursued by this task.
- **`staging` branch protection.** Recommend the Owner enable the same
  PR/CI gate on `staging` that `main` has, so staging pushes are reviewed
  too. This is a GitHub settings action, not a code change.
- **Workflow-file push needs a workflow-scoped token (Owner action).** The
  `.github/workflows/sync-vercel-env.yml` change that wires the per-env
  scoping pattern + the staging-only block is staged as a git patch at
  `ai-os/v2-7-workflow-change.patch`. The AI agent that produced V2-7
  (this task) holds a GitHub token whose scopes are `gist, read:org, repo`
  — no `workflow` scope — so GitHub rejects any push that adds/modifies a
  file under `.github/workflows/`. The Owner (or any token with the
  `workflow` scope) applies the patch with:
  `git apply ai-os/v2-7-workflow-change.patch && git commit -am 'V2-7: wire per-env scoping into sync-vercel-env.yml' && git push`.
  Until that push lands, the staging-only block in the workflow is
  documentation only; the design in this doc is what closes rows #37/#39.
