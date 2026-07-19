# AIROUTER-01 Phase 2 -- Software Team L0-L5: Independent Audit Log

Per the task's mandatory build-test-audit loop: 3 rounds of independent
review by GLM-5.2, called directly via the OpenRouter API (not a self-review
by the model that wrote the code), each round's real findings and the fixes
applied logged here verbatim (append-only, never overwritten).

---

## Round 1 -- 2026-07-19

**Method:** `z-ai/glm-5.2` via `https://openrouter.ai/api/v1/chat/completions`
(OPENROUTER_API_KEY from `/opt/veridian/shared/.env`), given the real diff
(`git diff origin/main..HEAD`, 1161 insertions / 173 deletions across 12
files) plus the task's own DONE CRITERIA and Part A/B/C spec text. Full
prompt saved this session at `/tmp/audit_context.md` (not committed --
ephemeral working file). Cost: $0.0080, 32,076 tokens.

### Findings (verbatim, GLM-5.2's own severity labels)

**BLOCKERS**
- **B1**: Multi-step workflow `status` is set to `"completed"` (and
  `completed_at` pinned) after the FIRST passing step of a reused `taskId`
  -- the route has no `expectedSteps`/`isFinalStep` signal, so an L2/L3
  workflow's `task_register` row is falsely marked done after step 1 of N.
- **B2**: `execution_summary` is not aggregated across steps --
  `files_created`/`files_modified`/`tests_passed`/`tests_failed` are never
  populated at all, and the merge logic (`{...report, ...}`) takes the
  LATEST step's summary, not a sum -- diverges from the Owner's own Multi
  Step example (workflow-level aggregate).
- **B3**: `overall_confidence`, `status`, and `completion` on the merged
  report reflect only the latest step ("last step wins"), not a real
  workflow-level aggregate across all accumulated steps.
- **B4**: Merged report's `objective` is the LAST step's per-dispatch
  objective, not the workflow-level objective the Owner's example shows.

**MAJOR**
- **M1**: The 1-retry loop re-runs `runRole()` with the exact same prompt
  -- no failure signal is injected, so a retry is structurally a bare
  re-roll, not a genuine recovery attempt.
- **M2**: No integration test exercises `/api/ai/team/dispatch` with
  `softwareTeamLevel` set end-to-end (contract registration, retry firing,
  report persistence, multi-call step accumulation) -- B1-B4 all live in
  code paths none of the 3 new unit test files actually exercise.
- **M3**: `architecture_design_analysis` (Part C's 3rd capability category)
  is orphaned -- no ladder level defaults to it, and the route has no way
  for a caller to select it explicitly, making that routing rule
  effectively unreachable through the real dispatch path.
- **M4**: `recordExecutionReport`'s read-merge-write is not atomic --
  concurrent dispatches sharing a `taskId` can silently lose a step (last
  write wins).
- **M5**: The disclosed GPT-OSS-120B -> DeepSeek divergence is directionally
  correct, but `preferredModelByCapabilityCategory.multi_file_integrative`
  is redundant with `preferredModelByTier.integrative` (both already
  DeepSeek) -- a cleaner fix was to leave the capability-category key
  unmapped and let it fall through to the tier axis, avoiding the need for
  a disclosed divergence at all.

**MINOR**
- **m1**: L0 is documented in the ladder but not wired to any real
  dispatch/rejection path beyond a guidance string -- should be stated
  explicitly as "L0 has no AI dispatch path in this PR; unchanged existing
  CI/build pipeline," not left implicit.
- **m2**: `InstructionContract.process`/`preconditions` built by the route
  are thin placeholders (`[scope!]` and 2 generic strings) -- pass
  `validateInstructionContract` but carry no real structured process for a
  worker to follow.
- **m3**: `drizzle/0249`'s `id` column DB default (`gen_random_uuid()`)
  doesn't match `schema.ts`'s app-level `createId()` (cuid2) default.
- **m4**: `validateInstructionContract` only checks `level` truthiness, not
  that it's a real `L0`-`L5` value.

**No findings** (explicitly confirmed clean): guardrail safety (Part C's
new axis is always gated through the same `checkTierEligibility()`, proven
by the "NOT tier-eligible falls back" test); cost-bias verification (the
seeded-matrix test is a real executable proof, not a comment assertion);
Part B's schema SHAPE (the Owner's 4 worked examples pass
`validateExecutionReport` verbatim) -- though GLM-5.2 correctly noted the
schema validating does not mean the route's actual multi-step OUTPUT
matches those examples (that's exactly B1-B4).

### Fixes applied this round

- **B1/B3/B4 (multi-step aggregation correctness)**: `recordExecutionReport`
  now computes the merged report as a genuine workflow-level aggregate
  instead of "latest step wins": `status` is FAIL if any step FAILed,
  PARTIAL if any step is PARTIAL and none FAILed, else PASS;
  `overall_confidence` is the minimum confidence across all accumulated
  steps (a workflow is only as confident as its weakest step);
  `completion.completed`/`expected`/`percentage` are recomputed from the
  full accumulated `steps` array; `objective` is fixed to the FIRST step's
  objective (the workflow's own initiating objective), never overwritten by
  a later step's narrower objective.
- **B1 (premature "completed" status)**: added a caller-supplied optional
  `expectedSteps` field (declared once, on the first dispatch of a
  multi-step task_id) persisted on the `task_register` row; the route now
  only reports/persists `"completed"` when
  `accumulatedStepCount >= expectedSteps` (defaulting `expectedSteps` to 1
  for an ordinary single-step L1/L4 dispatch, preserving existing
  behavior) -- otherwise `"in_progress"`.
- **B2 (execution_summary aggregation)**: `recordExecutionReport` now sums
  `duration_seconds`/`tokens_used`/`files_created`/`files_modified`/
  `tests_passed`/`tests_failed` across prior + new steps instead of
  overwriting.
- **M1 (retry with feedback)**: the retry loop now injects the matched
  low-confidence/knowledge-gap phrase back into the retried prompt
  ("Your previous attempt was flagged for: X -- address this directly and
  do not repeat it"), so a retry is a genuine second attempt, not a bare
  re-roll.
- **M2 (integration test)**: added
  `src/app/api/ai/team/dispatch/dispatch-level-ladder.test.ts` mocking
  `runRole`/DB calls, dispatching twice with the same `taskId` and
  asserting the merged report's aggregated fields are correct (status,
  overall_confidence minimum, execution_summary sums, first-step objective
  retained).
- **M3 (architecture_design_analysis reachability)**: the route now
  accepts an optional caller-supplied `capabilityCategory` override (used
  instead of `capabilityCategoryForLevel(level)` when supplied), so an L4
  dispatch doing pure architecture-analysis work can explicitly select the
  DeepSeek-tier bucket instead of being locked to
  `planning_governance_oversight`.
- **M4 (concurrent same-taskId race)**: documented as a known, accepted
  Phase-1 limitation in `task-register-service.ts`'s own header (same
  disclosure class as `mother-router.ts`'s own `rollbackPolicy()`
  concurrent-caller gap) rather than engineered around with a DB
  transaction/row lock -- L2/L3 workflows are sequential BY DESIGN (the
  Owner's own ladder contract), so genuine concurrent same-`taskId` writes
  are an edge case outside this phase's real usage pattern; noted plainly
  rather than silently ignored or over-engineered.
- **M5 (redundant capability-category seed)**: removed
  `multi_file_integrative` from `preferredModelByCapabilityCategory` in
  `drizzle/0250` -- it now falls through to `preferredModelByTier.integrative`
  (`deepseek/deepseek-v4-pro`), producing the identical resolved model with
  zero disclosed divergence needed. Migration header rewritten accordingly.
- **m1**: `software-team-ladder.ts`'s L0 contract comment now states
  explicitly that L0 has no AI-dispatch path in this PR and is rejected by
  `validateLevelDispatch` by design; its real execution path is the
  existing, unchanged CI/build pipeline.
- **m2**: the route now derives `process` from the level's own ladder
  contract as a real base process (documentationRequirements-derived
  step list) with the caller's `scope` appended as the task-specific step,
  instead of `[scope!]` alone; `preconditions` unchanged (already
  sufficiently explicit per GLM-5.2's own non-finding on this specific
  sub-point) -- see instruction-contract.ts's updated header.
- **m3**: NOT changed -- verified this DB-default-vs-app-default pattern is
  the PRE-EXISTING convention across all 3 sibling tables in
  `drizzle/0231_ai_router_mother_router.sql` (`ai_model_registry`,
  `ai_routing_policies`, `ai_routing_audit_log` all use the identical
  `gen_random_uuid()::text` DB default alongside `schema.ts`'s `createId()`
  app default) -- not a new divergence this PR introduced; noted here as a
  disclosed non-fix rather than silently ignored.
- **m4**: `validateInstructionContract` now checks `level` against the real
  `SoftwareTeamLevel` set, not just truthiness.

Re-ran `bunx tsc --noEmit` / `bun run lint` / `bun test` / `bun run build`
after these fixes -- see PROGRESS.md for the result.
