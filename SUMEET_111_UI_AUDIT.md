# SUMEET 111 UI AUDIT (2026-10-19)

## Read this first: what this document is and is not

The brief asked for every requirement to be proven by driving the real app in a browser. **That was not done.** Reasons, all environmental and recorded honestly:

- Free RAM on this 8GB laptop was 0.2-0.9 GB for the whole session (18 Claude processes, user Chrome, another session's `bun test`). The brief's own rule is one heavy process at a time and >1.2 GB free.
- The coordinator then ordered ONE dev server only; the app needs two (compliance-tracker :3000 + PROJEXA :3100). The Tambola session also took `C:\ct\heavy.lock` after I released it on request.
- I did get the backend (:3000, from this worktree at origin/main 00f52be1, which includes ct#2164) to start and answer `GET /api/v1/projexa/projects` with 200 using the E2E Meridian org key. No requirement was exercised beyond that. Frontend dev (:3100) crashed on the node_modules junction until `turbopack.root` was pinned to `C:/ct` (local-only edit, not committed); it was never re-started.

Therefore **no requirement below is marked WORKING by this session** (rule 6: never from code alone). The verdict column is `NOT-DRIVEN` for everything, plus the extra flags that I could establish without a server: the screen file exists (checked in `C:\ct\projexa-wt-audit`, PR #456 head 65f83d23), and the recorded `platform.sumeet_requirements` status. Treat the recorded status as the earlier sessions' claim, not mine.

## Findings that do not need a browser

1. **No site-instruction screen of its own (R-C14).** The only UI is inside `/scope/[id]` (ScopeObjectClient); no `/site-instructions` page exists. Schema is assumed industry-standard, not Sumeet's form.
2. **R-47 percent entries are uncapped on the server** (known finding 2026-10-14: six 60% entries stored as 360%). A branch `fix/r47-percent-entries-cap` exists in the main compliance-tracker checkout (9f08a381); not merged.
3. **R-C16 (CRR) has no screen**; closed only for capture+recall tests (R83-RC16-SCOPE-01). **R-C17 (email engine) is BLOCKED by owner**: needs Resend Inbound + MX for projexa-ai.com; only outbound send exists.
4. **R-71 and R-15 are source-verified only** in their recorded status (no observed screen).
5. **R-50 UI exists** (BoqDualViewGrid, DashboardHomeView) despite the older row text 'no route renders dual view'; recorded status was later CLOSED 2026-09-13.
6. **R-A*/R-B* are security/legal/test rows**, not walked. Recorded: A1-A5, A7 done; A6 recorded done though the evidence text still says PR #7 open (inconsistent, check the kit repo); B1/B2 closed 2026-09-13/20 against production, which cannot be re-run locally.
7. The New Project form is name-only on PR #456 (`projects/new/page.tsx` comment confirms no product picker); #456 is OPEN and BLOCKED (checks not green at last look). ct#2164 is merged.

## Per-requirement table

| id | screen/route | input tried | output observed | persisted? | verdict | note (recorded status, truncated) |
|---|---|---|---|---|---|---|
| EXC-ITEM-01 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Extra work is done, never captured - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-02 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Extra work is done, never billed - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-03 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Site builds from the drawing but not confirmed - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-04 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Site builds from the old drawing - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-05 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Approvals stuck - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-06 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Wrong approval given - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-07 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Work without approval happened - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-08 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Work happened not captured - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-09 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Work happened not billed - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-10 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Work disputed with vendor - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-11 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Work disputed by customer - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-12 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Customer complained - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-13 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | New SCOPE OF WORK decided - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-14 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | New BOQ decided - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-15 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Approval from customer on new SCOPE OF WORK - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-16 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Approval from customer on new BOQ - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-17 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Approvals given without comparing SCOPE OF WORK AND BOQ - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-18 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Material ordered WITHOUT SCOPE OF WORK AND BOQ - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-19 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Material ordered twice, or late - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-20 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The daily report never arrives - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-21 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Manpower on paper, payroll disputes - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-22 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Multiple versions of the BOQ -- which one is final, which is worked up - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-23 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Subcontractor invoices don't match the work - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-24 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | Snags lost, retention held - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-25 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The user decides from memory - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-26 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The user forgets - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-27 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The user doesn't remember - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-28 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The user reports wrong but it should be caught by software - recorded: DONE - VERIFIED (2026-09-30, ct PR #2004 a274ff57 + projexa PR #331 6f |
| EXC-ITEM-29 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The software should do all above (META) - recorded: DONE - VERIFIED (2026-09-30, claude-code sumeet-exceptions-verify): ME |
| EXC-ITEM-30 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | The software should have proper engine, wiring, logic, calculation for - recorded: DONE - VERIFIED (2026-09-30, claude-code sumeet-exceptions-verify): ME |
| EXC-ITEM-31 | /analysis/exceptions (ExceptionsClient) <- GET /api/v1/projexa/exceptions | none | none | n/a | NOT-DRIVEN | PROJEXA-AI.COM should be able to capture, analyze, fix all of these as - recorded: DONE - VERIFIED (2026-09-30, claude-code sumeet-exceptions-verify): ME |
| R-01 | /scope/new | none | none | n/a | NOT-DRIVEN | BOQ saves without server error - recorded: DONE - VERIFIED |
| R-02 | /scope/new | none | none | n/a | NOT-DRIVEN | Line item amount = QTY x RATE - recorded: DONE - VERIFIED |
| R-03 | /scope/new | none | none | n/a | NOT-DRIVEN | BOQ with title only and zero lines is allowed - recorded: DONE - VERIFIED |
| R-04 | /scope/new | none | none | n/a | NOT-DRIVEN | Missing title rejected naming the field - recorded: DONE - VERIFIED |
| R-10 | DB columns | none | none | n/a | NOT-DRIVEN | Sub-task columns exist in production DB - recorded: DONE - VERIFIED (production columns confirmed live 2026-09-11 by PM vi |
| R-100 | /analysis/project-360 | none | none | n/a | NOT-DRIVEN | Profit and loss analysis for the project. Owner directive 2026-09-18,  - recorded: CLOSED 2026-09-18: same Project360Client.tsx screen as R-99, top card  |
| R-11 | /scope/new | none | none | n/a | NOT-DRIVEN | Sub-task enterable in create form (Item Code / Parent Item Code / Brea - recorded: DONE - VERIFIED |
| R-12 | /scope/new | none | none | n/a | NOT-DRIVEN | Sub-task amount = ROOT qty x ROOT rate x breakdown % - recorded: DONE - VERIFIED (break-restore OBSERVED, merged to main) |
| R-13 | /scope/new | none | none | n/a | NOT-DRIVEN | Sub-task own QTY and RATE ignored - recorded: DONE - VERIFIED (break-restore OBSERVED, merged to main) |
| R-14 | /scope/new | none | none | n/a | NOT-DRIVEN | Weights NOT forced to sum to 100 - recorded: DONE - VERIFIED (break-restore OBSERVED, merged to main) |
| R-15 | /scope/new (ScopeClient) | none | none | n/a | NOT-DRIVEN | Running total of child percentages shown per parent - recorded: BUILT IN PROJEXA - CORRECTED BY CHAT 22 AUG (E-112), audited against t |
| R-16 | /scope/new | none | none | n/a | NOT-DRIVEN | Child with parent but no percentage rejected - recorded: DONE - VERIFIED (R75 Phase 3, commit b67b853f, PR #1615). Prior status |
| R-17 | /scope/new | none | none | n/a | NOT-DRIVEN | Parent code matching nothing rejected - recorded: DONE - VERIFIED (R75 Phase 3, commit b67b853f, PR #1615). Prior status |
| R-18 | /scope/new | none | none | n/a | NOT-DRIVEN | Circular reference rejected without hanging - recorded: DONE - VERIFIED (R74 Phase 13, commit 2ffb521e, PR #1606, R74-RULING-0 |
| R-19 | /scope/new | none | none | n/a | NOT-DRIVEN | Nested sub-task prices off the ROOT - recorded: DONE - VERIFIED (R74 Phase 13, commit 2ffb521e, PR #1606, R74-RULING-0 |
| R-20 | /scope/[id]/revise | none | none | n/a | NOT-DRIVEN | Revision preserves parent links and breakdown % - recorded: DONE - VERIFIED |
| R-21 | /scope/[id]/compare | none | none | n/a | NOT-DRIVEN | Revision variation vs prior shown - recorded: DONE - VERIFIED (2nd-audit re-confirmed 2026-09-11, wf_b788a77f-d5f: f |
| R-22 | /scope/[id]/revise | none | none | n/a | NOT-DRIVEN | Removing a line WITH progress is BLOCKED - recorded: DONE - VERIFIED (2nd-audit re-confirmed 2026-09-11, wf_b788a77f-d5f: f |
| R-23 | /scope/[id]/revise | none | none | n/a | NOT-DRIVEN | Reducing qty on a line WITH progress is BLOCKED - recorded: DONE - VERIFIED (2nd-audit re-confirmed 2026-09-11, wf_b788a77f-d5f: f |
| R-24 | /scope/[id]/compare | none | none | n/a | NOT-DRIVEN | Percentage-only change detected as variation - recorded: DONE - VERIFIED (2nd-audit re-confirmed 2026-09-11, wf_b788a77f-d5f: f |
| R-30 | /scope/[id] | none | none | n/a | NOT-DRIVEN | Sumeet can SEE line items of a BOQ - recorded: DONE - VERIFIED |
| R-31 | /scope/[id] | none | none | n/a | NOT-DRIVEN | Sub-task rows indented and labelled % of parent - recorded: DONE - VERIFIED |
| R-32 | /scope/[id] | none | none | n/a | NOT-DRIVEN | BOQ total EXCLUDES sub-tasks (5000 not 6500) - recorded: DONE - VERIFIED |
| R-33 | dashboard + reports | none | none | n/a | NOT-DRIVEN | BACKEND roll-up excludes sub-tasks - recorded: CONFIRMED LIVE 2026-09-04 (R74 Phase 5) -- see platform.sumeet_uat R74 |
| R-40 | /work-progress | none | none | n/a | NOT-DRIVEN | Record partial progress against a weighted sub-task - recorded: CLOSED ON PRIOR Env-1 EVIDENCE (R80/R81, 2026-09-08) -- 2026-09-30 RE- |
| R-41 | /work-progress | none | none | n/a | NOT-DRIVEN | Previous % / Current % / Total % columns - recorded: BUILT - VERIFIED, all gating UAT tests PASS (R46, 25 Aug) |
| R-42 | /work-progress | none | none | n/a | NOT-DRIVEN | Previous Qty / Current Qty / Total Qty columns - recorded: BUILT - VERIFIED, all gating UAT tests PASS (R46, 25 Aug) |
| R-43 | /work-progress | none | none | n/a | NOT-DRIVEN | Cum Amt / Current Amt / Balance Amt columns - recorded: BUILT - VERIFIED, all gating UAT tests PASS (R46, 25 Aug) |
| R-44 | /work-progress | none | none | n/a | NOT-DRIVEN | Parent cum qty = SUM(child cum qty x breakdown %) - recorded: BUILT - VERIFIED, all gating UAT tests PASS (R46, 25 Aug) |
| R-45 | /work-progress | none | none | n/a | NOT-DRIVEN | Parent % complete = cum amount / total amount - recorded: BUILT - VERIFIED, all gating UAT tests PASS (R46, 25 Aug) |
| R-46 | /work-progress | none | none | n/a | NOT-DRIVEN | Progress recorded twice keeps history and does not double count - recorded: DONE - VERIFIED (break-restore OBSERVED 2026-09-11, PM-recorded) |
| R-47 | /work-progress | none | none | n/a | PARTIAL (known server gap) | Progress above 100% rejected or capped - recorded: BUILT SERVER-SIDE - CORRECTED BY CHAT 22 AUG. "CLIENT ONLY" was stale. |
| R-48 | /work-progress | none | none | n/a | NOT-DRIVEN | Daily progress report with photos - recorded: DONE - VERIFIED (R75 Phase 3, projexa commit 2b6bfbb8, PR #245, closes |
| R-50 | /dashboard/project (BoqDualViewGrid) | none | none | n/a | NOT-DRIVEN | R-50 (EXPANDED per D91, claude_log id 375): the system maintains an IN - recorded: CLOSED 2026-09-13 (R86, PM session): all 7 c1-c7 components TRUE. c2-c |
| R-51 | /dashboard | none | none | n/a | NOT-DRIVEN | Dashboard earned value matches progress - recorded: DONE |
| R-52 | /dashboard | none | none | n/a | NOT-DRIVEN | Only the LATEST revision is counted - recorded: CONFIRMED LIVE 2026-09-04 (R74 Phase 5) -- see platform.sumeet_uat R74 |
| R-60 | /scope, /dashboard | none | none | n/a | NOT-DRIVEN | BOQ amounts show AED not rupee - recorded: DONE - VERIFIED |
| R-61 | org currency row | none | none | n/a | NOT-DRIVEN | Currency is an ORG SETTING stored as data - recorded: DONE - VERIFIED |
| R-62 | all money screens | none | none | n/a | NOT-DRIVEN | Dashboard and other screens show AED - recorded: CONFIRMED LIVE 2026-09-04 (R74 Phase 5) -- see platform.sumeet_uat R74 |
| R-63 | provisioning | none | none | n/a | NOT-DRIVEN | projexa_demo_org has no currency row - would fall back to rupee - recorded: FIXED AT SOURCE - provisioning now persists currency |
| R-70 | /scope/import, /projects/from-file | none | none | n/a | NOT-DRIVEN | Load Sumeet real xlsx with sub-tasks and weights - recorded: DONE - VERIFIED, REGRESSION RE-FIXED 2026-09-20/21 (see evidence: foun |
| R-71 | /scope/import | none | none | n/a | NOT-DRIVEN | Malformed row rejected readably - recorded: BUILT - malformed-row handling verified in source 22 Aug |
| R-72 | /scope/import | none | none | n/a | NOT-DRIVEN | Column mapping matches his headers - recorded: DONE - VERIFIED (break-restore OBSERVED 2026-09-11, PM-recorded) |
| R-80 | VERI chat pills (/copilot) | none | none | n/a | NOT-DRIVEN | ONE full pill path works end to end - recorded: DONE - VERIFIED (PM, 2026-09-13, real CI run + independent break-resto |
| R-81 | VERI chat pills | none | none | n/a | NOT-DRIVEN | NO visible pill may be unwired - hide the other 402 - recorded: DONE - VERIFIED (PM, 2026-09-13, real CI run 34768287839, all 7 compon |
| R-82 | VERI chat assistant | none | none | n/a | NOT-DRIVEN | Assistant either reaches project data or is hidden - recorded: DONE - VERIFIED (PM, 2026-09-13, real CI run + independent break-resto |
| R-90 | /scope toast | none | none | n/a | NOT-DRIVEN | Real backend message shown in the toast - recorded: DONE - VERIFIED (2026-09-30, claude-code sumeet-exceptions-verify): th |
| R-91 | /scope | none | none | n/a | NOT-DRIVEN | Cold start Failed to fetch on first submit - recorded: DONE - VERIFIED (break-restore OBSERVED, cross-verified independently, |
| R-92 | M24 shell left rail <-> right pane | none | none | n/a | NOT-DRIVEN | Left rail and right pane must stay in sync both ways: (1) pressing any - recorded: CLOSED |
| R-93 | /dashboard/project + share report | none | none | n/a | NOT-DRIVEN | BOQ must track 4 variables: CONTRACT VALUE (unit numbers + unit price  - recorded: CLOSED 2026-09-18: already built, pre-dating this directive -- BoqDual |
| R-94 | /workspace/[id] (MilestonesClient) | none | none | n/a | NOT-DRIVEN | A project must show TIMELINES and MILESTONES as two different things,  - recorded: CLOSED 2026-09-18: VERIDIAN already had a complete, tested milestone e |
| R-95 | /billing-milestones | none | none | n/a | NOT-DRIVEN | Billing milestones must be a real, usable feature -- not just visible  - recorded: RE-CLOSED 2026-09-20 (PROJEXA-E2E-001 phantom-test audit, follow-throu |
| R-96 | /scope | none | none | n/a | NOT-DRIVEN | Scope of work in a project must be a real, usable concept in PROJEXA.  - recorded: CLOSED 2026-09-18, WITH A NAMING CAVEAT recorded honestly rather than  |
| R-97 | /change-orders | none | none | n/a | NOT-DRIVEN | Change of scope of work in a project must work end-to-end. Owner direc - recorded: CLOSED 2026-09-20 (correction to the 2026-09-18 close, PROJEXA-E2E-001 |
| R-98 | /scope/[id]/revise | none | none | n/a | NOT-DRIVEN | BOQ must change/track when scope of work changes. Owner directive 2026 - recorded: CLOSED 2026-09-18, WITH A REAL CAVEAT recorded honestly: ScopeReviseCl |
| R-99 | /analysis/project-360 | none | none | n/a | NOT-DRIVEN | For a project: one combined analysis view over change of BOQ, change o - recorded: CLOSED 2026-09-18: found boq-analysis-service.ts's getProjectAnalysis/ |
| R-A1 | n/a | none | none | n/a | N-A (security/legal/test row) | Demo admin password rotated before any prospect sees product - recorded: DONE 2026-09-14 -- demo admin password rotated and verified via a real |
| R-A2 | n/a | none | none | n/a | N-A (security/legal/test row) | Live GitHub PAT in a clone remote URL rotated - recorded: DONE - VERIFIED (2026-09-12, claude-desktop Super Boss) -- SCOPE-LIMIT |
| R-A3 | n/a | none | none | n/a | N-A (security/legal/test row) | compliance-tracker repo visibility decision - recorded: DONE - VERIFIED (2026-09-12, claude-desktop Super Boss, live independe |
| R-A4 | n/a | none | none | n/a | N-A (security/legal/test row) | Tenant isolation - org A cannot read org B BOQ - recorded: PASS |
| R-A5 | n/a | none | none | n/a | N-A (security/legal/test row) | Review of GPLv3 ERPNext / scraped / reverse-engineered code - recorded: REVIEWED BY CHAT 22 AUG - NO GPL CODE FOUND. Not a blocker for Sumeet. |
| R-A6 | n/a | none | none | n/a | N-A (security/legal/test row) | nanoid CVE-2026-67213 fix merged into veridian-ui-kit - recorded: DONE - VERIFIED, MERGED (R75 Part 2 Phase 1 W1-03 batch 1a, commit 40b |
| R-A7 | n/a | none | none | n/a | N-A (security/legal/test row) | veridian-ui-kit repo visibility decision - recorded: DONE - VERIFIED (2026-09-12, claude-desktop Super Boss, live independe |
| R-B1 | n/a | none | none | n/a | N-A (security/legal/test row) | ONE Playwright smoke test over the proven path - recorded: CLOSED 2026-09-13 (R86, PM session): all 7 c1-c7 components TRUE, re-v |
| R-B2 | n/a | none | none | n/a | N-A (security/legal/test row) | DEMO GATE - TC-01 TC-10 TC-11 TC-30 TC-40 TC-90 each pass TWICE - recorded: CLOSED 2026-09-20 (PROJEXA-E2E-001 sub-task): content gap closed -- TC |
| R-C01 | /permits/new | none | none | n/a | NOT-DRIVEN | Permits register - data entry, upload PDF, permit name, issue date, en - recorded: DONE |
| R-C02 | /drawings/new, /floor-plans/[id]/walkthrough | none | none | n/a | NOT-DRIVEN | Upload drawings and 3D walkthroughs - recorded: DONE |
| R-C03 | /documents/upload | none | none | n/a | NOT-DRIVEN | Document store - any email, permit-related etc - recorded: DONE (WIRED, no second table) |
| R-C04 | /moms/new | none | none | n/a | NOT-DRIVEN | Live-create Minutes of Meeting, save as PDF, share to WhatsApp - recorded: DONE |
| R-C07 | /labour, /labour/attendance | none | none | n/a | NOT-DRIVEN | Manpower DB (ID, Name, Trade, Salary), daily attendance, trade-wise su - recorded: DONE |
| R-C08 | /materials | none | none | n/a | NOT-DRIVEN | Material database, material inbound, spec, cost, qty - recorded: DONE |
| R-C09 | /scope/[id] (budget %) | none | none | n/a | NOT-DRIVEN | Budget % defaults to 25%, changeable per scope item; vendor name + ven - recorded: DONE - CAVEAT: vendor NAME resolution is a separate read-side join (co |
| R-C10 | /schedule | none | none | n/a | NOT-DRIVEN | Project schedule - recorded: VERIFIED LIVE 24 AUG (R42 seq1) - task + baseline created via minted s |
| R-C11 | /reports | none | none | n/a | NOT-DRIVEN | Revenue / Budget / Actual, scope-wise and category-wise. ALL REPORTS I - recorded: CLOSED 2026-09-11 (PM): all 7 components genuinely TRUE -- narrowed sc |
| R-C12 | /design-studio/timesheets/new | none | none | n/a | NOT-DRIVEN | Daily timesheets - designer enters daily work, manager validates on re - recorded: VERIFIED LIVE 24 AUG (R42 seq2) -- correcting a stale "out of v1 scope |
| R-C13 | /scope/[id]/revise | none | none | n/a | NOT-DRIVEN | Negative variation must be checked against WPR in case work is already - recorded: ALREADY IN BACKEND - CONFIRMS R-22/R-23 |
| R-C14 | /scope/[id] (site instruction, no own page) | none | none | n/a | PARTIAL (no own screen) | Upload site instruction form - recorded: DONE (SCHEMA-ASSUMED-INDUSTRY-STANDARD) |
| R-C15 | ExportShareActions / /share/report/[token] | none | none | n/a | NOT-DRIVEN | Save reports as PDF and share to WhatsApp - recorded: CLOSED 2026-09-11 (PM): all 7 components genuinely TRUE -- narrowed sc |
| R-C16 | backend only (no screen) | none | none | n/a | NOT-DRIVEN (no screen) | CRR (Capture / Recall / Reuse): a generic backend capability. CAPTURE  - recorded: CLOSED 2026-09-12 (PM): scope narrowed per R83-RC16-SCOPE-01 to captur |
| R-C17 | none (Resend Inbound + MX needed) | none | none | n/a | BLOCKED-by-owner | Owner-initiated 2026-09-13 (not from Sumeet's original spec -- tracked - recorded: SCOPED 2026-09-13: outbound send already exists (src/lib/email.ts, Res |
