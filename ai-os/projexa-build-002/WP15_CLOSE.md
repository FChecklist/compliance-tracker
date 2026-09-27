# BUILD-002 WP-15: close report (2026-09-27)

Every status in `ACCEPTANCE_REGISTER.csv` comes from a real run of the row's own `verify_command`, in a clean checkout of main (`f0018c11`), one row after another. A row is `pass` only when the command exits 0 and its output matches `expected_output`. Nothing was set by hand.

## Result: 58 of 64 rows pass, 6 do not

| Group | Rows | Status |
| --- | --- | --- |
| WP-00 register, boundary, lint | AW-001 to AW-004 | pass |
| WP-01 multi-sheet reader | AW-101 to AW-104 | pass |
| WP-02 extraction | AW-111 to AW-115 | pass |
| WP-03/04 project and BOQ functions | AW-201 to AW-205 | pass |
| WP-05 coverage waves 1 to 9, exceptions | AW-301 to AW-312 | pass |
| WP-06 record kinds, WP-07 work functions | AW-321, AW-322, AW-331 | pass |
| WP-08 mint dialog (unit tests and the browser test) | AW-401 to AW-406 | pass |
| WP-09 execution function and owner kit | AW-501 to AW-511 | pass |
| Ways 1, 2, 3, 4, 5 | AW-601, AW-602, AW-603, AW-604, AW-605 | pass (way 1 added the same day, see below) |
| Persona runs (dry) | AW-701, AW-702, AW-703 | pass |
| **All ways reconcile to 1,596,280** | AW-606 | **pass**: `ways-reconcile.sh` exits 0. Ways 1, 2, 4 and 5 reconcile on real tables (`ways-reconcile.pglite.test.ts`), way 3 through its persona run (AW-603). Way 5 needed the approve action added on 2026-09-27 (see below) |
| Owner-blocked | AW-901 to AW-905 | pending, by design: they need the owner's switch-on, secrets, DNS or a live run |

## Built during the close because a row named something that did not exist

- `COVERAGE_111.csv` (AW-004, AW-312): assembled by `scripts/verify/build002-assemble-coverage.mjs` from the wave fragments plus `COVERAGE_EXCLUSIONS.csv`. 82 requirements come from the wave fragments; 29 come from the exclusions file, each with a reason (schema facts, screen rules, security and legal items, test evidence, three meta items). One of the 29, R-C15, also names the function that reads reports. The script refuses to write the file if a requirement is in neither place, and `--check` says whether the committed file is current. `submit_timesheet` was added to R-C12.
- `src/lib/services/ai-work-link-manual-size.test.ts` (AW-310): the Markdown manual and the paste card stay inside their budgets with all 94 link functions, for a manager, a member and a viewer, and with a 5,000-character project name. The JSON form is not budgeted (it carries the manifest twice by design) and the test says so. Checked by lowering the budget: 3 of 5 tests fail.
- `src/lib/pipeline/coverage-exclusions.test.ts` (AW-311): model calls, organisation-wide reads, creating a project and the personal-HR function stay off every link, and no function on a link is a delete, secret, credential, admin or model function by name. Checked by weakening one reason: 2 of 7 tests fail.
- `scripts/verify/way2-zoomies.sh` (AW-602): runs the four way-2 test files (69 tests).

## Also done in this close

- #1931 merged: function reads through the link, one seal per area, `submit_timesheet`, seed 0651 (live, ledger 484). Its conflict with the dry persona run was fixed: a named report answers 200 live, and in the dry world (no reporting SQL) it may answer 422 `INTERNAL_ERROR`.
- Edge functions redeployed from main `f0018c11`: `ai-work-link` v9 and `ai-work-link-exec` v6. The exec function answers 503 `NOT_CONFIGURED` until the owner sets its two secrets.

## What only the owner can do

Unchanged, see `OWNER_SWITCH_ON_GUIDE.md`, `OWNER_EMAIL_CHECKLIST.md` and `OWNER_WAY5_STEPS.md`: the execution secrets and pre-flight, the `EXEC_FUNCTION_PRESENT` flip and prepared migration 0645, the extraction provider secret, the internal-AI billing settings, Resend and DNS for inbound email, Drive or Gmail OAuth for way 5, the Cloudflare deploy of the confirm page with PROJEXA's publishable key, the live persona run (AW-901), and the open owner decisions D-1 to D-7.

## Known gaps, not hidden

- A scanned proposal can be approved (added 2026-09-27) but not rejected: there is no reject action. A proposal is simply left pending or decided by approval.
- PDF and docx readers are not built.
- Organisation-level email proposals are not listed under `GET /projects/{id}/approvals`.
- A named report was proved live-shaped only by unit tests; the persona run cannot execute the reporting SQL in the dry world.

## Way 1 (AW-601), added after the first close run

`scripts/verify/way1-zoomies.sh` runs two halves and both must pass. The database half (89 tests) runs the real from-document route and importer on in-process Postgres and re-reads the ZOOMIES project, its 53 lines and AED 1,596,280 from the tables. The screen half runs projexa's `e2e/upload-proposals.spec.ts` with Playwright against a local PROJEXA server, with the page's `/api` calls answered in the browser. Neither half touches the live database or Vercel, the same standard as ways 3 to 5.

The first browser run of that spec failed: it expected "Choose a file and a product to continue." but the page preselects a lone product, and the spec's stub returns exactly one. WP-10 had merged without a browser run. The spec was corrected in FChecklist/projexa#328 (the page was right); the rerun passes 3 of 3. That PR's CI had one flaky unit test and one Google Fonts fetch failure, each passing on rerun.

## Mint dialog in a browser (AW-405) and the cross-way reconcile (AW-606)

AW-405 ran the same way as AW-601 (`projexa-playwright.sh e2e/ai-link-mint.spec.ts` against a local PROJEXA on main): the screen test passed in 21.9 s. The file's second test, the live one, is skipped in the local config by design; it needs a live session and is part of AW-903.

AW-606 got `src/lib/services/ways-reconcile.pglite.test.ts` and `scripts/verify/ways-reconcile.sh`. The test drives the upload route, the internal chat orchestrator (on the real service, ledger, project and BOQ writers) and the email-job approval on real Postgres, and reads back from the tables: 1 project, 1 BOQ, 53 lines, AED 1,596,280, the same lines in each way, the BOQ's creator and the project's lead a real user. It fails when the BOQ is attributed to someone else and when one rate is changed (both checked). The script adds way 3 (AW-603) and way 5 (AW-605) and exits 3 (partial) because way 5 ends in a parked proposal and creates no project. (This paragraph describes the first cut, which exited 3; the approve action below closed it.)

## Way 5 approve action (AW-606 closed), added 2026-09-27 on the owner's instruction

`POST /api/v1/projexa/scheduler-proposals/<id>/approve` (`src/app/api/v1/projexa/scheduler-proposals/[id]/approve/route.ts`, service `src/lib/services/folder-watch-approve.ts`). The list (`GET /scheduler-proposals`) now gives each folder proposal an `approve` action.

The design decision that D-1 had left open: **the file is fetched again at approval time**, from the same mailbox or Drive folder, with the schedule owner's own active connection. No bytes are stored between the scan and the approval, so no retention rule and no new table are needed. Consequences, all tested:

- Only the person whose schedule prepared the proposal can approve it (their connection is the one that can read the file). A manager sees the list but cannot approve.
- The file fetched again must hash to the sha256 the proposal recorded. A Drive file edited after the scan, or a message that is gone, is refused with `file_changed` and nothing is made; the next scan proposes the new file.
- The project is made by the same `startExtractionJob` and `runExtractionJob` as an upload, a chat attachment and an email, with the real `createProject` and `createBoq`. The parked job is finished from what it stored, so no second model call is made. The approving person is the project's lead and the BOQ's creator.
- One approval per proposal (one conditional UPDATE, the pattern of `prepared-proposals.ts`); two overlapping approvals make one project. The claim is given back only when nothing was made.
- Not connected: 409 `source_not_connected`; source cannot hand the file over: 502; open questions without `acknowledgeQuestions`: 200 `needs_answers`, nothing made.

Still UNVERIFIED against a live account, as before: the shape of Composio's download response (`folder-watch-connectors.ts` header). That needs the owner's Drive or mailbox connection (AW-904/`OWNER_WAY5_STEPS.md`), and is not a check this run can make.
