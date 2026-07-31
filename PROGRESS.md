# PROGRESS -- task-20260731-043820-crm--import-export

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, CONSTITUTION context, KERNEL_CONSOLIDATION_STATUS.md Task #46 section
- [x] Researched `ingestionBatches` schema + its real consumer (`/api/ingest/*`, compliance-item AI-extraction pipeline)
- [x] **Spec discrepancy found**: spec's KNOWN_CONTEXT assumed GST-reconciliation import uses `ingestionBatches` -- it does not; GST has its own separate `gstImportBatches` table (`src/lib/db/schema.ts`). The only real consumer of `ingestionBatches` is `/api/ingest/*`. Followed the OBJECTIVE's hard constraint (reuse `ingestionBatches`, zero new batch table) and patterned off the real consumer instead. Will note this in the PR description.
- [x] Confirmed next-free migration number against fresh `origin/main`: 0302 (highest on main is 0301_construction_prevailing_wage_rates)
- [x] Registered ACTIVE-CLAIMS.yaml entry

## Remaining
- [ ] Add additive `target_entity` column to `ingestion_batches` (migration 0302) to discriminate CRM import batches from the existing compliance-item ingest ones
- [ ] `src/lib/services/crm-import-export-service.ts` -- import (CSV/xlsx -> crmLeads/crmOpportunities/crmAccounts/crmContacts rows, validated, tracked via `ingestionBatches`) + export (CRM records -> CSV)
- [ ] API routes: `src/app/api/crm/import/route.ts` (POST upload + GET list), `src/app/api/crm/import/[batchId]/route.ts` (GET detail), `src/app/api/crm/export/route.ts` (GET csv)
- [ ] Minimal UI wiring (import/export controls on an existing CRM page)
- [ ] Tests: successful import batch + real validation-failure case
- [ ] `npx tsc --noEmit` clean
- [ ] `bun test` on new/touched test files, 0 failures
- [ ] Commit + push, open PR (CI-green, do not merge, no self-audit)
- [ ] Append line to `/opt/veridian/ai-os/KERNEL_CONSOLIDATION_STATUS.md` Task #46 section with PR number
- [ ] Move ACTIVE-CLAIMS entry to recently_completed
