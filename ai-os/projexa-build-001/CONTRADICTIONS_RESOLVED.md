# CONTRADICTIONS_RESOLVED.md -- PROJEXA-BUILD-001 defect D-05

**Assignment:** A03-d05-contradictions (independent verifier, read-only)
**Date:** 2026-09-25
**Spec read:** `scratchpad/PROJEXA_BUILD_SPEC_2026-09-25.md` (440 lines, read in full; line numbers below are that file's)
**Code baseline:** `FChecklist/compliance-tracker` origin/main = `025eea08156baa6a5a0985edb766ff7948de5008` (matches `git ls-remote origin refs/heads/main`); `FChecklist/projexa` main = `e88b53e12b` (gh api, committed 2026-09-21T13:38:49Z)
**DB baseline:** Supabase `pcrjmlpuqsbocqfwoxod`, SELECT-only, 2026-09-25

Verdict key: REAL = the two statements cannot both be true as written. PARTIAL = both are partly true, or they describe different layers, but the wording misleads. NOT_A_CONTRADICTION = both hold.

| Entry | WO D-05 item | Verdict | Survives |
|---|---|---|---|
| C-01 | 68 vs 80 vs 111 | REAL | 80 (section 6); 111 = 80 + 31 exceptions items |
| C-02 | Gap letters vs numbers | REAL | numbers 1-9, plus mapping table |
| C-03 | "four things" vs nine gaps | REAL | nine gaps |
| C-04 | ~20 vs 22 vs 15 registry entries | PARTIAL | 22 rows = 2 edits + 20 new rows (29 function ids) |
| C-05 | Pattern 3 status | PARTIAL | L29 (built, org-wide, buggy); L387 wrong |
| C-06 | all-111-done vs R-C17 open / unmerged PRs | PARTIAL | R-C17 open; "all 111 done" false; "unmerged" claims stale |
| C-07 | Gap 5 sequencing | PARTIAL | L123/L403: fix first, alone |
| C-08 | R-02/03/04 free vs nested arrays | PARTIAL | R-03/R-04 free; R-02 needs array-of-objects |
| C-09 | user_ai_links vs token input schema | PARTIAL | L110; L332 "half-built" wrong |

---

## C-01 -- 68 vs 80 vs 111 (one population, three numbers) -- REAL

- Statement A, L158: "8 clusters, 68 requirement rows read live from the database". Repeated L168 "Across 68 requirements" and L346 "Read across all 68 requirements in Section 6". (The WO says "twice"; it is three times.)
- Statement B, L156 (section title) "ALL 111 REQUIREMENTS"; L355, L359, L367, L369, L371 also use 111.
- Statement C (implicit): the eight section-6 cluster headings (L214, L232, L250, L266, L284, L296, L312, L330) enumerate 25+10+12+10+4+7+7+5 = **80 unique IDs** (parsed by script from the headings; the same 80 are the only R-IDs anywhere in the file).

Evidence:
- `select count(*) from platform.sumeet_requirements` = **80**.
- 111 = 80 + 31: `ai-os/boss/ACTIVE-CLAIMS.yaml` on origin/main, lines 5073-5078: the "31-item exceptions directive" is the owner's 31 items behind `construction-exceptions-service.ts` (28 testable + 3 meta-statements #29-31), built in commit `6d531f53` "28-item deterministic exceptions-detection engine for Sumeet's 31-item PROJEXA requirement (#1752)" (`git merge-base --is-ancestor 6d531f53 origin/main` = true).
- The count "31", and any exceptions-item ID, appear 0 times in the spec.
- TRAP for whoever writes the 111 list: `platform.sumeet_gap` ALSO has exactly 31 rows (GAP-01..GAP-31). It is a different register (module-level gap analysis: 1 row COMPLETE, 7 NOT STARTED, 1 WITHDRAWN, others INCOMPLETE/BLOCKED). Do not treat `sumeet_gap` as the 31-item exceptions directive; the evidence above ties the 31 to the exceptions service.

Survives: **80** for Section 6 (DB and headings agree). 68 is wrong. 111 is correct only as "80 register rows + 31 exceptions-directive items", and the spec analysed none of the 31.

Corrected wording (L156/L158/L168/L346): "Section 6 covers all 80 rows of `platform.sumeet_requirements` (8 clusters). The remaining 31 of the 111 are the exceptions-directive items (`construction-exceptions-service.ts`, commit 6d531f53); they are NOT analysed in this document."

Verify command (after correction): `test "$(grep -c '68 requirement' PROJEXA_BUILD_SPEC.md)" = "0"` -- exit 0 = pass.

---

## C-02 -- Gap letters (A-I) vs Gap numbers (1-9), no mapping -- REAL

- Statement A: section 4 numbers the gaps GAP 1..GAP 9 (L75, L85, L95, L105, L115, L125, L135, L140, L144).
- Statement B: L39 "pattern 4 doesn't call these directly at all today, per Gap D below"; L69 "13 of them advertised but not runnable (Gap D)"; L423 "Section 4's Gap D (the MCP server advertising 13 tools it can't run)"; L439 "Everything in my first report (Gaps A through I)".

Evidence: the letters come from the first report, `PROJEXA_AI_ARCHITECTURE_ANALYSIS_2026-09-25.md` L44-L69, where Gap D = "The MCP server advertises 13 tools it cannot run" (L53) and Gap F = "Email attachments are delivered by the provider and thrown away" (L59). Section 4 of the spec has no "Gap D" heading, so "Gap D below" (L39) points at nothing. L69/L423 use Gap D correctly in the letter scheme (= spec Gap 3); L39 uses it for the email path, which is letter F/G (= spec Gap 6/7). One letter carries two meanings inside the same file.

Mapping (derived by matching each lettered heading to the numbered gap with the same content):

| Letter (first report) | Spec number | Subject |
|---|---|---|
| A | Gap 1 | No path creates a project from a file |
| B | Gap 2 | Importer reads sheet 1 only, no document understanding |
| C | Gap 1 + section 5 registry | No AI-dispatchable tool creates a project or ingests a file |
| D | Gap 3 | `/api/mcp` advertises 13 tools it cannot run |
| E | Gap 4 + Gap 5 | `/api/mcp/[token]`: org-wide scope + unredacted financials |
| F | Gap 6 | Email attachments discarded |
| G | Gap 7 | Email creates one generic task after a human promote |
| H | Gap 8 | Inbound email DNS-blocked (R-C17) |
| I | Gap 2 + Gap 9 | L0/L1/L2/L3 framework defined but not wired |

Survives: the numbers (1-9). Corrected wording: L39 "... per Gaps 6 and 7 below"; L69 and L423 "(Gap 3)"; L439 "Everything in my first report (its Gaps A-I, mapped to Gaps 1-9 in the table in section 4)". Add the table above to section 4.

---

## C-03 -- "four specific, narrow things" (L12) vs nine gaps (section 4) -- REAL

- Statement A, L12: "the gap isn't 'build APIs,' it's four specific, narrow things:" followed by 4 bullets (L14-L17).
- Statement B: section 4 lists GAP 1..GAP 9 (L75-L152).

Mapping of the four bullets: bullet 1 = Gap 1; bullet 2 = Gap 2; bullet 3 = Gap 4 + Gap 5; bullet 4 = Gap 9. Not covered by any bullet: Gap 3 (13 advertised-but-unrunnable MCP tools), Gap 6, Gap 7, Gap 8 (the whole email path). The section-5 registry work (22 table rows) is also absent from the four.

Survives: nine gaps (section 4 is the detailed statement; the summary under-counts).

Corrected wording (L12): "... it's nine specific gaps in four themes: (1) no project from a file [Gap 1]; (2) no document-understanding layer [Gap 2]; (3) the external-AI door is org-wide and leaks financial figures [Gaps 4, 5], and the compliance MCP advertises 13 unrunnable tools [Gap 3]; (4) email and autonomous paths are not wired [Gaps 6, 7, 8, 9]."

---

## C-04 -- ~20 vs 22 vs 15 registry entries -- PARTIAL

- Statement A: L369 "closing the ~20-item registry gap in Section 5's table"; L371 "The ~20 registry registrations in Section 5's table"; L423 "every one of the ~20 new registry entries".
- Statement B: section 5 table L172-L195 has **22 rows** (script count of `|` rows L174-L195).
- Statement C, L350: "roughly 15 more items across change orders, schedule, milestones, budgets, permits metadata, material, manpower reporting, timesheet approval, email-suggestion promotion, and report sharing".

Evidence (script over the table): 22 rows = **20 new-entry rows** + **2 edit rows** (L175 "Fix `executeCreateBoqRevision`", L192 "Widen `executeCreateDocument`"). The 20 new-entry rows name **29 distinct new function ids**: `create_boq`, `get_boq_line_items`, `preview_boq_import`, `apply_boq_import`, `list_change_orders`, `get_change_order`, `create_change_order`, `create_site_instruction`, `run_named_report`, `get_project_analysis`, `update_line_item_budget`, `create_schedule_task`, `get_project_schedule`, `create_milestone`, `update_milestone`, `list_milestones`, `list_billing_claims`, `get_billing_due_queue`, `create_drawing`, `create_mom`, `get_manpower_cost_report`, `record_material_receipt`, `approve_timesheet`, `reject_timesheet`, `get_designer_timesheet_report`, `promote_email_intelligence_item`, `recall_precedent`, `capture_artifact`, `create_report_share_link`. L350's "15" is a subset bucket (section 7's "registry-coverage" group), not a total -- but the document never states its unit (rows vs function ids), which is why three numbers appear.

Survives: the table. Corrected wording (L369/L371/L423): "the 22 rows of section 5's table: 2 edits to existing executors plus 20 new rows adding 29 new function ids". L350: name the function ids in the bucket instead of "roughly 15".

---

## C-05 -- Pattern 3 status: "built" (L29) vs "proved this session" (L387) vs "behind unbuilt Gap 4" (L112) -- PARTIAL

- Statement A, L29: "Built for Claude.ai specifically (self-service token, 2 tools: `submit_task`/`ask`) ... Org-wide scope, not project-scoped. Has a live bug".
- Statement B, L387: "This is the one option that needs the least new capability, and it's the one I actually proved this session."
- Statement C, L112 (Gap 4): "A user opens a specific project, clicks 'generate AI link for this project'"; and L387 itself: "A human pastes their per-project AI link (once Gap 4's project scoping exists)" ... "then calls the (once-registered) `create_project`/BOQ-import tools".

Facts settled (question 5):
1. **Built: YES.** `src/app/api/mcp/[token]/route.ts` exists on origin/main (155 lines). `tools/list` returns exactly 2 tools (route.ts:21-45, :102); both call `runSubmission()` (route.ts:58-63, :68). Minting: `src/app/api/ai-link/route.ts` GET/POST (session-authenticated, per user, no project parameter). `platform.user_ai_links` = 2 rows, both `active`, 2 orgs, created 2026-08-29, `max(last_used_at)` = **2026-08-29 17:57:55 UTC**.
2. **Working today: UNVERIFIABLE live** (Vercel production paused per WO section 11; no request was sent by this verifier). No committed test exists for the route: `git ls-tree -r --name-only origin/main src/app/api/mcp/` lists `[token]/route.ts` with no sibling `*.test.ts`.
3. **"Proved this session": NOT via this route.** No link was used this session (last use 2026-08-29). `PROJEXA_SESSION_DISCUSSION_LOG_2026-09-25.md` L19-L21: the project was created and the BOQ imported by invoking the real route code directly in-process (log wording at L21), with the PM doing the 22-sheet reconciliation by hand. What was proved is "an AI model can do the L1 extraction step itself", not "Pattern 3 creates a project".
4. **Pattern 3 cannot create a project or import a BOQ today:** `EXECUTORS` (`src/lib/pipeline/executor.ts:672-685`) has no `create_project`, `create_boq`, or import entry.
5. **Gap 5 bug confirmed in code:** route.ts:58-63 and :68 pass no `role`; `src/lib/task-execution/construction-tools.ts:95` = `const financialsAllowed = role ? (ROLE_RANK[role as UserRole] ?? 0) >= ROLE_RANK.manager : true` (undefined role means financials shown).

Survives: L29 (built, org-wide, buggy). L387 is wrong as written.

Corrected wording (L387): "This is the option that needs the least new perception code. It is NOT proven end to end: this session proved only that an AI model can perform the L1 extraction itself (the PM did it by hand and called the project and BOQ-import route code directly in-process, not through the AI link). Through the link, Pattern 3 cannot create a project or import a BOQ until `create_project`/BOQ-import entries exist in `EXECUTORS` (section 5); per-project scoping additionally needs Gap 4."

Verify commands:
- built: `git -C C:/ct/ct cat-file -e 'origin/main:src/app/api/mcp/[token]/route.ts'` -- exit 0 = present.
- no project-creating executor today: `test "$(git -C C:/ct/ct show origin/main:src/lib/pipeline/executor.ts | grep -cE '^\s+(create_project|create_boq):')" = "0"` -- exit 0 = still absent (flip expected value to 1 once built).

---

## C-06 -- "all 111 done" (L367) vs R-C17 Open (L332) and closures resting on unmerged PRs (L240, L276, L294) -- PARTIAL

(The "all 111 done" claim is false; the three "unmerged" claims were true when written but are stale today.)

- Statement A, L367: "Pattern 1 (UI): already true for all 111, today -- every requirement in Section 6 is `DONE`/`CLOSED` at the Software(L0) UI/REST level."
- Statement B, L332: "R-C17 (Email Engine): Open".
- Statement C: L240 "already fixed in an open PR (#303) that simply hasn't merged yet"; L276 "A real, still-unmerged bug was found in passing (a report-fetch path missing a required query param, causing 17 non-hosted reports to render blank)"; L294 "evidence sitting on unmerged branches".

Evidence against A (live SELECT on `platform.sumeet_requirements`, grouped by status):
- R-C17 status begins "SCOPED 2026-09-13 ... NOT AI-closable without owner action" (built = null).
- R-90 status = `PARTIAL`.
- R-40 status = "BLOCKER CLEARED - CORRECTED BY CHAT 22 AUG. Still unverified end to end."
- The 31 exceptions-directive items (C-01) are not in section 6 at all, so "all 111" is unsupported for 31 of them regardless.

Evidence on C (all three stale as of 2026-09-25):
- L240: `FChecklist/projexa` PR #303 "fix(scope): build real Filter and Export on /scope" -- `merged=true`, merged_at 2026-09-20T15:37:11Z; merge commit `78e788f0` is an ancestor of projexa main `e88b53e` (gh compare status `ahead`).
- L276: the described bug matches `FChecklist/projexa` PR #300: its body says `reportDestination()`'s generic fetch path, "which every non-hosted report on the Reports screen ... is fetched through", lacked `format=legacy`. `merged=true`, merged_at 2026-09-20T15:27:37Z; merge commit `bbd01141` is an ancestor of `e88b53e`. The spec cites no PR number, so this identification is by description: PLAUSIBLE, not certain.
- L294 (R-B2): the PRs the R-B2 register row names -- projexa #297, projexa #298, compliance-tracker #1759 -- are all `merged=true` (gh api).
- compliance-tracker PR #303 is an unrelated docs PR (2026-07-14); the spec's #303 is the projexa one.

Survives: B (R-C17 open). A does not. C's "unmerged" statements no longer hold.

Corrected wording (L367): "Pattern 1 (UI): of the 80 section-6 rows, 77 carry a DONE/CLOSED/VERIFIED-style status; R-C17 (SCOPED, owner-blocked on DNS/Resend), R-90 (PARTIAL) and R-40 (unverified end to end) do not. The 31 exceptions-directive items are not assessed here." L240/L276/L294: replace "unmerged" with the merge facts above.
Note: 77 = 80 - 3 read from free-text status; several status texts are themselves stale (see X-06), which is why WO Phase 3 (a verify_command per row) is the real fix.

---

## C-07 -- Gap 5 sequencing: "fix on its own, now" (L123) vs section 8 item 4 of 5 -- PARTIAL

- Statement A, L123: "I'd recommend fixing this one on its own, now, regardless of sequencing on the rest." Repeated L403: "Fix this one specifically, on its own, before doing anything else that widens the external-AI surface".
- Statement B, L374: section 8 numbered list, item 4 of 5: "The project_id scoping fix (Section 5) and the financial-redaction fix (Section 4, Gap 5)".

Analysis: section 8's list (L371-L375) is introduced as "You are looking at:" -- an inventory of work, not a declared sequence. Read as a plan it places Gap 5 after the registry work, which conflicts with L123/L403. The WO repeats the conflict: its Q2 recommends "yes -- it is a live data leak", but it gates the fix as exit test 2.5, behind every Phase 1 exit test (including 1.6 secret-scan CI and 1.9 Speed Insights).

Code evidence that the bug is real and independent: C-05 fact 5. The fix touches only the [token] route plus a role lookup for the token's user; it depends on no other gap. Exposure is latent while Vercel production is paused (WO section 11) and live the moment it unpauses; 2 active links exist.

Survives: L123/L403 (fix first, alone). Corrected wording (L374): "4. The project_id scoping fix (Section 5). [Gap 5's redaction fix is not in this list: it ships first, alone -- see Gap 5.]"

---

## C-08 -- "R-02/03/04 come free once R-01 is wired" (L222) vs "nested array ... [not supported] for any of the 27 functions" (L224) -- PARTIAL

- Statement A, L222: "R-02/R-03/R-04 are business rules *inside* `createBoq()` -- they come free the moment R-01 is wired."
- Statement B, L224: "adding `create_boq`'s executor needs to carry a nested array (per-line `itemCode`/`parentItemCode`/`breakdownPercentage`), which the pipeline's current flat param helpers don't support for any of the 27 functions today."

Facts settled (question 8: does EXECUTORS support nested-array params for any function?):
- `EXECUTORS` = 27 entries (`executor.ts:672-685`: 8 named + 6 `READ_ONLY_DISPATCH_FUNCTION_IDS` (L350-357) + 1 alias `review_budget` (L668-670) + 12 `READ_ONLY_ORG_SCOPED_FUNCTION_IDS` (L393-402)).
- Param helpers are scalar: `str()` (executor.ts:115-117), `num()` (:129-133).
- The declared param schema has no array or object type: `CardFieldType = "text" | "number" | "percent" | "date" | "select" | "file" | "time"` (`function-registry.ts:23`).
- ONE executor reads an array: `executeCreateMeeting` reads `task.params.agendaItems` as a flat `string[]` (executor.ts:473-475), undeclared in the card schema. No executor reads an array of objects.
- **Answer: NO array-of-objects (nested) param support in any of the 27; a flat string array exists for exactly one (`create_meeting`).** L224 is correct in substance; "for any of the 27" is exact only for arrays of objects.
- `createBoq(ctx, input: BoqInput)` (`construction-boq-service.ts:1361`) with `BoqInput.lineItems: BoqLineItemInput[]` required (:114-117).
- Requirement texts (live SELECT): R-02 "Line item amount = QTY x RATE"; R-03 "BOQ with title only and zero lines is allowed"; R-04 "Missing title rejected naming the field".

Resolution: R-03 and R-04 do come free with a flat `{projectId, title}` executor passing `lineItems: []`. R-02 does NOT: it needs line objects (qty, rate), i.e. the array-of-objects param that no executor supports. R-10-R-19 need the same extension.

Corrected wording (L222): "R-03/R-04 come free once R-01 is wired with a title-only executor (`lineItems: []`). R-02 (amount = qty x rate) and R-10-R-19 additionally need an array-of-objects `lineItems` param, which no executor supports today." L224: "... which no executor supports today (the only array param among the 27 is `create_meeting`'s flat `agendaItems: string[]`)."

Verify command: `test "$(git -C C:/ct/ct show origin/main:src/lib/pipeline/function-registry.ts | grep -c '"array"')" = "0"` -- exit 0 = still no array field type.

---

## C-09 -- `user_ai_links` "physically cannot" express project scope (L110) vs "the token's own input schema already has an optional project field" (L332) -- PARTIAL

(WO cites L108; the quoted sentence is at L110. Both statements are true at different layers; L332's "half-built" inference is wrong.)

- Statement A, L110: "today's schema physically cannot express it (no column to hold it)".
- Statement B, L332: "note that the token's own input schema already has an optional project field waiting to be used -- the plumbing is half-built already."

Facts settled (question 9):
- `information_schema.columns` for `platform.user_ai_links`: `id, org_id, user_id, token, status, created_at, last_used_at, revoked_at` -- **0 columns matching `%project%`**. `compliance.api_keys` (13 columns: `id, name, key_hash, key_prefix, org_id, scopes, is_active, last_used_at, created_at, updated_at, domain_scope, rate_limit_per_minute, issued_for_application_id`) -- no project, no user column.
- `src/app/api/mcp/[token]/route.ts:32`: `submit_task.inputSchema.properties.projectId: { type: "string", description: "A specific project id, if the task is scoped to one." }` -- optional (`required: ["rawInput"]`, :27); passed through at :61. `ask` has no projectId and hard-codes `projectId: null` (:68).
- That field is supplied by the CALLER per call, not bound to the token. `src/lib/pipeline/run-submission.ts:106-110`: "This is not a weakened boundary, because it was never the boundary. `reachableProjectIds` is a HALLUCINATION GUARD ... real reachability is enforced two layers down, by withTenantContext's org scoping".

Resolution: both statements are true. The error is the inference: an optional, caller-chosen per-call projectId does not scope a credential, so it is not half of Gap 4. A link holder can pass any project id in the org, or none.

Survives: L110. Corrected wording (L332): "The AI-link tool `submit_task` already accepts an optional, caller-supplied `projectId` per call ([token]/route.ts:32). This is a per-call hint, not a scope: the token carries no project, and run-submission.ts:106-110 confirms the per-call id is not an access boundary. Gap 4 still needs a `project_id` column on `platform.user_ai_links`, set at mint time and compared with each call's projectId."

---

## Extra contradictions

## C-10 -- Spec internal: "14-function write ceiling" (L28-L29) vs "27-function EXECUTORS" (L162, L218)
L28: internal chat = "7 read-only report tools + 7 real writes"; L29: Pattern 3 has the "same 14-function write ceiling as #2". L162/L218: both paths terminate in "the 27-function `EXECUTORS` registry". Code: 27 entries (executor.ts:672-685) = 7 writes + 20 reads; the [token] route reaches all 27 via `runSubmission()`. The "7 read-only" figure is the codeReference allowlist of `/api/v1/projexa/assistant`, not the runSubmission path. Survives: 27. Corrected L28/L29: "20 reads + 7 writes via runSubmission (27 total); the codeReference branch alone exposes 7 reads."

Surviving statement: 27 (7 writes, 20 reads). The spec's "14-function write ceiling" is wrong; PMD-02 and the U-01 fix already assume the 27-entry registry.

### X-02 -- WO D-10 / exit 2.1 / 2.2 vs spec L208, L288: NOT NULL vs nullable
WO D-10: "The spec proposes `NOT NULL` schema changes on two live credential tables". Spec L208: "both are small, additive schema changes (a nullable column plus a check ...)"; L288: "add a nullable `projectId` to `compliance.api_keys`". L107 says "require it when minting" (API level). The spec never proposes NOT NULL; NOT NULL comes from WO exit tests 2.1/2.2. With Q6 (break vs grandfather) still open, 2.1/2.2 pre-decide Q6 as "break". The WO text must change; the column nullability is an owner decision (Q6).

Resolved by PMD-08: platform.user_ai_links.project_id is NOT NULL for new mints; compliance.api_keys.project_id is NULLABLE with a key_kind check.

### X-03 -- Spec Gap 9 (L147-L148, L31) vs Addendum A1/E-04: where scheduled work runs
Spec: "The existing `/api/internal/*/run` cron pattern (already real, already scheduled) ... extend this pattern rather than building a new scheduler" (Vercel crons). Addendum A1 (normative): scheduled work runs as `pg_cron` + `pg_net` -> Supabase Edge Function; "A Vercel function invocation on a normal user path is a defect". Addendum wins. Corrected Gap 9 "Where": "`pg_cron` -> `pg_net` -> Supabase Edge Function, copying `dpdp-monday-digest` (Addendum E-03/E-04)".

Resolved by PMD-12: scheduled work runs as pg_cron -> pg_net -> Edge Function (one job first, exchange-rate-refresh); Vercel crons are not extended.

### X-04 -- Spec section 10 L399 "You can trust this boundary today" vs Addendum A2 / WO D-06
Live SELECT on `pg_policies`: total 1290; naming `authenticated` 6; naming `anon` 8; `construction_*` policies naming `authenticated` or `public` = **0** (60 `construction_*` policies exist, all for other roles). The spec's claim is scoped to the server path (`withTenantContext()` + app_runtime RLS) and says nothing about browser -> PostgREST as `authenticated`, which the Addendum makes the Phase 4 target. Both hold for their own path; "Every database call in this codebase" is too broad. Corrected: "Every server-side database call ... runs inside `withTenantContext()` ... This does not cover direct browser -> PostgREST access as `authenticated`, which has 0 policies on any `construction_*` table today (Addendum A2)."

### X-05 -- Spec Pattern 1 "Fully built" (L27) vs WO D-08 / exit 4.5 surface 1 "has no code today"
Different definitions, not a factual clash: spec Pattern 1 = manual UI screens; WO surface 1 = "one AI-prepared page the person approves". Spec Pattern 1 maps to WO surface 2 (ERP screens); WO surface 1 has no spec counterpart. WO 4.5's "the spec wrongly counts it as Pattern 1" should read "the spec has no counterpart for surface 1".

### X-06 -- Spec L244 vs register row R-98: sourceChangeOrderId linkage
Spec L244: "`createBoqRevision()` now accepts an optional `sourceChangeOrderId`, validated and linked in the same transaction." `platform.sumeet_requirements` R-98 status: "no changeOrderId field links an approved Change Order to the BOQ revision it produced (confirmed via grep, no such linkage exists)". Code on origin/main: `construction-boq-service.ts:1426` `sourceChangeOrderId?: string`, :1434-1437 validation branch. Spec survives; the R-98 register text is stale. Relevant to WO Phase 3 (status text is not evidence).

### X-07 -- WO D-02 "states twice it read 68 rows" vs spec
The spec states 68 three times (L158, L168, L346). WO text should say three.

### X-08 -- WO exit 3.2 ("31 exceptions-directive items ... in the same register") has two candidate sources
`platform.sumeet_gap` has 31 rows (GAP-01..GAP-31) and is NOT the exceptions directive; the directive's 31 items are in `construction-exceptions-service.ts`'s header (ACTIVE-CLAIMS.yaml origin/main L5073-5078; commit 6d531f53; 28 testable + 3 meta). WO 3.2 must name the source file, or a builder can load the wrong 31.

---

## Commands used (all read-only)
- In C:/ct/ct: `git show origin/main:<path>`, `git ls-tree -r --name-only origin/main`, `git grep ... origin/main`, `git merge-base --is-ancestor 6d531f53 origin/main`, `git ls-remote origin refs/heads/main`.
- `gh api repos/FChecklist/projexa/pulls/{297,298,300,303}`, `gh api repos/FChecklist/compliance-tracker/pulls/{303,1759}`, `gh api repos/FChecklist/projexa/compare/<merge_sha>...e88b53e`, `gh api repos/FChecklist/projexa/commits/main`.
- SQL, SELECT only, `pcrjmlpuqsbocqfwoxod`: `information_schema.columns` for `platform.user_ai_links`, `compliance.api_keys`, `platform.sumeet_requirements`, `platform.sumeet_gap`; `platform.sumeet_requirements` grouped by status; `platform.user_ai_links` status / created / last_used (token column not read); `platform.worker_agents` counts (22 `tier='global'`, 27 total); `platform.sumeet_gap` status counts; `pg_policies` role counts; `pg_proc` SECURITY DEFINER EXECUTE grants in `public` (anon: 5 dpdp_* + 2 pgaudit_*; authenticated: 30 dpdp_* + 2 pgaudit_*).
- Source snapshots used for line numbers: `build001/a03src/*.ts` (exported from origin/main 025eea08).
