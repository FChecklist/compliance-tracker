# VERIDIAN Mobile PWA and VERI Chat Runtime — v1.0

**OCID-20260803-025.** Documentation only — no implementation, no new PWA, no new chat
system, no new AI assistant. This defines the complete end-user mobile experience strictly
in terms of what already exists in the live codebase today, per the mandatory discovery
pass below. Where a mandated topic has no real mechanism yet, this document says so plainly
(`NOT_YET_BUILT`) rather than inventing one — the same discipline `ai-os/CONSTITUTION.yaml`
already applies throughout.

**UMR:** parented to `UMR-20260803-041000-70ae` (cited by this task's own prompt as "OCID-024,
just registered"), citing `UMR-20260803-040929-9713` (OCID-023), `UMR-20260803-040844-4a33`
(OCID-022), `UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program),
`UMR-20260802-165606-4413` (OCID-020), `UMR-20260802-164659-9a31` (traceability audit),
`UMR-20260802-165034-5747` (gatekeeper rule), `UMR-20260802-165434-cd91` (unified project
memory), `UMR-20260802-165541-c27d` (recovery framework). Consistent with the OCID-021
implementation lock (real citation: `UMR-20260802-165606-4413`, OCID-020's own gating
condition — no real implementation until OCID-020 is independently verified complete;
documentation-only work is explicitly permitted under that lock).

**Disclosed concurrency note:** at the time this document was written, sibling sessions for
OCID-022, OCID-023, and OCID-024 were genuinely concurrent and still `in_progress` — OCID-024's
own document did not yet exist despite being cited as "just registered." This document does
not have a hard read-dependency on any sibling OCID's text: every claim below is grounded
directly in real production code (grep hits, file paths, line counts), independently
re-verifiable regardless of what the sibling documents conclude. See `ai-os/boss/ACTIVE-CLAIMS.yaml`
for the full disclosure.

**Method note:** findings below come from a direct discovery pass across `compliance-tracker`
(this repo — the real VERIDIAN AI product) and the sibling `projexa` repo (a distinct
construction-vertical product built on the same VERIDIAN AI OS foundation), covering
`src/app/manifest.ts`, `src/components/veri-chat/*`, `src/lib/services/chat-service.ts`,
`src/lib/ai-team/roster.ts`, `src/lib/ai-router/mother-router.ts`, `src/lib/llm-routing-gate.ts`,
`src/lib/ai-reply-gate.ts`, `src/lib/browser-execution/*` (12 files), `src/lib/browser-intent-cache.ts`,
`src/lib/db/schema.ts`, `src/lib/supabase/auth-guard.ts`, `src/lib/db/tenant-scoped.ts`, and every
`ai-os/*.md`/`*.yaml` file already touching PWA/mobile/offline/push topics (`ai-os/CONSTITUTION.yaml`
§§6,17,19; `VERI_CHAT_GOVERNANCE.md`; `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` items 5-7;
`ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md`). No new PWA, chat engine, or
AI assistant is proposed anywhere below — every section either cites a real mechanism or names
a real, disclosed gap.

---

## 1. Role of the mobile PWA

VERIDIAN AI already ships as an installable Progressive Web App: `src/app/manifest.ts`
(Next.js 16 native manifest route) returns `name: "VERIDIAN AI"`, `start_url: "/home"`,
`display: "standalone"`, theme/background colors matching the design tokens in `CLAUDE.md`.
This is the same mechanism that lets a browser install VERIDIAN to a device home screen and
open it full-screen, with no separate native app.

**Governing principle (Owner directive, this task's own spec, restated as a rule, not
invented here):** the laptop web browser remains the primary VERIDIAN workspace. The mobile
PWA is the mobile *extension* of that same experience — same backend, same auth, same data,
same `tasks`/`conversations`/`messages` tables — never a second ERP and never a duplicate of
the desktop application. There is exactly one VERIDIAN AI product; the PWA is one more surface
onto it, the same way `AppSidebar.tsx`/`AppTopbar.tsx` are the desktop surface onto it.

`ai-os/CONSTITUTION.yaml` §19 (`end_user_experience`, UX-01) already documents that a
purpose-built 5-region layout (chat box + dynamic main screen + VERI Chat rail) is
`NOT_YET_BUILT` — current reality on both desktop and mobile is `AppSidebar` + `AppTopbar` +
one `VeriComposer`. This document does not propose changing that; it documents the mobile
runtime as it stands on top of the same layout.

## 2. Role of VERI Chat

VERI Chat is the real, already-shipped multi-party messaging platform: `conversations` /
`conversationParticipants` / `messages` tables (`src/lib/db/schema.ts:3751,3813,3821`),
served through `src/app/api/conversations/[id]/messages/route.ts` → `chat-service.ts`
(1269 lines) → `orchestra-model-resolver.ts` → `llm-client.ts` (real calls to
`openrouter.ai`/`api.anthropic.com`). `VeriComposer.tsx` (764 lines) is the one composer
component used across the app — desktop and mobile render the same composer, not two
different ones.

Per `ai-os/CONSTITUTION.yaml` §7 (`veri_identity`): **VERI Chat is not VERI, and VERI is not
VERI Chat.** VERI Chat is the multi-party human/guest messaging surface; VERI (the assistant)
is a participant that can be invited into it. This distinction holds identically on mobile.

VERI Chat's real capability surface already includes (confirmed live, `src/app/api/veri-chat/`):
share-target intake, share-links, guest access, per-conversation context, approvals, voice
tickets, meeting action items, and message attachments — all reachable identically from the
mobile PWA since they are ordinary authenticated API routes, not desktop-only code.

## 3. Role of VERI (your assistant)

VERI is the customer-facing assistant identity (`ai-os/CONSTITUTION.yaml` §7,
`customer_facing_name: "VERI — Your Assistant"`), with its own dedicated 1:1 thread at
`/veri-ai`, and the option to join VERI Chat conversations as an invited participant
(never unprompted — VERI-02, `PARTIALLY_ENFORCED`, no proactive/unsolicited replies shipped).

VERI always participates in VERI Chat in the sense that it is always an available, invitable
member of any conversation — the assistant is architecturally present in the same runtime a
mobile user is chatting in, not a separate mobile-only bot. VERI never auto-creates,
auto-assigns, or auto-sends without approval (HAB-03/VERI-03, `ENFORCED` via
`high-impact-action-detector.ts` + `src/lib/ai-reply-gate.ts`), and never claims to have
completed an action it did not take (`ai-reply-gate.ts`'s `detectFalseActionClaim()`) — both
identically true whether the request originated on mobile or desktop, since it is the same
server-side gate regardless of client.

## 4. Mobile user experience

There is one VERIDIAN AI application. The mobile PWA is that same Next.js 16 App Router
application, installed via `src/app/manifest.ts`, rendering the same `AppSidebar.tsx` (with
a real mobile drawer path — `src/components/ui/sidebar.tsx`'s `useIsMobile()` hook,
`SIDEBAR_WIDTH_MOBILE`, `openMobile` state; `AppSidebar.tsx:667-675`'s `MobileSheetTrigger`)
and the same `VeriComposer.tsx`. `GlobalChatDock.tsx` already documents (its own header
comment) that it was adapted from both mobile and laptop mockups and positions differently
per breakpoint.

**Honest, disclosed limitation** (not glossed over): `ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md`
explicitly states four mobile-UX gaps remain open in this codebase — CSV row #106 (desktop-only
responsive scaling in places), #1792 (offline/poor-connectivity resilience), #1793
(touch-target sizing, no ≥44px `field`-size variant), #1794 (mobile load-time performance /
no Lighthouse CI). That same document states plainly: **"This is NOT a claim that
compliance-tracker is mobile-usable."** This document does not retract or override that
finding — it is the honest current state this runtime document is built on top of.

## 5. Chat-first experience

VERI Chat (composer + mode pills + Chain Selector) is already the primary instruction surface
on every screen — `ai-os/CONSTITUTION.yaml` §6 (`navigation_and_intent`): "Dynamic Mode Pills
+ Dynamic Option Selection/Chain Selector + chat is the flexible, non-rigid instruction
interface." On mobile, this is the same composer surfaced through the mobile drawer/dock —
there is no separate mobile-only chat entry point to build; the existing one already renders
responsively.

## 6. Text input

Real and live: `VeriComposer.tsx`'s free-text field, submitted through the same
`conversations/[id]/messages` route as desktop. No mobile-specific text-input code exists or
is needed — this is a standard web `<textarea>`/input, not a native capability requiring a
mobile-specific implementation.

## 7. Voice input

Real and live: `src/lib/whisper-client.ts` (OpenAI Whisper transcription of user-uploaded
audio — a pure speech-to-text pass-through, explicitly one of the two approved exceptions to
the Chain Selector requirement per `ai-os/CONSTITUTION.yaml` DMP-02A, since it returns the
user's own words, not an AI opinion). Downstream: `src/app/api/veri-chat/voice-tickets/route.ts`
lists voice memos and voice-originated action items assigned to the user. Whatever the
transcript is used for goes through the same normal gates as if the user had typed it.
On mobile, the browser's standard `MediaRecorder`/microphone permission flow applies —
no separate mobile voice pipeline exists or is proposed.

## 8. Attachment input

Real and live: `src/app/api/veri-chat/messages/[id]/attachments/route.ts` (`attachDocumentToMessage()`),
letting any existing document be attached to a message. This is document-attachment, not raw
file upload from a device camera roll — see §10 (Document input) for the distinction already
present in the codebase.

## 9. Image input

Photo capture and local queueing already exists in the sibling `projexa` repo's offline
work-progress flow (`src/lib/offline/work-progress-queue.ts`, `QueuedPhoto` type — a real
`Blob` stored in IndexedDB, natively structured-cloneable, no base64 encoding needed).
That module's own header discloses the real, current gap honestly: queued photos are **not**
uploaded on sync today because `compliance-tracker`'s `constructionWorkProgressEntries` table
has no photo/attachment column or reachable upload endpoint from PROJEXA — the UI shows the
photo as "saved on this device" while the rest of the entry (quantity/notes) syncs for real.
This is the one place in the current codebase where image capture from a mobile device camera
is a real, working, disclosed-partial mechanism — not a hypothetical one.

## 10. Document input

Real and live in `compliance-tracker`: documents are first-class entities (the "document" the
attachments route above attaches is a real `documents`-table row, not a raw upload). Document
upload itself happens through existing document-management routes, unchanged for mobile — the
PWA reuses the same upload flow as desktop, no separate mobile document pipeline exists or is
needed.

## 11. All inputs converging to one deterministic prompt

Every input channel above (text, voice-transcribed text, attachment reference, image, document
reference, share-target import) ultimately becomes one message row in the same `messages` /
`taskChatMessages` schema, submitted through the same composer and the same
`conversations/[id]/messages` route. There is one convergence point, not five parallel input
pipelines — this is real today, not a proposed unification.

`src/app/api/veri-chat/share-target/route.ts` is the clearest concrete example: it is the
receiving half of the PWA's own `share_target` manifest entry (`src/app/manifest.ts`), letting
a mobile OS Share Sheet (WhatsApp's "Export Chat" → Share, Telegram's Share, or any app)
deliver external text directly into VERIDIAN, where `importSharedContent()` folds it into the
same conversation/message model every other input channel uses.

## 12. Mode pills on mobile

Real and live: `VeriComposer.tsx`'s mode-pill buttons (`{/* Mode pills */}` block, calling
`setComposerMode(m)`/`setComposerMode(n.key)`) are the same rendered-live, per-org tree
computed by `capability-tree-service.ts::buildCapabilityTree()` (`ai-os/CONSTITUTION.yaml`
DMP-01, `ENFORCED`) on every surface, including mobile — there is no separate mobile pill set.
**Disclosed gap, unchanged for mobile:** DMP-02 (`PARTIALLY_ENFORCED`) — Dynamic Chain
classification is only enforced for conversations/tasks actually created through the Chain
Selector, not for chat generally.

## 13. Option chain on mobile

Real and live: `ChainSelector.tsx`, driven by `capability-tree-service.ts` and the
`dynamic_chains` table (`schema.ts:1804`), invoked from the same `VeriComposer.tsx` used on
mobile. `tasks.dynamicChainId` and `conversations.dynamicChainId` persist the resolved chain
identity (the latter nullable/additive, not yet wired by any writer, per its own schema
comment — an honest, pre-existing gap, not something this document introduces). No
mobile-specific Chain Selector variant exists or is needed — it is the same dialog,
responsive by default as a standard React component.

## 14. The AI escalation model

Real, live, three-stage gate — identical on mobile and desktop since it is entirely
server-side:

1. **`src/lib/llm-routing-gate.ts`** (90 lines) — intent is classified first
   (`intent-engine.ts`). If a deterministic handler is registered for that intent (currently
   two: `check_status`, `generate_report`), it answers with zero LLM cost — no AI call at all.
2. Only if no deterministic handler exists does the request fall through to the LLM path via
   `orchestra-model-resolver.ts` → `llm-client.ts`.
3. **`src/lib/ai-reply-gate.ts`** (75 lines) — every LLM output is gated before rendering:
   blocks empty replies, over-length replies, and hallucinated action claims
   (`detectFalseActionClaim()`).

This matches the constitution's software-first principle (`ai-os/CONSTITUTION.yaml` §5,
SF-01, `ENFORCED`: "Dispatch order: deterministic software path first ... AI free-text
planning fallback only if no deterministic path exists"). **Disclosed limitation:** the
deterministic-handler set is narrow (2 intents today), and `mother-router.ts`'s own
2026-07-20 self-audit found 35 call sites still bypassing the unified router directly —
this document does not claim the gate covers every path, only that it is real and enforced
where it exists.

## 15. When software completes work

Software completes the work whenever a deterministic path exists and matches: `llm-routing-gate.ts`'s
two registered intents; any Chain Selector selection that already resolves a specific Worker
Agent (`tasks.resolvedWorkerAgentId` — when set, `executeTask()` skips LLM planning entirely,
per that column's own schema comment, "zero-LLM-cost path"); and ordinary CRUD screens, which
work identically to desktop (`ai-os/CONSTITUTION.yaml` UX-02, `ENFORCED`).

## 16. When AI is required

AI is required only when no deterministic handler or resolved worker agent exists for the
request — the fallback branch of §14's gate. This is the same rule stated in
`ai-os/CONSTITUTION.yaml` §5: "AI is the fallback, not the default."

## 17. The mobile task model

`tasks` (`schema.ts:1225`) is the real, single deterministic outcome record: `status`
(`pending|in_progress|completed|failed|cancelled`), `resolvedWorkerAgentId`, `dynamicChainId`,
`priority` with deterministic-only reprioritization (`lastReprioritizedAt`/
`lastReprioritizationReason`, written exclusively by `task-reprioritization-service.ts`, never
by a human edit). `taskExecutionPlan` and `taskAgentExecutions` (the latter carrying 9
mandatory structured "handover" fields — `handoverTaskStatus`, `handoverValidationPassed`,
`handoverConfidence`, etc.) provide deterministic execution and outcome tracking on top of it.

**Honest, disclosed gap:** no mechanism was found that automatically converts every chat
interaction into a `tasks` row — `taskChatMessages` is chat scoped to an *already-existing*
task, and ordinary conversation-level `messages` are not auto-promoted to `tasks`. "Every
mobile action ultimately produces one deterministic task" is, today, an architectural
principle expressed through the Chain Selector → `resolvedWorkerAgentId` path, not an
enforced invariant across every chat turn. This document states that gap plainly rather than
claiming the invariant is already real.

## 18. Local mobile cache

Real, live, IndexedDB-backed, client-only: `src/lib/browser-intent-cache.ts` (232 lines) caches
a user's own past `VeriComposer` submissions (mode pill + chain path + chat text) for one-click
replay, explicitly "works offline" per its own header, with zero AI cost and zero network
round-trip. Ranking mirrors `chain-usage-ranking.ts`'s server-side recency-weighted-frequency
proxy. Its own header discloses the honest limit: "encrypted: true" from a prior Owner spec is
not implemented as real encryption-at-rest — IndexedDB's own origin isolation and device-local
storage are the real protection in place, described as such rather than oversold.

Separately, `src/lib/browser-execution/model-cache.ts` (IndexedDB weight cache, per-engine) and
`cross-tier-storage.ts` (OPFS→CacheAPI→IndexedDB abstraction) exist for the browser-execution
tiers described in §20 below — a different cache, for model weights, not user data.

## 19. Local offline operation

**Real and partial, not general.** The one working end-to-end offline-capture flow in the
current codebase is in the sibling `projexa` repo: `src/lib/offline/work-progress-queue.ts`
(idb-keyval-backed queue, per-user-scoped store keyed to the authenticated Supabase user id —
a real, audited fix that prevents one shared field tablet from leaking one user's queued
entries into another's session). Entries (including photo blobs, §9) are queued locally first,
regardless of connectivity, and synced opportunistically.

In `compliance-tracker` itself, `browser-intent-cache.ts` (§18) is the one real offline-capable
mechanism — it reads/writes past submissions without a network round-trip. There is **no
general offline-first data layer** in `compliance-tracker` covering arbitrary CRUD/chat data;
`src/lib/browser-execution/sync-engine.ts` (§21) is a real, tested, pure library implementing
the primitives for one, but is not wired to any live persistence or UI today.

## 20. Background synchronization

**`NOT_YET_BUILT` in `compliance-tracker`.** No Service Worker exists in this repo at all — no
`sync` event, no `periodicSync`, no `registration.sync`, confirmed by a repo-wide search
returning zero hits. `src/lib/browser-execution/sync-engine.ts` (244 lines) implements the real
primitives — an `OfflineQueue` class, `coalesceQueuedChanges()`, `syncQueue()`,
`pullDeltaSync()`, a `SyncMutex` — built fresh after that increment's own audit found the
PROJEXA offline queue it was told to reuse as prior art did not exist in this repo's history at
the time. It is unit-tested (part of the 108/108 passing `browser-execution` suite) but not
wired into the live chat send path or any Service Worker trigger.

In the sibling `projexa` repo, background sync is real but event-driven from the client, not a
Service Worker background-sync event: `syncQueuedWorkProgressEntries()` drains the IndexedDB
queue on the browser's `online` event, with a real per-scope mutex (`syncLocks`) so overlapping
calls (e.g. a component remount racing the `online` event) dedupe onto one in-flight drain
instead of double-posting.

## 21. Sync with browser

Within a single device, `browser-intent-cache.ts`'s IndexedDB store and `projexa`'s per-scope
work-progress queue both already work across browser tabs/windows on the same device, since
IndexedDB is a per-origin store, not a per-tab one — this is a property IndexedDB provides for
free, not a feature either module had to build. `ai-os/CONSTITUTION.yaml` BROWSER-07 documents
this as the correct target primitive for the general case (`NOT_YET_BUILT` there refers to the
general cross-tab cache of *resolved capability-tree/calculator work*, a separate, broader
target from the two real IndexedDB uses that already exist).

## 22. Sync with server

Real today for `projexa`'s offline queue: each queued entry POSTs to the real, existing
`/api/work-progress` route on reconnect; a synced entry is removed from the local queue; a
failed entry is retried up to `MAX_SYNC_ATTEMPTS` (5) before being marked permanently `failed`
and excluded from further automatic retries. For `compliance-tracker` generally: every other
input channel (§§6-11) already syncs with the server synchronously on submit — there is no
queued/deferred path for ordinary chat messages today, only for the one offline-capture flow
described above.

## 23. Small-packet synchronization

`sync-engine.ts`'s `pullDeltaSync()` and `QueuedChange`'s `baseVersion` field are the real,
tested building blocks for small-packet/delta sync (syncing only what changed, with a version
basis for conflict detection) — built and unit-tested, not yet wired to any live server
endpoint or Service Worker. This document names it as a real, available primitive for a future
implementation OCID to wire up, not as something already running in production.

## 24. Conflict resolution

Real, tested, and precisely specified in `sync-engine.ts`'s `coalesceQueuedChanges()`: when two
offline edits are queued against the same entity while disconnected, the function applies a
documented rule set (create+update → create; update+update → update, keeping the *earliest*
`baseVersion` so the server can detect a genuine remote conflict against the first local edit,
not the second's already-stale basis; anything+delete → delete; delete+create/update → a fresh
create; create+delete → cancels out to nothing). This is real conflict-resolution logic, unit
tested, but — same disclosed gap as §20 — not wired into any live sync path yet.

`projexa`'s work-progress queue takes a simpler, real, live approach: entries are independent
by `localId`, so there is no same-entity-conflict case to resolve — each queued entry is a new
record, not a competing edit to an existing one.

## 25. Session recovery

**`NOT_YET_BUILT`.** No "resume session," "reconnect," or "recover conversation state" logic
was found anywhere client-side (a repo-wide, case-insensitive search returned zero hits).
`src/lib/supabase/auth-guard.ts` enforces a maximum concurrent-session/device count
(`activeSessionCount`), but this governs how many sessions may exist, not client-side recovery
of an interrupted one. On mobile, today, an interrupted session behaves exactly as it does on
desktop: standard Supabase Auth SSR cookie-based re-authentication on next load, with no
in-flight-conversation-state recovery beyond what's already durably persisted server-side in
`messages`/`conversations`.

## 26. Push notifications

**Does not exist.** No `Notification.permission`, no `new Notification(`, no `pushManager`/
`PushSubscription`, no VAPID key reference, and no push-related database table anywhere in
`compliance-tracker` — confirmed by a repo-wide search returning zero hits. In-app
notifications are real and live (`notifications` table, `schema.ts:581`), but nothing today
delivers a notification to a device when the PWA is not open. This is a real, disclosed gap,
not a documented feature.

## 27. Role-based security

Unchanged for mobile — this is a server-side, transport-agnostic guarantee, not a per-client
concern. Every API route (mobile or desktop) goes through `requireAuth()` /
`requireAuthOrApiKey()` (`src/lib/supabase/auth-guard.ts`, 471 lines) and
`withTenantContext()` (`src/lib/db/tenant-scoped.ts`, real Postgres GUCs under a dedicated
non-RLS-bypassing role, called in 49/51 service files per `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`
item 8). `requireAuthOrApiKey()`'s own design comment explicitly names "mobile app" as one of
the external-caller shapes it was built to support (an API-key-authenticated client, not a
different permission model) — the same role/permission checks apply identically regardless of
which client calls the route.

## 28. Mobile permissions

**Device-level browser permissions (camera, microphone, geolocation, notifications) have no
VERIDIAN-specific handling today** — confirmed, no code found requesting or checking these
beyond what the browser's own standard permission prompts provide implicitly (e.g. Whisper's
audio capture, §7; `projexa`'s photo capture, §9). `requireAuthOrApiKey`'s "mobile app"
reference (§27) is about an external API *client's* credential, not an in-browser device
permission model — these are two different, easily conflated concepts, and this document keeps
them distinct rather than treating one as covering the other.

## 29. End-user privacy

Governed by the same real mechanisms as desktop: RLS + tenant-scoped Postgres GUCs (§27)
ensure one org's data is never visible to another regardless of client; `browser-intent-cache.ts`'s
composer-history cache is explicitly device-local and never synced to VERIDIAN's servers (§18);
`ai-os/CONSTITUTION.yaml` §15 (`data_protection_and_separation`) governs the rest and is
unaffected by which client (mobile or desktop) makes a request.

## 30. End-user simplicity

The mobile PWA does not introduce a second UI vocabulary — it is the same `AppSidebar`/
`AppTopbar`/`VeriComposer` triad as desktop, with mobile-responsive rendering already present
in `sidebar.tsx`'s `useIsMobile()` path. A user who already knows the desktop chat-first
workflow (mode pill → chain selection → chat) needs to learn nothing new on mobile: the same
composer, the same pills, the same chain selector.

## 31. Zero cognitive load

The same Chain Selector / mode-pill mechanism that reduces desktop cognitive load
(`ai-os/CONSTITUTION.yaml` §6, "the flexible, non-rigid instruction interface") applies
identically on mobile since it is the same rendered component. **Disclosed, honest gap
carried forward from `ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md`:**
touch-target sizing (CSV #1793, no ≥44px `field`-size variant) is a real open item that works
against this goal on small screens specifically — noted here rather than claimed solved.

## 32. A thirty-second learning experience

Not a measured or certified metric anywhere in this codebase today — no onboarding-timing
instrumentation or usability-test artifact was found for this specific claim. What is real:
`OnboardingChecklist.tsx` persists completion state in `localStorage` (one of the four real,
narrow `localStorage` uses found in the codebase, per `ai-os/CONSTITUTION.yaml` BROWSER-06),
and the chat-first single-composer model (§5) is the real design basis a "thirty second"
learning claim would rest on. This document records the design intent honestly without
asserting it has been measured or certified.

## 33. Mobile performance target

**`NOT_YET_TRACKED`.** `ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md` CSV row
#1794 (mobile load-time performance, no Lighthouse CI or performance budget) is an open,
unresolved item, confirmed still true by this pass — no Lighthouse CI job, performance budget
config, or mobile-specific bundle-size gate was found in this repo. This document does not set
a numeric target, since VERIDIAN has no existing measurement mechanism a target could be
checked against yet — proposing one is implementation, out of this document's documentation-only
scope.

## 34. Offline-first behavior

Real, but narrow and disclosed, not general: §§18-19 (browser-intent-cache, projexa's
work-progress queue) are the two genuinely offline-first flows that exist today. General
offline-first behavior for arbitrary VERIDIAN chat/task data is `NOT_YET_BUILT` — the real
primitives for it (`sync-engine.ts`) exist, tested, unwired. "Offline-first" describes two real
features today, not the runtime as a whole.

## 35. End-user certification rules

No mobile-specific certification suite exists — the real end-to-end certification effort
(`UMR-20260802-165606-4413`, OCID-020) targets `projexa-ai.com` generally, not a mobile-specific
pass; `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md`'s 22-spec Playwright suite was
not confirmed to run against mobile viewports or touch interaction in this pass. Per this
task's own prohibition (documentation only, no implementation), this document does not create a
certification suite — it records that certifying the mobile runtime specifically remains real,
open, future work, to be scoped by a subsequent OCID.

## 36. Mobile runtime summary

| Area | Real status |
|---|---|
| PWA installability (manifest, standalone display, share_target) | **Real, live** — `src/app/manifest.ts` |
| Service worker / background sync | **`NOT_YET_BUILT`** in `compliance-tracker`; a real, narrower hand-rolled SW exists in the sibling `projexa` repo (app-shell caching only, no API caching) |
| VERI Chat composer, mode pills, Chain Selector | **Real, live**, shared identically across desktop and mobile (same components, responsive) |
| VERI (the assistant) participation in VERI Chat | **Real, live**, invite-only, never proactive (VERI-02) |
| AI escalation gate (software-first, AI fallback) | **Real, live**, narrow (2 deterministic intents today), 35 call sites self-documented as unmigrated |
| Deterministic task model | **Real for Chain-Selector-resolved tasks**; no automatic chat→task promotion for every turn |
| Local device cache (composer history) | **Real, live**, IndexedDB, `browser-intent-cache.ts` |
| Offline data capture | **Real but narrow** — one flow in `projexa` (work-progress + photos), one in `compliance-tracker` (composer history); no general offline data layer |
| Delta sync / conflict resolution primitives | **Real, unit-tested, unwired** — `sync-engine.ts` |
| Push notifications | **Does not exist** |
| Session recovery | **Does not exist** — standard cookie re-auth only |
| Role-based security / tenant isolation | **Real, live**, identical for every client type |
| Mobile-specific device permissions (camera/mic/geo/notifications) | **No VERIDIAN-specific handling** — only implicit browser prompts where a feature (Whisper, photo capture) already needs one |
| Mobile-specific responsive/touch/perf hardening | **Real, disclosed open gaps** — CSV #106/#1792/#1793/#1794, `ai-os/REVIEW_FRAMEWORK_V2-8_MOBILE_UX_CROSSREF_2026-07-20.md` |

**Net position:** VERIDIAN's mobile PWA is real and installable today, built entirely on the
same VERI Chat / VERI Assistant / Chain Selector runtime as desktop — there is no second
product to build or maintain. The real, disclosed gaps (background sync, push notifications,
session recovery, general offline data, mobile-specific touch/perf hardening) are genuine open
items, each already named in an existing tracked document, not newly invented here — and each
is implementation work explicitly out of this document's documentation-only scope, left for a
future OCID to pick up with this document as its grounding reference.

---

## Amendment log

- **2026-08-03** — v1.0 created (this document), OCID-20260803-025.
