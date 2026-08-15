# PROGRESS -- task-20260718-130006-retry-2--ai-model-lifecycle---benchmark

VERIDIAN Review Framework gap-closure: "AI Model Lifecycle & Benchmarking / Ongoing Quality
Monitoring" (3 findings). Prior invocations (14-16) of this task had already produced real,
uncommitted code (schema + services + routes) sitting in the worktree -- this invocation
picked that work up, verified it rather than assuming it was correct, registered the
ai-os/boss/ACTIVE-CLAIMS.yaml claim that was still missing, and is committing it.

## Investigation (re-verified before trusting the prior invocations' uncommitted work)

- Read `ai-os/boss/ACTIVE-CLAIMS.yaml` and confirmed the sibling task
  `task-20260718-124004-retry-0--ai-model-lifecycle---benchmark` (same parent gap area) is
  scoped to a *different* sub-finding set ("Evaluation & Promotion Process" -- roster.ts
  rollout/shadow-testing + a promotion-eval CI check), disjoint file scope from this task's
  work. No collision; added this task's own claim entry (was missing).
- Confirmed via each new file's own header comments (already written by a prior invocation,
  cross-checked against the real code) that this is not a duplicate of:
  - `model-scorecard-service.ts` (GAP-MODEL-SCORECARD) -- dispatch-outcome signal, not
    content-quality scoring.
  - `agent_review_records` (GAP-AI-WORKFORCE-GOVERNANCE) -- deterministic promote/retrain
    verdict from the same dispatch-outcome signals, not content-quality either.
  - No existing table/query anywhere joins cost data with a quality signal, or records a
    provider-outage window. Verified myself: grepped `schema.ts` for `roleQualitySnapshots`/
    `providerOutageWindows` (both new, added by the prior invocation) and confirmed every
    field referenced by the 3 new services against the real schema definitions (activityLog,
    orchestraExecutions, tokenUsageLedger) -- all real, no typos/drift.
- Verified all imports/exports resolve: `getRole`/`operationalRoles` (roster.ts),
  `runRole` (team-service.ts), `getPreferredUpstreamProvider` (llm-client.ts, new export),
  `db`/table exports (`src/lib/db/index.ts` re-exports `./schema`).
- Verified the 3 new API routes follow this codebase's established `veridian_admin`-gate
  pattern (`requireAuth()` + `dbUser.role !== "veridian_admin"`), matching
  `/api/ai/team/scorecard`, `/api/ai/team/token-usage`, `/api/ai/team/executive-review`.

## Completed

- [x] Registered this task's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (was missing from prior
      invocations' work).
- [x] Verified (by reading in full, not assuming) all pre-existing uncommitted work from prior
      invocations is real and correct:
      - `src/lib/db/schema.ts`: `roleQualitySnapshots` (Finding 1) + `providerOutageWindows`
        (Finding 3) tables, platform-level (raw `db`), matching `model-scorecard-service.ts`'s
        posture.
      - `drizzle/0225_model_lifecycle_benchmarking.sql`: matching migration, NOT applied live
        (left for the supervising session, standing convention in this file).
      - `src/lib/llm-client.ts`: additive `getPreferredUpstreamProvider()` export, reusing
        `OPENROUTER_PROVIDER_PREFERENCE` (no second copy of that map).
      - `src/lib/services/model-quality-regression-service.ts` (Finding 1): deterministic
        assertion-based probe scoring (no LLM-judge call -- avoids doubling cost / avoids the
        judge itself being subject to the same drift it's meant to detect), regression
        threshold, DB-shell + pure-core split, live wrapper piggybacked on the existing daily
        loop cron.
      - `src/lib/services/model-cost-quality-service.ts` (Finding 2): pure join of
        `token_usage_ledger` x `role_quality_snapshots` by model, cost-per-quality-point,
        Infinity-vs-null handled explicitly (0-score model with real cost vs. never-scored
        model).
      - `src/lib/services/provider-outage-correlation-service.ts` (Finding 3): correlates
        recorded outage windows against 2 real failure sources (AI Dev Team `activity_log`
        resolved to upstream vendor via `getPreferredUpstreamProvider`, and Orchestra Layer's
        own `provider` column), baseline-vs-during-window failure rate.
      - 3 new API routes (`/api/ai/team/{quality-regression,cost-per-quality,
        outage-correlation}`), `veridian_admin`-gated, matching established route conventions.
- [x] Cross-checked every DB field referenced by the new services against the real
      `schema.ts` definitions (`activityLog.roleKey`/`activityType`/`lifecycleStage`,
      `orchestraExecutions.provider`/`model`/`status`, `tokenUsageLedger.scope`/
      `estimatedCostUsd`) -- all real, correctly named.
- [x] `bunx tsc --noEmit` -- started in background (`NODE_OPTIONS=--max-old-space-size=6144`;
      the default heap OOMs on this repo's full-project typecheck, a known issue the sibling
      task independently hit too). Given this shared box's real, previously-incident-causing
      load (multiple concurrent tsc/next-build processes from sibling tasks observed via
      `ps aux` during this invocation), this did not finish within this invocation's window.
      Static review substituted: read every new/changed file in full and manually verified
      every cross-file reference (imports, exported functions, schema columns) resolves
      correctly against the real current source -- no additional errors expected, but the
      background typecheck should be checked by the next invocation/reviewer before this is
      treated as fully verified.
- [x] Committed the real code (schema, migration, llm-client export, 3 services, 3 routes) --
      see git log. Not yet pushed/PR'd within this invocation (see Remaining).

## Remaining

- [x] Confirmed the background `bunx tsc --noEmit` run finished clean: exit code 0, empty
      output, full project (`NODE_OPTIONS=--max-old-space-size=6144`).
- [x] Committed (326b57dd6) and pushed
      `worker/task-20260718-130006-retry-2--ai-model-lifecycle---benchmark`.
- [x] Opened PR #1284 (https://github.com/FChecklist/compliance-tracker/pull/1284) against
      `main`. Not self-merged; no AUDIT verdict posted -- left for the supervising session's
      audit per this repo's standing convention.
- [ ] `bun run lint` and `bun test` (full suite) were NOT run this invocation -- every attempt
      timed out under the shared box's sustained heavy concurrent load (multiple sibling
      tasks' `tsc`/`next build` processes observed live via `ps aux`; even plain `git status`
      intermittently took >2 minutes). Disclosed in the PR body rather than silently skipped.
      CI's own lint/test jobs are the real gate before merge.
- [ ] Migration `drizzle/0225_model_lifecycle_benchmarking.sql` intentionally NOT applied to
      the live DB by this session -- left for the supervising session.
