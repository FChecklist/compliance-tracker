# PROGRESS -- task-20260719-021227-gap-closure--gp-20-loop-prevention

## Completed
- [x] Read CONSTITUTION.yaml GP-20 section in full
- [x] Read src/lib/loop-prevention.ts (checkLoopBudget, shouldPromptSelfCheck) in full
- [x] Checked ACTIVE-CLAIMS.yaml + `gh pr list` for duplicate claims -- none found
- [x] Read src/lib/task-execution-engine.ts's dispatch/escalation call chain -- confirmed no
      existing code creates an edge between two DISTINCT `tasks` rows (escalation there is
      same-task, role-ladder only via nextEscalationRung, structurally acyclic CSEO->COO->
      Super Boss). The one real "task spawns + executes another task" call chain in this
      codebase is crm-service.ts's createChainedTask() (Wave 78 Multi-Agent Chaining), which
      calls task-execution-engine.ts's own executeTask() on a freshly created task.
- [x] Registered claim in ACTIVE-CLAIMS.yaml, committed as its own first commit

## Remaining
- [ ] Implement pure wouldCreateCycle() DFS in src/lib/loop-prevention.ts
- [ ] Implement DB-touching recordTaskEscalationEdge() in new src/lib/task-dependency-graph.ts
      (entity_relationships-backed, ServiceError refusal on cycle)
- [ ] Wire into crm-service.ts's createChainedTask()/createFollowUpTaskFromLead/
      createFollowUpTaskFromOpportunity (optional fromTaskId) + the 2 follow-up-task API routes
- [ ] Update CONSTITUTION.yaml's GP-20 entry to reflect the real, honest new state
- [ ] Add unit tests: 2-task cycle, 3-task cycle, non-cyclic chain not blocked, self-loop
- [ ] Run bunx tsc --noEmit, bun run lint, bun test -- fix everything
- [ ] Push, open PR against main
- [ ] Post structured AUDIT: PASS PR comment (8 fields)
- [ ] Wait for CI via gh run watch
- [ ] Classify tier (expect TIER1 -- no schema.ts/drizzle changes) and self-merge if green
- [ ] Report final status
