# BUILD-002: AI work completion plan (PROJEXA)

Written 2026-09-26 by the PROJEXA project-manager session, after the owner (Sumeet persona) asked "audit and confirm" whether the 198 points of BUILD-001 deliver his objective, found they do not, and asked for a gap analysis, a document, and work "as per the document".
Status: PLAN. Nothing in this file is built yet. Owner decisions are in section 6; owner-only actions are in section 7.
Sources: four read-only gap reports (function coverage, write path, mint and upload, five-ways trace). They contain attack-surface detail, so per PMD-25 they are kept in the private KT Drive folder and only their conclusions are here.

## 1. The objective, in the owner's words (this is what "done" means)

1. The user can upload the data.
2. Software (Level 0) and AI (Level 1) read and apply that data in that project.
3. The Level 1 AI can be internal (ours, metered and re-billed to the user) or external (the AI in the user's own chat box).
4. The user has an AI work link for that project and user, and can click and copy it from the front end, paste it into the external AI, and that AI works in the system on behalf of the human.
5. and 6. The AI is not a human, so it needs no UI or UX. It needs file paths, input, output, logic and an API. That is built in PROJEXA for the AI to work.
7. Through the link the AI can do anything and everything except coding, as per the roles of the user and the project.
8. This Claude Code session is used as the external AI to do the work, tested end to end.

The five ways (owner's words 2026-09-25; way 5 was added by the PM and accepted): 1 human upload in the front end; 2 internal AI chat box; 3 external AI chat box with the pasted link; 4 email the sheet to the software; 5 autonomous or scheduled AI (pull, no trigger).
The test object is the prospect workbook `SMD.ZOOMIES, DIP, FP.DUBAI signed.xlsx`: 22 sheets, a PDF-table export, two areas (Play Area 1,343,445 and Vet Area 252,835), grand total AED 1,596,280 excluding VAT.
In all five ways the project is created and all data is populated by software and AI, and the human does not work. If a question arises, the human is asked.
The 111 Sumeet requirements must be completable through these ways, and the persona test is: Sumeet, holding the 111 requirements, the 198 points and the ZOOMIES data, manages the whole project through the AI work link.

**A way is done only when the ZOOMIES run passes through that way end to end and the result is re-read from the database.** A route, a function or a unit test existing does not count.

## 2. Why the 198 points passed while the objective is unmet

BUILD-001's register is a list of checks derived from a work order and a spec that modelled FOUR surfaces (approval page, prefilled screen, link chat, email) for seven record types on an existing project. The owner's discussion moved to FIVE ways and to a NEW project. The register was never reconciled to the discussion. Specifically:

1. The unit under test was a record on an existing project. No row could fail on "a project is created from a sheet".
2. "The function exists" was counted as "the AI can use it": 55 executors exist, 10 are on links, none of them creates a project or a BOQ.
3. The read layer was counted as the whole link. Writes answer 503 or 501 and the executor does not exist. The link is a universal reader.
4. Test doubles hid the hard part: extraction tests use a stand-in model on a three-line-per-sheet fixture, never the real ZOOMIES file.
5. Storing an attachment was counted as processing it (BR-413).
6. A server route was counted as a screen: PROJEXA has no upload, approvals or mint screen.
7. Twenty-nine rows were parked as owner-blocked, and they are exactly the rows that would show the ways end to end.
8. Refusals were tested (the internal AI does not run on link traffic) but capabilities were not (a link completes a task).
9. Rule conflicts were not registered: "the AI never writes on its own authority" (four-surface rule 5, PMD-05) against "the human does not work".
10. Four model routes, one budget cap, no single metering row.
11. "All 111 completable through the ways" has no row. 56 of the 111 have no path through any way today.
12. Most rows are unit tests written with the code, against fakes.
13. I reported "162 of 198 pass" as progress without checking it against the objective. That was the PM's error.

BUILD-002 therefore has its own acceptance register (`ACCEPTANCE_REGISTER.csv`, ids AW-nnn) whose rows are outcomes of the owner's words, run on the real ZOOMIES file, not properties of components. BOOLEAN_REGISTER.csv (198) is unchanged and remains the record of BUILD-001.

## 3. Gaps found (grouped; each has a work package in section 5)

Shared middle (ways 1, 2, 4, 5):
- G-01 The importer reads only sheet 1; the raw ZOOMIES file is rejected ("Could not find a Description column"). A deterministic multi-sheet reader reads it as 50 priced lines (AED 1,388,480) plus three flagged lump-sum lines (AED 207,800: bills 1A 175,000, 1B 22,000, Play Bill 7 10,800) that reconcile to 1,596,280. The summary sheet must not be read as AED 250 million.
- G-02 The model extraction contract is too thin: line breaks flattened (merged cells in Tables 5, 12, 13, 19 misread), 400-character cell cap cuts the 1,228- and 1,156-character terms, no totals, VAT, areas, client, currency or questions, item codes restart per sheet, 22 of 71 quantity rows have no rate, two areas as two BOQs would hide one from the dashboard.
- G-03 No model is configured (`model: null`); `projexa-document-extract` is not deployed; provider choice is the owner's.
Way 1: G-04 PROJEXA never calls the from-document route: no upload-new-project screen, no proxy; no page lists proposals or presses Approve.
Way 2: G-05 the chat composer has no file attachment; no registry function creates a project; Level 1 is refused for every user except the owner.
Way 3: G-06 no mint screen (removed, Edge `/mint` is 501); G-07 links are per existing project and no function creates a project; G-08 only 10 of 55 executors are on links; `create_boq` is on none and the link drops `lineItems`; the body cap (8 KB) is below the BOQ (about 14 KB); there is no append-lines function; G-09 no write works (see G-12).
Way 4: G-10 the .xlsx attachment is stored and never read; inbound hostname in the DNS list (`inbound.*`) differs from the hostname the code accepts (`mail.veridian-aios.com`).
Way 5: G-11 no watcher, no cursor, no file download; the scheduler bridge's proposals are not listed and its last hop is on the paused Vercel project.
Write path: G-12 `POST /actions` is refused, `POST /drafts` is 501, nothing runs a confirmed draft, `ai-work-link-exec` does not exist, `writes_enabled` is false and a second hard-coded switch (`executorEnabled:false`) also blocks; link writes would be recorded as executor `software` with no `via`/`ai_link_id` and no `model_calls`/`level1_outcome`; 24 ranked gaps in the private report.
Coverage: G-13 of the 111 requirements, 14 are covered on the link, 41 have a service and executor but are not on the link, 24 have a service but no executor, 8 have no write path anywhere (exception items 03, 04, 10, 11, 12, 15, 16, 21), 24 are not link capabilities. G-14 `record_work_progress` ignores `remarks` and `entryDate` and fails when the project has no activity. G-15 the Tier-1 `documents` kind omits `metadata`. G-16 55 executors exist (28 added by U-38 are unreviewed for links).

## 4. Design decisions taken by the PM (change any of them by telling the PM)

- **D-A New project for an external AI: project shell first (option B).** One click in PROJEXA ("New project with my AI") creates a shell project through the existing `createProject` and mints a link for the same user. The AI then renames and fills it (`update_project`, `create_boq`, `add_boq_lines`, `seal_boq`). No CHECK or link-model change. The project-less "workspace link" (option A) is specified in the private report and built only if a way needs it.
- **D-B A BOQ larger than the body cap is built in batches:** `create_boq` (empty, mandatory idempotency key), `add_boq_lines` (up to 25 lines per batch, replay-safe by boq id plus batch number), `seal_boq` (compares the AI's control totals per area and grand total against the sum of quantity times rate and answers `TOTAL_MISMATCH` with the diffs, which the AI must show its user). The per-function body cap is raised to 64 KB for these three only.
- **D-C Approvals are level-2 (draft, then the person confirms while signed in), not excluded.** "As per the roles" means the AI can prepare an approval and the person with the approving role confirms it. Billing claims and other commercial actions stay level 2 with the minimum role of the existing route. The one open owner decision is D-1 in section 6.
- **D-D Two areas of the ZOOMIES file are ONE BOQ** with area-prefixed categories (a second BOQ is invisible to the dashboard and trips the multiple-BOQ exception).
- **D-E Writes are built and tested with the master switch OFF.** A local execution host (a bun script that runs the same `executeIntent` code as the Edge function against a real database in-process) makes the end-to-end test possible without the owner's secret. The live switch-on is a four-step owner kit (section 7).
- **D-F The mint screen is a PROJEXA dialog that calls the Edge function with the user's session JWT** (no Vercel function invocation on the click). It reaches users only with one PROJEXA release, which only the owner may authorise. Until then the same screen is proven locally.
- **D-G One metering row for every model call** (internal chat, extraction, email analysis) so internal AI can be re-billed per user and organisation.
- **D-H The ZOOMIES fixture in the repo contains only the public parts** (no bank details, no client personal data).

## 5. Work packages (order, files, tests, owner dependency)

Every package: extends existing code, no duplicate, forward and down migration where SQL changes, PGlite tests, a falsifiability proof (break the code, see the test fail, restore), restricted tsc plus the three guard scripts, one heavy command at a time (8 GB laptop), PR merged on green CI, never `--admin`.

| WP | What | Main files | Ways / objectives | Owner needed |
|---|---|---|---|---|
| WP-00 | Claim, SHARED_BOUNDARY rows, this plan, the acceptance register and its checker | ai-os/boss/ACTIVE-CLAIMS.yaml, ai-os/SHARED_BOUNDARY.md, ai-os/projexa-build-002/* | all | no |
| WP-01 | Deterministic multi-sheet bill reader used as the fallback of scope/import and as the pre-step of from-document, with the real ZOOMIES fixture (public parts) | src/lib/ingest/multisheet-bill-reader.ts, parser.ts, scope/import route, fixtures | 1, 2, 4, 5; objective 1 | no |
| WP-02 | Extraction contract fixes: row-preserving digest, cell cap, schema (totals, areas, client, currency, payment terms, questions), item-code prefix, reconciliation gate, single BOQ, realistic stand-in model | document-extraction-schema.ts, -service.ts, projexa-document-extract handler | 1, 2, 4, 5 | model choice for live (D-2) |
| WP-03 | Project functions on the pipeline and the link: `create_project` (shell), `update_project`, `create_project_from_document`; shell convention | function-registry.ts, executor.ts, gen-ai-link-registry.data.ts | 3, 2 | no |
| WP-04 | BOQ payload functions: `create_boq` on the link at level 2, `add_boq_lines`, `seal_boq`, `create_boq_revision` declares `lineItems`; per-function body cap; shared line validator; `/drafts/{id}/preview` | executor.ts, construction-boq-service.ts, link handler | 3 | no |
| WP-05a..f | Function coverage, waves 1 to 6, 8, 9 (schedule, milestones, reports; BOQ import, change orders, site instructions; RFIs, submittals, punch list, site diary; progress, activities, attendance, materials; meetings, drawings, timesheets; exceptions, baselines, variance; permits, wiki, mood boards, FF&E, floor plans). Money and approval actions at level 2. Wave 7 (progress claims, KPI, submit for approval) is built as level-2 drafts | executor.ts, gen-ai-link-registry.data.ts, seed migration for `platform.ai_work_link_functions`, manual pagination | 3, 7 | R-95 answer for billing claims (D-1) |
| WP-06 | About 20 new or extended Tier-1 record kinds with hidden money columns; `documents.metadata` | record-kinds generator, SQL row-set functions | 5, 6, 7 | no |
| WP-07 | Fix `record_work_progress` (remarks, entryDate, no-activity), plus `create_activity` reachable | executor.ts, work-progress service | 7 | no |
| WP-08 | Mint: Edge `/mint`, `/links`, `/warning`, revoke; `_for` SQL variants; fresh-token rule; mint rate limit; truthful warning; PROJEXA dialog and "New project with my AI" | supabase/functions/ai-work-link/*, new migration, projexa ProjectWorkspaceClient/M24Shell | 3; objective 4 | one PROJEXA release (Vercel) to reach users |
| WP-09 | Write path, built and OFF: migration for claim/finish/live/draft-state SQL, `submissions.via/ai_link_id`, pipeline telemetry (executor `ai`, `model_calls` 0), bundling refactor, `ai-work-link-exec`, link v2 (drafts recorded live and safe, actions and confirm call exec, one switch), static-page fixes, effective level everywhere, local execution host, switch-on kit, kill-switch drill | drizzle/06xx, run-submission.ts, executor split, supabase/functions/ai-work-link-exec/*, projexa-link-pages/* | 2, 3; objectives 2, 7, 8 | secret + flag flip (section 7) |
| WP-10 | PROJEXA screens: upload-new-project (way 1), proposals and questions page (approve), attach a file in chat (way 2) | projexa src/app/... | 1, 2 | one PROJEXA release |
| WP-11 | Internal AI: chat attachment to `create_project_from_document`; provider policy (claude-cli owner-only before go-live, metered OpenRouter after, D-G) | assistant route, adapter.ts | 2; objective 3 | D-3 (spend) |
| WP-12 | Email: attachment reader over WP-01/02, sender check, hostname aligned with the DNS list, proposals listing | resend-inbound, email-intelligence-service | 4 | DNS, Resend keys |
| WP-13 | Way 5: `scan_connected_folder` (mailbox first, then Drive), cursor, list scheduler proposals, last hop off Vercel | scheduler bridge, prepared-proposals | 5 | Drive OAuth, Vault secrets |
| WP-14 | Persona acceptance: Sumeet manages ZOOMIES through the link, run by this Claude Code session as the external AI; first with the local execution host, then live once writes are on | scripts/verify/persona-*.sh, docs | 8 | switch-on for live |
| WP-15 | Close: acceptance register statuses from real runs, docs, memory | ai-os/projexa-build-002/* | all | no |

Migration numbers reserved for BUILD-002 (0629 to 0631 and 0643 upward are free on main at 2026-09-26; the journal's last `when` is 1790093500000; every new entry's `when` must be strictly above the previous merged one, use 1790100000000 + 500000 x n in merge order): WP-09 takes 0629 (link execution SQL: `ai_work_link__live`, `intent_claim`, `intent_finish`, `draft_state`, re-created `draft_confirm` and `warning`) and 0630 (`compliance.submissions.via`, `ai_link_id`, columns only); WP-08 takes 0631 (mint, list and warning variants that take a user id); WP-06 takes 0643 (record-kind row-set functions); WP-03/04/05 take 0644 upward (link function seed rows). Each has a down file and a rolled-back rehearsal, and the live apply follows the order in ROLLBACK_RUNBOOK.md and the U-46a procedure (rehearse, apply, re-hash, ledger row, then PR).
Code convention that keeps parallel packages from colliding: new executors live in `src/lib/pipeline/executors/<area>.ts` and are added to the EXECUTORS map with one import line each; new mint routes live in `supabase/functions/ai-work-link/mint.ts` and new draft and confirm routes in `drafts.ts`, with one dispatch line each in `handler.ts`.

Order the owner asked for: coverage (WP-03..07), then mint (WP-08), with the write path prepared (WP-09). WP-01 and WP-02 (upload) follow immediately because objective 1 and the ZOOMIES persona need them. WP-10 to WP-13 follow. Build serially through one heavy-command mutex; agents work in separate worktrees.

## 6. Owner decisions (asked once)

- **D-1** Does a single confirmation of a fully populated proposal count as "asking the human", or must upload, AI and email create directly? Default taken: one confirmation stays (keeps the four-surface rule and PMD-05). If direct creation is wanted the rule changes and money baselines need a manager rule.
- **D-2** Extraction provider before go-live (Groq under the USD 1 cap of PMD-43, or Claude Code stand-in) and who is billed.
- **D-3** Metered OpenRouter for non-owner internal Level 1 (spend).
- **D-4** Option A (workspace link) later or never.
- **D-5** Who may create a project and who may approve a BOQ with rates, per way. Default: creating a project needs role rank 2; approving a BOQ needs the existing approval role.
- **D-6** Inbound email hostname and provider.
- **D-7** Whether chat AIs that cannot POST are in or out of the ZOOMIES test.
- **R-95** May an AI write a billing claim at all (wave 7)? Default: level-2 draft that a billing-role person confirms (PMD-41).

## 7. Owner-only actions (the assistant never sets secrets, spends, changes DNS or deploys to Vercel)

1. Set `APP_RUNTIME_DATABASE_URL` as a function secret for `ai-work-link-exec`; run the preflight script; apply the prepared enable-writes migration (flag flip); run the smoke test. Rollback: set the flag back.
2. Extraction: set `PROJEXA_DOCUMENT_EXTRACT_SECRET` and the provider key; name the provider.
3. Set `AWL_CONFIRM_HOST` if unset (the default is a host that never resolves).
4. Resend inbound: DNS and keys. Scheduler bridge: Vault and Edge secrets.
5. Vercel: unpause and deploy PROJEXA (upload, mint and approvals screens) and compliance-tracker routes; recharge or upgrade.
6. Drive folder OAuth for way 5.
7. Acceptance runs with real ChatGPT, Gemini, Claude, DeepSeek and the others (BR-588 to BR-597).

## 8. Will each objective be met 100% by this plan?

| # | Objective | After WP-00..15 |
|---|---|---|
| 1 | User uploads the data | Yes for the ZOOMIES file and files of its kind (WP-01, no model), proven on the real file. Any other layout needs the model (D-2). Upload screen reaches users after one PROJEXA release. |
| 2 | Software and AI read and apply it | Yes, proven locally end to end (WP-09, WP-14); live when the owner switches writes on. |
| 3 | Internal or external Level 1 | External: yes. Internal: yes for the owner (claude-cli); for other users after D-3. |
| 4 | Link per project and user, click and copy | Yes locally; live after one PROJEXA release. |
| 5, 6 | API, file paths, input and output for the AI | Yes (manual, REST, OpenAPI, MCP with the widened function list and record kinds). Vendor acceptance is the owner's run. |
| 7 | Everything except coding, per role and project | Everything that has a service today, except the 13 excluded classes (platform admin, deletes, secrets, AI-model calls on link traffic, org-wide reads). The 8 exception items with no write path anywhere get a small new service each (WP-05f) or are recorded as not possible. Approvals are level-2 drafts. |
| 8 | This session as the external AI, end to end | Yes locally with the execution host (WP-14); live after switch-on. |

## 9. Working rules for this plan

Local, Supabase and GitHub for development, testing, merge; Vercel only for PROJEXA-AI.COM at go-live and never used to check work; DPDP stays off Vercel; never `--admin`; no database credentials written; no spend; DNS needs the owner; heavy commands one at a time; every workflow file yaml-checked before commit; every register row closes only from a run whose output is re-read from the database; falsifiability proof for every new test.
