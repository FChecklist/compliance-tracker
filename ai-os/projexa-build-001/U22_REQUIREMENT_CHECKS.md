# U-22 requirement checks: PROJEXA-BUILD-001 phase 3

Work item U-22 (register rows BR-307, BR-308, BR-309, BR-310, BR-311). Written 2026-09-25 by a Claude Code
engineer session for the PM. This file records, for each of the 111 requirement ids (80 register rows R-xx and
EXC-ITEM-01..31), the verify_command and evidence_ref that `drizzle/0617_build001_requirement_evidence_data.sql`
writes, what was run on 2026-09-25 and its result. Nothing was applied to any database: 0616 and 0617 are committed
files only, and every database read was a SELECT.

## Summary

| measure | value |
|---|---|
| ids with a verify_command after 0617 | 100 of 111 (69 of the 80 R- rows, all 31 EXC-ITEM rows) |
| ids with a valid evidence_ref after 0617 | 100 of 111 (72 of the 80 R- rows, EXC-ITEM-01..28) |
| DONE rows with a valid evidence_ref | 41 of 45 (R-A1, R-A2, R-A3, R-A7 have none, see "DONE rows to downgrade") |
| built = 'YES' rows with a verify_command | 58 of 61 (R-15, R-31, R-92 have none, see "built = YES rows with no check") |
| PASS | 97: 66 R- rows by `bun test`, R-10 and R-63 by SQL, R-B1 by git grep (presence only), EXC-ITEM-01..28 by `bun test` |
| of which the check covers only the compliance-tracker half of a PROJEXA screen | 22 (listed below; 9 of them are DONE) |
| FAIL | 0 today. After 0617 is applied, EXC-ITEM-29 and EXC-ITEM-31 will FAIL (proven on the PGlite copy): no detector item is DONE and none has been checked on the PROJEXA screen |
| NOT RUNNABLE HERE | 14: the 11 R- rows with no verify_command, and EXC-ITEM-29..31 (their SQL reads columns and rows that exist only after 0616/0617 are applied; on the PGlite copy they return 0, 28 and 0) |

Register rows, live values through the Supabase MCP (role postgres), and on the PGlite copy after 0616 + 0617
(`src/lib/services/sumeet-requirements-evidence-migration.pglite.test.ts`, tests 1 and 4):

| row | expected | live 2026-09-25 (before apply) | PGlite after 0616 + 0617 |
|---|---|---|---|
| BR-307 | 31 | SQL 2026-09-25: 0 | 31 |
| BR-308 | 0 | SQL 2026-09-25: 61 | **3** (R-15, R-31, R-92) |
| BR-309 | 31 | SQL 2026-09-25: 0 | 31 |
| BR-310 | 3 | SQL 2026-09-25: 0 | 3 |
| BR-311 | 0 | SQL 2026-09-25: 45 | **4** (R-A1, R-A2, R-A3, R-A7) |

So after the PM applies 0616 and 0617, BR-307, BR-309 and BR-310 pass; the EXIT rows BR-308 and BR-311 still fail
until the PM decides the 7 rows named above. No check was weakened to reach a number.

## DONE rows to downgrade (the PM decides)

No commit, PR number or dated query result could be found for these four DONE rows, so evidence_ref stays NULL and
BR-311 reads 4:

| id | why there is no evidence_ref |
|---|---|
| R-A1 | An operational credential rotation. No commit or PR, and no database value tells a rotation apart from an ordinary sign-in (auth.users.updated_at moves on both). Details only in the private KT folder. |
| R-A2 | A security item whose details were removed from the public copy (PMD-25). No commit, PR or dated database value to cite. |
| R-A3 | An owner decision (the repository stays public). The only check is a GitHub read of the repository's visibility, which is neither an allowed verify_command form nor an allowed evidence_ref form. |
| R-A7 | Same as R-A3, for veridian-ui-kit. |

None of the four has a verify_command either (none is built = 'YES', so BR-308 does not count them).

DONE rows that FAIL their check: **none**. All 41 DONE rows that have a verify_command passed it on 2026-09-25.

## DONE rows whose check covers only the compliance-tracker half

These pass, but the requirement is (partly) a PROJEXA screen, and the screen's own proof is a Playwright spec or a test
in the FChecklist/projexa repository, which cannot run from this repository (Playwright runs only in CI,
DEV_TEST_DEPLOY_PLAN P-03). The verify_command exercises the compliance-tracker code the screen calls:

| id | what the check proves | what it does not prove |
|---|---|---|
| R-01 | BOQ saves through the real POST route and service | the browser save (e2e/r01-r02-boq-create-env1.spec.ts) |
| R-11 | the create route accepts and validates Item Code / Parent Item Code / Breakdown % | the form fields (projexa e2e/r11-...-env1.spec.ts) |
| R-30 | getBoq returns the line items | that the screen shows them (projexa e2e/r15-r30-r31-boq-view-env1.spec.ts) |
| R-32 | the root-lines-only total (5000, not 6500) | the total on screen (e2e/r32-...-env1.spec.ts) |
| R-48 | the daily Work Progress Report PDF | the photos, which live only in PROJEXA's own storage and table |
| R-60 | the org's currency is stored and served | AED on the BOQ screen (projexa e2e/r60-boq-currency-env1.spec.ts) |
| R-80, R-81, R-82 | the chain-options ladder, the module chain and the assistant dispatch | the click-through (projexa e2e/r80-r81-r82-copilot-pill-chain-env1.spec.ts) |

The same holds for 13 rows that are not DONE (R-40, R-41, R-42, R-43, R-62, R-90, R-93, R-94, R-95, R-97, R-98, R-99,
R-100); each is marked "(ct half only)" in the table.

## built = 'YES' rows with no check (BR-308 reads 3)

| id | why no verify_command |
|---|---|
| R-15 | The running total of child percentages is computed and drawn only in the PROJEXA View dialog; compliance-tracker has no code for it. Its proof is a PROJEXA Playwright spec. |
| R-31 | Indenting and the "% of parent" label are PROJEXA rendering only. Same Playwright spec. |
| R-92 | Left/right sync is PROJEXA shell code only. Its proof is two bun tests in the projexa repository (src/components/shell/PillStrip.test.tsx, M24Shell.loaded-chain-reset.test.tsx). |

A command that only exercised unrelated compliance-tracker code would make BR-308 read 0 without checking these
requirements, so none was written. Options for the PM: accept a verify_command that runs at the projexa repository root
(R-92), or add a cross-repo form (for example a `bash scripts/verify/<script>` that reads the result of the CI job
"E2E Tests (Env-1, cross-repo)" for a named spec) for R-15 and R-31.

## Other findings

1. **The exceptions tests cannot catch a wrong WHERE clause.** The fake database in
   `construction-exceptions-service.test.ts` returns every configured row whatever `where` it is given (its own header
   says so). Falsifiability probes on 2026-09-25, each restored byte-for-byte (`git diff` empty afterwards):
   item 6, `approvedById === requestedById` flipped to `!==`: the EXC-ITEM-06 command FAILED (2 of 3 tests), so it is
   falsifiable; item 24, `push(24, ...)` changed to `push(29, ...)`: the EXC-ITEM-24 command FAILED (the aggregator
   test), so the wiring is falsifiable; item 11, the `category = 'work_dispute'` filter removed: the EXC-ITEM-11 command
   still PASSED; item 13, `isNotNull(parentBoqId)` flipped to `isNull`: the EXC-ITEM-13 command still PASSED. Every item
   whose defining predicate is a WHERE clause has the same blind spot (probed: 11 and 13; the others by reading the code):
   3, 5, 10, 11, 12, 13/14, 15/16, 17, 18/27, 21 and the overdue half of 24. The instruction was to add an item test only where an item has none, and each of these has
   one, so no test was added. A test that runs the detectors against PGlite tables would close it.
2. **Applying 0617 turns BR-115 red.** `scripts/verify/requirements-111.sh` (phase 1) compares only the 80 R- ids with the
   live table and counts `live_extra` as every live id outside them; after 0617 that is 31 (the EXC-ITEM rows) and the
   script exits 1. The script needs to compare all 111 ids from REQUIREMENTS_111_REGISTER.csv; that is a register change,
   so it needs an AMENDMENT_LOG row. Not changed here.
3. **BR-206 fails until the PM rehearses 0616 live.** `bash scripts/verify/rollback-rehearsals.sh` now prints
   `MISSING 0616_build001_requirement_evidence` and `REHEARSAL_MISSING=1` (exit 1). `bash scripts/verify/rollback-replay.sh`
   passes: `listed=4 restored=4`, `SCHEMA_HASH_MISMATCH=0`, `PASS BR-207`.
4. **Closure SHAs that are not on main.** R-70's closure_commit_sha 594d0947 is not an ancestor of compliance-tracker
   main (PR #1771 was squash-merged as db469a9e; evidence_ref uses db469a9e). In projexa, R-B2 (b236009e), R-95 (e39f5437)
   and R-97 (a9fa2aeb) are branch commits of PRs #296, #297 and #299, squash-merged as 7886f1d7, 0411dba1 and c4ce4fae,
   which evidence_ref uses; R-80, R-81 and R-82 (e677e393) are on projexa main through the merge commit cc4b84f4 of PR
   #281, which evidence_ref uses. The closure_commit_sha column itself was not changed.
5. **evidence_ref can name a projexa commit.** For rows whose closure_repo is 'projexa' the evidence_ref is a projexa
   commit (R-11, R-15, R-30, R-31, R-41, R-42, R-43, R-48, R-60, R-62, R-80, R-81, R-82, R-90, R-92, R-94, R-95, R-97,
   R-99, R-100, R-B2). The allowed forms carry no repository name, so closure_repo is what says which repository to look
   in. R-94, R-99 and R-100 list compliance-tracker test files in closure_test_path while closure_repo says projexa.
6. **R-63 needs a role that sees tenant rows.** Its SQL through the MCP returned 1 (AED); the same verify_command run with
   the .env.local connection (role app_runtime) printed 0 and exited 1, because RLS hides the row (PMD-22).
7. **EXC-ITEM built and verified values.** built = 'YES' for items 1-28 means the detector exists on main and its
   verify_command passed on 2026-09-25; verified_in_db and tested_in_live_ui are NULL (never checked against live data or
   the PROJEXA exceptions screen), status is 'OPEN - ...', closure_state 'OPEN'. The items share detectors exactly as the
   service's own header says (1 and 8, 13 and 14, 15 and 16, 18 and 27, 20 and 26), so those pairs have identical
   verify_commands.
8. **Out of this item's four rows but seen on the way.** BR-312 (also U-22, check-register-consistency.mjs) was not in
   scope and is untouched. That script's `EXPECTED_CLOSURE_DRIFT_IDS` lists 15 rows as CLOSED with a FALSE component;
   live on 2026-09-25 only R-C17 has a FALSE component (c1), so the literal is stale.

## How the checks were run

- `bun test` commands: one at a time, each through the machine lock (`C:\ct\ct-worktrees\heavy.ps1`), in Git Bash from the
  worktree root, on branch feat/build-001-u22-requirement-evidence at origin/main 2014b10e. 86 distinct commands, all exit
  0. A `-t` pattern that matches no test makes bun exit 1 ("regex matched 0 tests"), and every pattern was checked to
  match at least one test in every file its command names.
- SQL: SELECT only. R-10 ran as written with the .env.local connection (app_runtime; catalog queries are exact under it)
  and through the MCP; R-63 and the register counts through the Supabase MCP (role postgres), dated 2026-09-25.
- evidence_ref: each SHA was checked to exist in its own repository, to be on that repository's main, and (for closure
  commits) to contain the row's closure test file; PR merge commits were read with `gh`.
- The 0616/0617 proof: `bun test --isolate src/lib/services/sumeet-requirements-evidence-migration.pglite.test.ts`, 8 pass.
  Falsifiability: with `evidence_ref = coalesce(...)` in 0617 replaced by a plain overwrite, tests 3 and 6 failed; with
  one `DROP COLUMN` removed from 0616's down file, tests 7 and 8 failed; both files restored byte-for-byte.

## Per-requirement table

Every verify_command runs from the compliance-tracker repository root. `(ct half only)` marks a PASS that checks only the
compliance-tracker code behind a PROJEXA screen. A `|` inside a command is written `\|` in this table.

| id | built / DONE | verify_command | evidence_ref | what was run, result (2026-09-25) | finding |
|---|---|---|---|---|---|
| R-01 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts src/app/api/v1/construction/boq/boq-route.nested-pricing.test.ts` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 001: 4 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | Route-level BOQ saves (header-only and a 3-level hierarchy) through the real POST handler and service. The browser half (e2e/r01-r02-boq-create-env1.spec.ts, Playwright) is not runnable here. |
| R-02 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.test.ts -t "computeHierarchicalAmount"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 002: 7 pass, 0 fail (1 file), exit 0. **PASS** | Amount = QTY x RATE for a plain line, and the root-derived amount for sub-tasks. The row's browser spec (e2e/r01-r02-boq-create-env1.spec.ts, Playwright) is not runnable here. |
| R-03 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-03:"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 003: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-04 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-04:"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 004: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-10 | YES / DONE | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from information_schema.columns where table_schema = 'compliance' and table_name = 'construction_boq_line_items' and column_name in ('item_code', 'parent_line_item_id', 'breakdown_percentage')" --equals 3` | `b3de3e1ad613849b8c4f40fa8a000a93793b2398` | sql-assert as app_runtime (catalog): stdout 3, exit 0; same SELECT through the MCP: 3. **PASS** | Catalog query, exact for any role that holds privileges on the table. |
| R-11 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 005: 3 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half only: the create route accepts and validates Item Code / Parent Item Code / Breakdown %. The form itself is PROJEXA UI; its proof (projexa e2e/r11-boq-create-form-subtask-fields-env1.spec.ts, Playwright) is not runnable here. |
| R-12 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.weighted-subtask-pricing.test.ts -t "R-12"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 006: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-13 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.weighted-subtask-pricing.test.ts -t "R-13"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 007: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-14 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-14:"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 008: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-15 | YES / - | -- | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | **NOT RUNNABLE HERE**: no verify_command (see finding) | The running total is computed and shown only in the PROJEXA View dialog; compliance-tracker has no code for it. Its proof (projexa e2e/r15-r30-r31-boq-view-env1.spec.ts, Playwright) cannot run from this repo, so no verify_command is set. |
| R-16 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-16"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 009: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-17 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-17"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 010: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-18 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.parent-code-validation.test.ts -t "R-18"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 011: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-19 | YES / DONE | `bun test --isolate src/app/api/v1/construction/boq/boq-route.nested-pricing.test.ts -t "R-19"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 012: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-20 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-20"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 013: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-21 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.revision-variation.test.ts -t "R-21"` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 014: 8 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-22 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.scope-reduction-guard.test.ts -t "R-22"` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 015: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-23 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.scope-reduction-guard.test.ts src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-23\|R-C13"` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 016: 2 pass, 0 fail (2 files), exit 0. **PASS** | Pure guard (R-23) plus the full service call that raises the 409 (the R-C13 describe), as the row's own status text recommends. |
| R-24 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.revision-variation.test.ts -t "R-24"` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 017: 4 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-30 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.dual-view-wiring.test.ts -t "getBoq"` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 018: 5 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half only: getBoq returns the BOQ's line items. Seeing them is PROJEXA UI (projexa e2e/r15-r30-r31-boq-view-env1.spec.ts, Playwright), not runnable here. |
| R-31 | YES / DONE | -- | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | **NOT RUNNABLE HERE**: no verify_command (see finding) | Indenting and the '% of parent' label are PROJEXA rendering only; compliance-tracker has no code for it. Its proof (projexa e2e/r15-r30-r31-boq-view-env1.spec.ts, Playwright) cannot run from this repo, so no verify_command is set. |
| R-32 | YES / DONE | `bun test --isolate src/lib/services/boq-dual-view-service.test.ts src/lib/services/construction-boq-service.dual-view-wiring.test.ts -t "R-32"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 019: 6 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | The root-lines-only roll-up (5000, not the double count) in the dual-view service and in getBoq. The browser spec (e2e/r32-boq-total-excludes-subtasks-env1.spec.ts, Playwright) is not runnable here. |
| R-33 | YES / - | `bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-33"` | `8f87a2b79cbe88ff221cec09469df2c44cbb24ab` | bun test run 020: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-40 | YES / - | `bun test --isolate src/lib/services/construction-progress-service.test.ts -t "createProgressEntry"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 021: 10 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | Service half: progress entries against BOQ lines (partial percentages, the parent-line refusal is in updateProgressEntry). The browser spec (e2e/r40-work-progress-weighted-subtask-env1.spec.ts, Playwright) is not runnable here; the row's status still says 'unverified end to end'. |
| R-41 | YES / - | `bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 022: 12 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: the Previous / Current / Total arithmetic of the Work Progress Report export served by compliance-tracker. The PROJEXA screen computes its own copy (projexa src/lib/work-progress-report.ts); its spec (projexa e2e/r41-r42-r43-work-progress-report-columns-env1.spec.ts) is not runnable here. |
| R-42 | YES / - | `bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 022: 12 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | Same as R-41 (quantity columns). |
| R-43 | YES / - | `bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts -t "computeRows"` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 022: 12 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | Same as R-41 (amount and balance columns). |
| R-44 | YES / - | `bun test --isolate src/lib/services/construction-reports-service.earned-value.test.ts -t "R-44:"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 023: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-45 | YES / - | `bun test --isolate src/lib/services/construction-reports-service.earned-value.test.ts -t "R-45:"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 024: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-46 | YES / DONE | `bun test --isolate src/lib/services/construction-progress-service.test.ts -t "R-46"` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 025: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-47 | YES / - | `bun test --isolate src/lib/services/construction-progress-service.test.ts -t "outside 0-100\|assertPercentComplete"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 026: 4 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-48 | YES / DONE | `bun test --isolate src/lib/pdf/work-progress-report-pdf.test.ts src/app/api/v1/projexa/work-progress/report/pdf/route.test.ts` | `2b6bfbb88a30f15e47b9a3e770c05ebceecff8bd` | bun test run 027: 24 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: the daily Work Progress Report (PDF) is generated for a real project. The photos live only in PROJEXA (its own storage bucket and table); their proof (projexa src/app/api/work-progress/photos/route.test.ts) is not runnable here. |
| R-50 | NO / - | `bun test --isolate src/app/api/v1/projexa/dashboard/route.test.ts "src/app/api/v1/projexa/dashboard/[projectId]/route.test.ts" -t "R-50"` | `02fca7415d9f133298cb19711057d2b816c8769a` | bun test run 028: 8 pass, 0 fail (2 files), exit 0. **PASS** | Role-based redaction of the dual-view figures on the dashboard routes. The row says built=NO. |
| R-51 | YES / DONE | `bun test --isolate src/lib/services/construction-dashboard-service.test.ts src/lib/services/construction-reports-service.test.ts -t "earned value\|earnedValue\|R-51"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 029: 16 pass, 0 fail (2 files), exit 0. **PASS** |  |
| R-52 | YES / - | `bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-52"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 030: 3 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-60 | YES / DONE | `bun test --isolate src/lib/services/erp-accounting-service.test.ts src/app/api/v1/projexa/currencies/route.test.ts` | `5e1d24a66e4cf4f54e61d913c1315aafb9d8df26` | bun test run 031: 7 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: the org's currency is a stored row and is served. Showing AED on the BOQ screen is PROJEXA UI (projexa e2e/r60-boq-currency-env1.spec.ts, Playwright), not runnable here. |
| R-61 | YES / DONE | `bun test --isolate src/lib/services/erp-accounting-service.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 032: 3 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-62 | YES / - | `bun test --isolate src/lib/services/erp-accounting-service.test.ts -t "getBaseCurrency"` | `2b6bfbb88a30f15e47b9a3e770c05ebceecff8bd` | bun test run 033: 1 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: each org reads back its own stored base currency. The screens are PROJEXA UI (projexa src/lib/currency-fallback-env.test.ts), not runnable here. |
| R-63 | YES / - | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from compliance.erp_currencies where org_id = 'projexa_demo_org' and is_base_currency" --equals 1` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | Through the MCP (role postgres): SQL 2026-09-25: 1 (AED). **PASS**. As app_runtime the same command prints 0 and exits 1: RLS hides the row (PMD-22), so run it with a role that sees tenant rows. | Tenant data: run as a role that can see compliance.erp_currencies rows (PMD-22). |
| R-70 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-import-service.test.ts src/lib/services/construction-boq-service.test.ts -t "Sumeet real-file shape\|R-70"` | `db469a9e52f8f0b6423c7cf61a4d7963f6f9adbd` | bun test run 034: 19 pass, 0 fail (2 files), exit 0. **PASS** |  |
| R-71 | YES / - | `bun test --isolate src/lib/services/construction-boq-import-service.test.ts -t "clear 400 error\|BLOCKING issue\|blocking too\|skipped with a warning"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 035: 4 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-72 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-import-service.test.ts -t "mapBoqHeaders\|Sumeet real-file shape"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 036: 14 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-80 | YES / DONE | `bun test --isolate src/app/api/v1/projexa/assistant/route.test.ts src/app/api/v1/projexa/chain-options/route.test.ts` | `cc4b84f47a2e06238f728fde138975af5e434d32` | bun test run 037: 15 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: the chain-options ladder ends on real routes and the assistant dispatch runs for real. The click-through is PROJEXA UI (projexa e2e/r80-r81-r82-copilot-pill-chain-env1.spec.ts, Playwright), not runnable here. |
| R-81 | YES / DONE | `bun test --isolate src/app/api/v1/projexa/module-chain/route.test.ts src/app/api/v1/projexa/chain-options/route.test.ts` | `cc4b84f47a2e06238f728fde138975af5e434d32` | bun test run 038: 20 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: the module chain and each ladder level are served from real data. Hiding unwired pills is PROJEXA UI (same Playwright spec as R-80), not runnable here. |
| R-82 | YES / DONE | `bun test --isolate src/app/api/v1/projexa/assistant/route.test.ts` | `cc4b84f47a2e06238f728fde138975af5e434d32` | bun test run 039: 2 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: the assistant reaches project data through a real tool dispatch. The panel is PROJEXA UI (same Playwright spec as R-80), not runnable here. |
| R-90 | YES / - | `bun test --isolate src/app/api/v1/construction/boq/boq-route.creation-closure.test.ts -t "R-04:"` | `63e7e43ac8474f899da67a6e7812d7f238b6ee15` | bun test run 004: 1 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: the backend answers with a real, field-naming message. Showing it in the toast is PROJEXA UI (projexa e2e/r90-real-backend-error-in-toast-env1.spec.ts, Playwright), not runnable here. |
| R-91 | n/a / DONE | `bun test --isolate src/lib/errors/error-catalog.test.ts -t "friendlyErrorMessage"` | `f051b3da40cafc048fcd57b5204702f45869f1f5` | bun test run 040: 4 pass, 0 fail (1 file), exit 0. **PASS** | ct's friendlyErrorMessage; the PROJEXA retry fix itself is projexa#163 (use-submit.ts). |
| R-A1 | n/a / DONE | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | Operational action (a credential rotation) with no commit, PR or distinguishing database value; details only in the private KT folder. |
| R-A2 | n/a / DONE | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | Security item; details only in the private KT folder (PMD-25). No commit, PR or dated database value to cite. |
| R-A3 | n/a / DONE | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | Owner decision (repositories stay public). Checkable only by a GitHub read (repo visibility), which is not one of the allowed verify_command or evidence_ref forms. |
| R-A4 | YES / - | `bun test --isolate src/app/api/v1/projexa/scope/route.test.ts -t "R-A4"` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 041: 3 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-A5 | n/a / - | -- | `d40bc80c60c21310fae2952ffc844530c1eab458` | **NOT RUNNABLE HERE**: no verify_command (see finding) | Legal review closed by owner risk acceptance; the disclaimer page is compliance-tracker PR #1724. Not code behaviour, so no verify_command. |
| R-B1 | YES / - | `test "$(git grep -c -F 'test("demo gate: TC-01, TC-10, TC-11, TC-30, TC-40' -- e2e/demo-gate-smoke-env1.spec.ts \| awk -F: '{s+=$2} END {print s+0}')" = "1"` | `4760c244c26f143cdb1401a1547c56fa23a33b5a` | Git Bash: exit 0 (1 declaration). **PASS (presence only)** | Presence only: the one Playwright smoke test exists. Running it needs the Env-1 servers (Playwright is CI-only, DEV_TEST_DEPLOY_PLAN P-03). |
| R-B2 | n/a / - | -- | `7886f1d7ca9fd749ca7306c437bd752d8039ab12` | **NOT RUNNABLE HERE**: no verify_command (see finding) | The demo gate is a PROJEXA Playwright spec (projexa e2e/rb2-boq-create-real-click-and-progress-dropdown-env1.spec.ts); no compliance-tracker-runnable form exists. |
| R-A6 | n/a / DONE | `bun test --isolate src/lib/dependency-pins.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 042: 5 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-A7 | n/a / DONE | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | Owner decision (repositories stay public). Checkable only by a GitHub read (repo visibility), which is not one of the allowed verify_command or evidence_ref forms. |
| R-C01 | YES / DONE | `bun test --isolate src/app/api/v1/projexa/permits/route.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 043: 6 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C02 | YES / DONE | `bun test --isolate src/app/api/v1/projexa/drawings/route.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 044: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C03 | YES / DONE | `bun test --isolate src/app/api/v1/documents/route.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 045: 2 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C04 | YES / DONE | `bun test --isolate "src/app/api/veri-meetings/[id]/minutes/route.test.ts"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 046: 6 pass, 0 fail (1 file), exit 0. **PASS** | Covers live-editable minutes; save-as-PDF and the WhatsApp share are not in this test. |
| R-C07 | YES / DONE | `bun test --isolate src/lib/services/construction-labour-service.test.ts src/lib/services/construction-reports-service.test.ts -t "recordAttendance\|createRosterEntry\|aggregateManpowerDailySummary\|rollUpAttendanceByTrade\|manpower-cost"` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 047: 25 pass, 0 fail (2 files), exit 0. **PASS** |  |
| R-C08 | YES / DONE | `bun test --isolate src/lib/services/construction-materials-service.test.ts` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 048: 29 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C09 | YES / DONE | `bun test --isolate src/lib/services/construction-boq-service.vendor-budget.test.ts` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 049: 2 pass, 0 fail (1 file), exit 0. **PASS** | The row's own caveat stands: vendor NAME resolution on the read side is not in this test. |
| R-C10 | YES / - | `bun test --isolate src/app/api/v1/projexa/schedule/route.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 050: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C11 | YES / - | `bun test --isolate src/lib/services/construction-reports-service.boq-budget-closure.test.ts -t "R-C11"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 051: 2 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C12 | YES / - | `bun test --isolate src/lib/services/pms-time-service.test.ts` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 052: 33 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C13 | YES / - | `bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts -t "R-C13"` | `28cf473c4791e02aeccdc60c25fbd1184f7ef258` | bun test run 053: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C14 | YES / DONE | `bun test --isolate src/app/api/v1/construction/site-instructions/route.test.ts` | `40be85bf3f6622e9a3173a6f50be56b9efd0b089` | bun test run 054: 1 pass, 0 fail (1 file), exit 0. **PASS** |  |
| R-C15 | YES / - | `bun test --isolate src/app/api/v1/projexa/reports/share/route.test.ts "src/app/api/v1/projexa/reports/[reportName]/export/route.test.ts" src/lib/services/report-share-service.shareable-types.test.ts` | `b6999822037f01512e86b86335ef8a6f8b9c67af` | bun test run 055: 17 pass, 0 fail (3 files), exit 0. **PASS** |  |
| R-C16 | NO / - | `bun test --isolate src/lib/crr/capture.test.ts src/lib/crr/recall.test.ts` | `a4eb8c4b21dad2b3f2319d98cf0bacef8a2d6abf` | bun test run 056: 20 pass, 0 fail (2 files), exit 0. **PASS** | Narrowed scope per R83-RC16-SCOPE-01 (capture and recall only). The row says built=NO. |
| R-C17 | null / - | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | OPEN and owner-blocked (inbound email needs DNS/Resend); nothing can prove it yet. |
| R-92 | YES / - | -- | `cb095a32daa4756b7dbf4970ba51f4604128b8e9` | **NOT RUNNABLE HERE**: no verify_command (see finding) | Left/right sync is PROJEXA shell code only. Its proof (projexa src/components/shell/PillStrip.test.tsx and M24Shell.loaded-chain-reset.test.tsx) runs only in the projexa repo, so no compliance-tracker verify_command is set. |
| R-93 | null / - | `bun test --isolate src/lib/services/construction-boq-service.dual-view-wiring.test.ts src/lib/services/boq-dual-view-service.test.ts -t "getBoq\|computeBoqLineMoneyView"` | -- | bun test run 057: 13 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: contract and project quantity/rate per line (the 4 variables) are computed and returned. The grid is PROJEXA UI. No closure commit recorded. |
| R-94 | null / - | `bun test --isolate src/lib/services/pms-taxonomy-service.test.ts src/app/api/v1/projexa/milestones/route.test.ts` | `20cacb8f7918b10136b711c0c86ec05562bfa08c` | bun test run 058: 21 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: milestones are created, read and completion is computed. The PROJEXA screen proof (projexa src/components/MilestonesClient.test.tsx) is not runnable here. |
| R-95 | null / - | `bun test --isolate src/app/api/v1/projexa/billing-claims/route.test.ts "src/app/api/v1/projexa/billing-claims/[id]/route.test.ts"` | `0411dba1d89e9e8400e2aac80d5391264a646807` | bun test run 059: 16 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: billing milestones are created and listed. The write UI proof (projexa e2e/sumeet-billing-milestones-env1.spec.ts, Playwright) is not runnable here. |
| R-96 | null / - | -- | -- | **NOT RUNNABLE HERE**: no verify_command (see finding) | A naming decision in PROJEXA (BOQ is the Scope of Work record); no compliance-tracker behaviour to check. |
| R-97 | null / - | `bun test --isolate src/app/api/v1/projexa/change-orders/route.test.ts` | `c4ce4fae26045371f6e7168a75c9ef152cca39bd` | bun test run 060: 3 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: change orders are created with the real acting user. The PROJEXA flow proof (projexa src/components/ChangeOrdersClient.test.tsx) is not runnable here. |
| R-98 | null / - | `bun test --isolate src/lib/services/construction-boq-service.revision-integration.test.ts` | -- | bun test run 061: 2 pass, 0 fail (1 file), exit 0. **PASS** (ct half only) | ct half: createBoqRevision copies scope forward and blocks a reduction of started work. No closure commit recorded. |
| R-99 | null / - | `bun test --isolate src/lib/services/boq-analysis-service.test.ts src/app/api/v1/projexa/reports/boq-analysis/route.test.ts src/app/api/v1/projexa/billing-claims/route.test.ts` | `20cacb8f7918b10136b711c0c86ec05562bfa08c` | bun test run 062: 35 pass, 0 fail (3 files), exit 0. **PASS** (ct half only) | ct half: the combined analysis and the billing queue. The Project 360 screen proof (projexa src/components/Project360Client.test.tsx) is not runnable here. |
| R-100 | null / - | `bun test --isolate src/lib/services/boq-analysis-service.test.ts src/lib/services/boq-dual-view-service.test.ts -t "THE ANSWER\|computeProfitAtBothLevels"` | `20cacb8f7918b10136b711c0c86ec05562bfa08c` | bun test run 063: 5 pass, 0 fail (2 files), exit 0. **PASS** (ct half only) | ct half: expected and actual profit at both levels. The screen proof (projexa src/components/Project360Client.test.tsx) is not runnable here. |
| EXC-ITEM-01 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findDiaryWithoutProgressEntry\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 064: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findDiaryWithoutProgressEntry. |
| EXC-ITEM-02 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findApprovedChangeOrdersNeverBilled\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 065: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findApprovedChangeOrdersNeverBilled. |
| EXC-ITEM-03 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "drawing with no confirmation\|confirmed drawing reference\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 066: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findUnconfirmedDrawingProgress. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-04 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "superseded drawing\|current drawing version\|findOldDrawingProgress \(#4\)\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 067: 6 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findOldDrawingProgress. |
| EXC-ITEM-05 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findStuckApprovals\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 068: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findStuckApprovals. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-06 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findSelfApprovedChangeOrders\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 069: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findSelfApprovedChangeOrders. Falsifiable: flipping the comparison failed it. |
| EXC-ITEM-07 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findWorkWithoutApprovedBoq\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 070: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findWorkWithoutApprovedBoq. |
| EXC-ITEM-08 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findDiaryWithoutProgressEntry\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 064: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findDiaryWithoutProgressEntry (shared with 1). |
| EXC-ITEM-09 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findProgressNeverBilled\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 071: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findProgressNeverBilled. |
| EXC-ITEM-10 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "open vendor dispute is flagged\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 072: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findOpenVendorDisputes. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-11 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "narrows to work_dispute\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 073: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findOpenCustomerComplaints(work_dispute). Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). Probed: removing the category filter did NOT fail it. |
| EXC-ITEM-12 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "open complaint is flagged\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 074: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findOpenCustomerComplaints. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-13 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findNewBoqRevisions\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 075: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findNewBoqRevisions. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). Probed: flipping isNotNull(parentBoqId) did NOT fail it. |
| EXC-ITEM-14 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findNewBoqRevisions\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 075: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findNewBoqRevisions (shared with 13). Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-15 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findBoqWithoutCustomerApproval\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 076: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findBoqWithoutCustomerApproval. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-16 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findBoqWithoutCustomerApproval\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 076: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findBoqWithoutCustomerApproval (shared with 15). Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-17 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findApprovalsWithoutBoqComparison\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 077: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findApprovalsWithoutBoqComparison. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-18 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findMaterialWithoutBoqLine\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 078: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findMaterialWithoutBoqLine. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-19 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findLateOrDuplicateMaterial\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 079: 5 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findLateOrDuplicateMaterial. |
| EXC-ITEM-20 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findMissingDailyReports\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 080: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findMissingDailyReports. |
| EXC-ITEM-21 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findUnlinkedRoster\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 081: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findUnlinkedRoster. Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-22 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findAmbiguousBoqVersions\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 082: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findAmbiguousBoqVersions. |
| EXC-ITEM-23 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findMismatchedSubcontractorInvoices\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 083: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findMismatchedSubcontractorInvoices. |
| EXC-ITEM-24 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findOverdueSnags\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 084: 5 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findOverdueSnags + findRetentionHeldDespiteSnagsClosed. Its defining predicate (overdue half) is a WHERE clause the test's fake database does not evaluate (finding 1). Falsifiable: renumbering push(24) failed the aggregator test. |
| EXC-ITEM-25 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findApprovalsWithoutEvidence\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 085: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findApprovalsWithoutEvidence. |
| EXC-ITEM-26 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findMissingDailyReports\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 080: 4 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findMissingDailyReports (shared with 20). |
| EXC-ITEM-27 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findMaterialWithoutBoqLine\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 078: 2 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findMaterialWithoutBoqLine (shared with 18). Its defining predicate is a WHERE clause the test's fake database does not evaluate (finding 1). |
| EXC-ITEM-28 | YES / - | `bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t "findProgressRegressions\|returns exactly the 28 numbered items"` | `6d531f534b611ce2f6822b982c8be28369aa5390` | bun test run 086: 3 pass, 0 fail (1 file), exit 0. **PASS** | Detector: findProgressRegressions. |
| EXC-ITEM-29 | n/a / - | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from platform.sumeet_requirements r where r.id ~ '^EXC-ITEM-(0[1-9]\|1[0-9]\|2[0-8])\$' and r.status like 'DONE%' and coalesce(to_jsonb(r)->>'evidence_ref', '') ~ '^([0-9a-f]{7,40}\|PR#[0-9]+\|SQL [0-9]{4}-[0-9]{2}-[0-9]{2}: .+)\$'" --equals 28` | -- | **NOT RUNNABLE HERE** (the columns and rows exist only after 0616/0617 are applied). On the PGlite copy after 0617: 0, expected 28, so it will **FAIL** once applied: no detector item is DONE. | META item: register-level check (BR-310). |
| EXC-ITEM-30 | n/a / - | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from platform.sumeet_requirements r where r.id ~ '^EXC-ITEM-(0[1-9]\|1[0-9]\|2[0-8])\$' and r.built = 'YES' and to_jsonb(r)->>'verify_command' like 'bun test --isolate src/lib/services/construction-exceptions-service.test.ts -t %'" --equals 28` | -- | **NOT RUNNABLE HERE** (needs 0616/0617 applied). On the PGlite copy after 0617: 28 = expected, so it will **PASS** once applied. | META item: register-level check (BR-310). |
| EXC-ITEM-31 | n/a / - | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from platform.sumeet_requirements r where r.id ~ '^EXC-ITEM-(0[1-9]\|1[0-9]\|2[0-8])\$' and r.tested_in_live_ui = 'YES'" --equals 28` | -- | **NOT RUNNABLE HERE** (needs 0616/0617 applied). On the PGlite copy after 0617: 0, expected 28, so it will **FAIL** once applied: no item has been checked on the PROJEXA screen. | META item: register-level check (BR-310). |
