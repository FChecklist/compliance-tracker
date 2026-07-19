# PROGRESS -- task-20260719-031532-schema-ts--reflect-live-platform-schema

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim, pushed as its own commit
- [x] Read src/lib/db/schema.ts in full (10658 lines)
- [x] Added `platformSchemaDB = pgSchema('platform')` export next to complianceSchemaDB
- [x] Migrated 22 tables' `.table(...)` calls from complianceSchemaDB to platformSchemaDB (table name strings, columns, exported TS identifiers all unchanged)
- [x] Migrated 3 enum types' `.enum(...)` calls (ai_router_scope, ai_model_status, ai_model_health) from complianceSchemaDB to platformSchemaDB
- [x] Checked all `relations(...)` blocks touching these 22 tables (workerAgents*, moduleRegistry, productBranches*, moduleRuleConfigs, automationRules*, orgProductBranchEnablements->productBranches) -- all reference table objects directly, not schema-qualified, no same-schema assumption found
- [x] Ran `bunx tsc --noEmit` -- 0 errors
- [x] Ran `bun run lint` -- 0 errors (3 pre-existing unrelated warnings)
- [x] Ran `bun test` -- 1754 pass / 0 fail
- [x] Grepped src/ for hardcoded raw-SQL `compliance.<table>` references to all 22 tables -- found and fixed:
  - src/lib/services/instruction-execution-cache-service.ts (5 raw `sql\`...\`` template occurrences)
  - src/app/api/mcp/route.ts (1 comment)
  - src/lib/services/capability-learning-service.ts (1 comment)
  - src/lib/services/capability-audit-service.ts (1 live LLM-context string)
  - Left worker-agent-service.test.ts's comment alone -- it's a dated historical fact ("verified live 2026-07-13", i.e. before the move), same treatment as historical drizzle/*.sql migration files
- [x] Confirmed no new drizzle/*.sql migration file was created (git status clean besides the 6 intended files)
- [x] Re-ran tsc/lint/test after the grep-fix edits -- still 0 errors / 0 fail

## Remaining
- [ ] Push, open PR, post AUDIT: PASS comment
- [ ] Wait for CI, self-merge as TIER1 once green
- [ ] Report PR number, CI result, merged status, tsc confirmation
