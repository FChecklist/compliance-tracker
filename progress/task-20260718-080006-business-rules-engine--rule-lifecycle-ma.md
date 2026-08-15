# PROGRESS -- task-20260718-080006-business-rules-engine--rule-lifecycle-ma

Task: VERIDIAN Review Framework gap-closure, "Business Rules Engine / Rule
Lifecycle Management" -- 4 findings (real spec is
`/opt/veridian/ai-os/tasks/task-20260718-080006-business-rules-engine--rule-lifecycle-ma/prompt.txt`,
one level above `workspace/`, not in cwd).

Findings:
1. [High] Business Rule Engine Completeness -- generic reusable rule engine doesn't exist
2. [High] Business Rule Versioning -- no version history / rollback
3. [Medium] Business Rule Testing Framework -- no dry-run against sample data
4. [Low] Business Rule Simulation -- no what-if impact analysis

## Completed
- [x] Read AGENTS.md/CLAUDE.md, `ai-os/boss/ACTIVE-CLAIMS.yaml` (registered this
      task's own claim -- no overlapping active entry found), prompt.txt.
- [x] Verified the gap is still real against current code (not stale): grepped
      schema.ts for every existing "rule" table -- `automationRules` (Wave 30),
      `erpPricingRules` (Wave 60), `moduleRuleConfigs` (Wave 21),
      `documentMatchingRules`, `approvalWorkflowStepDefinitions` (Wave 51).
      All are single-condition ({field, operator, value}), none have a
      condition tree (AND/OR nesting), a lifecycle status (draft/active/
      deprecated/archived), a version-history table, or a dry-run/test mode.
      Confirms findings 1-3 are real gaps. Finding 4 (Simulation) is real too
      but its own recommended approach says defer it until after the engine
      + testing framework ship -- deferring per that guidance, not silently
      dropping it (recorded below, not implemented this PR).
- [x] Read `approvalWorkflowStepDefinitions` (schema.ts) for the
      conditionField/Operator/Value precedent named in the finding, and
      `automation-rule-service.ts` + its API routes for this codebase's
      established service/route pattern (ServiceError, withTenantContext,
      requireAuth, fire-and-forget capability indexing).
- [ ] Design + add schema: `businessRules`, `businessRuleVersions`,
      `businessRuleTestRuns` tables (+ status/operator enums), additive only.
- [ ] Generate Drizzle migration.
- [ ] Build `src/lib/services/business-rules-service.ts`: condition-tree
      evaluator (AND/OR/leaf), CRUD, lifecycle transitions (draft -> active ->
      deprecated -> archived, plus reactivate), version-on-change + rollback,
      dry-run test mode.
- [ ] Unit tests for the evaluator + lifecycle transitions
      (`business-rules-service.test.ts`).
- [ ] API routes under `src/app/api/business-rules/**`.
- [ ] Update PROGRESS entries, commit, push, open PR.

## Remaining
- [ ] (see unchecked items above)
- [ ] Business Rule Simulation (Low priority, finding 4): explicitly deferred
      per the finding's own recommended approach -- not implemented this PR.
