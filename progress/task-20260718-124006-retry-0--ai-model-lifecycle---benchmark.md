# task-20260718-124006-retry-0--ai-model-lifecycle---benchmark

## Context
This task had never made real progress before invocation 14: every prior
run (2026-07-18 through 2026-07-20) either exited with code 1 immediately,
or was pre-flight-blocked by credit-accountant.py on a real negative
OpenRouter balance (task.yaml's own checkpoint history). Resumed
2026-08-15 once credit was confirmed restored (governing UMR-20260806-
071025-1d28). No prompt.txt existed in this workspace; the task's real
scope was derived from its title against PLATFORM_STRATEGY.md 30.2's own
Agent Performance (APR) row, which documented exactly this gap: "no
hallucination-score or cost field yet" on model-scorecard-service.ts, and
a model-granularity gap in the periodic lifecycle-review cycle (Agent
Review/ARR only ever covered role_key granularity).

Checked ai-os/boss/ACTIVE-CLAIMS.yaml before starting -- no active claim
on this gap/file area. Registered this session's own claim under
`active:`/`recently_completed:` (see commit).

## Completed
- [x] Investigated PLATFORM_STRATEGY.md 30.2, model-scorecard-service.ts,
      token-usage-service.ts, agent-review-service.ts before writing
      anything -- confirmed cost is real/computable (token_usage_ledger
      already has a `model` column) and hallucination-score genuinely is
      not (no persisted per-dispatch correctness-scoring signal anywhere).
- [x] `model-scorecard-service.ts`: added `attachModelCost()` (pure,
      merges real token_usage_ledger spend by model, honestly not
      tier-split -- COST_GRANULARITY_NOTE) and `hallucinationScore`
      (honest null + HALLUCINATION_SCORE_NOTE, never fabricated). Wired
      into `getModelScorecard()`.
- [x] `src/lib/db/schema.ts` + `drizzle/0225_model_lifecycle_reviews.sql`:
      new append-only `model_lifecycle_reviews` table, mirrors
      `agent_review_records`' shape at model instead of role_key grain.
- [x] `model-lifecycle-service.ts` (new): `mergeEscalationByModel()`,
      `toLifecycleMetrics()`, `runModelLifecycleReviewCycle()`,
      `getModelLifecycleHistory()`, `getLatestModelLifecycleReviews()`,
      `getModelsNeedingTrustTierReconsideration()`,
      `getModelsNeedingUrgentReview()`. Reuses
      `agent-review-service.ts`'s `computeReviewRates()`/
      `computeReviewVerdict()` unmodified (confirmed granularity-agnostic)
      rather than re-implementing the same threshold math.
- [x] `src/app/api/ai/team/model-lifecycle/route.ts` (new): veridian_admin
      -gated GET+POST, matches `/review-registry`'s API-only convention.
- [x] Tests: `model-lifecycle-service.test.ts` (new, 9 tests) +
      additions to `model-scorecard-service.test.ts` (12 new tests) --
      deliberately did NOT re-test `computeReviewRates`/
      `computeReviewVerdict`'s own threshold math (already covered in
      `agent-review-service.test.ts`).
- [x] `ai-os/registry/asset-registry-coverage.yaml`: exempted
      `model_lifecycle_reviews` (same reasoning as `agent_review_records`).
- [x] `PLATFORM_STRATEGY.md` 30.2 (APR row) + 30.4 (new 2026-08-15 status
      note) updated.
- [x] `ai-os/MASTER-TRACKER.yaml` closed_priorities #26 added.
- [x] `ai-os/boss/ACTIVE-CLAIMS.yaml`: claim registered directly under
      `recently_completed:` (work completed within this single session).
- [x] Verification: `bunx tsc --noEmit` clean (0 errors, run with
      `NODE_OPTIONS=--max-old-space-size=4096` -- this box's default V8
      heap OOMs on the full project graph regardless of this change).
      `eslint` clean on every new/changed file. `bun test`: 1437 pass / 0
      fail across 104 files. `check-asset-registry-coverage.mjs` /
      `check-guardrail-presence.mjs` / `check-metadata-index-coverage.mjs`
      / `check-doc-cross-references.mjs` / `check-doc-quarantine-banner.mjs`
      / `check-migration-collision.mjs` all pass.

## Honestly NOT done / flagged
- `drizzle/0225_model_lifecycle_reviews.sql` is NOT applied live -- this
  headless worker session has no `DATABASE_URL`/Supabase MCP access
  (confirmed empty). A session with live DB access needs to apply it
  before `/api/ai/team/model-lifecycle`'s DB-backed reads/writes work.
- Iteration count and hallucination-score both remain genuinely not
  computable from any persisted data -- documented via existing/new
  `*_NOTE` constants, not fabricated.
- No automated cron trigger for the review cycle (same honestly-deferred
  posture as `/review-registry` -- this repo has already hit the Vercel
  Hobby plan's once-per-day cron limit).
- Not merged by this session per standing dispatch instructions -- PR
  opened, left for the supervising session's audit.

## Remaining
- None for this task's own scope. Follow-on (live migration apply, and
  eventually a cron trigger for both review cycles) belongs to whichever
  session has the infrastructure access this one didn't.
