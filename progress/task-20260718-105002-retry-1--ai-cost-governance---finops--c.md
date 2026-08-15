# PROGRESS -- task-20260718-105002-retry-1--ai-cost-governance---finops--c

## Task
VERIDIAN Review Framework gap-closure: AI Cost Governance & FinOps / Cost
Monitoring & Forecasting -- 4 findings (per `prompt.txt`):
1. [Medium] Cost anomaly detection (tenant/role spend spike vs baseline)
2. [Medium] Forecasted vs actual monthly AI spend
3. [Medium] FinOps dashboard reconciles engineering cost claims against
   Finance's ledger
4. [Low] Unused/idle AI capacity identified

## Finding: already closed, duplicate dispatch

Per this task's own instructions ("read the actual current implementation
first ... if a finding turns out to already be resolved, say so"): all 4
findings are already resolved on `origin/main`, closed by a **different,
earlier** dispatch of the identical gap set
(`worker/task-20260718-062002-ai-cost-governance---finops--cost-monito`),
merged as **PR #424** ("AI Cost Governance & FinOps: anomaly detection,
spend forecast, idle capacity", merged 2026-07-18T20:20:50Z, merge commit
`cc1af35d6`) -- before this task's own 15th invocation ever did real work.
`ai-os/boss/ACTIVE-CLAIMS.yaml` independently confirms the same PR #424
history (original claim, then two separate "rescue PR #424" claims for CI
fixes), and PR #1209 (open, docs-only) is itself titled "chore: reconcile
stale ACTIVE-CLAIMS.yaml entry (AI Cost Governance & FinOps task, already
merged as PR 424)" -- the same conclusion, reached independently by an
earlier session.

Verified directly against real code on `origin/main` (fetched, not assumed
from commit message):
- `src/lib/services/cost-anomaly-service.ts` (+ `.test.ts`) -- finding 1.
  Ratio-based recent-vs-baseline daily spend deviation per org (tenant) and
  per AI-Team role, sourced from `token_usage_ledger`, min-spend floor
  ($1) to avoid noise, explicit "new spender" case (no baseline to divide
  by) instead of NaN/Infinity. Matches the finding's own recommended
  approach verbatim ("simple ratio-based deviation check first").
- `src/lib/spend-forecast.ts` (+ `.test.ts`) -- finding 2. Pure linear
  run-rate projection (`spend-so-far / days-elapsed * days-in-month`),
  reused by both `cost-guard.ts` (per-org `CostStatus`, surfaced in
  `OrgLimitsSection.tsx`) and `token-usage-service.ts` (platform-wide
  Finance report). Matches "simple linear run-rate projection first."
- `src/lib/services/idle-ai-capacity-service.ts` (+ `.test.ts`) --
  finding 4. Reuses `customerModelConfig`/`clientModelConfig`'s existing
  `lastUsedAt` (already read for a related purpose in
  `orchestra-model-resolver.ts`'s `borrowFromSharedPool()`) to flag
  provisioned BYO AI capacity unused for 90+ days. One deterministic
  query, no new tracking table -- matches "simple quarterly query, not
  worth dedicated tooling."
- Finding 3 (FinOps-dashboard-vs-Finance-ledger reconciliation) is
  explicitly **deferred** in PR #424's own commit message, with the
  reasoning "no second independent engineering cost estimate exists yet
  to reconcile against" -- this is exactly finding 3's own recommended
  approach ("Defer unless spend scale or an audit requirement justifies
  building a second independent estimate"). Confirmed no such second
  estimate has since appeared for this specific reconciliation gap: the
  open PRs under the *separate* "AI Cost Governance & FinOps / Cost
  Visibility" gap (#687, #1046, #1212 -- per-tenant UI + invoice
  reconciliation) are a different sub-area of the same framework category,
  not this finding, and remain independently tracked/claimed elsewhere.

Also confirms `src/lib/services/permission-service.ts`'s
`ERP_ACTION_ROLES` table was not touched by this or the prior closure --
no conflict with this task's stated out-of-scope instruction.

No code change made: making one would either duplicate PR #424's real,
already-merged, already-tested implementation, or re-open a
finding (3) whose own recommended approach is to defer it and which is
still correctly deferred. `bun test` was not re-run project-wide since no
source was touched.

## Completed
- [x] Read `prompt.txt` (real task spec) and cross-checked against
      `ai-os/boss/ACTIVE-CLAIMS.yaml` history for this gap.
- [x] Verified (via `gh pr view 424` + `git fetch origin main` +
      direct file reads on `origin/main`) that all 3 actionable findings
      are implemented and merged, and the 4th is correctly, explicitly
      deferred per its own recommended approach.
- [x] Confirmed no other in-flight PR duplicates this specific
      sub-area (Cost Monitoring & Forecasting) -- the 3 other open
      FinOps PRs are the separate Cost Visibility sub-area.
- [x] Documented finding here; no PROGRESS.md edit (shared/contaminated
      file across concurrent worktree sessions -- see
      `[[veridian-task-yaml-checkpoint-cross-contamination]]` /
      `[[veridian-shared-worktree-stash-risk]]` in memory; it currently
      belongs to an unrelated concurrent RCA task and touching it here
      would risk clobbering that task's real state, matching the
      precedent set by the immediately-preceding duplicate-dispatch
      closure commits in this same shared worktree).

## Remaining
- [ ] None. Task complete: no code change required, closing as
      duplicate-dispatch of already-merged PR #424 (findings 1/2/4) +
      already-correctly-deferred finding 3.
