# Sumeet register re-check, P8 (2026-10-08)

Method: repo only (no live DB, no Supabase, no projexa edits). Sources: `drizzle/0617_build001_requirement_evidence_data.sql` (verify_command + evidence_ref per row), `ai-os/projexa-build-001/U22_REQUIREMENT_CHECKS.md` (the PM's run log per row), `REQUIREMENTS_111_REGISTER.csv`, the test files themselves. "6 conditions" = R74-RULING-03: (a) named committed re-runnable test, (b) through the real surface, (c) seen to FAIL when broken, (d) passes on a recorded SHA, (e) asserts the PERSISTED outcome by re-reading, (f) recorded against the id with path + run timestamp.
Conditions (d) and (f) for anything added below are NOT done: they need `platform.sumeet_requirements` (live DB) to be updated by the PM after these tests are on a merged commit; I could not and did not touch it.

## Summary table
| Row | Verdict before | Committed test(s) found | After this pass |
|---|---|---|---|
| R-15 | NOT closed (no verify_command) | only PROJEXA `e2e/r15-r30-r31-boq-view-env1.spec.ts` (projexa repo, live Env-1) | still NOT closeable from ct; needs the projexa spec re-run |
| R-40 | NOT closed (service half only) | ct: `construction-progress-service.test.ts` (createProgressEntry, mocked tx), `construction-reports-service.earned-value.test.ts`; spec `e2e/r40-work-progress-weighted-subtask-env1.spec.ts` (in THIS repo, runs against live Env-1) | still NOT closed; blocked on an infra decision |
| R-47 | service-level only | `construction-progress-service.test.ts` (assertPercentComplete, updateProgressEntry) | **route-level test added**, mutant proven |
| R-71 | pure-function only | `construction-boq-import-service.test.ts` (mapRowsToLineItems issues); `scope/import/route.test.ts` covers actor attribution only | **route test with the real parser added**, mutant proven |
| R-96 | no behaviour to test | none; U22 says "naming decision in PROJEXA" | owner decision, see below |
| R-97 | note was wrong (link exists) | `executor.boq-revision.test.ts` (AI pipeline), `change-orders/route.test.ts` (actor only) | **REST route test added**, mutant proven |
| R-C13 | fake-DB service test only | `construction-boq-service.revision-integration.test.ts -t R-C13` (fake db), `...scope-reduction-guard.test.ts` (pure fn) | **REST route test added** on the stateful store double, mutant proven |

## Per row

### R-15 Weighted Sub-Tasks, running child-percentage total
- Status text: "BUILT IN PROJEXA - CORRECTED BY CHAT 22 AUG". U22 log: the total is computed and drawn only in PROJEXA's View dialog; compliance-tracker has no code for it; `verify_command` is NULL in 0617.
- Only proof: projexa `e2e/r15-r30-r31-boq-view-env1.spec.ts` (Playwright against live Env-1, projexa repo, read-only for me). It needs the same minted-session login as R-40, so it carries the same blocker.
- Conditions: (a) yes (in projexa), (b) yes (browser), (c) unknown, (d) evidence_ref 63e7e43a recorded but no run after the 2026-09-30 login break, (e) unknown, (f) no run record.
- Missing step: re-run that spec once login works, or add a component test inside projexa for the View dialog total with a falsification run. Not doable from ct.

### R-40 Record partial progress against a weighted sub-task
- ct half: `construction-progress-service.test.ts` createProgressEntry (10 pass in PM run 021 at 28cf473c); earned-value math in `construction-reports-service.earned-value.test.ts`. Both mock the transaction.
- A browser/API spec exists IN THIS REPO: `e2e/r40-work-progress-weighted-subtask-env1.spec.ts` (create weighted BOQ, record an entry, expect 750 earned value / 15%). It mints a session through Supabase Edge Function `mint-session-r33` with the legacy anon JWT, which now gets 401 (project evpckeuxgvahguwsaeul).
- Missing step (owner decision, already in AUDIT_17_POINTS): re-enable the legacy key, or move the spec to the publishable key, then run `bunx playwright test e2e/r40-...` and record SHA + timestamp. A ct-only PGlite test of the 750/15% roll-up is possible (pattern: `route.headers.test.ts`) but I did not build it; it would not replace the spec (condition b is "real surface").

### R-47 Progress above 100% rejected
- Truth: server-side. `assertPercentComplete()` in `construction-progress-service.ts` (~line 704), called by createProgressEntry before any transaction and by updateProgressEntry.
- ADDED `src/app/api/v1/projexa/work-progress/route.r47.test.ts`: posts 100.01, 140, 1000, -1 to the real POST handler, expects 400 "percentComplete must be between 0 and 100", the store (re-read) holds no entry and zero transactions were opened; exactly 100 passes the range rule (reaches the project lookup, 404 from the empty fake). 5 pass.
- Mutant: `percentComplete > 100` changed to `> 10000` in the service: 3 tests failed; reverted (git diff clean).
- Not met: the exact-100 case does not prove a persisted row (the fake DB has no project). Condition (f) pending. The "or capped" wording does not apply; the rule is reject.

### R-71 Import: malformed row rejected readably
- Behaviour: `mapRowsToLineItems` skips a row with non-numeric Qty/Rate and records `{row, message: "Row N: Qty is not a number", blocking: true}`; the preview counts it; the commit imports the remaining rows. So it is "bad row rejected, rest imported", and the whole file is refused only when every row is bad.
- ADDED `src/app/api/v1/projexa/scope/import/route.r71.test.ts`: real CSV, real route, real parser. Preview names row 3, rowsWithErrors 1, readyLines 2, nothing written; commit hands only the two good rows to the writer; an all-bad file gives 400 "No usable line items found in this spreadsheet", nothing written. 3 pass.
- Mutant: disabled the Qty malformed check (construction-boq-import-service.ts line 180): all 3 failed; reverted.
- Not met: the BOQ write service is doubled, so "persisted" means "what the writer received", not a DB re-read. The PROJEXA screen's wording of the issue is not tested here.

### R-96 BOQ vs Scope of Work naming
- No ct behaviour. `projexa/scope` is a 4-line re-export of `construction/boq`; the U22 log calls it "a naming decision in PROJEXA (BOQ is the Scope of Work record)". Closed 2026-09-18 with a naming caveat, no commit SHA, no verify_command.
- Existing tests only show the `/api/v1/projexa/scope` surface returns BOQ data (`projexa/scope/route.test.ts`, `construction/boq/route.headers.test.ts`). They do not prove the owner's requirement ("scope of work must be a real concept"). This is a product decision (a separate screen named Scope of Work?). Owner-needed; a test cannot close it.

### R-97 Change of scope end to end (change order <-> BOQ revision)
- **Which note is true: the link now EXISTS.** `constructionChangeOrders.boqRevisionId` (`src/lib/db/schema.ts` line 11966; DB column added by migration 0430, `boq_revision_id text`, nullable, no FK, no unique constraint). It is populated by `createBoqRevision(ctx, parentBoqId, { sourceChangeOrderId })` (`construction-boq-service.ts` ~1793-1830, written inside the same transaction at ~1916): only an APPROVED change order can be linked, each change order once (409), a change order of another org or project is refused. The code comment names this the "R-98 fix 2026-09-19". The earlier "no changeOrderId link exists" note is stale. The pointer lives on the change-order side (CO -> revision); the BOQ revision row has no back-pointer. `findApprovedChangeOrdersNeverBilled` (`construction-exceptions-service.ts` ~122-160) reads exactly that column (`isNotNull(boqRevisionId)`).
- Callers: the AI pipeline `create_boq_revision` (forwards sourceChangeOrderId; proven by `executor.boq-revision.test.ts`, which re-reads the store) and the REST route `POST /api/v1/(construction|projexa)/scope/{id}/revisions` (passes the body straight through; PROJEXA `ScopeReviseClient.tsx` and `ChangeOrderObjectClient.tsx` send it as `fromChangeOrder` - I only grepped this, did not run it). There was NO test through the REST route.
- ADDED `src/app/api/v1/projexa/scope/[id]/revisions/route.r97.test.ts` (shared with R-C13): approved CO links and the re-read `boqRevisionId` equals the new revision; a second link attempt gives 409 with the store byte-identical; a draft CO gives 400 with the store identical. 5 pass in the file.
- Mutant: link write replaced with `boqRevisionId: null` (construction-boq-service.ts ~1916): 2 tests failed; reverted.
- Not met: the PROJEXA UI half (ChangeOrdersClient / ScopeReviseClient flow) needs a projexa component or Playwright test; "end-to-end" as worded is the UI flow. The PM should correct the status text to say the link exists.

### R-C13 Negative variation checked against Work Progress
- Rule: `createBoqRevision` -> `findScopeReductionViolations` -> `ScopeReductionError` 409 with `conflicts`, unless `allowScopeReductionOverride === true`.
- Earlier proof: a fake-DB service test (R-C13 in `revision-integration.test.ts`) and a pure-function guard test. Neither goes through the route nor re-reads state.
- ADDED in the same route.r97 file: reducing A1 (40% done) gives 409, body.conflicts names A1, the store is byte-identical, the parent is still approved; with the override true it gives 201 and the re-read revision line A1 has quantity 60.
- Mutant: `false && violations.length > 0 && ...` at construction-boq-service.ts:1897: the 409 test failed; reverted.

## Disclaimer page placeholders (R-A5)
`src/app/disclaimer/page.tsx` lines 34, 35 and 256 render `[INSERT CONTACT EMAIL]`, `[INSERT WEBSITE]`, `[INSERT DATE]`. This is the main VERIDIAN ERP app's page, not the static veridian-aios.com DPDP pages. **NOT changed**, owner-needed:
- Email: the repo holds `dpdp@veridian-aios.com` (the DPDP product mailbox, used by the new static pages per `dpdp-app/docs/LEGAL-AUDIT-2026-09-30.md`) and the owner's personal address in AGENTS.md (an account identity record, not a published legal-notice address). Which one goes into a legal notice (section 23, notices of claimed infringement) is the owner's call; the page's own header comment says do not invent values.
- Website: `veridian-aios.com` appears for the DPDP site; whether the ERP disclaimer should name that site is not stated.
- Date: the source document `VERIDIAN-Disclaimer-v2_1.docx` is not in the repo; "Version 2.0" appears on the page but no effective date anywhere.
- The legal audit (F1, F3) also says the ERP disclaimer and the Terms disagree (liability cap, arbitration), so filling the blanks alone does not make that page final.

## Not verified / not done
- The new tests were run with bun only; not typechecked with `tsc` or linted (RAM). One uses `as any` for the request double, as the neighbouring test does.
- No live DB or browser run; no `platform.sumeet_requirements` update. SHA and recording (conditions d, f) are for the PM after these commits merge.
- R-15, R-40, R-96 are not closeable from this repo. The projexa-side specs were not read in depth.
