# PROGRESS -- task-20260719-004409-gap-closure--umr-03

Closing UMR-03 (ai-os/CONSTITUTION.yaml section 14, learning_and_umr):
instruction-execution-cache so a similar future chat instruction can be
answered from what was already learned, not re-derived from scratch.

## Completed
- [x] Read CONSTITUTION.yaml section 14 (learning_and_umr) in full
- [x] Read embeddings.ts, capability-registry-service.ts, fde-service.ts, chat-service.ts, task-execution-engine.ts
- [x] Checked ai-os/boss/ACTIVE-CLAIMS.yaml + `gh pr list` for a duplicate claim -- none found
- [x] Registered claim in ACTIVE-CLAIMS.yaml
- [x] Added `instructionExecutionCache` table to src/lib/db/schema.ts
- [x] Added drizzle/0242_umr03_instruction_execution_cache.sql (re-checked highest migration on origin/main immediately before writing: 0241)
- [x] Added src/lib/services/instruction-execution-cache-service.ts (findPriorExecutionPath/recordExecutionPath)
- [x] Wired into src/lib/services/fde-service.ts::submitFdeRequest (checked before findSimilarCapabilities; recorded after embedding match, LLM-assisted match, and new proposal)
- [x] Added ai-os/registry/asset-registry-coverage.yaml exemption entry for the new table
- [x] Added tests: instruction-execution-cache-service.test.ts, fde-service.test.ts (10 new tests)
- [x] bunx tsc --noEmit -- 0 errors
- [x] bun run lint -- 0 errors
- [x] bun test -- 1698 pass / 0 fail
- [x] All 6 local CI guardrail scripts pass (asset-registry-coverage, migration-collision, guardrail-presence, doc-cross-references, doc-quarantine-banner, metadata-index-coverage)
- [x] Committed claim registration as its own first commit

## Remaining
- [ ] Commit implementation
- [ ] Push branch, open PR against main
- [ ] Post structured `AUDIT: PASS` PR comment (8 fields)
- [ ] Watch CI to green
- [ ] Classify tier (touches drizzle/*.sql + schema.ts -> TIER2, do NOT self-merge)
- [ ] Report final status to Owner for sign-off
