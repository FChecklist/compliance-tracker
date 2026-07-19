# PROGRESS -- task-20260719-050016-ai-router--registry-backed-model-resolut

## Completed
- [x] Read task spec, reset PROGRESS.md

## Remaining
- [ ] Read ai-os/boss/ACTIVE-CLAIMS.yaml, ai-os/CONSTITUTION.yaml for collisions
- [ ] Read src/lib/ai-team/roster-overrides.ts, roster.ts in full
- [ ] Read src/lib/orchestra-model-resolver.ts in full
- [ ] Read src/lib/ai-router/mother-router.ts in full
- [ ] Read src/lib/model-tier-eligibility.ts (read-only)
- [ ] Read schema.ts's ai_model_registry/ai_routing_policies definitions + drizzle/0245 header
- [ ] Register claim in ACTIVE-CLAIMS.yaml, push as first commit
- [ ] Find real highest migration number from origin/main
- [ ] Gap 1: registry-backed isKnownModel()/knownModels() (commit 1)
- [ ] Gap 2: role column + registry lookups w/ fallback in orchestra-model-resolver.ts (commit 2)
- [ ] New model row: openai/gpt-oss-20b via groq, tier=mechanical (commit 3)
- [ ] New scope: customer_success enum + AiRouterScope + computeCustomerSuccessResolution() (commit 4)
- [ ] Tests: isKnownModel, resolver fallback, computeCustomerSuccessResolution
- [ ] bunx tsc --noEmit, bun run lint, bun test all clean
- [ ] Push, open PR, post AUDIT: PASS comment
- [ ] Wait for CI (gh run watch --exit-status)
- [ ] Classify TIER2 (touches drizzle/schema) -- do NOT self-merge, report for Owner sign-off
- [ ] Final report: PR number, CI result, registry-backed vs hardcoded summary
