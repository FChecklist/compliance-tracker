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

## Remaining
- [ ] Run `bun install --frozen-lockfile && bunx tsc --noEmit && bun run lint && bun test` on
      merged branch, fix any real failures
- [ ] Push merged/fixed branch
- [ ] Read full PR diff, post structured AUDIT PASS/FAIL comment
- [ ] Wait for CI green
- [ ] Classify TIER (this PR touches drizzle/0225 migration + schema.ts -- likely TIER2)
- [ ] Report final status
