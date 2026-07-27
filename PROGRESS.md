# PROGRESS -- task-20260727-082615-architecture-phase-9--gateway-knowledge

phase_9_gateway_knowledge_sync_infrastructure (ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml,
lines 563-607, repo claude-control, target_repo compliance-tracker).

## Completed
- [x] Read governance docs, registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (pushed
      commit `71a2d67e`). No conflicting active claim found.
- [x] Verified candidate call site: `src/app/api/ai/orchestrate/route.ts` was the strongest
      of the ~22 `resolvePromptTemplate()` callers -- it also independently calls a model
      resolver (`orchestra-model-resolver.ts`'s `resolveModelConfig()`), the exact
      "prompt-execution request whose model-selection step never crosses G05" gap the phase
      names. Confirmed `mother-router.ts`'s `end_user_org` scope existed, fully implemented
      (`computeEndUserOrgResolution`), with **zero real callers anywhere in the repo** before
      this change (grep-confirmed) -- a genuinely dead, uninstrumented gateway scope, not a
      documentation gap.
- [x] Built the real gateway hop (option (b) from SCOPE item 1): `orchestrate/route.ts` now
      calls `resolveModel({ scope: "end_user_org", orgId, layerKey: "task_oa" })`
      (`resolveModel as resolveMotherRouterModel` from `@/lib/ai-router/mother-router`)
      **instead of** calling `resolveModelConfig()` directly. `mother-router.ts` extended:
      - `MotherRouterResolution` gained an optional `resolvedConfig?: ResolvedModelConfig`
        field (end_user_org only) so a caller gets the real, ready-to-call config (apiKey/
        fallback/isCustomerConfigured) through this ONE function, not a second independent
        resolution afterwards.
      - `computeEndUserOrgResolution()` populates it for every branch (BYO passthrough, no
        override, package override with a configured platform key). When a package override
        names a provider with **no** platform API key configured, `resolvedConfig` is
        `undefined` (never silently downgraded to baseline, never a broken config) --
        mirrors `resolveModelConfig()`'s own existing `if (!apiKey) return null` convention.
      - Every real DB write path (the `ai_routing_audit_log` insert in `resolveModel()`) now
        fires for real on this route -- a citable, non-simulated G05 crossing.
      - Added 4 new unit tests for `resolvedConfig` in `mother-router.test.ts` (BYO, no
        override, override+key, override+no-key) -- all pass (30/30 total in that file, plus
        the 2 pre-existing test files touching this code, 35/35, unaffected).
      - `bun x tsc --noEmit` clean; behavior of every pre-existing test (26/26 originally,
        including `software_team`/`sales_marketing`/`customer_success` scopes, untouched)
        still passes unchanged.
      - File:line evidence: `src/app/api/ai/orchestrate/route.ts` (import + call site),
        `src/lib/ai-router/mother-router.ts` (`MotherRouterResolution` type,
        `computeEndUserOrgResolution`, `resolveModel`'s `end_user_org` branch, unchanged).

## Remaining
- [ ] Wire capability-intel: register a new `capability_registry` row (via
      `scripts/superboss-register.py register-capability` on the server, claude-control repo)
      for this phase's prompt-needs-to-capability matching, reusing the existing table --
      no parallel matcher.
- [ ] Register the `knowledge_engine` row (`veridian_v2_gateway_knowledge_sync`, tag
      `domain:veridian_architecture_v2`) via `register-knowledge` (the real write-path
      `query-knowledge` reads from), server-side, claude-control repo.
- [ ] Add a new `populated_routes` entry to
      `ai-os/ROUTE_REGISTRY_SCHEMA_2026-07-24.yaml` (claude-control) with a `route_id`
      containing `veridian-v2` and `hops_through` gateway `G05`, citing the file:line trace
      above, capability_name matching the new capability_registry row -- this is what makes
      `generate_wiring_registry.py`'s output actually contain a `veridian-v2` entity
      (`build_routes()` derives `route-{route_id}` entity IDs straight from this file).
- [ ] Explicit named decision on the `PATH_MISSING` drift for `KE-20260725-233806-1d75`
      (`.../compliance-tracker/src/lib/prompt-compiler/pipeline.ts`): confirmed the file is
      real and merged on `main` (present in this task's own workspace checkout, commit
      `605462b2`). The drift is because the SHARED, long-lived checkout at
      `/opt/veridian/repos/compliance-tracker` is stale (on branch
      `docs/cost-control-2026-07-20`, with its own uncommitted local changes from an
      unrelated task/session) -- the cron that used to keep it in sync (`sync-repos.sh`) is
      intentionally disabled (`#STOPPED-ALL-CRON-2026-07-26#`; this task's own CONSTRAINTS
      require every currently-disabled cron/timer to STAY disabled). Decision: do **not**
      force-update or reset that shared checkout to "fix" this -- it would risk destroying
      another session's in-progress uncommitted work and would require re-enabling a cron
      this task is explicitly forbidden from touching. Left as a documented, out-of-scope,
      pre-existing operational gap, not silently ignored -- re-verify via `verify-knowledge`
      once `sync-repos.sh` is ever re-enabled by a session with the authority to do so.
- [ ] Re-run `python3 scripts/generate_wiring_registry.py` (server, claude-control) and
      confirm `grep -q veridian-v2 ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json` exits 0.
- [ ] Confirm `python3 scripts/superboss-register.py query-knowledge
      "veridian_v2_gateway_knowledge_sync" --tag domain:veridian_architecture_v2` returns
      `found>=1`.
- [ ] Update `OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml`'s three items
      (engine-gateway-integration, engine-knowledge-sync, engine-capability-intel) with
      real, re-verified verdicts -- do not upgrade rate-limiting/protocol-translation
      (explicitly out of this phase's scope per CONSTRAINTS).
- [ ] Open PR against compliance-tracker for the code change; CI green; do not merge to
      main directly (Rule 6).
