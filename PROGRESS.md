# PROGRESS -- task-20260718-062002-ai-cost-governance---finops--cost-monito

VERIDIAN Review Framework gap-closure: AI Cost Governance & FinOps / Cost
Monitoring & Forecasting (4 findings).

## Completed

- [x] Registered active claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting (Rule 11).
- [x] Read the real current implementation first (`cost-guard.ts`, `token-usage-service.ts`, `customerModelConfig`/`clientModelConfig`, `orchestra-model-resolver.ts`'s existing idle-detection precedent) before writing any code.
- [x] **Cost anomaly detection** (Medium): new `src/lib/services/cost-anomaly-service.ts` — ratio-based recent-vs-baseline deviation check, per org (tenant, `scope='product_orchestra'`) and per AI-Team role (`scope='ai_team_internal'`), sourced from the real `token_usage_ledger`. Simple/explainable per the finding's own recommended approach: `recentSpend / baselineAvgDaily >= 3x` (default), with a `$1` minimum-spend floor to avoid flagging trivial noise, plus a distinct "new spender" case (real spend above the floor with zero baseline). Pure `classifyAnomaly()` unit-tested (7 tests); DB wrapper `detectCostAnomalies()` not unit-tested, matching this codebase's established pure/DB-touching test split. New cron entry point `GET /api/internal/cost-anomalies/run` (`CRON_SECRET`-gated, same pattern as every other `/api/internal/*/run` route) + daily `vercel.json` cron line. No dashboard/inbox surface yet — honestly disclosed scope limit, same posture as `ai-performance-report-service.ts` and its sibling cadence reports.
- [x] **Forecasted vs actual monthly AI spend** (Medium): new shared pure module `src/lib/spend-forecast.ts` (linear run-rate projection: `spend-to-date / days-elapsed * days-in-month`), unit-tested (11 tests). Wired into two real, already-live surfaces rather than building a new dashboard:
  - Per-org: `cost-guard.ts`'s `CostStatus` gained `forecastedMonthEndSpendUsd`, computed in `getCostStatus()`. Surfaced in the existing `OrgLimitsSection.tsx` settings UI (already the real, live admin surface for `cost-guard.ts` — `GET/PATCH /api/settings/org-limits`) as "Forecasted (linear run-rate): ~$X by month end" plus an "On pace to exceed cap" badge when the forecast crosses a configured cap the org isn't over yet.
  - Platform-wide: `token-usage-service.ts`'s `TokenUsageSummary` (the existing veridian_admin-gated `GET /api/ai/team/token-usage` Finance report) gained `platformMonthlyForecast`, via new `getPlatformMonthlyForecast()`.
- [x] **Unused/idle AI capacity identified** (Low): new `src/lib/services/idle-ai-capacity-service.ts`. `customerModelConfig` (org/Layer-2) and `clientModelConfig` (client/Layer-3) rows with a real configured API key ARE this schema's "provisioned AI capacity" records, and both already carry `lastUsedAt` for exactly this purpose (same field `orchestra-model-resolver.ts`'s `borrowFromSharedPool()` already reads to compute idleness for a different, 5-minute-cutoff question). Idle = unused (or never used since `createdAt`) for 90+ days (quarterly). Pure `classifyIdleCapacity()` unit-tested (4 tests); DB wrapper `findIdleAiCapacity()` not unit-tested. New cron entry point `GET /api/internal/idle-ai-capacity/run` + quarterly `vercel.json` cron line (`0 10 1 1,4,7,10 *`). Per the finding's own recommended approach ("simple quarterly query, not worth dedicated tooling at current scale") — one deterministic query, no new table, no dashboard.
- [x] Verified: `bunx tsc --noEmit` clean; `bunx eslint` clean on every new/changed file; full `bun test` — 1443 pass / 0 fail (was already passing before this change; no regressions).
- [x] No schema/migration changes — every column needed (`customerModelConfig.lastUsedAt`, `clientModelConfig.lastUsedAt`, `tokenUsageLedger.*`, `organisations.monthlyCostCapUsd`) already existed.
- [x] Did not touch `permission-service.ts` or any other in-flight worker's declared scope (checked `ai-os/boss/ACTIVE-CLAIMS.yaml` first — no overlap found).

## Deferred (documented, not implemented)

- [ ] **FinOps dashboard reconciles engineering cost claims against Finance's ledger** (Medium) — deferred per the finding's own recommended approach ("Defer unless spend scale or an audit requirement justifies building a second independent estimate"). `token-usage-service.ts`'s `token_usage_ledger` already **is** a real, single spend ledger (Finance's own source of truth, per that file's header) — but there is no second, *independent* engineering-side cost estimate anywhere in this codebase to reconcile it against (the closest analog, `docs/analysis/cost-estimate-5org-50user.md`, is a one-off manual guesstimate produced by a different worker session for a different purpose, not a live/automated second source). Building a real independent estimator (e.g. deriving expected cost from `orchestra_executions` row counts × per-layer model pricing, cross-checked against the ledger's own `estimatedCostUsd`) is a genuinely separate, non-trivial piece of work whose ROI depends on spend scale/audit requirements this codebase doesn't currently have evidence for. Not built speculatively here — left explicitly open rather than closed with a token/fake reconciliation.

## Remaining

- [ ] None of the 4 findings' recommended-scope work remains open — 3 closed with real code, 1 explicitly deferred above.

## Rescue (task-20260718-195944-rescue-pr--424)

- [x] Registered rescue claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`.
- [x] `gh pr checkout 424` (worktree conflict with original branch worked around via `git fetch origin <branch>:pr-424-local`).
- [x] Merged `origin/main` (real conflicts: `PROGRESS.md` kept ours; `ai-os/boss/ACTIVE-CLAIMS.yaml` — additive, kept both blocks + this rescue entry).
- [x] Confirmed no `drizzle/*.sql` or `src/lib/db/schema.ts` changes in this PR's diff vs main — TIER1.
- [x] `bun install --frozen-lockfile && bunx tsc --noEmit && bun run lint && bun test` — clean/clean/0 errors/1519 pass.
- [x] Pushed merged branch; posted structured `AUDIT: PASS` PR comment (all 8 fields).
- [x] Mandatory Audit Check job had run before the comment existed (failed); re-ran it after posting — passed.
- [x] Main moved again mid-rescue (PR #422, "proactive AI cost-ceiling alerts", also touching `cost-guard.ts`) — merged a second time; `cost-guard.ts` auto-merged cleanly (additive, non-overlapping: PR #422 added `checkCostCeilingBreaches`/`classifyCostBreach`, this PR added `forecastedMonthEndSpendUsd` — both coexist). Re-ran full verification after this second merge — still 0 errors/1519 pass. Re-pushed, all CI green including audit-check.
- [x] Main moved a third time (PR #422's own rescue-claim chore commit) — merged again, content-only conflicts (PROGRESS.md/ACTIVE-CLAIMS.yaml), no source overlap. Re-verified clean, re-pushed, CI green again.
- [x] Merged (squash + delete branch) — TIER1, CI green, audit PASS. Squash commit `cc1af35d`.
- [x] Moved rescue claim from `active:` to `recently_completed:` in `ai-os/boss/ACTIVE-CLAIMS.yaml`.
