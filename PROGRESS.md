# PROGRESS -- task-20260719-050016-ai-router--registry-backed-model-resolut

## Completed
- [x] Read task spec, reset PROGRESS.md
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, checked `gh pr list` for collisions -- none found
- [x] Read src/lib/ai-team/roster-overrides.ts, roster.ts in full
- [x] Read src/lib/orchestra-model-resolver.ts in full (526 lines)
- [x] Read src/lib/ai-router/mother-router.ts in full
- [x] Read src/lib/model-tier-eligibility.ts (read-only, confirmed untouched)
- [x] Read schema.ts's ai_model_registry/ai_routing_policies definitions + drizzle/0231/0232/0245 headers (confirmed tables now live in `platform` schema)
- [x] Registered claim in ACTIVE-CLAIMS.yaml, pushed as branch's first commit
- [x] Found real highest migration number from origin/main: 0245 -> used 0246/0247/0248
- [x] Gap 1: registry-backed isKnownModel()/knownModels() in roster-overrides.ts (async, DB-backed, fails open to roster.ts static list on error) -- commit e92a28e2
- [x] Gap 2: `role` column on ai_model_registry (drizzle/0246, backfills the 4 existing seed rows + partial unique index) + getRoleModel() TTL-cached lookup consulted by platformFallbackFor()/escalatedPlatformConfig()/resolveModelConfig()/resolvePlatformModelConfig(), safe-fallback-with-warning on any DB error or missing row; escalatedPlatformConfig() made async, 6 downstream call sites (task-execution-engine.ts x3, chat-service.ts x2, fde-service.ts x1) updated to await it -- commit e5f234aa
- [x] New model row: openai/gpt-oss-20b via groq, tier=mechanical, real pricing verified live via groq.com/pricing (drizzle/0247) -- commit c9759436
- [x] New scope: customer_success enum value (drizzle/0248) + AiRouterScope union + computeCustomerSuccessResolution() mirroring computeSalesMarketingResolution() + wired into resolveModel() -- commit 3e0ae672
- [x] Tests: isKnownModel()/knownModels() registry-hit + unregistered + fail-open-on-DB-error (roster-overrides.test.ts, DB mocked); orchestra-model-resolver's registry-lookup-with-fallback path incl. a forced lookup failure proving the safe fallback fires (orchestra-model-resolver.test.ts, +3 new tests, plus a global afterEach added to reset the module's in-process role-registry cache between tests since the module body only evaluates once per test file); computeCustomerSuccessResolution() mirroring the sales_marketing test shapes (mother-router.test.ts, +4 tests)
- [x] `bunx tsc --noEmit` clean, `bun run lint` clean (pre-existing warnings only, unrelated to this diff), `bun test`: 1763 pass / 0 fail (net +12 new tests across the 3 touched test files)
- [x] Ran CI-mirroring local checks: check-migration-collision.mjs (OK, no collisions), check-guardrail-presence.mjs (all 88 markers present), check-asset-registry-coverage.mjs (all 421 tables accounted for -- no new table added, only a column, so no registry change needed)
- [x] 4 logically separate commits on one branch (git add -p used to split schema.ts's two independent hunks across the Gap 2 and new-scope commits)
- [x] Pushed branch

## Remaining
- [ ] Open PR
- [ ] Post structured `AUDIT: PASS` comment
- [ ] `gh run watch --exit-status` until all required checks green
- [ ] Move ACTIVE-CLAIMS.yaml entry to recently_completed
- [ ] TIER2 (touches drizzle/*.sql + schema.ts new column/enum/seed row) -- do NOT self-merge, report as ready for Owner sign-off
- [ ] Final report to Owner: PR number, CI result, plain-English registry-backed-vs-hardcoded summary
