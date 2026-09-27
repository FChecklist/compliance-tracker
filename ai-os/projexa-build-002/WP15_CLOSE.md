# BUILD-002 WP-15: close report (2026-09-27)

Every status in `ACCEPTANCE_REGISTER.csv` comes from a real run of the row's own `verify_command`, in a clean checkout of main (`f0018c11`), one row after another. A row is `pass` only when the command exits 0 and its output matches `expected_output`. Nothing was set by hand.

## Result: 57 of 64 rows pass, 7 do not

| Group | Rows | Status |
| --- | --- | --- |
| WP-00 register, boundary, lint | AW-001 to AW-004 | pass |
| WP-01 multi-sheet reader | AW-101 to AW-104 | pass |
| WP-02 extraction | AW-111 to AW-115 | pass |
| WP-03/04 project and BOQ functions | AW-201 to AW-205 | pass |
| WP-05 coverage waves 1 to 9, exceptions | AW-301 to AW-312 | pass |
| WP-06 record kinds, WP-07 work functions | AW-321, AW-322, AW-331 | pass |
| WP-08 mint dialog (unit tests) | AW-401 to AW-404, AW-406 | pass |
| WP-09 execution function and owner kit | AW-501 to AW-511 | pass |
| Ways 1, 2, 3, 4, 5 | AW-601, AW-602, AW-603, AW-604, AW-605 | pass (way 1 added the same day, see below) |
| Persona runs (dry) | AW-701, AW-702, AW-703 | pass |
| **All ways reconcile to 1,596,280** | AW-606 | **pending** (no script: ways 1, 2 and 5 do not yet all assert the 1,596,280 total and per-line attribution the way ways 3 and 4 do) |
| **Mint dialog in a browser** | AW-405 | **pending** (Playwright, not yet run; the way-1 run showed it is possible with about 1.5 GB free) |
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

- No approve or reject action for new-project scheduler proposals (D-1).
- PDF and docx readers are not built.
- Organisation-level email proposals are not listed under `GET /projects/{id}/approvals`.
- A named report was proved live-shaped only by unit tests; the persona run cannot execute the reporting SQL in the dry world.

## Way 1 (AW-601), added after the first close run

`scripts/verify/way1-zoomies.sh` runs two halves and both must pass. The database half (89 tests) runs the real from-document route and importer on in-process Postgres and re-reads the ZOOMIES project, its 53 lines and AED 1,596,280 from the tables. The screen half runs projexa's `e2e/upload-proposals.spec.ts` with Playwright against a local PROJEXA server, with the page's `/api` calls answered in the browser. Neither half touches the live database or Vercel, the same standard as ways 3 to 5.

The first browser run of that spec failed: it expected "Choose a file and a product to continue." but the page preselects a lone product, and the spec's stub returns exactly one. WP-10 had merged without a browser run. The spec was corrected in FChecklist/projexa#328 (the page was right); the rerun passes 3 of 3. That PR's CI had one flaky unit test and one Google Fonts fetch failure, each passing on rerun.
