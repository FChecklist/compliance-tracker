# PROGRESS -- task-20260729-112447-build-extend-workflow-track-engines

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain and `ai-os/boss/ACTIVE-CLAIMS.yaml` protocol before picking work
- [x] Located the real PHASE-2-CROSSREF: `sap_reports` table in `/opt/veridian/ai-os/memory/sap_mapping.sqlite`
      (`engine_track` + `veridian_mapping_status` columns), not a markdown file -- confirmed via direct sqlite
      query and cross-checked against PR #624 / task-20260729-001528's discoverability doc.
- [x] Scoped work: `engine_track='workflow' AND veridian_mapping_status IN ('BUILD_NEW', 'EXTEND_EXISTING(...)')`
      = 2 rows: **SD-002** (Billing Due List) and **SD-007** (Sales Order -- Status Overview). Both BUILD_NEW.
      0 workflow-track EXTEND_EXISTING rows exist. (Treasury-002 is workflow-track but REUSE_EXISTING -- out of
      scope by spec.)
- [x] Found the real `wiring_registry`: live sqlite table in `/opt/veridian/ai-os/memory/superboss-register.sqlite`
      (host-level, shared, NOT this repo), registered via `/opt/veridian/scripts/superboss-register.py
      register-entity` per `ai-os/WIRING_ENGINE_SCHEMA_2026-07-25.yaml` (separate claude-control repo).
- [x] Collision check: 8 sibling branches with the identical task title exist (dispatcher duplication storm,
      2026-07-29 09:29-11:19Z, affecting both workflow-track and calculation-track build tasks). Only 2 have any
      commit beyond main, both claim-registration-only, zero engine code, no open PR. Proceeding given the tiny
      real scope (2 engines) and zero competing implementation -- registered claim in ACTIVE-CLAIMS.yaml
      documenting this.
- [x] Dispatched research agent to survey existing workflow/state-machine patterns in this repo before writing
      any code, per spec's "these are state machines, do not force the wrong shape" instruction. Findings:
      erp-selling-service.ts's `QUOTATION_TRANSITIONS`/`updateQuotationStatus` (explicit `Record<Status,
      readonly Status[]>` transition table) is the established convention -- no shared state-machine helper
      exists in this repo, every status-flow service hand-rolls its own map. `constructionInterimBills` has NO
      status column (generateInterimBill() goes straight from work-progress % to a posted invoice in one call) --
      confirmed a new table is genuinely needed, not an extension of an existing one.
- [x] Built both engines as ONE service, `src/lib/services/construction-billing-workflow-service.ts` (they share
      the same underlying table/state machine -- SD-002 is the queue view, SD-007 is the per-claim trace view):
      - New table `constructionProgressClaims` + `constructionClaimStatusEnum` (schema.ts + hand-written
        migration `drizzle/0269_construction_progress_claims_workflow.sql`, same convention as
        0268_pms_time_entry_approval_flow.sql -- drizzle-kit generate can't diff against an accurate baseline,
        confirmed via that migration's own header)
      - State machine: `milestone_achieved -> drafted -> submitted -> client_approved -> invoiced` (+ `rejected`
        bounce-back to `drafted`), modeled on `QUOTATION_TRANSITIONS`
      - `invoiceApprovedClaim` delegates the real bill computation to the existing `generateInterimBill()` --
        never recomputes it, this service's job stops at the state transition
      - `listBillingDueQueue` = SD-002's "Ready to Bill" worklist (overdue flag when scheduledDate has passed)
      - `getClaimTimeline` = SD-007's "Claim Timeline" document-flow trace (claim -> interim bill -> sales
        invoice -> payment, `isStuck` flag past a documented 14-day threshold)
- [x] Wired 7 API routes under `src/app/api/construction/progress-claims/` (list/create, draft, submit, approve,
      reject, invoice, timeline), mirroring `interim-bills/route.ts` and `kpi-entries/[id]/approve/route.ts`'s
      exact `requireAuth`/`requireRole`/`ServiceError` conventions
- [x] Registered the new engine file in the real wiring_registry immediately after writing it (`register-entity`
      CLI, `entity_id: file-0586774ff0fd`) -- `verification_status: PATH_MISSING` is honest, not a defect: the
      canonical path (`repos/compliance-tracker/...`) won't exist until this branch merges
- [x] 14 unit tests (`construction-billing-workflow-service.test.ts`, same mock-`withTenantContext` pattern as
      `pms-time-service.test.ts`) -- all pass, plus the 2 neighboring service test files (38 total, 0 fail)
- [x] `tsc --noEmit` clean on all new/changed files, `eslint` clean, `check-terminology-guardrail.mjs`/
      `check-guardrail-presence.mjs`/`check-metadata-index-coverage.mjs`/`check-migration-collision.mjs` all pass

- [x] Opened PR #629: https://github.com/FChecklist/compliance-tracker/pull/629

## Remaining
- [ ] CI + merge (per AGENTS.md Rule 6, no self-merge without CI green)
- [ ] Move this task's ACTIVE-CLAIMS.yaml entry to recently_completed once merged
