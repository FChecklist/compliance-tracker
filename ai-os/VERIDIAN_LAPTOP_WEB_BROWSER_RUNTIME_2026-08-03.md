# VERIDIAN Laptop Web Browser Runtime — v1.0

**UMR:** `UMR-20260803-041000-70ae` (OCID-20260803-024, `veridian-worker@task-20260803-041006-ocid-024-veridian-laptop-web-browser-run.service`).
Parent: `UMR-20260803-040929-9713` (OCID-023, "VERIDIAN Universal End User Workflow").
Cites and does not amend the substance of: `UMR-20260803-040844-4a33` (OCID-022, End User
Experience Foundation), `UMR-20260802-173631-ca85` (ERP Functional Completeness Master
Program), `UMR-20260802-165606-4413` (OCID-020, PROJEXA end-user certification directive),
`UMR-20260802-164659-9a31` (server artifact traceability audit), `UMR-20260802-165034-5747`
(standing gatekeeper rule), `UMR-20260802-165434-cd91` (unified project memory model),
`UMR-20260802-165541-c27d` (recovery framework).

**Status: documentation only.** This artifact implements no code, changes no database, changes
no UI, changes no UX. Every claim below is either (a) real, live, evidenced state as of
2026-08-03, cited to a file:line or an existing canonical artifact, or (b) an explicitly
labeled gap already on record elsewhere in this repo's governance trail, or newly named here
only because no prior artifact had stated it from the browser-runtime angle specifically —
nothing here is invented, redesigned, or proposed as new architecture, UI, PWA, sync protocol,
AI engine, or database.

**Honest disclosure on this document's own directive, carried forward from OCID-022** (this
repo's own `ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md`, §"Honest disclosure",
PR #765, open at time of writing — not re-derived, cited): the originating task prompt describes
"the OCID-021 implementation lock which still permits discovery and matrix building to
continue." The real OCID-021 (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, amendment dated
2026-08-03) is the Category A/B production-DB governance split (`SEC-06`) — already
closed/merged, topically unrelated to the browser runtime, and not an "implementation lock" on
anything browser-related. `UMR-20260802-165606-4413` is the real UMR for OCID-020 itself, not
OCID-021. OCID-020 is also, separately, not yet confirmed independently complete per this
repo's own `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml` history. Neither discrepancy changes
what this task was asked to do — produce one documentation-only artifact — so it did not block
this work; it is recorded here, exactly as OCID-022 recorded it, for the Owner's awareness
rather than silently corrected into the directive's own text.

**Discovery method:** direct reads of `src/components/veri-chat/*`, `src/lib/prompt-compiler/*`,
`src/lib/browser-execution/*`, `src/lib/services/{chat-service,capability-registry-service,
permission-service,abac-policy-service}.ts`, `src/lib/supabase/auth-guard.ts`,
`src/lib/browser-intent-cache.ts`, `src/components/{AppSidebar,AppTopbar,AppShell}.tsx`,
`src/app/(app)/*` (99 module directories), `src/app/layout.tsx`; cross-checked against
`ai-os/CONSTITUTION.yaml` §5/§6/§17, `ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`,
`ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md`, `ai-os/audit-tree/04-veri-chat.yaml`,
`ai-os/audit-tree/08-task-response-engine.yaml`, `ai-os/audit-tree/09-onboarding-ux.yaml`,
`ai-os/SOFTWARE_TEAM.md`, `ai-os/AI_ORCHESTRA_HIERARCHY.md`, and
`ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` (OCID-022, this document's
immediate sibling and primary foundation) — not re-derived from memory. Where a mandated topic
has no real, built counterpart, that is stated explicitly as `NOT_YET_BUILT`/`POLICY_ONLY`
rather than invented.

---

## 1. Role of the laptop web browser

The laptop web browser is the delivery surface for the entire real, live VERIDIAN product today.
There is no separate desktop app, no Electron shell, no native laptop client, and no built PWA
(`BROWSER-01` through `BROWSER-07`, `ai-os/CONSTITUTION.yaml` §17, none describe a packaged app —
all describe the browser itself as the target). Every module listed in §12 below, every VERI
Chat surface, every report, every calculator, and every admin function is a page rendered by
`src/app/(app)/*` and served to whatever laptop browser the end user already has open. This
document describes that existing runtime as it stands; it does not propose a new one.

## 2. Why the browser is the primary workspace

Three real, already-decided facts make the browser the primary workspace, not a secondary one:

1. **There is no alternative surface.** `AGENTS.md`/`CLAUDE.md` describe one Next.js App
   Router application (`src/app/`); `ai-os/MASTER-TRACKER.yaml`'s `GAP-CONNECTOR-LAYERS` entry
   confirms Layer 3 (Browser Extension) and Layer 4 (Desktop Companion) are "fully unbuilt" and
   `deferred_large` — the browser is not one delivery channel among several, it is the only one
   that exists.
2. **The end-user-facing app shell is browser-native, not a thin wrapper.** `AppSidebar.tsx`
   (`getNavSections()`) and `AppTopbar.tsx` wrap `@fchecklist/veridian-ui-kit/shell` directly;
   there is no intermediate native chrome.
3. **The Owner's own architecture baseline treats the browser as where "more information should
   be held for faster work"** (`BROWSER-03`, `ai-os/CONSTITUTION.yaml`:736) — an explicit,
   already-recorded policy statement that the browser is meant to be a first-class runtime, not
   a passive display for a server-rendered page.

## 3. The large majority of end-user work happens in the browser

This is not a projection — it is a description of the only interaction surface that exists.
Every one of the 99 real module directories under `src/app/(app)/` (§12), every VERI Chat send
path (§17), every report (§25), every calculator lookup, and every approval decision (§28) is
performed inside a browser tab. There is no batch job, CLI, or native client an end user
operates instead. Where 100% of a platform's UI surface is browser-delivered, "large majority of
end-user work happens in the browser" is the base case, not an aspiration to design toward.

## 4. Browser as primary runtime

"Runtime" here means: where computation that produces what the end user sees actually executes,
not just where it is displayed. Three real, already-shipped execution substrates exist inside
the browser today, each independently confirmed in `ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`:

- **Deterministic client-side compilation** — `src/lib/browser-execution/client-compile.ts`
  runs phase_2's Layer-2 `analyzeLightweight()` logic client-side before any network call
  (`VeriComposer.tsx`'s `runBrowserFirstPass()`, lines 243–258).
- **In-browser embeddings/classification** — `transformers-engine.ts` runs
  `Xenova/all-MiniLM-L6-v2` client-side for tool-selection cosine similarity, explicitly not
  text generation.
- **In-browser small-LLM generation (WebGPU-gated)** — `webllm-engine.ts` runs
  `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` client-side, attempted only when `tier-orchestrator.ts`'s
  `shouldAttemptWebLlm()` confirms real `navigator.gpu` presence; otherwise it honestly falls
  back rather than faking a result.

All three are real, tested, merged code (increment 1 = PR #586; increment 2 = the status doc
above). What is explicitly **not yet wired**, per that same status doc's own "left open" section:
these engines are not yet connected to `VeriComposer.tsx`'s live send path — they exist as a
tier-orchestration layer callable via `tier-orchestrator.ts`'s exports, not as the composer's
default behavior today. That wiring is future-OCID scope, not redesigned here.

## 5. Browser local data model

The real local data model is narrow and single-purpose, not a general local database:

- **`src/lib/browser-intent-cache.ts`** — a real IndexedDB store (`indexedDB.open(DB_NAME,
  DB_VERSION)`, line 67), explicitly documented in its own header as "deliberately IndexedDB,
  not a server table: zero AI cost, zero network round-trip, works offline." This is the one
  real local *structured* data model in the codebase; it backs `IntentCommandPalette.tsx`'s
  recall of previously-picked chain+text combinations.
- **`src/lib/browser-execution/model-cache.ts`** — `IndexedDbModelCache`, tier-local model-weight
  storage so `npu-engine.ts` reuses downloaded weights across sessions.
- **Everything else the end user sees is server data, fetched per-request** — task, conversation,
  report, and capability-tree data all live in Postgres behind Drizzle/RLS
  (`withTenantContext()`, §29) and are not locally persisted beyond the two IndexedDB stores
  above.

`BROWSER-06`/`BROWSER-07` (`ai-os/CONSTITUTION.yaml`:749–758) — "most resolved work
(DMP-tree/calculator output/capability-tree structure) is cached in the browser" and "a second
tab/window automatically reuses that cache" — are both **`NOT_YET_BUILT`**, confirmed by direct
grep: the only pre-existing `localStorage` uses are four narrow, single-purpose keys
(`GlobalChatDock.tsx` chat-draft persistence, `OnboardingChecklist.tsx` completion state,
`resizable.tsx` panel-size persistence, `visitor-id.ts` anonymous pre-login id) — none of them
implement "cache resolved work for fast repeat access." This gap is not closed by this document;
it is named here as the real current state a future OCID would extend.

## 6. Browser local cache model

The real cache model today is IndexedDB-only, and only for two narrow use cases (intent recall,
model weights — §5). There is no cache for: capability-tree structure (fetched fresh every page
load per `BROWSER-05`'s own documented gap, `CONSTITUTION.yaml`:744-748), calculator output, or
resolved report data. `CACHE-01`–`CACHE-04` (`CONSTITUTION.yaml` §20) are a distinct, unrelated
concept — LLM prompt-caching (`cache_control` blocks sent to Anthropic), not browser-runtime
caching — and this document does not conflate the two. A general-purpose browser cache
covering capability-tree/calculator/report data is real, named, existing scope
(`BROWSER-06`/`BROWSER-07`) that remains open; this document catalogues that fact rather than
designing the cache itself, per the prohibition on designing sync protocols/new architecture.

## 7. Browser local search model

There is one real local (client-side, no network round-trip) search surface:
`IntentCommandPalette.tsx`, opened via `/` or `Tab` on an empty composer in chain mode, which
queries `browser-intent-cache.ts`'s `queryIntents()` against the local IndexedDB store first,
falling back to `GET /api/dynamic-chains/my-library` only when the local cache is empty for the
current mode. `AppTopbar.tsx`'s real-time search control (line 186) and the sidebar's ~100+ nav
links are server/route-backed, not a local search index. There is no local full-text search over
tasks, reports, or documents — that is real, current absence, not a gap this document proposes
to close.

## 8. Browser task execution model

Every user action that becomes a task follows one real, confirmed path:
`VeriComposer.tsx`'s `dispatchInstruction()` (line 260) → `POST /api/tasks` →
`task-service.ts::createTask()`. Two things happen in parallel with, not instead of, that call:

1. **Task creation itself** — synchronous, authoritative, the actual system-of-record write.
2. **Browser-first compile telemetry** — `runBrowserFirstPass()` (`VeriComposer.tsx`:243–258)
   runs `compileInBrowser()` client-side, then fire-and-forget `POST`s to
   `/api/prompt-compiler/execute`, which never trusts the client's classification and always
   recomputes from `rawText` server-side (`execute/route.ts`:9-21). Its own code comment is
   explicit: this is "best-effort telemetry/compiled-prompt logging that never blocks or fails
   the actual chat send / task creation that follows it" (`VeriComposer.tsx`:238-242).

A created task carries a Dynamic Chain classification only when created through the Chain
Selector (`DMP-02`, **PARTIALLY_ENFORCED** — not true for chats/reports/workflows generally,
`CONSTITUTION.yaml`:308-312). `DMP-04` (**ENFORCED**) guarantees no dead end: when no chain fits,
`src/lib/services/fde-service.ts::submitFdeRequest()` captures the requirement instead of
silently failing.

## 9. Browser workspace model

The workspace is a single persistent shell, not a per-page reset: `AppShell.tsx` mounts
`VeriComposer.tsx` once (per its own header comment, not remounted on navigation), so the
composer's in-progress chain selection, draft text, and active AI thread survive normal in-app
navigation. `veri-chat-context.tsx` lifts `selectedPath`/`aiThreadId` state above the composer
specifically so other components (e.g. `AppSidebar.tsx`) can read/write it. `VeriChatPanel.tsx`
(714 lines) is the independent right-hand panel — Overview/Tasks/Chats/To Do plus this repo's
own Meetings/Approvals/Voice tabs — with its own tab state, not driven by composer mode. This is
the real "one workspace, two coordinated surfaces" (main content + persistent composer/panel)
model already shipped; this document does not add a third surface.

## 10. Browser screen behavior

Screens are Next.js App Router pages under `src/app/(app)/<module>/`, sharing one layout
(`src/app/(app)/layout.tsx`) and the persistent shell (`AppShell.tsx`, §9). Real, confirmed
current behavior:

- Which **sections** a given org sees is gated by org type/module-enablement
  (`accountType`, `pmsEnabled`, `firmEnabled` — `AppSidebar.tsx`:126,175,224), not by end-user
  role — `AppSidebar.tsx` has zero references to `role` (confirmed by direct grep, matching
  OCID-022 §2.1/§3.6's finding, not re-derived independently here).
  Finance/ERP and Sales/CRM render unconditionally today per the code's own comment
  (`AppSidebar.tsx`:232, "no erpEnabled flag exists").
- A module a fresh org hasn't enabled still renders its page shell, but the backing API calls
  403 with **no explanatory UI** — an already-tracked gap
  (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` Finding B / Stream E; OCID-022 §3.2), not fixed
  here.
- Five links (Home, Dashboard, Chat, Connectors, Agents/FDE) are pinned above the collapsible
  section list at all times (`AppSidebar.tsx`:589-597).

## 11. Screen-to-function mapping

Screen-to-function mapping is real but implicit, not a maintained lookup table: each route
directory under `src/app/(app)/<module>/` maps 1:1 to the module's own API routes under
`src/app/api/<module>/` and service functions under `src/lib/services/<module>-service.ts` (the
convention followed by, e.g., `permission-service.ts`'s `ERP_ACTION_ROLES`, `chat-service.ts`
for `/chat`, `capability-registry-service.ts` for `/capability-registry`). A machine-readable,
maintained screen↔function↔API index does not currently exist as a standalone artifact — the
closest real approximation is `ai-os/CONSTITUTION.yaml`'s per-rule `mechanism:` fields, which
cite real files but are organized by governance rule, not by screen. Building a maintained
screen-to-function index is real, named, future-OCID scope; this document does not construct
one, consistent with the "no new architecture" constraint.

## 12. Module-to-screen mapping

Real, current module list (`src/app/(app)/*`, 99 directories, verified by shell glob, not by a
possibly-truncated `find`):

```
access-review, ai-observability, approvals, audit, audit-engagements, automation, bcm, board,
board-evaluation, cap-table, capability-improvements, capability-registry, change-orders,
charges, chat, checklists, clients, committees, compliance, connectors,
construction-dashboard, contract-compliance, crm, dashboard, departments, directors, doa,
documents, erp, esg, expenses, fde, ffe, floor-plans, fm-register-digitization, frameworks,
fraud-cases, gst-reconciliation, help, home, hr, hr-compliance, incidents, ingest,
ip-portfolio, irdai, it-dr, knowledge-base, kpi-hub, labour, leave-holiday, legal-matters,
legal-opinions, legal-vendors, litigation, mca-filings, mdm-quality, metric-alerts,
mood-boards, notices, orchestra, penalties, performance-reviews, pms, policies, posh,
problem-records, prompt-eval, punch-list, rbi, recruitment, reports, rewards, rfis, risks,
rpt, sales-hq, scope, sebi, secretarial-audit, settings, site-diary, statutory-registers,
submittals, task-duplicates, tasks, tds-returns, team, the-firm-practice, tickets, training,
users, vendor-risk, veri-ai, veri-meetings, veri-todo, voice-tickets, whistleblower,
work-progress
```

Each module directory is one screen-group; `AppSidebar.tsx`'s `getNavSections()` groups these
99 module screens into ~24 human-facing sections (Overview, Reports & Analysis, Sales/CRM,
Projects, Construction, Finance/ERP, Compliance, Governance, Company Secretarial, Legal, People
& HR, Risk, Sector Regulators, Audit, Third-Party/ESG, Integrity, Incidents, Access & Approvals,
Admin, Tools) — the sidebar section is the real, existing module-to-screen grouping mechanism;
this document does not propose a different one.

## 13. Function-to-screen mapping

Cross-cutting functions (not owned by one module) map to fixed, pinned screens rather than
appearing per-module: chat/composer (`chat`, always-mounted per §9), approvals (`approvals`),
capability registry lookups (`capability-registry`), reports (`reports`, `rpt`), FDE/"option not
available" capture (`fde`). This mapping is a direct consequence of `AppSidebar.tsx`'s pinned-
links design (§10) and the Chain Selector's capability-tree structure (§14) — both already real
— rather than a separately maintained table.

## 14. Mode pills execution

Confirmed real: `VeriComposer.tsx`:534-555 renders a pill-style row (`rounded-full`,
`bg-ct-cloud`) built from `FIXED_MODES` (discuss/chats/todo) plus every non-fixed root node of
the live capability tree, each pill a `<button>` calling `setComposerMode`. The tree itself is
computed live per-org by `capability-tree-service.ts::buildCapabilityTree()`, served via
`GET /api/capability-tree` and fetched by `veri-chat-context.tsx`'s `fetchCapabilityTree()`
(lines 38-43) — not a hardcoded taxonomy. This matches `DMP-01` (**ENFORCED**,
`CONSTITUTION.yaml`:303-306). Selecting a pill changes `composerMode`, which reflows the
cascading option chain below it (§15). `DMP-05` — per-screen adaptive pills that automatically
reflow as the user navigates modules, plus a personalized library of frequently-used chains — is
**`NOT_YET_BUILT`** (`CONSTITUTION.yaml`:341-343, confirmed zero "library" concept anywhere in
the codebase); today's pills are composer-scoped, not screen-scoped.

## 15. Option chain execution

The "option chain" is the Chain Selector: `ChainSelector.tsx` (399 lines) exports `ChainRows`
(renders the active picker row of option buttons from `CapabilityNode[]` tree data),
`pathSegmentDisplay`/`pathDisplayString` (breadcrumb formatting), `nodeChildrenAt`/
`expandPathsForSend` (tree-walk helpers), `findCalculatorSuggestions` (matches the search box
against deterministic VCEL-calculator leaves), and `ChainSelectorDialog` (a pre-conversation
modal reusing the same picker when starting a new AI thread). It is shared between
`VeriComposer.tsx` and the new-thread dialog specifically so the picker logic exists once, not
twice. `DMP-02`/`DMP-03` describe what happens once a chain is picked: the resolved leaf is
re-verified server-side (`task-service.ts::createTask()`) and, for tasks/conversations created
this way, the chosen `dynamicChainId` is persisted on the row it classifies — but that
persistence today carries only dispatch routing (`workerAgentId`/`engineKey`/`fixedInputs`), not
yet permissions/approvals/notifications/audit (`DMP-03`, **PARTIALLY_ENFORCED**,
`CONSTITUTION.yaml`:317-321).

## 16. Chat execution

Two real, distinct chat execution paths exist, and they are not symmetric:

- **Conversation-level chat** (`HomeThreadSlot.tsx`, `VeriChatPanel.tsx`'s Chats tab) — a real,
  live LLM round trip: `POST /api/conversations/[id]/messages` → `chat-service.ts::sendMessage()`
  → `generateAiReply()` (`chat-service.ts`:613, referenced 797-958) → `resolveModelConfig()`
  (`orchestra-model-resolver.ts`) → `llm-client.ts::callLLM()`, a real `fetch` to
  `api.anthropic.com`/`openrouter.ai`. Before the model is ever called, deterministic gates run
  in order: policy enforcement, a deterministic-route check (`tryDeterministicRoute()`,
  `llm-routing-gate.ts`), a dialogue-script check, floor-tier escalation, then
  `passesReplyGate()` (`src/lib/ai-reply-gate.ts`) — the actual enforcement point for §22's
  software-first rule — and audit logging.
- **Task-level chat** (`src/app/api/tasks/[id]/chat/route.ts`, 47 lines) — inserts the user's
  message into `taskChatMessages` and returns. **No LLM call anywhere in that file.** An end
  user typing into a task's chat thread gets no AI reply today; the identical action in a
  conversation thread does. Already tracked
  (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 6 / Stream G; OCID-022 §3.1) — not fixed
  here, cited for completeness of the browser-runtime picture.

`HomeThreadSlot.tsx` polls `GET /api/conversations/:id/messages` every 6s via
`useResilientPoll` — the real, current mechanism for a thread to reflect new messages; there is
no WebSocket/SSE push channel for chat today.

## 17. Attachment execution

Real, but **fragmented across three composer-like surfaces, not unified in `VeriComposer.tsx`
itself**: `home/page.tsx`, `veri-ai/page.tsx`, and `GlobalChatDock.tsx` each implement their own
working `fileInputRef`/hidden `<input type="file">`/`handleFile`/`attachFile` flow, `POST`ing to
`/api/veri-chat/messages/:id/attachments`. Inside `src/components/veri-chat/`, `VeriComposer.tsx`'s
own Paperclip button (lines 681-683) is **decorative only** — no `onClick`, no file input wired
to it. This is a real, confirmed current gap (wiring, not redesign — the working attach flow
already exists three times over, just not on the persistent composer) named here because no
prior artifact had stated it from the browser-runtime angle specifically.

## 18. Voice entry handling

Real microphone recording exists at exactly one screen, `src/app/(app)/voice-tickets/page.tsx`
— `navigator.mediaDevices.getUserMedia({ audio: true })` and `MediaRecorder`, with an `Upload`
fallback if mic access is denied. **There is no voice/mic input inside `src/components/veri-chat/`
at all** (confirmed by targeted grep — no `Mic` import, no `MediaRecorder`, no Web Speech API
usage in that directory); `AppSidebar.tsx`'s `Mic` import is only a nav icon for the Voice
Tickets link. Voice entry today is a standalone screen's function, not a composer input
modality — real, current state, not redesigned here.

## 19. All inputs converting to a single deterministic task

The codebase does not use the literal phrase "single deterministic task" (confirmed, zero hits),
but it implements the adjacent, real concept: **both of `VeriComposer.tsx`'s two send
surfaces — free-text `discuss` chat and chain/mode-pill dispatch — funnel through the same
`runBrowserFirstPass()` → `dispatchInstruction()` pair** (`VeriComposer.tsx`:233-260), described
in the composer's own code comment as "the real browser-to-server handoff for BOTH Owner-directed
input surfaces." `dispatchInstruction()` is the one convergence point: whatever the input
modality (typed text, picked chain, voice-transcribed text arriving as normal typed text per
`whisper-client.ts`'s pass-through design, `DMP-02A` exception, `CONSTITUTION.yaml`:314-317),
it resolves to one `POST /api/tasks` call, re-verified and re-classified server-side
(`task-service.ts::createTask()`), never trusting client-supplied classification
(`execute/route.ts`:9-21 states this explicitly for the parallel compile-telemetry path too).
This is the real single funnel that exists; it is not literally branded "single deterministic
task" anywhere in governance docs, and this document does not rename or reframe it as such.

## 20. Predictive behavior

"Predictive" in the codebase today refers to a different, unrelated concept — ML-based
model-routing prediction (`routing-accuracy-report-service.ts`'s
`recommendPredictiveModelSelectionReview`) — not predictive browser UX. The closest real,
governance-level use of "predictive" in the browser-UX sense is `ai-os/CONSTITUTION.yaml` §5's
own wording: **"Predictive/repetitive work is done by deterministic software first"** (§5,
line 282) — i.e., "predictive" here means *predictable/repeatable*, not *anticipatory
autocomplete*. `ai-os/audit-tree/08-task-response-engine.yaml`'s Topic 4 (Response Engine)
describes the one real anticipatory mechanism that exists as design intent: software should be
able to *suggest* a response from a predefined short set (Yes/No/OK/Pending/Completed/Need
Clarity/Require Input/Wrong Data/Incomplete Instructions), with AI's role limited to
evaluating/confirming that suggestion — but this Response Engine is a documented source-doc
requirement, not confirmed built browser behavior (no `Response Engine` code artifact was found
in `src/`). Stated honestly as design intent, not shipped state.

## 21. Software first, AI second

This is real, enforced policy with a real mechanism, not aspirational copy:

- `ai-os/CONSTITUTION.yaml` §5 (`software_first`, **SF-01, ENFORCED**): "Dispatch order:
  deterministic software path first (`executeEngineDispatch`/`executeStructuredDispatch`), AI
  free-text planning fallback only if no deterministic path exists" — mechanism
  `src/lib/task-execution-engine.ts`.
- `src/app/page.tsx`:75-76 (public marketing copy, cited because it is the one place this
  principle is stated directly to an end user): *"Software-first, AI second... Every request
  tries a deterministic software path before it ever reaches a model."*
- `src/lib/prompt-compiler/verification-pipeline.ts`:14-15 states its own design note: it "makes
  zero LLM calls, per this phase's own 'software first' design note."
- `src/lib/services/chat-service.ts`'s `passesReplyGate()` (`src/lib/ai-reply-gate.ts`) is the
  real, live enforcement point in the conversational chat path (§16) — the software-first gate
  a message must pass before an AI reply is even generated.
- `ai-os/SOFTWARE_TEAM.md`/`ai-os/AI_ORCHESTRA_HIERARCHY.md`'s L0 tier ("No AI... existing,
  unchanged... tooling") is the same principle applied to the AI Dev Team dispatch ladder, a
  distinct but related mechanism (build/CI/test, not end-user browser interaction).

## 22. When the browser executes without AI

Confirmed real, no-AI execution paths in the browser runtime today:

- Client-side compile pass (`client-compile.ts`'s `analyzeLightweight()`, §4) — zero LLM call.
- Chain Selector resolution and task creation (§8, §15) — deterministic tree lookup and a
  direct DB write, no model call, unless the resolved leaf itself is an AI-backed worker agent.
- `verification-pipeline.ts`'s four checks (business rules, workflow budget, capability match,
  permission) and `computeConfidence()`/`selectModelTier()` — all pure computation, explicitly
  zero LLM calls.
- Predefined VCEL calculators — per `ai-os/audit-tree/08-task-response-engine.yaml`'s Topic 2,
  "predefined calculators exist in software for all calculations, no AI needed" — though today
  these run server-side, not yet client-side (`BROWSER-04`, **NOT_YET_BUILT**,
  `CONSTITUTION.yaml`:740-743).
- Task-level chat (§16) — not by design choice but by real current absence of an LLM call in
  that route.

## 23. When the browser escalates to AI

Escalation to AI is real and gated, not automatic:

- Conversation-level `sendMessage()` (§16) always calls the LLM, but only after the
  deterministic gates above run and `passesReplyGate()` passes.
- When the Chain Selector has no matching option, `DMP-04` (**ENFORCED**) routes the
  requirement to `fde-service.ts::submitFdeRequest()`, which involves AI analysis of the
  requirement to propose a new capability for human approval — escalation is explicit and
  human-gated, not silent.
- `verification-pipeline.ts`'s `checkCapability` treats "no matched template and no semantic-cache
  hit ≥ 0.5" as the real trigger condition for needing a fuller AI path rather than a cached/
  templated one.
- WebGPU-gated in-browser generation (`webllm-engine.ts`, §4) is itself an AI escalation, just
  one that stays entirely client-side rather than calling a server-hosted model — real, gated on
  `navigator.gpu` presence, not yet wired to the composer's live send path.

## 24. Report rendering

Reports (`src/app/(app)/reports/`, `src/app/(app)/rpt/`) render server-fetched data through the
same App Router page pattern as every other screen (§10) — no separate report-rendering runtime
exists. `src/lib/services/report-schedule-service.ts` (cited in `CONSTITUTION.yaml`'s monitor
gap note, §21 of that file) generates scheduled reports server-side; the browser's role is
display, not computation, for these. No client-side report-rendering engine (e.g., a local
PDF/chart compiler) was found — reports are rendered as normal React pages against
server-computed data.

## 25. Analysis rendering

Analysis screens follow the identical pattern to reports (§24) — server-computed, browser-
rendered. `capability-registry-service.ts`'s semantic-search wrapper over `embeddings.ts` is the
one real analysis-adjacent function confirmed to run partly client-triggered (the search query
originates in the browser) but computed server-side (the embedding call itself). There is no
separate "analysis rendering engine" distinct from the normal page-render pipeline.

## 26. Notification rendering

Real, confirmed mechanism: `sonner`'s `<Toaster position="top-right" richColors />`, mounted
globally in `src/app/layout.tsx`:3,74, used throughout (`VeriComposer.tsx`, `AppTopbar.tsx`,
`GlobalChatDock.tsx`) via `toast()` calls for immediate, transient feedback. Persistent
notifications are handled separately by `AppTopbar.tsx`'s notification bell (`Bell` icon,
lines 24-32): fetches `GET /api/notifications`, marks read via `PATCH /api/notifications/:id/read`,
renders a dropdown. There is no standalone `notification-service.ts` — the bell reads/writes
directly against the `/api/notifications` route. `CONSTITUTION.yaml`'s own monitor-gap note
(§4, line 718) discloses that `NOTIFICATION_DELIVERED` has "12+ real insert call sites, no
shared creation helper, no delivered/read timestamp column" — a real, already-disclosed gap in
notification data quality, not something this document re-discovers or fixes.

## 27. Permission enforcement

Real, layered, and already enforced at the API boundary (not yet at the nav-rendering boundary,
per §10):

- `src/lib/supabase/auth-guard.ts`'s `requireAuth()` (line 264) and `requireAuthOrApiKey()`
  (line 392) are the session-establishing primitives every API route calls (per `CLAUDE.md`'s
  own stated rule).
- The same file owns a 10-value `UserRole` enum, `ROLE_RANK`, `hasRole()`/`requireRole()`.
- `src/lib/services/permission-service.ts` (`ERP_ACTION_ROLES`) is a single lookup table
  (action-string → minimum `UserRole`) resolved through those same primitives, added
  specifically because per-action role checks had been ad hoc across ~21 ERP/Finance routes.
- `src/lib/services/abac-policy-service.ts` (`src/lib/abac.ts`) is a supplementary, deny-only
  ABAC overlay — org admins can further restrict, never grant, what an already-RBAC-permitted
  actor may do; fails open on missing attribute data by design.
- `verification-pipeline.ts`'s `checkPermission` (§21) gates `DELETE`/`DEPLOY`-class intents to
  `veridian_admin` before an AI-routed action is even attempted.

Permission enforcement is real and live at the API layer; §10 already names the one confirmed
gap (sidebar rendering is gated by org-type, not by these same role primitives).

## 28. Role based view

**Real, and confirmed to stop at the API boundary today.** The role/permission system in §27 is
real, enforced, and used across dozens of service files. What does **not** yet exist is a
role-based *view* — `AppSidebar.tsx` has zero references to `role`; which sidebar sections
render is gated by `accountType`/`pmsEnabled`/`firmEnabled` (org-level), not by the signed-in
user's own role. So today, two users in the same org with different roles see the identical
nav — they are simply permitted or denied different actions once they reach a screen. This
matches OCID-022 §2.1/§3.6's finding exactly (not re-derived independently here); this document
does not propose the fix, only confirms and carries it forward as the real current state of the
browser-runtime layer specifically.

## 29. Zero cognitive load

The literal phrase "zero cognitive load" does not appear anywhere in this repo's governance
trail (confirmed by grep across `ai-os/audit-tree/`, `ai-os/CONSTITUTION.yaml`, and this
document's other cited sources) — it is not restated here as an existing target. The closest
real, already-recorded design intent is `ai-os/audit-tree/09-onboarding-ux.yaml`'s transcription
of the Owner's own source document: a Mode Pills + Chain Option flow that requires "no typing,"
where the system should infer profile/work context and be "super simple," plus persistent,
minimalist controls (a single "+" invite icon) rather than multi-step configuration screens. The
real, shipped mechanisms that serve this intent today are the Chain Selector (§15, live) and the
always-visible "Invite a team member" control (`AppTopbar.tsx`:194-206, live, per OCID-022 §2.1).
A formal "zero cognitive load" success criterion or measurement does not exist as a built
artifact; naming one is out of this document's scope (no new architecture/metric is proposed
here).

## 30. A thirty second learning experience

No literal "thirty second" (or "30 second") learning-time target exists anywhere in this repo's
governance trail (confirmed by grep across `ai-os/`) — none is invented here. The closest real,
adjacent design intent is the same onboarding-ux transcription cited in §29: removal of
multi-step onboarding friction (dropping "Set up AI configuration" and "Upload the document" as
onboarding steps, per `ai-os/audit-tree/09-onboarding-ux.yaml` lines 25-27) and auto-connected
integrations (e.g., Gmail) during setup, both aimed at the same underlying goal — fast, low-
friction first use — without a stated numeric target. A formal time-to-first-productive-action
metric is real, named, future-OCID scope (it would require instrumentation that does not
currently exist); this document does not fabricate one.

## 31. Response time target

No formal, numeric page-response-time SLA exists in this repo's governance trail for the
browser runtime. The one real, adjacent numeric target that does exist is
`src/lib/prompt-compiler/pipeline.ts`'s `STAGE_BUDGETS_MS` (lines 35-40): `lightweight_analysis`
15ms, `context_assembly` 25ms, `prompt_construction` 30ms, `verification` 30ms — a real latency
budget, but scoped to the prompt-compiler pipeline's own four internal stages, not to browser
page-load or end-to-end response time. `ai-os/audit-tree/01-consutitution.yaml`:566 (a source-
document transcription of the ZLM 5.2 engineering responsibilities) records "Response Time" as
one of several dimensions the platform should "continuously improve" — a qualitative principle,
not a number. A quantified page-response-time target (e.g., a p95 time-to-interactive budget)
does not currently exist as a built or documented artifact; this document names that as real
current absence rather than inventing a figure.

## 32. Offline operation

Real, narrow, and explicitly disclosed as incomplete: `browser-intent-cache.ts` is documented in
its own header as "the offline-first counterpart" to server-backed chain recall, and guards for
`typeof indexedDB === "undefined"` (SSR/unsupported browser). This is the only code in the
repository whose own header claims offline behavior. `ai-os/CONSTITUTION.yaml` has **zero**
`offline`-tagged rules — there is no broader offline-mode policy, no service worker (confirmed
by grep, zero hits), and no offline task-creation/sync-queue mechanism. Designing a full offline
mode is explicitly out of this document's scope (prohibited: "do not design a ... synchronization
protocol"); this section records only what already, narrowly, exists.

## 33. Background synchronization trigger

No background-synchronization mechanism exists in the browser runtime today. There is no
service worker, no `sync` event registration, and `ai-os/CONSTITUTION.yaml` has zero `sync`-
tagged rules beyond incidental, unrelated hits. The one real "keeps itself fresh" behavior found
is `HomeThreadSlot.tsx`'s foreground polling (`GET /api/conversations/:id/messages` every 6s via
`useResilientPoll`, §16) — a foreground poll, not a background sync trigger, and it stops the
moment the tab loses focus or closes. Designing a background-sync protocol is explicitly out of
scope for this document (prohibited); this section records the real current absence, consistent
with `BROWSER-07`'s own `NOT_YET_BUILT` status (§5).

## 34. Error recovery

Real, per-surface, not a unified error-recovery framework. Confirmed real mechanisms:
`webllm-engine.ts`'s honest fallback when WebGPU is absent (§4, reports `{kind:"fallback"}`
rather than attempting a load that would fail); `voice-tickets/page.tsx`'s `Upload` fallback
when microphone access is denied (§18); `verification-pipeline.ts`'s explicit checks that
surface `checkBusinessRules`/`checkCapability` failures as classified reasons rather than a
generic error. There is no single, cross-cutting client-side error-recovery/retry framework
confirmed — each surface implements its own fallback. This document records that as the real
current state, not a gap to be designed here.

## 35. End user experience validation

The most recent real, authenticated end-to-end validation of the live browser runtime is
`ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md` (OCID-020) — a 118-link nav
inventory, ~15 pages/areas clicked, against the real, live `projexa-ai.com` deployment, with
concrete, disclosed results (one high-severity crash, since fixed via PR #747; the silent-403
gap named in §10; a chip-gated-composer observation). That certification pass is **not yet
confirmed independently complete** per this repo's own `PROGRESS.md`/`ACTIVE-CLAIMS.yaml`
history (carried forward honestly from the disclosure at the top of this document, not
re-verified fresh here). This document does not repeat or supersede that certification; it
cites it as the real, existing validation record for the browser runtime, and defers any new
validation pass to whichever future OCID actually needs one.

## 36. Browser runtime summary

The VERIDIAN laptop web browser is, today, the sole delivery and primary execution surface for
the entire product — 99 real module screens, one persistent composer/workspace shell, a live
per-org capability tree driving Mode Pills and the option Chain Selector, and a real, enforced
software-first dispatch order before any AI call. Three real in-browser execution substrates
(deterministic compile, in-browser embeddings, WebGPU-gated small-LLM generation) already exist
but are not yet wired into the live composer send path. Permission enforcement is real and
API-layer-complete; role-based *view* gating, a general browser cache/offline/background-sync
layer, a unified attachment/voice input surface on the persistent composer, and formal
response-time/learning-time targets are the confirmed, named gaps — each maps to an existing
real file or table a future OCID can extend, none require new architecture, and none are
designed or implemented by this document.

---

## 37. Known gaps catalogued (index, not new findings — each cited above)

| # | Gap | Status | Cited in |
|---|---|---|---|
| 1 | Sidebar module visibility gated by org type, not end-user role | Real, confirmed | §10, §28 |
| 2 | Silent 403 for modules a fresh org hasn't enabled | Already tracked | §10 |
| 3 | Attachment upload not wired into `VeriComposer.tsx` itself (Paperclip decorative) | Real, confirmed, newly named from this angle | §17 |
| 4 | Voice entry not available on the persistent composer, only at `/voice-tickets` | Real, confirmed | §18 |
| 5 | DMP-05 per-screen adaptive pills / personalized chain library | `NOT_YET_BUILT` | §14 |
| 6 | `BROWSER-04` most-used calculator running client-side | `NOT_YET_BUILT` | §22 |
| 7 | `BROWSER-05` capability tree not client-cached (refetched every page load) | `PARTIALLY_ENFORCED` | §6 |
| 8 | `BROWSER-06`/`BROWSER-07` general browser cache for resolved work, cross-tab | `NOT_YET_BUILT` | §5, §6 |
| 9 | No offline mode beyond `browser-intent-cache.ts`'s narrow scope | Real, confirmed | §32 |
| 10 | No background synchronization mechanism | Real, confirmed | §33 |
| 11 | No cross-cutting client-side error-recovery framework | Real, confirmed | §34 |
| 12 | Task-level VERI Chat has no AI reply | Already tracked | §16 |
| 13 | No formal response-time / learning-time numeric target | Real, confirmed | §30, §31 |
| 14 | Three in-browser execution engines (WebLLM/transformers/tool-calling) not wired to the composer's live send path | Real, confirmed | §4, §22, §23 |

None of these are fixed, designed, or scoped for implementation by this document. Each is
either already tracked elsewhere in this repo's governance trail, or newly named here only
because no prior artifact had stated it from the browser-runtime angle specifically.

---

## 38. Handoff to OCID-025

This document is the first canonical laptop-web-browser-runtime artifact for the VERIDIAN
platform. It implements nothing and blocks nothing that was not already blocked. A future
OCID-025 (or any later-numbered directive) that wants to close any gap catalogued in §37 — wire
attachment/voice into the persistent composer, connect the three in-browser execution engines to
the live send path, build role-based nav gating, build the general browser cache/offline/
background-sync layer, or set formal response-time/learning-time targets — can cite this
document as its baseline "what does the browser runtime actually do today, and where exactly is
the gap" reference, instead of re-running this discovery from zero. Per this repository's own
standing gatekeeper rule (`UMR-20260802-165034-5747`), any such future directive must re-verify
live state before dispatching real implementation work — this document is a point-in-time
synthesis (2026-08-03) and will go stale as real work lands, exactly like
`ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` and
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` before it.

**Not acted on.** No implementation, database change, UI change, or UX change has been made
under this UMR. Awaiting Owner review, consistent with the OCID-020 implementation lock this
directive was scoped to respect.

Canonical artifact: this file,
`ai-os/VERIDIAN_LAPTOP_WEB_BROWSER_RUNTIME_2026-08-03.md` — new, not a duplicate of any existing
file (confirmed via discovery in §0/this session's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry; no
prior file with this name or scope exists anywhere in `ai-os/`).

Real updated UMR: `UMR-20260803-041000-70ae` (this task's own live entry in
`/opt/veridian/ai-os/memory/superboss-register.sqlite`'s `umr_tasks` table, unit
`veridian-worker@task-20260803-041006-ocid-024-veridian-laptop-web-browser-run.service`, child
of `UMR-20260803-040929-9713` OCID-023). No new UMR chain was created — this extends the
existing one.
