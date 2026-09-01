# R48 100-Function Catalog — Source of Truth

Pulled verbatim from `platform.uat_function` (Supabase project `pcrjmlpuqsbocqfwoxod`) on 2026-08-29.
This file is the durable reference for the function-by-function audit/build pass. Do not re-derive
from memory — re-query `platform.uat_function` if this file is ever suspected stale.

**Process for each fn_id:**
1. Read `business_rule` (the real spec) and `db_check_sql` (how correctness is verified against real data).
2. Locate the real implementing code via targeted search (service file, API route, UI).
3. Read the actual code. Compare line-by-line against `business_rule`.
4. Mark verdict in `R48_PROGRESS.md`: VERIFIED-REAL (cite file:line) / FIXED (describe the real fix + file:line) / BUILT-NEW (real new code + file:line) / GENUINE-GAP (explain why, not a quick fix).
5. Never mark VERIFIED-REAL without having actually read the code that implements it.

---

## G1-AUTH (F001-F003)
- F001 CEO login (/login): A valid credential authenticates and lands on the org home with the correct org name shown.
- F002 Team leader login and project scoping (/login): A project manager sees only projects she is assigned to.
- F003 Team member login and read-only scoping (/login): A site engineer can enter data but sees no budget or margin figures anywhere.

## G1-SHELL (F004-F006, F090)
- F004 App shell renders for all three roles (/): The shell renders the same structural archetypes for every role; only permitted items appear.
- F005 Project list and project switch (/projects): Switching project changes every downstream screen's data with no stale carry-over.
- F006 Global navigation completeness (/): Every visible navigation item leads to a real screen that renders content.
- F090 Mobile layout at 360px is fully usable (/): Every function reachable on desktop must be reachable and usable at 360px.

## G2-BOQ (F007-F010, F083-F084)
- F007 BOQ create - saves without server error (/boq/new): A BOQ with a title and valid lines saves and appears in the list.
- F008 BOQ line amount equals QTY x RATE (/boq/new): amount = qty x rate, computed server-side, displayed identically.
- F009 BOQ with title only and zero lines is allowed (/boq/new): A BOQ may be created with a title and no line items.
- F010 Missing title is rejected naming the field (/boq/new): A BOQ without a title is rejected with a message naming the title field.
- F083 BOQ edit changes only the intended field (/boq/edit): Editing one field must not alter any other stored value.
- F084 BOQ delete behaves correctly (/boq): Delete removes from the list with the correct hard or soft semantics and no collateral damage.

## G3-SUBTASK (F011-F020)
- F011 Sub-task columns exist and are populated (/boq/new): item_code, parent_item_code and breakdown_percent persist on the line item.
- F012 Sub-task enterable in the create form (/boq/new): The create form exposes Item Code, Parent Item Code and Breakdown percent as real inputs.
- F013 Sub-task amount = ROOT qty x ROOT rate x breakdown pct (/boq/view): A sub-task amount is derived from the ROOT line, never from its own qty and rate.
- F014 Sub-task own QTY and RATE are ignored (/boq/view): Any qty or rate entered on a child line must not affect its amount.
- F015 Weights are NOT forced to sum to 100 (/boq/new): Children need not total 100 percent; the system must not block or auto-adjust.
- F016 Running total of child percentages shown per parent (/boq/view): Each parent displays the live sum of its children's percentages.
- F017 Child with a parent but no percentage is rejected (/boq/new): A line with parent_item_code set and breakdown_percent null must be rejected.
- F018 Parent code matching nothing is rejected (/boq/new): A child referencing a non-existent parent code must be rejected.
- F019 Circular reference is rejected without hanging (/boq/new): A cycle in parent references is detected and refused; the request must not hang.
- F020 Nested sub-task prices off the ROOT (/boq/view): A grandchild is priced from the ROOT line, not from its immediate parent.

## G4-REV (F021-F025, F074)
- F021 Revision preserves parent links and percentages (/boq/revise): A new revision carries every parent_item_code and breakdown_percent forward unchanged.
- F022 Revision variation vs prior is shown (/boq/view): The difference between the current and prior revision is displayed per line and in total.
- F023 Removing a line WITH progress is blocked (/boq/revise): A line that has recorded progress cannot be removed in a revision.
- F024 Reducing qty below recorded progress is blocked (/boq/revise): Qty cannot be reduced below the quantity already recorded as complete.
- F025 Percentage-only change is detected as a variation (/boq/view): Changing only a breakdown percentage still registers as a variation.
- F074 Negative variation checked against work progress (/boq/revise): A negative variation must be checked against recorded progress before it is allowed.

## G5-VIEW (F026-F028, F081-F082)
- F026 Line items are visible on a BOQ (/boq/view): Every line item of the BOQ is listed and readable.
- F027 Sub-task rows are indented and labelled percent of parent (/boq/view): Children render visually nested under the parent with their percentage shown.
- F028 BOQ total EXCLUDES sub-tasks (/boq/view): The BOQ total sums only root lines. The stated example is 5000, not 6500.
- F081 BOQ list search returns exactly the matching set (/boq): Search returns every match and nothing else.
- F082 BOQ list sorting and paging lose no row (/boq): Paging through the whole list yields every row exactly once.

## G6-ROLLUP (F029)
- F029 Backend roll-up excludes sub-tasks (/reports): Report totals must match the BOQ total and exclude sub-tasks - the R-33 double-count fix.

## G7-PROG (F030-F039, F085-F086)
- F030 Record partial progress against a weighted sub-task (/progress): A site engineer can record partial progress against a specific sub-task.
- F031 BOQ picker offers newly created BOQs - the TC-30 defect (/progress): The picker must list every BOQ in the current project, including one created minutes ago.
- F032 Previous / Current / Total percent columns (/progress): Three percentage columns are shown and arithmetically consistent.
- F033 Previous / Current / Total quantity columns (/progress): Three quantity columns, consistent with the percentage columns.
- F034 Cumulative / Current / Balance amount columns (/progress): Amount columns derive from quantity and rate and reconcile to the line amount.
- F035 Parent cumulative qty = SUM(child cum qty x breakdown pct) (/progress): A parent's cumulative quantity is the weighted roll-up of its children.
- F036 Parent percent complete = cum amount / total amount (/progress): Parent completion is amount-weighted, not a simple average of child percentages.
- F037 Progress recorded twice keeps history and does not double count (/progress): Two entries produce two history rows and one correct cumulative figure.
- F038 Progress above 100 percent is rejected or capped server-side (/progress): The limit is enforced on the server, not only in the browser.
- F039 Daily progress report with photos (/progress/daily): A daily report can be created with attached photos and is retrievable.
- F085 Progress entry delete recalculates cumulative (/progress): Deleting a progress entry recalculates the cumulative figure and the dashboard.
- F086 Progress search and filter by date and line (/progress): Filtering by date range and by line returns exactly the matching entries.

## G8-DASH (F040-F042, F087)
- F040 Project value matches BOQ total (/dashboard): The dashboard project value equals the sum of the latest revision BOQ totals.
- F041 Dashboard earned value matches recorded progress (/dashboard): Earned value equals the cumulative amount from work progress.
- F042 Only the LATEST revision is counted (/dashboard): Superseded revisions must not contribute to any dashboard figure.
- F087 Dashboard refresh reflects a change made elsewhere (/dashboard): A change made on another screen is reflected after refresh, with no stale cache.

## G9-CUR (F043-F046)
- F043 BOQ amounts show AED not rupee (/boq/view): Amounts render with the org currency symbol, AED for Meridian.
- F044 Currency is an org setting stored as data (/settings): Currency is a database value per org, not a constant in code.
- F045 Dashboard and other screens show AED (/dashboard): Currency is consistent on every screen, not only on the BOQ - R-62 is a confirmed live defect.
- F046 Org with no currency row does not fall back to rupee (/dashboard): A missing currency row must not silently produce rupee.

## G10-IMP (F047-F049)
- F047 Load Sumeet real xlsx with sub-tasks and weights (/boq/import): The real spreadsheet imports with parents, children and weights intact.
- F048 Malformed row rejected readably (/boq/import): A bad row is reported with its row number and the reason; good rows still import.
- F049 Column mapping matches his headers (/boq/import): The importer maps Sumeet's actual column headers without manual remapping.

## G11-PILL (F050-F052)
- F050 One full mode-pill path works end to end (/): A pill resolves its chain, resolves inputs, checks the caller role, and renders a real result.
- F051 No visible pill may be unwired (/): Every rendered pill must have a resolvable chain; unwired ones are hidden, not greyed.
- F052 Pill classification never authorizes (/): Browser-side pill classification must never grant access; the server decides.

## G12-CHAT (F053-F054, F089)
- F053 Assistant resolves real project data (/): The assistant answers from live project data, and the figure matches a direct DB query.
- F054 Assistant refuses when it has no data (/): With no grounding data the assistant must say so rather than invent.
- F089 Assistant respects role and project scope (/): The assistant answers only within the asker's role and project scope.

## G13-ERR (F055-F056)
- F055 Real backend message shown in the toast (/boq/new): The toast must carry the actual backend message, not a generic one.
- F056 Cold start does not show a bare Failed to fetch (/boq/new): After an idle period the first submit must not present a raw fetch error.

## G14-SEC (F057-F060, F091-F092)
- F057 Demo admin password is not the default (/login): A published or guessable default credential must not authenticate.
- F058 Tenant isolation - ORG_B cannot read ORG_A (/boq/view): No ORG_A record is reachable from ORG_B by any route.
- F059 MEMBER cannot see budget or margin (/dashboard): Budget and margin figures must be absent for a site engineer, server-side.
- F060 Known CVE fix is merged (/): The nanoid CVE-2026-67213 fix must be merged in veridian-ui-kit.
- F091 Session expiry and re-auth (/): An expired session must force re-auth, not show stale data.
- F092 Direct object reference cannot be guessed (/boq/view): Changing an id in the URL must not expose another record.

## G15-GATE (F080, F099-F100)
- F080 The six demo-gate TCs pass twice, manually (/): Each of TC-01, TC-10, TC-11, TC-30, TC-40, TC-90 passes on two separate manual runs.
- F099 Automated suite fails on a broken build (/): The smoke suite must go red against a knowingly broken commit.
- F100 A stranger completes the full journey unaided (/): A person who did not build the product completes six steps with no coaching.

## G16-PERM (F061, F093)
- F061 Permits register - create with PDF (/permits): A permit saves with name, issue date, expiry and an attached PDF.
- F093 Permit expiry reminder appears (/permits): A permit approaching expiry surfaces a reminder on the relevant screen.

## G17-DRW (F076)
- F076 Upload drawings and 3D walkthrough (/drawings): Drawings and 3D files upload, list, and open.

## G18-DOC (F062-F064, F097)
- F062 Document store - upload and retrieve (/documents): Any document uploads, is listed, and reopens with its original content.
- F063 Document becomes searchable by content (/documents): An uploaded document is retrievable by a phrase that appears only inside it, with a citation.
- F064 Ask a question and get a cited answer (/): A question about the document is answered with a resolving citation.
- F097 Document permissions follow project scope (/documents): A document is visible only to those with access to its project.

## G19-MOM (F065-F066)
- F065 Create Minutes of Meeting live and share (/meetings): A MoM is created, saved as PDF and shareable to WhatsApp.
- F066 MoM action items become trackable tasks (/meetings): Each action item is assignable with an owner and a due date, and appears in that person's list.

## G20-MAN (F067, F095)
- F067 Manpower database and daily attendance (/manpower): Workers are recorded with ID, name, trade and salary; attendance is entered daily and summarised by trade.
- F095 Attendance summary reconciles trade-wise (/manpower): The trade-wise summary equals the sum of individual attendance entries.

## G21-MAT (F068, F094)
- F068 Material database and inbound (/materials): Materials are recorded with spec, cost and quantity; inbound updates the stock figure.
- F094 Material cost flows into the budget figure (/budget): Recorded material cost appears in the actual column of the budget.

## G22-BUD (F069)
- F069 Budget percent defaults to 25 and is changeable per scope item (/budget): Budget defaults to 25 percent, is editable per scope item, and carries vendor name and cost.

## G23-SCH (F070, F096)
- F070 Project schedule task and baseline (/schedule): A task and a baseline are created and both read back correctly.
- F096 Schedule baseline variance is shown (/schedule): Actual dates against baseline produce a visible variance.

## G24-REP (F071, F088)
- F071 Revenue / Budget / Actual report scope-wise (/reports): The report shows revenue, budget and actual, scope-wise and category-wise, and reconciles to the DB.
- F088 Report figures reconcile to the database exactly (/reports): Every report figure equals an independently written SQL query, to the last unit.

## G25-DS (F073)
- F073 Daily timesheet entry and manager validation (/timesheets): A designer enters daily work; a manager validates it; the validation is recorded.

## G26-VAR (F074-F075) [F074 listed under G4-REV above too per source data]
- F075 Upload site instruction form (/instructions): A site instruction uploads, links to a scope item, and is retrievable.

## G27-EXP (F072)
- F072 Save report as PDF and share to WhatsApp (/reports): The PDF contains the same figures shown on screen and the share link opens.

## G28-CRR (F077-F079, F098)
- F077 Scanned PDF is read without a paid vision call (/documents): A scanned PDF is OCR'd in the browser; only low-confidence pages escalate.
- F078 Low-confidence amount is flagged not auto-written (/documents): Any numeric or date field below the confidence threshold is flagged for a human, never auto-written.
- F079 Rename preserves identity; erasure redacts not deletes (/documents): doc_uid never changes on rename; erasure nulls content but keeps every row and citation.
- F098 Twenty mixed documents all reach a terminal state (/documents): Every uploaded document reaches EMBEDDED or a named SKIPPED state - none stuck.
