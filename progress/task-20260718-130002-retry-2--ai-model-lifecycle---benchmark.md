# PROGRESS -- task-20260718-130002-retry-2--ai-model-lifecycle---benchmark

Task: VERIDIAN Review Framework gap-closure -- AI Model Lifecycle &
Benchmarking / Deprecation & Rollback.

Finding (High): "Model deprecation/rollback process defined" -- gap was that
deprecation/rollback is a manual git-revert process, not an automated
mechanism. Recommended approach: add an emergency-revert config flag.

## Completed
- [x] Read the actual current implementation of
      `src/lib/orchestra-model-resolver.ts` first, per the task instructions,
      instead of assuming the gap description was still accurate. Confirmed
      the gap is real: the platform-default model
      (`PLATFORM_DEFAULT_PROVIDER`/`PLATFORM_DEFAULT_MODEL` plus each
      Orchestra Layer's own `defaultModelConfig`) was a hardcoded
      constant/DB row with no runtime override -- reverting a broken model
      required a code edit + PR/CI/redeploy cycle, too slow for a live
      provider incident.
- [x] Implemented `emergencyRevertOverride()`: reads `MODEL_EMERGENCY_REVERT`
      (a live env var, `provider:model` format) fresh on every call, no
      code change/PR/redeploy needed to flip it. Validates the provider
      against the real `LLMProvider` union and requires a non-empty model;
      invalid/malformed values are ignored with a `console.warn`, never
      thrown.
- [x] Wired the override into both `resolveModelConfig()` and
      `resolvePlatformModelConfig()`'s platform-default branches, taking
      priority over both the hardcoded `PLATFORM_DEFAULT_*` constants and
      any per-layer `defaultModelConfig` -- a single global "get everyone
      off the broken model now" switch, not a per-layer knob.
- [x] Deliberately did NOT touch an org's own BYO `customer_model_config`
      (`isCustomerConfigured: true`) path -- same boundary the existing
      `ESCALATED_MODEL` override already respects. Covered by a dedicated
      test (`never overrides an org's own active BYO customer_model_config
      during a platform-wide revert`).
- [x] Did not touch `src/lib/services/permission-service.ts` or any other
      in-flight worker's declared scope (per task instructions) -- this
      finding's fix is fully self-contained in the model-resolver module,
      no permission-service entry was needed.
- [x] Added 10 new tests in `orchestra-model-resolver.test.ts` covering:
      unset env (no-op/default), valid parse, model names containing their
      own colon (OpenRouter-style ids), invalid provider (warns, doesn't
      throw), missing separator, empty model, override applied end-to-end
      through `resolveModelConfig()`, BYO-config exemption, and an explicit
      regression guard for the unset-env case resolving exactly as before.
- [x] Verified: `bun test src/lib/orchestra-model-resolver.test.ts` -- 31
      pass / 0 fail. `NODE_OPTIONS="--max-old-space-size=4096" bunx tsc
      --noEmit` -- 0 errors (plain `bunx tsc --noEmit` OOMs on this box
      regardless of this change; raising heap size resolves it). `bun run
      lint` -- 0 errors, 3 pre-existing warnings unrelated to this file.
- [x] Found and corrected a cross-contamination bug from a prior invocation
      of this same task: the shared repo-root `PROGRESS.md` (which belongs
      to a *different*, unrelated in-flight task --
      "cost-estimate-5org-50user") had been overwritten with a stub for
      this task. Reverted `PROGRESS.md` to its prior committed content
      (`git checkout -- PROGRESS.md`) and moved this task's own progress
      tracking to this per-task file instead, per the current resume
      protocol (do not edit or recreate the shared `PROGRESS.md`; maintain
      `progress/<task-id>.md`). Also removed a stray `.scratch/` directory
      of ad-hoc diff dumps left over from the same prior invocation.

- [x] Committed (`e1c9de23f`), pushed
      `worker/task-20260718-130002-retry-2--ai-model-lifecycle---benchmark`,
      and opened PR #1269 against `main`:
      https://github.com/FChecklist/compliance-tracker/pull/1269

## Remaining
- [ ] Await green CI on PR #1269, then merge (Rule 6: no direct
      push/merge to `main`, PR + green CI required -- this session does
      not merge without that).
