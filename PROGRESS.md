# PROGRESS -- task-20260718-124002-retry-0--ai-model-lifecycle---benchmark

Task: VERIDIAN Review Framework gap-closure -- "AI Model Lifecycle &
Benchmarking / Deprecation & Rollback" (1 High finding): "Deprecation/
rollback is a manual git-revert process, not an automated mechanism."
Recommended approach: add an emergency-revert config flag.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance pointers and
      `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no existing/stale claim on this
      finding or on `src/lib/orchestra-model-resolver.ts`; nothing to
      collide with.
- [x] Investigated the actual current implementation before assuming the
      finding's description still holds. There is no dedicated "AI Model
      Lifecycle" module/page in this codebase -- the real, single choke
      point every platform-default LLM model decision goes through is
      `src/lib/orchestra-model-resolver.ts` (its own doc comments already
      call it out as such: "the one real choke point every product_orchestra
      dispatch resolves a model through"). Confirmed the gap is real: before
      this change, walking back a bad platform-default/escalation model swap
      (`PLATFORM_DEFAULT_MODEL`, `ESCALATED_MODEL`, or a layer's own
      `default_model_config` row) required editing the source and a full
      redeploy -- exactly the "manual git-revert" gap described, not
      already resolved by any existing mechanism.
- [x] Implemented the recommended fix: `getEmergencyModelRevert()` in
      `orchestra-model-resolver.ts`, reading a new `AI_MODEL_EMERGENCY_REVERT`
      env var (`"<provider>:<model>"`, e.g. `"groq:openai/gpt-oss-120b"`).
      Wired into every real platform-default/escalation resolution path:
      `resolveModelConfig()`'s non-BYO branch, `resolvePlatformModelConfig()`'s
      default branch, and `escalatedPlatformConfig()`. Flipping this one env
      var now force-pins every one of those paths to a known-good model
      immediately, no deploy/git-revert required; unset it to resume normal
      resolution. Deliberately does NOT touch an org's own BYO
      `customerModelConfig`/`clientModelConfig` row (verified with a
      dedicated test) -- this is a platform-operator emergency brake for the
      platform's own default/escalation models, never a silent override of
      an org's explicit configuration, matching this file's existing
      BYO-respecting posture elsewhere.
      Malformed/unrecognized values are ignored (logged once, not silently)
      rather than crashing resolution.
- [x] Added 12 new tests to `orchestra-model-resolver.test.ts` covering
      `getEmergencyModelRevert()` parsing (valid, blank, unset, no
      separator, empty model, unrecognized provider, colon-containing
      OpenRouter-style model ids) and its wiring into all three resolution
      paths, including the "does not override BYO" and "unset is a complete
      no-op" cases. Full suite: 34/34 pass.
- [x] `bunx tsc --noEmit` clean, `bunx eslint` clean on both touched files.
- [x] Did not touch `permission-service.ts`'s `ERP_ACTION_ROLES` table or any
      other in-flight worker's scope -- this change is confined to
      `orchestra-model-resolver.ts` and its test file.

## Remaining
- [ ] None. Ready for PR + CI (Rule 6).
