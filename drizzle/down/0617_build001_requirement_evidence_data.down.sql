-- Down-migration for drizzle/0617_build001_requirement_evidence_data.sql
-- (PROJEXA-BUILD-001 U-22). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately. Run it
-- BEFORE drizzle/down/0616_build001_requirement_evidence.down.sql.
--
-- WHAT IT RESTORES: the rows as they were before 0617.
--   1. The EXC-ITEM rows 0617 inserted are deleted: id EXC-ITEM-01..31 AND
--      source = 'construction-exceptions-service.ts@6d531f53' AND updated_by = 'BUILD-001 U-22'.
--   2. On the 74 existing rows 0617 updated, verify_command and evidence_ref
--      are set back to NULL, each only where the value is still exactly what
--      0617 wrote. updated_at, updated_by, status and every other column are
--      untouched (0617 never changed them).
--
-- DATA LOSS, read before running:
--   1. Everything in the deleted EXC-ITEM rows is lost, including any edit made
--      to such a row after 0617 that kept updated_by = 'BUILD-001 U-22' (a status
--      moved to DONE, an evidence_ref, a verified_in_db). Copy them out first if
--      they are wanted (select * from platform.sumeet_requirements where id like
--      'EXC-ITEM-%').
--   2. None beyond that: a verify_command or evidence_ref someone changed after
--      0617 is kept, because it no longer equals what 0617 wrote.
--
-- WHAT IT LEAVES, ON PURPOSE: an EXC-ITEM row whose updated_by was changed
--   after 0617 (someone edited it and signed the edit) is NOT deleted; the
--   NOTICE at the end names how many EXC-ITEM rows remain. Delete such a row by
--   hand only if that edit is not wanted. An EXC-ITEM row that existed before
--   0617 was never touched by 0617 (ON CONFLICT DO NOTHING) and is not deleted
--   unless it happens to carry the source and updated_by above.
--
-- WHEN IT REFUSES: it does not. If 0616's columns are already gone, step 2 is
--   skipped (there is nothing left to set to NULL) and step 1 still runs.
--
-- Safe to run twice: a second run finds nothing to delete or clear.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the EXC-ITEM rows 0617 inserted ------------------------------------------
DELETE FROM platform.sumeet_requirements
WHERE id IN ('EXC-ITEM-01', 'EXC-ITEM-02', 'EXC-ITEM-03', 'EXC-ITEM-04', 'EXC-ITEM-05', 'EXC-ITEM-06', 'EXC-ITEM-07', 'EXC-ITEM-08', 'EXC-ITEM-09', 'EXC-ITEM-10', 'EXC-ITEM-11', 'EXC-ITEM-12', 'EXC-ITEM-13', 'EXC-ITEM-14', 'EXC-ITEM-15', 'EXC-ITEM-16', 'EXC-ITEM-17', 'EXC-ITEM-18', 'EXC-ITEM-19', 'EXC-ITEM-20', 'EXC-ITEM-21', 'EXC-ITEM-22', 'EXC-ITEM-23', 'EXC-ITEM-24', 'EXC-ITEM-25', 'EXC-ITEM-26', 'EXC-ITEM-27', 'EXC-ITEM-28', 'EXC-ITEM-29', 'EXC-ITEM-30', 'EXC-ITEM-31')
  AND source = 'construction-exceptions-service.ts@6d531f53'
  AND updated_by = 'BUILD-001 U-22';

-- 2. the two cells 0617 filled on the existing rows ----------------------------
DO $down$
DECLARE
  v_left bigint;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'platform' AND table_name = 'sumeet_requirements'
        AND column_name IN ('verify_command', 'evidence_ref')) = 2 THEN
    EXECUTE $upd$
      UPDATE platform.sumeet_requirements AS r
      SET verify_command = CASE WHEN r.verify_command = v.verify_command THEN NULL ELSE r.verify_command END,
          evidence_ref   = CASE WHEN r.evidence_ref = v.evidence_ref THEN NULL ELSE r.evidence_ref END
      FROM (VALUES
      ('R-01', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts src/app/api/v1/construction/boq/boq-route.nested-pricing.test.ts', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-02', 'bun test --isolate src/lib/services/construction-boq-service.test.ts -t "computeHierarchicalAmount"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-03', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-03:"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-04', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-04:"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-10', 'node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from information_schema.columns where table_schema = ''compliance'' and table_name = ''construction_boq_line_items'' and column_name in (''item_code'', ''parent_line_item_id'', ''breakdown_percentage'')" --equals 3', 'b3de3e1ad613849b8c4f40fa8a000a93793b2398'),
      ('R-11', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-12', 'bun test --isolate src/lib/services/construction-boq-service.weighted-subtask-pricing.test.ts -t "R-12"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-13', 'bun test --isolate src/lib/services/construction-boq-service.weighted-subtask-pricing.test.ts -t "R-13"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-14', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-14:"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-15', NULL, '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-16', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-16"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-17', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-17"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-18', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-18"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-19', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.nested-pricing.test.ts -t "R-19"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-20', 'bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-20"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-21', 'bun test --isolate src/lib/services/construction-boq-service.revision-variation.test.ts -t "R-21"', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-22', 'bun test --isolate src/lib/services/construction-boq-service.scope-reduction-guard.test.ts -t "R-22"', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-23', 'bun test --isolate src/lib/services/construction-boq-service.scope-reduction-guard.test.ts src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-23|R-C13"', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-24', 'bun test --isolate src/lib/services/construction-boq-service.revision-variation.test.ts -t "R-24"', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-30', 'bun test --isolate src/lib/services/construction-boq-service.dual-view-wiring.test.ts -t "getBoq"', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-31', NULL, '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-32', 'bun test --isolate src/lib/services/boq-dual-view-service.test.ts src/lib/services/construction-boq-service.dual-view-wiring.test.ts -t "R-32"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-33', 'bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-33"', '8f87a2b79cbe88ff221cec09469df2c44cbb24ab'),
      ('R-40', 'bun test --isolate src/lib/services/construction-progress-service.test.ts -t "createProgressEntry"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-41', 'bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-42', 'bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-43', 'bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-44', 'bun test --isolate src/lib/services/construction-reports-service.earned-value.test.ts -t "R-44:"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-45', 'bun test --isolate src/lib/services/construction-reports-service.earned-value.test.ts -t "R-45:"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-46', 'bun test --isolate src/lib/services/construction-progress-service.test.ts -t "R-46"', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-47', 'bun test --isolate src/lib/services/construction-progress-service.test.ts -t "outside 0-100|assertPercentComplete"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-48', 'bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts src/app/api/v1/projexa/work-progress/report/pdf/route.test.ts', '2b6bfbb88a30f15e47b9a3e770c05ebceecff8bd'),
      ('R-50', 'bun test --isolate src/app/api/v1/projexa/dashboard/route.test.ts "src/app/api/v1/projexa/dashboard/[projectId]/route.test.ts" -t "R-50"', '02fca7415d9f133298cb19711057d2b816c8769a'),
      ('R-51', 'bun test --isolate src/lib/services/construction-dashboard-service.test.ts src/lib/services/construction-reports-service.test.ts -t "earned value|earnedValue|R-51"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-52', 'bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-52"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-60', 'bun test --isolate src/lib/services/erp-accounting-service.test.ts src/app/api/v1/projexa/currencies/route.test.ts', '5e1d24a66e4cf4f54e61d913c1315aafb9d8df26'),
      ('R-61', 'bun test --isolate src/lib/services/erp-accounting-service.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-62', 'bun test --isolate src/lib/services/erp-accounting-service.test.ts -t "getBaseCurrency"', '2b6bfbb88a30f15e47b9a3e770c05ebceecff8bd'),
      ('R-63', 'node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from compliance.erp_currencies where org_id = ''projexa_demo_org'' and is_base_currency" --equals 1', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-70', 'bun test --isolate src/lib/services/construction-boq-import-service.test.ts src/lib/services/construction-boq-service.test.ts -t "Sumeet real-file shape|R-70"', 'db469a9e52f8f0b6423c7cf61a4d7963f6f9adbd'),
      ('R-71', 'bun test --isolate src/lib/services/construction-boq-import-service.test.ts -t "clear 400 error|BLOCKING issue|blocking too|skipped with a warning"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-72', 'bun test --isolate src/lib/services/construction-boq-import-service.test.ts -t "mapBoqHeaders|Sumeet real-file shape"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-80', 'bun test --isolate src/app/api/v1/projexa/assistant/route.test.ts src/app/api/v1/projexa/chain-options/route.test.ts', 'cc4b84f47a2e06238f728fde138975af5e434d32'),
      ('R-81', 'bun test --isolate src/app/api/v1/projexa/module-chain/route.test.ts src/app/api/v1/projexa/chain-options/route.test.ts', 'cc4b84f47a2e06238f728fde138975af5e434d32'),
      ('R-82', 'bun test --isolate src/app/api/v1/projexa/assistant/route.test.ts', 'cc4b84f47a2e06238f728fde138975af5e434d32'),
      ('R-90', 'bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-04:"', '63e7e43ac8474f899da67a6e7812d7f238b6ee15'),
      ('R-91', 'bun test --isolate src/lib/errors/error-catalog.test.ts -t "friendlyErrorMessage"', 'f051b3da40cafc048fcd57b5204702f45869f1f5'),
      ('R-A4', 'bun test --isolate src/app/api/v1/projexa/scope/route.test.ts -t "R-A4"', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-A5', NULL, 'd40bc80c60c21310fae2952ffc844530c1eab458'),
      ('R-B1', 'test "$(git grep -c -F ''test("demo gate: TC-01, TC-10, TC-11, TC-30, TC-40'' -- e2e/demo-gate-smoke-env1.spec.ts | awk -F: ''{s+=$2} END {print s+0}'')" = "1"', '4760c244c26f143cdb1401a1547c56fa23a33b5a'),
      ('R-B2', NULL, '7886f1d7ca9fd749ca7306c437bd752d8039ab12'),
      ('R-A6', 'bun test --isolate src/lib/dependency-pins.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C01', 'bun test --isolate src/app/api/v1/projexa/permits/route.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C02', 'bun test --isolate src/app/api/v1/projexa/drawings/route.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C03', 'bun test --isolate src/app/api/v1/documents/route.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C04', 'bun test --isolate "src/app/api/veri-meetings/[id]/minutes/route.test.ts"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-C07', 'bun test --isolate src/lib/services/construction-labour-service.test.ts src/lib/services/construction-reports-service.test.ts -t "recordAttendance|createRosterEntry|aggregateManpowerDailySummary|rollUpAttendanceByTrade|manpower-cost"', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-C08', 'bun test --isolate src/lib/services/construction-materials-service.test.ts', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-C09', 'bun test --isolate src/lib/services/construction-boq-service.vendor-budget.test.ts', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-C10', 'bun test --isolate src/app/api/v1/projexa/schedule/route.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C11', 'bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-C11"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-C12', 'bun test --isolate src/lib/services/pms-time-service.test.ts', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-C13', 'bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-C13"', '28cf473c4791e02aeccdc60c25fbd1184f7ef258'),
      ('R-C14', 'bun test --isolate src/app/api/v1/construction/site-instructions/route.test.ts', '40be85bf3f6622e9a3173a6f50be56b9efd0b089'),
      ('R-C15', 'bun test --isolate src/app/api/v1/projexa/reports/share/route.test.ts "src/app/api/v1/projexa/reports/[reportName]/export/route.test.ts" src/lib/services/report-share-service.shareable-types.test.ts', 'b6999822037f01512e86b86335ef8a6f8b9c67af'),
      ('R-C16', 'bun test --isolate src/lib/crr/capture.test.ts src/lib/crr/recall.test.ts', 'a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf'),
      ('R-92', NULL, 'cb095a32daa4756b7dbf4970ba51f4604128b8e9'),
      ('R-93', 'bun test --isolate src/lib/services/construction-boq-service.dual-view-wiring.test.ts src/lib/services/boq-dual-view-service.test.ts -t "getBoq|computeBoqLineMoneyView"', NULL),
      ('R-94', 'bun test --isolate src/lib/services/pms-taxonomy-service.test.ts src/app/api/v1/projexa/milestones/route.test.ts', '20cacb8f7918b10136b711c0c86ec05562bfa08c'),
      ('R-95', 'bun test --isolate src/app/api/v1/projexa/billing-claims/route.test.ts "src/app/api/v1/projexa/billing-claims/[id]/route.test.ts"', '0411dba1d89e9e8400e2aac80d5391264a646807'),
      ('R-97', 'bun test --isolate src/app/api/v1/projexa/change-orders/route.test.ts', 'c4ce4fae26045371f6e7168a75c9ef152cca39bd'),
      ('R-98', 'bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts', NULL),
      ('R-99', 'bun test --isolate src/lib/services/boq-analysis-service.test.ts src/app/api/v1/projexa/reports/boq-analysis/route.test.ts src/app/api/v1/projexa/billing-claims/route.test.ts', '20cacb8f7918b10136b711c0c86ec05562bfa08c'),
      ('R-100', 'bun test --isolate src/lib/services/boq-analysis-service.test.ts src/lib/services/boq-dual-view-service.test.ts -t "THE ANSWER|computeProfitAtBothLevels"', '20cacb8f7918b10136b711c0c86ec05562bfa08c')
        ) AS v(id, verify_command, evidence_ref)
      WHERE r.id = v.id
        AND (r.verify_command = v.verify_command OR r.evidence_ref = v.evidence_ref)
    $upd$;
  END IF;

  SELECT count(*) INTO v_left FROM platform.sumeet_requirements WHERE id LIKE 'EXC-ITEM-%';
  IF v_left > 0 THEN
    RAISE NOTICE 'DOWN 0617: % EXC-ITEM row(s) left in platform.sumeet_requirements (edited after 0617 or not written by it); see this file''s header.', v_left;
  END IF;
END
$down$;

COMMIT;
