# PROJEXA local-first: the owner's requirements, one register

Owner: Rajat Agarwal. Source: live Claude Code session, 2026-10-02 (verbatim intent, tidied). Governing priority from the owner: **cost near zero first, ease of work for the user second, security third**
("security is second to cost"; "the security is not high, this is not rocket data"). Order of building: local + Supabase + git first, then deploy, then the LAST step is the Vercel deploy.

Status words are measured, not planned: `DONE` = merged or committed with a passing committed test; `IN BUILD` = code exists on a branch, not complete; `STARTED` = work item running; `PLANNED` = scoped, not started.
Each row names the acceptance test that must pass before it is called done. Honest limits are written next to the row, not hidden.

## A. The five goals (first messages)

| # | Requirement | Acceptance test | Status |
|---|---|---|---|
| G1 | The user's laptop is a daughter server: it does the work so Vercel is used minimally | scripted 10-minute session: count of requests that reach Vercel (functions + middleware) per screen; target ~0 for reads and writes | IN BUILD (replica, outbox, push) |
| G2 | Two-way sync laptop <-> our backend (Supabase), every record versioned and its history kept | pull + `/changes` + `/ids` + push with conflict detection; versions recorded in `platform.projexa_record_head` / `projexa_change_log` | IN BUILD (backend DONE on branch feat/lf-sync-backend: 0678-0681; client IN BUILD) |
| G3 | Two or more laptops of one organisation sync directly with each other | two browser contexts exchange signed rows; tampered row refused; wrong org/view refused | STARTED (backend attestation + signing DONE; WebRTC client PLANNED next) |
| G4 | Our RAM / server used minimally; the user's RAM used | invocation counts (G1) + no server-side compute for reads | IN BUILD |
| G5 | The COMPLETE software and the COMPLETE database of that user and their organisation (as per role) is on the laptop, synced with Supabase (data) and git (software versions), on the user's RAM; Vercel / external servers nearly zero; the bill zero or inside the free plan | one versioned bundle (one file, like an image) + every table the visible screens read; measured invocations; projected bill | IN BUILD (registry 0680 DONE on branch; bundle build PLANNED; org-level kinds PLANNED) |
| V1 | The download has a version number, download date, etc., is ONE file/bundle matched with the backend; each file has a number and a version recorded in Supabase so update history is kept; versions help sync | `platform.projexa_release*` + `projexa_client_install`; 426 gate for too-old clients | backend DONE on branch (0680); build script + installer PLANNED |

## B. The fifteen requirements of 2026-10-02 (the "keeps working / AI / forever" message)

| # | Requirement (owner's words, tidied) | What it means in build terms | Acceptance test | Honest limit / decision | Status |
|---|---|---|---|---|---|
| R1 | Even with NO internet, PROJEXA keeps working on the laptop | service worker serves the whole app from the downloaded release; every screen reads the local database; every write goes to the local outbox and syncs later | Playwright with the network OFF: load, navigate every visible module, create/edit/delete a record, reload, still there; reconnect -> it syncs | The first visit must be online (nothing is on the laptop yet). Only the visible modules are made offline-complete first. | STARTED |
| R2 | Internet is up but OUR server is down: it keeps working | same as R1; the app treats an unreachable or erroring server exactly like offline, silently, and retries with back-off; peers still sync if they can find each other | stub the Edge Function to 5xx/timeout: the app keeps working, a "will sync later" marker, no error dialogs | Laptop-to-laptop needs a rendezvous: Supabase Realtime is ours, so a free public fallback signalling channel is added. Attestation lasts 24 h so peers can verify each other while we are down. | STARTED |
| R3 | More than one user's laptops auto-sync | background, automatic: on open, on reconnect, on a timer, on peer discovery; no button | two laptops converge without any click | cost: timers are long (minutes), deltas only | IN BUILD |
| R4 | Each user sees their own data, their own projects' data and their own organisation's data, as per role | the sync SQL scopes every row by organisation, project readability and role redaction (money nulled by role); extended from 13 kinds to every table the visible screens read | per-role test: a viewer never receives money/wage fields; another org never receives a row | one person may belong to several organisations (company switcher): each is its own database. The inventory shows many unsynced tables: labour, material receipts/issues, meetings, floor plans, time entries, baselines/sprints, billing claims, masters (vendors, customers, companies, departments, users, categories, currencies). | PLANNED (backend 0683) |
| R5 | The external / internal AI CANNOT code on this | the downloaded bundle is immutable (hash-verified, read-only); no endpoint, tool or manual lets any AI change the software; AI manuals say so | test: no registry function / route / tool writes code; bundle hash mismatch refuses to run | "Code" means the app's software. Data is R6/R7. | PLANNED |
| R6 | The external / internal AI CAN work on it | the AI work link (exists) plus an in-browser AI surface (R11) both read and write the person's data | existing link tests + new local-surface tests | | partly DONE (link), local surface PLANNED |
| R7 | The AI can make the COMPLETE project, edit, delete, update etc. for that user, as per role and organisation | extend the AI function registry/executors to full create/update/delete for every visible entity, role-gated; deletes by an AI are drafts the person confirms unless the person switches on "let my AI act without asking" | per entity: create, update, delete by AI as each role: allowed/refused exactly per role | Today the registry has 72 writes and NO delete and no generic update (verified). This is a large TypeScript build in the pipeline executors. | PLANNED (gap analysis first) |
| R8 | The complete work can happen on the laptop | R1 + R7 on the local database; the AI (R11) acts on the local database too | the end-to-end scenario: create a project, BOQ, tasks, progress, RFIs entirely offline, by hand and by AI, then sync | | IN BUILD |
| R9 | Once logged in, logged in FOREVER until the user logs out or deletes | the session is stored durably (Supabase refresh token, long-lived), a failed refresh while offline or while our server is down NEVER signs the person out; a cached local identity opens the app | test: expire the access token offline -> still in; close/reopen the browser -> still in | Supabase's refresh token never expires by default; sign-out only on the user's click. | STARTED |
| R10 | The app cannot be deleted from the browser until the user chooses | request persistent storage (`navigator.storage.persist()`), offer install as an app (PWA), keep a second copy of the identity, re-download automatically if the cache is somehow missing while online | test: persist() requested and recorded; app and data survive storage-pressure simulation | A browser can never be PROMISED not to evict; persist() + install are the strongest tools there are, and Safari discards storage of sites not used for 7 days unless installed to the Dock/Home Screen. The user's own "clear site data" always wins (that is the user's choice). Data is also in Supabase, so a wiped laptop re-downloads. | STARTED |
| R11 | The user's browser AI (Chrome, Edge, Safari ...) can automatically get access to PROJEXA for that user on that laptop | the page registers its tools with the browser AI (WebMCP `navigator.modelContext` when the browser has it), exposes `window.projexa.ai` with a machine-readable manual, an `llms.txt`/in-page manual, and accessible labels, all running on the logged-in session: nothing for the user to set up | test: tools are registered; a scripted agent lists projects and creates a task with no setup | WebMCP is experimental and only some browsers have it; where it is absent the agent drives the page through the accessible UI and the manual. | PLANNED |
| R12 | The user does not have to think | everything automatic (download, update, sync, retries); conflicts are merged automatically field by field (disjoint changes merge; the same field takes the latest change and the other is kept in history, undo available); no sync buttons, no dialogs for normal work | test: two laptops edit different fields of one record offline -> both edits survive after sync, no prompt | | IN BUILD (auto-merge to add on top of the outbox) |
| R13 | Security is not high; ease of work is most important | no end-to-end encryption of the local database; 24 h attestation; no re-login prompts; no passwords/PINs on the laptop copy | n/a (design rule) | The floor that stays, because "own data as per role" (R4) is itself a security rule: organisation isolation and role redaction. | design rule |
| R14 | Keeping cost near zero is the most important | free tiers only; no paid add-on; long sync intervals, deltas, batching; peer sync before server sync; Vercel serves static files only | cost model: invocations/month vs free limits (Supabase Edge 500k, Realtime, DB egress; Vercel static) | Spend can only be proven after real use for a billing cycle; before that, scripted-session counts. | design rule + measured |
| R15 | Security is second to cost | whenever cost and security conflict, cost wins; the floor in R13 stays | n/a | | design rule |

## C. Rules I keep while building (from the owner's standing rules)
- No paid step without asking (recharges, plan or cap changes, paid add-ons, DNS) -- the three owner-only items. Nothing in this register needs one.
- No deploy to Vercel to test; test locally and on Supabase. The Vercel deploy is the LAST step, after everything else is complete and merged.
- Never create accounts or set passwords for anyone; never permanently delete data (dashboard steps are given to the owner instead).
- Migrations are additive with a down file, applied after CI is green, and reported to the owner.

## D. STATUS SNAPSHOT 2026-10-02 (measured, not planned)
**How the percentages are measured.** "Completed" = the share of that requirement's acceptance criteria that are BUILT and covered by a committed, passing test at the unit / PGlite (real Postgres as WASM) / fake-server level. It is NOT "works in a browser": nothing has yet been run in a real browser, against the real deployed backend, in CI, or on Vercel, so **end-to-end verified is 0% for every row**. Percentages are my estimates from the evidence in git, not a guarantee.

| # | Requirement | Completed | Pending | What exists | What is missing |
|---|---|---|---|---|---|
| G1 | Laptop = daughter server, Vercel minimal | 35% | 65% | replica, outbox/push, local DB v3, release bundle + installer + service-worker core | the `/local` shell wired to modules, 20 of 21 visible routes, shell-bootstrap throttling, invocation measurement |
| G2 | Two-way sync + versions recorded | 60% | 40% | backend 0678-0684 (signed rows, versions, tombstones, push + conflicts, release registry, 37 kinds) 228 tests; client engine 193 tests | org kinds client, auto-merge, only 3 write flows wired of ~70, backend never run against the real client (review running), CI, live apply |
| G3 | Laptop <-> laptop sync | 55% | 45% | backend attestation + signing; client peers (WebRTC, 3 signalling providers, scheduler) built by a cloud agent | review, integration into the replica, real two-browser test |
| G4 | Our RAM/server minimal | 25% | 75% | design, cost model, AI-off gate (in progress) | measured numbers, module conversions |
| G5 | Complete software + complete org DB on the laptop | 30% | 70% | 28 project + 9 organisation kinds server-side; bundle build/installer | client consumption of org kinds, 20 of 21 modules, real bundle build in CI |
| V1 | Versioned one-file download, per-file number/version, history | 75% | 25% | registry + installs + 426 gate (21 tests), bundle builder, verified installer | build integration, registration at deploy, real install test |
| R1 | Works with no internet | 35% | 65% | service-worker core, connectivity state, shell infra (agent still building) | `/local` shell modules, Playwright offline run |
| R2 | Works when OUR server is down | 45% | 55% | server_down state, 24 h peer trust, public signalling fallback | real test with the Edge function failing |
| R3 | Several laptops auto-sync | 50% | 50% | cost-aware scheduler, peer protocol | wired into the app, real test |
| R4 | See own data as per role | 45% | 55% | role redaction proven for 37 kinds, isolation tests | UI reads (only BOQ), org kinds in the replica |
| R5 | AI cannot change the software | 60% | 40% | deny-list guard + hash check (cloud agent), no code-writing function exists | integration, review |
| R6 | AI can work on it | 65% | 35% | AI link (72 writes) + in-browser API (cloud agent) | integration, review |
| R7 | AI can create/edit/delete everything per role | 15% | 85% | gap analysis; first attempt lost to a cloud classifier block; re-run in progress | 27+ new functions, per-person switch, 0685 migration |
| R8 | Complete work possible on the laptop | 10% | 90% | engine pieces | module conversions, AI on local data |
| R9 | Logged in forever | 65% | 35% | durable identity, no sign-out on refresh failure (unit tests) | real-browser verification |
| R10 | App cannot be deleted from the browser | 65% | 35% | persistent storage request, install prompt, silent re-install | real-browser verification |
| R11 | Browser AI gets access automatically | 55% | 45% | `window.projexa.ai`, WebMCP registration, manual, llms.txt (cloud agent) | review, integration into the shell |
| R12 | User never has to think | 35% | 65% | everything automatic except conflicts | automatic field-level merge, no prompts |
| R14 | Cost near zero | 30% | 70% | cost model + runbook (cloud agent), design rules | measured invocation counts, billing-cycle proof |
| R13, R15 | Security not high / second to cost | n/a | n/a | design rules, honoured so far | |
| **All 19 measurable rows** | | **~45%** | **~55%** | | **End-to-end verified: 0%** |

**By work stream** (completed): backend migrations/Edge/tests 85%; laptop sync engine 70%; offline shell + bundle + identity 45%; peers + jobs + browser AI 55% (built, unintegrated, unreviewed); module conversions 5% (1 of 21 routes); AI create/edit/delete 15%; in-app AI off 60%; cost model + runbook 70%; integration + CI + browser e2e 0%; deploy 0%.

## E. STATUS SNAPSHOT 2026-10-02 (2) -- only MERGED + TESTED work counts as completed
Since snapshot D: an independent review of the backend (80 findings, 1 blocker) and of the laptop client (44 findings, 4 blockers: the sync identity guard, the CORS header, the BOQ row shape, the 413 wedge) were run against the REAL code; the backend fixes D1 (Edge handlers) and D2 (push/jobs/release SQL) are merged (16 sync suites green), AI create/edit/delete B2 (27 functions + per-person switch) is merged, and on the laptop the sign-out wiring (E1), delivery (E2), documents (E3) and overview (E5) module clusters are merged. Still in flight (not counted): D3 (change feed/retention), FA/FB (client wire conformance, outbox safety), E4 (design/change), E6 (cost, measured: a working day fell from 14,159 to 209 requests per laptop), B5 (organisation-scoped AI functions).

| # | Requirement | % completed | % pending |
|---|---|---|---|
| G1 | Laptop is the daughter server, Vercel minimal | 40% | 60% |
| G2 | Two-way sync, versions recorded | 50% | 50% |
| G3 | Laptop to laptop sync | 50% | 50% |
| G4 | Our RAM/server minimal | 25% | 75% |
| G5 | Whole software + whole org DB on the laptop | 30% | 70% |
| V1 | One versioned download, per-file numbers, history | 70% | 30% |
| R1 | Works with no internet | 38% | 62% |
| R2 | Works when our server is down | 45% | 55% |
| R3 | Several laptops auto-sync | 50% | 50% |
| R4 | See own/project/org data as per role | 42% | 58% |
| R5 | AI cannot change the software | 60% | 40% |
| R6 | AI can work on it | 70% | 30% |
| R7 | AI can create/edit/delete as per role | 50% | 50% |
| R8 | Complete work possible on the laptop | 10% | 90% |
| R9 | Logged in forever | 75% | 25% |
| R10 | App not deleted by the browser | 70% | 30% |
| R11 | Browser AI gets access automatically | 55% | 45% |
| R12 | User never has to think | 35% | 65% |
| R14 | Cost near zero | 30% | 70% |
| | **Overall (19 rows)** | **47%** | **53%** |

End-to-end verified (real browser, real backend, CI, live): **0%**.
## F. STATUS SNAPSHOT 2026-10-02 (3) -- built, TESTED, and the backend LIVE
Since snapshot E: both integration branches are complete (backend `feat/lf-sync-backend`, laptop `feat/local-first-complete`), migrations 0678-0687 are APPLIED on the live Supabase project and the three Edge functions are DEPLOYED. Tested, with no password or token ever used: the real Edge handler over the live SQL functions for 9 real people of 3 organisations (117 checks: isolation, role visibility, paging, `/heads`); the write side (30: push ledger exactly once, role gates, job lease, tracking health of 37 kinds, a committed change feed); a pushed edit executed by the real exec pipeline on the live database (12: applied, duplicate on replay, conflict on a stale edit, role and organisation refusals, feed + pull); signatures over PostgREST with the service role (14: real grants, key creation, px2/px3 row signatures verify independently); the release registry with a manifest from the laptop app's own builder. The first real-browser run of the offline e2e found that nothing in the app turned local-first on (fixed: default ON for a signed-in person with an opt-out) and a cloud agent then brought the four offline tests (R1, R2, R9, R10) to green in a real Chromium on two clean runs, fixing three real app bugs on the way (the first sign-in never installed the release, a doubled connectivity marker, a crash on every keystroke in the offline BOQ screen). Percentages are my judgment and count only tested work.

| # | Requirement | % completed | % pending (what is left) |
|---|---|---|---|
| G1 | Laptop is the daughter server, Vercel minimal | 85% | 15% (the deploy, the owner's real login) |
| G2 | Two-way sync, versions recorded | 90% | 10% (a real person's token end to end) |
| G3 | Laptop to laptop sync | 65% | 35% (two real browsers; only unit + conformance so far) |
| G4 | Our RAM/server minimal | 80% | 20% (measure after launch) |
| G5 | Whole software + whole org DB on the laptop | 65% | 35% (37 kinds and 14 modules are offline; the other PROJEXA modules are not) |
| V1 | One versioned download, per-file numbers, history | 85% | 15% (the first release registered after the deploy) |
| R1 | Works with no internet | 85% | 15% (modules beyond the BOQ proof in a real browser) |
| R2 | Works when our server is down | 90% | 10% |
| R3 | Several laptops auto-sync | 75% | 25% (the change feed is live-verified; the peer path is not) |
| R4 | See own/project/org data as per role | 90% | 10% |
| R5 | AI cannot change the software | 75% | 25% |
| R6 | AI can work on it | 75% | 25% (a real Chrome/Edge AI session) |
| R7 | AI can create/edit/delete as per role | 80% | 20% (draft-confirm and the per-person switch in a live session) |
| R8 | Complete work possible on the laptop | 40% | 60% (a person can do the offline modules' work; the rest of PROJEXA still needs the server) |
| R9 | Logged in forever | 85% | 15% (a real long-lived session) |
| R10 | App not deleted by the browser | 85% | 15% (a real browser eviction cycle) |
| R11 | Browser AI gets access automatically | 60% | 40% (only tested without a real browser AI) |
| R12 | User never has to think | 75% | 25% (the owner's first-use walk-through) |
| R14 | Cost near zero | 80% | 20% (real traffic after launch; Vercel's rate-limit status) |
| | **Overall (19 rows)** | **77%** | **23%** |

End-to-end verified: real browser against the stand-in services **yes (4 tests, twice)**; the real handler and pipeline against the LIVE database **yes (173 checks)**; a real browser against the LIVE deployed backend with a real person **not yet (0%)**, which needs the deploy and the owner's real login.

## G. Snapshot G, 2026-10-02 evening (supersedes the Status column above where they differ)

**Decisions closed by the owner today:** (1) R12 "the user never has to think" is an AMBITION, not a pass/fail requirement; it is not scored. (2) R11: the AI is always the user's OWN: the browser AI on their laptop, or any AI they paste the ai-work-link into. Nothing of ours calls a model; all AI work lands in the laptop's own database. (3) Money-sensitive AI creates/updates are NOT confirmed (as per role); deletes stay drafts unless the person's own "act without asking" switch is on. (4) Vercel free plan is the target; the production deploy is the LAST step; no spend; no API deploy (R76).

**What "done" means in this table:** merged to main of both repos AND covered by a committed test that passed in CI (real Chromium with the network OFF against a local stand-in service, the real handler against PGlite, and live-database probe scripts). It does NOT mean a real person used it on the live site: that needs the production deploy (blocked by the Vercel rate limit, owner-only) and the owner's real login. That last step is 0%.

| # | Requirement | Built + tested in CI | Still missing |
|---|---|---|---|
| G1 | Laptop is a daughter server | 85% | measured Vercel request count on the live site |
| G2 | Two-way versioned sync with Supabase | 90% | real-login run (migrations 0678-0687 and edge functions are LIVE; live probes read 117 / write 30 / push 12 / signing 14 pass) |
| G3 | Laptop-to-laptop sync | 85% | peers across two real machines (WebRTC proven in two browser contexts) |
| G4 | Our RAM/server minimal | 80% | real-world numbers (harness: 209 requests per laptop per working day; about 108 laptops fit the free 500K quota) |
| G5 | Whole software + whole role-scoped database on the laptop, bill about zero | 80% | the first real release registered after deploy |
| V1 | Versioned one-file download, versions recorded in Supabase | 90% | first release auto-registers on the first signed-in laptop after deploy |
| R1 | Works with no internet | 90% | only the visible modules are offline-complete |
| R2 | Works when OUR server is down | 85% | |
| R3 | Laptops auto-sync | 80% | |
| R4 | Own data, per role | 85% | org kinds beyond the visible screens |
| R5 | AI cannot change the software | 70% | hash-verified immutable bundle is built; no live check |
| R6 | AI can work on it | 90% | |
| R7 | AI complete create/update/delete per role | 85% | deletes are drafts by decision |
| R8 | Whole work on the laptop, by hand and by AI | 75% | one end-to-end scenario on the live site |
| R9 | Logged in until logout | 85% | signOutEverywhere wired in all four sign-out paths; real-login proof is the owner's |
| R10 | App cannot be deleted from the browser | 75% | persistent-storage grant depends on the browser |
| R11 | The user's own browser AI gets access | 85% | |
| R12 | (ambition, not scored) | n/a | |
| R13-R15 | Design rules (cost first, security second, floor stays) | rules, applied | |

Average of the scored rows (G1-G5, V1, R1-R11): about 83% built and tested in CI. Live end to end with a real person: 0%, until the deploy and the owner's login.

Known open item: the e2e "AI-created task shows on the Schedule screen" check was flaky in CI (a pull in flight when a push settles can hide the new row until the next change-feed pass); the spec now reopens and nudges, and prints what the laptop holds on failure. First-sync pacing (100 requests a minute, `rate-pacer.ts`) and the circuit breaker (`replica.ts`) are built, on by default and tested (cost/*.test.ts).
