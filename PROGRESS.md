# PROGRESS -- task-20260720-031002-superboss-v2-plan--persistent-vercel-sta

## Completed
- [x] Read governance in order: ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml (via CLAUDE.md/AGENTS.md), v2 plan V2-7 spec (lines 192-201) + D8 decision (line 80) + Tier2/workflow-scope notes (lines 410-411)
- [x] Collision check: no active claim or open PR on sync-vercel-env.yml / staging env
- [x] Verified live Vercel state via VERCEL_ACCESS_TOKEN: plan=Hobby, 0 custom environments allowed, 3 system envs (production/preview/development), 19 env vars already per-target scoped
- [x] Confirmed the task's premise is FALSE at current tier: a named `staging` *custom environment* requires Pro ($20/mo), Hobby caps custom envs at 0 (API returns 400 "Cannot create more than 0 custom environments")
- [x] Designed the tier-honest path: long-lived `staging` git branch (Vercel auto-deploys as preview) + env vars scoped via `target=preview` + `gitBranch=staging` (free env-var API field, no plan change)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml + committed/pushed (commit f0332ed4, per Rule 11 protocol)
- [x] Extended .github/workflows/sync-vercel-env.yml with per-env scoping pattern (target array + gitBranch) + a staging-only vars block (commit 8ef4470d, staged for Owner push -- gh-token lacks `workflow` scope)
- [x] Wrote ai-os/STAGING_ENV_2026-07-20.md (design + live-infra ground truth + premise correction + 5-check staging-preview smoke test + open Owner items) + registered it in ai-os/OS.yaml (commit 8ef4470d)

## Remaining
- [x] Push the docs-only portion of V2-7 (STAGING_ENV doc + OS.yaml index + workflow patch + PROGRESS) -- this token CAN push non-workflow files (scopes: gist, read:org, repo)
- [ ] Owner applies `ai-os/v2-7-workflow-change.patch` with a workflow-scoped token (this token cannot push `.github/workflows/*.yml`). Documented in the PR body + §6 of the doc.
- [ ] PR open + CI green on the docs portion; Tier2 (workflow file) holds for Owner sign-off regardless of audit verdict.
