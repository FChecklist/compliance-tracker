# PROGRESS -- task-20260718-124002-retry-0--ai-model-lifecycle---benchmark

Task: VERIDIAN Review Framework gap-closure -- "AI Model Lifecycle &
Benchmarking / Deprecation & Rollback" (1 High finding): "Deprecation/
rollback is a manual git-revert process, not an automated mechanism."
Recommended approach: add an emergency-revert config flag.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance pointers and
      `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no existing/stale claim on this
      finding.
- [x] Investigated the actual current implementation before assuming the
      finding's description still holds. Found the real, single choke point
      every platform-default LLM model decision goes through:
      `src/lib/orchestra-model-resolver.ts`.
- [x] **Important finding discovered mid-task, after merging in the several
      weeks of `main` history this stale workspace had missed**: this gap
      is NOT untouched. Two substantial pieces of real prior work already
      address large parts of it:
      1. `platform.ai_model_registry` (schema.ts) + `getRoleModel()` in
         `orchestra-model-resolver.ts` itself -- a DB-backed, named-role
         (`platform_default`/`platform_fallback`/`cerebras_failover`/
         `escalated_default`) override table with a `status` enum
         (active/disabled/deprecated). A DB insert now changes the live
         model for a role, no deploy required. This alone already replaces
         "manual git-revert" with a DB write for the platform-default path.
      2. `src/lib/ai-router/mother-router.ts` -- a separate, versioned
         `ai_routing_policies` table (per-scope, `version` + `isActive`)
         plus a real, explicitly-named **"Emergency rollback"** section:
         `rollbackPolicy(scope, toVersion)` flips `is_active` back to a
         prior version transactionally and invalidates the in-process
         cache immediately. This is real prior automated-rollback work.
      Neither of these is the literal "config flag" the recommended
      approach asked for, though: both require DB write access plus
      specific knowledge (a correct registry row, or an exact prior policy
      version number) -- real operations, not a single flip-and-done
      switch, and `rollbackPolicy()` has no admin API/UI route wired to it
      yet (server-side-callable only). Confirmed via `git grep` that no
      `AI_MODEL_EMERGENCY_REVERT`-shaped flag existed anywhere in the repo
      before this change.
- [x] Implemented the literal recommended fix as a genuinely complementary,
      not duplicate, addition: `getEmergencyModelRevert()` in
      `orchestra-model-resolver.ts`, reading a new `AI_MODEL_EMERGENCY_REVERT`
      env var (`"<provider>:<model>"`, e.g. `"groq:openai/gpt-oss-120b"`).
      Checked BEFORE the registry lookup even runs (so it still works if
      the registry itself is what's broken) and wired into every real
      platform-default/escalation resolution path: `resolveModelConfig()`
      non-BYO branch, `resolvePlatformModelConfig()` default branch, and
      `escalatedPlatformConfig()`. Flipping this one env var force-pins all
      three immediately, no deploy or DB write required; unset it to resume
      normal (registry-then-hardcoded-fallback) resolution.
      Deliberately does NOT touch an org's own BYO `customerModelConfig`/
      `clientModelConfig` row (verified with a dedicated test) -- a
      platform-operator emergency brake only, never a silent override of an
      org's explicit configuration.
      Malformed/unrecognized values are ignored (logged once) rather than
      crashing resolution.
- [x] Added 12 new tests to `orchestra-model-resolver.test.ts` covering
      `getEmergencyModelRevert()` parsing and its wiring into all three
      resolution paths, including "does not override BYO" and "unset is a
      no-op". Full suite: 34/34 pass.
- [x] `bunx tsc --noEmit` clean, `bunx eslint` clean on both touched files.
- [x] Did not touch `permission-service.ts`'s `ERP_ACTION_ROLES` table or
      any other in-flight worker's scope -- confined to
      `orchestra-model-resolver.ts` and its test file.
- [x] Merged several weeks of `origin/main` history into this branch
      (workspace was stale since 2026-07-18) to resolve the conflicts that
      surfaced from the discovery above; re-applied this change cleanly on
      top of the current `getRoleModel()`/registry-aware resolver.

## Remaining
- [ ] None. Ready for PR + CI (Rule 6).
