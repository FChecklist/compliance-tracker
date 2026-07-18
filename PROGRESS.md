# PROGRESS -- task-20260718-185248-rescue-pr--417

Rescuing PR #417 (worker/task-20260718-051002-ai-architecture--domain-accuracy---quali):
merge to current main, fix migration number collision, get CI green, audit, merge (if TIER1).

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml (no conflicting active claim found for this PR's file scope)
- [x] `gh pr checkout 417` (real head branch already held by another task's worktree -- fetched
      `refs/pull/417/head` into local branch `pr-417-work` instead, same commit)
- [x] `git fetch origin main && git merge origin/main --no-edit`
- [x] Resolved conflicts: `PROGRESS.md` (kept PR's own via `--ours`), `ai-os/CONSTITUTION.yaml`
      (both sides were independent appended `amendment_log` entries from concurrently-merged
      PRs -- kept both, no real conflict in substance)
- [x] Found and fixed a real migration number collision: this PR's own
      `drizzle/0224_erp_exchange_rates_source.sql` collided with
      `drizzle/0224_crm_accounts_contacts_actor_columns_no_fk.sql`, which landed on `main`
      via a different, concurrently-merged PR. Renumbered this PR's migration to
      `drizzle/0225_erp_exchange_rates_source.sql` (highest on main was 0224) and updated
      its 2 internal comment references (`erp-accounting-service.ts`, `schema.ts`). Notably
      this PR itself adds `scripts/check-migration-collision.mjs`, a new CI guard for exactly
      this class of collision -- confirmed it would have caught this.

- [x] `bunx tsc --noEmit` clean, `bun run lint` 0 errors (3 pre-existing warnings, unchanged),
      `bun test` 1480 pass / 0 fail
- [x] Ran all 6 governance/guardrail check scripts locally -- all pass (88/88 guardrail markers,
      metadata index, doc cross-refs, asset registry, doc quarantine banner, migration collision)
- [x] Investigated originally-failing "Promptfoo Evals" CI check: `Error: Cannot find module
      'ajv/dist/compile/codegen'` from `ajv-formats` under bun's node_modules layout (bun hoists
      ajv@6.14.0 for eslint, but ajv-formats needs ajv@8+). Verified independently (not just
      trusting the PR's own claim) by running the identical `bun run test:prompts` in a fresh
      `git worktree` of `origin/main` alone, no PR changes applied -- same exact error. Confirmed
      pre-existing and unrelated to this PR. Also confirmed via `gh api .../branches/main/protection/required_status_checks`
      that "Promptfoo Evals" is NOT in the required-checks list (only Lint, Type Check, Build,
      audit-check, Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests are) --
      matches the workflow file's own header, which documents this as a deliberately
      non-blocking check pending an Owner branch-protection decision. Does not block merge.
- [x] Pushed merged branch to `worker/task-20260718-051002-ai-architecture--domain-accuracy---quali`
      (`d653a947`)

## Remaining
- [ ] Read full PR diff, post structured AUDIT PASS/FAIL comment
- [ ] Wait for required CI checks green
- [ ] Classify TIER (this PR touches drizzle/0225 migration + schema.ts -- TIER2 -- do NOT merge)
- [ ] Report final status
