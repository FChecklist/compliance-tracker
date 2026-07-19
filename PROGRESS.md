# PROGRESS -- task-20260719-004411-gap-closure--dmp-04-enhancement

## Completed
- [x] Read CONSTITUTION.yaml DMP-04 entry in full
- [x] Checked ACTIVE-CLAIMS.yaml + `gh pr list` for duplicate work (none found)
- [x] Read src/lib/services/fde-service.ts, worker-agent-service.ts (proposeWorkerAgent), dynamic-chain-directory-service.ts, capability-tree-service.ts, dynamicChains schema, approvals/[id]/route.ts
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (this commit)

## Remaining
- [ ] Implement proposeDynamicChain() in dynamic-chain-directory-service.ts (pure builder + DB-touching function)
- [ ] Wire submitFdeRequest()'s no_match branch to call proposeDynamicChain() alongside proposeWorkerAgent()
- [ ] Extend FdeEvaluation.proposal type + bump fde.evaluate_request prompt template to v3 (moduleRef/businessRules/permissions/workflowSteps/kpis)
- [ ] Add fdeRequests.createdDynamicChainId column (schema.ts + migration)
- [ ] Extend approvals/[id]/route.ts to handle requestType 'dynamic_chain_proposal' (approve -> status 'approved', reject -> status 'retired' + deprecationReason; gate at veridian_admin like worker_agent_proposal)
- [ ] Add unit tests for the new pure builder function
- [ ] Run bunx tsc --noEmit, bun run lint, bun test
- [ ] Push, open PR, post AUDIT: PASS comment
- [ ] Watch CI
- [ ] Classify tier (touches schema.ts/migration -> TIER2, report for Owner sign-off, do not self-merge)
