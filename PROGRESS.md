# PROGRESS -- task-20260728-050704-sap-informed-veridian-phase-0--baseline

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim, pushed (commit 887fae43)
- [x] Located real data sources: ai-os/DATABASE_CATALOG.json (compliance-tracker, 449-table snapshot from 2026-07-26) + claude-control repo's ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json (7711 entities; only 6 generic "route" entities, 444 supabase_table, 1371 src/app/api functions -- not useful for per-route domain categorization, used DATABASE_CATALOG.json + direct grep as primary per spec's own fallback guidance)
- [x] Diffed DATABASE_CATALOG.json's 449 tables against current schema.ts's real 464 `.table(` declarations -- found 15 new tables added since the snapshot (hr loans/expense-claims/shift-roster, performance-review goals/raters, helpdesk SLA/escalation/ticket-teams, construction interim bills), pulled their real columns directly from schema.ts
- [x] Categorized 213 business-domain tables across the 8 in-scope domains (CRM 8, Sales 19, Purchase 27, Inventory 17, Accounting/GST 41, HR 43, PM 27, Helpdesk 13, Construction/BoQ 18), each with real file:line + real column list
- [x] Enumerated all 959 real API route.ts files under src/app/api (note: relative-path `find` silently truncated to 51 in this shell -- absolute-path `find` gave the real count; used absolute-path form throughout), categorized 508 of them into the 8 domains by directory, with real per-directory counts + example paths (fixed an erp/returns sales-vs-purchase mis-split along the way)
- [x] Confirmed PROJEXA's module-chain exposure via PR #609 (compliance-tracker, merged 2026-07-28T04:11:24Z) + PR #59 (projexa, merged 2026-07-28T03:19:17Z): buildCapabilityTree() now exposed to PROJEXA's chat composer (minus construction_intelligence, which PROJEXA already owns via its own dedicated route) -- read the actual route.ts + capability-tree-service.ts source, not just PR titles
- [x] Ran both spec sanity checks: `grep -c "pgTable("` = 0 (real finding: this codebase uses `complianceSchemaDB.table(`/`platformSchemaDB.table(`, not literal `pgTable(` -- documented, not silently worked around) + real `.table(` count = 464; `git log` on PHASE_0_BASELINE.yaml confirmed empty (pre-creation)

## Remaining
- [ ] Assemble ai-os/tasks/sap_mapping/PHASE_0_BASELINE.yaml from gathered data
- [ ] Commit + push
- [ ] Open PR
