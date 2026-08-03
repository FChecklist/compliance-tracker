# VERIDIAN Unified Synchronization Runtime — v1.0

**Status: documentation only.** This artifact implements no code, changes no database, creates
no new table, and defines no new sync architecture. Every claim below is either (a) real, live,
evidenced state as of 2026-08-03, cited to a file:line or an existing canonical artifact, or
(b) an explicitly labeled gap (`NOT_YET_BUILT`/`POLICY_ONLY`/`PARTIALLY_ENFORCED`) already on
record elsewhere in this repo's governance trail, or newly named here only because no prior
artifact had stated it from the synchronization angle specifically. Nothing here is invented,
redesigned, or proposed as new infrastructure — per this document's own mandate: **synchronization
rules only, grounded in what already exists.**

**Numbering note, resolved by a real PM decision:** this task's own folder/branch was labeled
`ocid-028`, and that label was correct all along. Real PM decision `UMR-20260803-052107-71fa`
(citing `UMR-20260803-041257-e9c3`) independently verified this document's real content ("VERIDIAN
Unified Synchronization Runtime") is OCID-028, correcting an earlier draft of
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s status table that had mislabeled it
as row `OCID-20260803-027`. OCID-027 is "VERIDIAN Global Knowledge Discovery and Reuse Runtime"
(PR #771). Same mislabeling class as the OCID-036/037 correction (`UMR-20260803-045159-ec55`, a
separate, unrelated citation).

**UMR:** parented to `UMR-20260803-041211-b7b7` (per this task's own SPEC, "the real OCID-027
directive just registered"). Citing, in the order given: `UMR-20260803-041122-b22d` (OCID-026),
`UMR-20260803-041047-03ee` (OCID-025), `UMR-20260803-041000-70ae` (OCID-024),
`UMR-20260803-040929-9713` (OCID-023), `UMR-20260803-040844-4a33` (OCID-022),
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program),
`UMR-20260802-165606-4413` (OCID-020, PROJEXA end-user certification directive). Consistent with
`ai-os/CONSTITUTION.yaml`'s `SEC-07` (the real implementation lock — its actual gating condition
is `UMR-20260802-165606-4413`/OCID-020, not a literal "OCID-021 lock," per the honest correction
already recorded in `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §2 and repeated
by both OCID-022's and OCID-024's own documents) — SEC-07 explicitly permits discovery and
documentation to continue while implementation stays locked. This document does neither more
nor less than that.

**Discovery method:** a dedicated repo-wide discovery pass (grep + direct file reads) across
`src/lib`, `src/app/api`, `src/components`, and `package.json` for sync/cache/PWA/realtime/queue
mechanisms, cross-checked against `ai-os/CONSTITUTION.yaml` (§§5, 6, 14, 17, 20), plus a full
read of the three already-written, still-unmerged sibling OCID documents this one directly
builds on: `ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` (OCID-022, PR #765),
`ai-os/VERIDIAN_LAPTOP_WEB_BROWSER_RUNTIME_2026-08-03.md` (OCID-024, PR #767), and
`ai-os/VERIDIAN_MOBILE_PWA_AND_VERI_CHAT_RUNTIME_2026-08-03.md` (OCID-025, PR #766). **Zero
duplication check, done, not asserted:** every fact those three documents already established
about sync-adjacent state (browser cache, PWA offline queue, chat polling, task model) is cited
here by section reference rather than re-derived from scratch — this document's own, genuinely
new contribution is cross-referencing those scattered facts into one coherent synchronization
model, plus the sections (conflict resolution taxonomy, sync certification, UMR continuity, OCID-
029 readiness) none of the three siblings covers end-to-end. Where this document's own discovery
pass found something the siblings did not (e.g. the task-update last-write-wins mechanism,
`docProcessingJobs`' Realtime-not-yet-implemented comment, PROJEXA's `sync-engine.ts` primitives
in more sync-specific detail), it is cited to its own file:line, independently.

---

## 1. Sync principles

Restated from this task's own SPEC (Owner directive), not invented here — these are the rules
every section below is checked against:

1. Every task and every chat has **one verified state**; every end user sees the same verified
   state across devices.
2. The laptop web browser remains the **primary workspace** (per OCID-024 §§1-2, already the real
   sole delivery/execution surface — there is no alternative surface today, `GAP-CONNECTOR-LAYERS`
   in `ai-os/MASTER-TRACKER.yaml` confirms Layers 3/4 are fully unbuilt).
3. The mobile PWA **synchronizes with** the laptop experience — it is one more surface onto the
   same backend, never a second product (OCID-025 §1).
4. **The server never creates a parallel state.** Every real write path found in this discovery
   converges on the same Postgres tables through the same Drizzle service layer — there is no
   second, competing data store anywhere in this codebase (confirmed: zero Redis/queue/alternate-
   DB hits, per §16 below).
5. Synchronization uses **small data packets**; only **changed data** is synchronized. Real,
   partial today — see §14.
6. Every synchronization is **traceable and auditable**, and updates the existing UMR chain — see
   §29-30.
7. **End users never need to manually synchronize.** Real today only in the narrow sense that
   every currently-shipped path (ordinary CRUD, foreground chat polling) is already automatic —
   there is no "sync now" button anywhere in the UI, and none is needed for what exists. Where a
   sync mechanism does not yet exist (background sync, push), the honest state is that nothing
   requires manual triggering because nothing runs there at all yet — see §17.

## 2. Single source of truth

Real and confirmed, not aspirational: there is exactly **one** system of record, Postgres via
Drizzle, reached through `src/lib/db/`. Every write path this document's discovery traced —
`task-service.ts::createTask()`/`updateTask()`, `chat-service.ts::sendMessage()`,
`db.query.*` reads across `src/app/api/**` — reads from and writes to the same tenant-scoped
tables (`withTenantContext()`, `src/lib/db/tenant-scoped.ts`, called in 49/51 service files per
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 8). There is no second database, no shadow
store, and no competing cache that is ever treated as authoritative — every cache found in this
discovery (§22-23) is explicitly either (a) a pure HTTP-response cache with a short `staleTime`
that always re-fetches from the same source, or (b) device-local and explicitly documented in
its own code as never syncing back to the server, i.e. never a competing source of truth. This
is the real, live mechanism principle 4 above describes; this document does not need to design a
"single source of truth" — one already exists and this section only confirms it.

## 3. End user browser state

Real, per OCID-024 §9: `AppShell.tsx` mounts `VeriComposer.tsx` once, not per-page, so composer
draft text, active chain selection, and active AI thread persist across in-app navigation within
one browser session (`veri-chat-context.tsx` lifts `selectedPath`/`aiThreadId` for cross-
component reads). This is real, in-memory, single-tab/session state — it does not persist across
a full reload beyond the four narrow `localStorage` keys catalogued in OCID-024 §5 (chat-draft,
onboarding-completion, panel-size, anonymous visitor id). There is no general browser-state
snapshot/restore mechanism; a reload returns to server-fetched defaults, not a resumed in-
progress state, except for those four keys.

## 4. PWA state

Real and installable, narrow: `src/app/manifest.ts` (OCID-025 §1) makes VERIDIAN installable to
a home screen with `share_target` wired to `/api/veri-chat/share-target`. There is **no service
worker in compliance-tracker** (confirmed independently by this discovery pass and by both OCID-
024 §33 and OCID-025 §20 — zero `sw.js`, zero `next-pwa`/`workbox` dependency, zero
`serviceWorker.register()` call anywhere in `src`), so the PWA holds no persistent app-shell
cache or background-sync registration of its own. "PWA state" today is: whatever the browser's
own HTTP cache does for static assets, plus the same in-session composer state as §3 (same code,
responsive rendering, per OCID-025 §4). The PROJEXA sibling repo has a real, narrower hand-rolled
service worker (app-shell caching only, no API caching, per OCID-025 §36's summary table) — this
is out of compliance-tracker's own scope and not claimed as compliance-tracker state.

## 5. Server state

The server holds the one authoritative state for every table under `compliance` schema, gated by
`requireAuth()`/`requireAuthOrApiKey()` (`src/lib/supabase/auth-guard.ts`) and
`withTenantContext()` RLS scoping (§2). Server-side in-process caches exist
(`asset-registry-cache.ts`) but are explicitly documented in their own header as **per-serverless-
instance memory, not distributed** — "two concurrent Vercel function instances can each hold a
slightly different cached view" is a real, disclosed limitation, not a sync guarantee. There is
no Redis, no pub/sub, no `LISTEN`/`NOTIFY` usage anywhere in this codebase (confirmed by this
discovery's own grep, zero hits, matching `asset-registry-cache.ts`'s own header claim). Server
state is therefore real and authoritative at the Postgres row level, but not instantaneously
consistent across serverless instances at the in-process-cache level — a real, narrow, disclosed
gap, not a sync-runtime concern (no user data is affected, only ephemeral metadata lookups).

## 6. Task state synchronization

Real mechanism, real gap: `tasks` (`schema.ts:1225`) is the one deterministic outcome record.
`updateTask()` (`src/lib/services/task-service.ts:346-372`) performs a plain
`db.update(tasks).set(updates).where(eq(tasks.id, id))` after re-stamping `updatedAt` — **there
is no version column, no ETag/If-Match check, and no optimistic-concurrency mechanism anywhere
on the tasks table.** This is unconditional last-write-wins: whichever `PATCH` reaches the
database last silently overwrites whatever fields a concurrent writer had just set, with no
conflict signal to either client. `PATCH /api/tasks/[id]` (`src/app/api/tasks/[id]/route.ts:23-
45`) accepts no version/If-Match parameter in its request body type. This is real, current, and
the honest baseline any future conflict-detection work (§18-19) would have to add to, not
replace — no task-level sync mechanism beyond direct-write-then-re-fetch exists today.

## 7. Chat state synchronization

Real, and asymmetric between two paths (OCID-024 §16, OCID-025 §2/§16, this discovery's own
confirmation): conversation-level chat (`POST /api/conversations/[id]/messages` →
`chat-service.ts::sendMessage()`) is a live LLM round trip with foreground polling as the only
freshness mechanism — `HomeThreadSlot.tsx` polls every 6s, `chat/page.tsx` every 8s (via
`useResilientPoll`, with in-flight-guard + capped backoff), `veri-ai/page.tsx` every 6s,
`ThreadView.tsx` every 6s, `guest-chat/[token]/page.tsx` every 5s. **There is no WebSocket, no
SSE, and no Supabase Realtime channel for chat anywhere in this codebase** (confirmed zero hits
for `.channel(`/`postgres_changes`/`EventSource`/`WebSocket` in the chat surfaces). Polling stops
the moment a tab loses focus or closes (OCID-024 §33) — chat "sync" across two open tabs/devices
today means both tabs independently poll the same server rows on their own schedule, not that
one write pushes to the other. Task-level chat (`src/app/api/tasks/[id]/chat/route.ts`) inserts
a message and returns with no LLM call at all — already tracked
(`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 6, OCID-022 §3.1, OCID-024 §16) — not re-fixed
here, cited for completeness of the sync picture: this path has no AI-reply state to keep in sync
across devices in the first place.

## 8. Mode pills state

Real and live, computed fresh every time, not cached: `capability-tree-service.ts::
buildCapabilityTree()` serves `GET /api/capability-tree`, fetched by `veri-chat-context.tsx`'s
`fetchCapabilityTree()` on load (OCID-024 §14, `DMP-01`, **ENFORCED**). There is no client cache
of the tree — `BROWSER-05` (`ai-os/CONSTITUTION.yaml`) is itself `PARTIALLY_ENFORCED` precisely
because the tree "is recomputed server-side and fetched fresh on every page load — no client-
side cache." This means mode-pill state is, today, trivially and always in sync across devices —
every device independently fetches the current live tree on every load — at the cost of a
network round trip every time rather than a cached-and-invalidated model. `DMP-05` (per-screen
adaptive pills, a personalized chain library) is `NOT_YET_BUILT` (OCID-024 §14) — there is no
persisted, per-user pill-preference state to synchronize yet.

## 9. Option chain state

Real, per OCID-024 §15: the Chain Selector (`ChainSelector.tsx`) operates on the same live,
always-fetched capability tree as §8 — no separate cache, no separate sync concern. Once a chain
is picked and a task/conversation created through it, `dynamicChainId` is persisted on that row
(`DMP-03`, **PARTIALLY_ENFORCED** — carries dispatch routing only, not yet permissions/approvals/
notifications/audit, per `CONSTITUTION.yaml`:317-321) — this persisted value is ordinary row
state, synchronized the same last-write-wins way as any other task/conversation field (§6-7), not
via a separate mechanism. `browser-intent-cache.ts` (IndexedDB, device-local) separately caches
a user's own **past** chain-selection choices for one-click recall (OCID-024 §7, OCID-025 §18) —
explicitly documented as never leaving the device, so it is not, and is not meant to be, synced
across a user's own multiple devices; a user's chain-recall history on their phone and laptop are
independent by design today.

## 10. Prompt state

The composed system prompt for an LLM call is deterministically compiled server-side per request
(`src/lib/prompt-compiler/*`, `CACHE-01` **ENFORCED**) and is not client-persisted or client-
synced state at all — it is recomputed, not stored client-side, so there is no prompt-state sync
concern on the client. Server-side, `CACHE-01`-`CACHE-04` (`CONSTITUTION.yaml` §20) govern
**LLM-provider prompt caching** (`cache_control`-tagged content blocks sent to Anthropic,
tracked in `prompt_cache_metrics`) — this is a cost-optimization mechanism for repeated LLM
calls, explicitly **not** an end-user data synchronization mechanism (OCID-024 §6 already draws
this same distinction; this document does not conflate the two either). `browser-intent-cache.ts`
separately caches a user's own composer submission history client-side (§9) — the closest thing
to "prompt state" a user would recognize, and, as noted, deliberately device-local, not synced.

## 11. Function state

"Function" here means capability-tree leaves and resolved Worker Agent dispatch
(`tasks.resolvedWorkerAgentId`, `tasks.dynamicChainId`) — real, persisted server-side row state,
synchronized the same way as any other task field (§6): whichever write lands last wins, re-
fetched by whichever client next reads the row. There is no separate "function execution state"
store; `taskExecutionPlan`/`taskAgentExecutions` (`schema.ts` ~1277-1650) hold structured
execution/handover tracking as ordinary DB rows under the same tenant-scoped, last-write-wins
regime.

## 12. Report state

Real, per OCID-024 §24: reports (`src/app/(app)/reports/`, `src/app/(app)/rpt/`) render server-
fetched data through the normal App Router page pattern — there is no separate report-rendering
runtime, no client-side report cache, and no report-specific sync mechanism. Every report view is
freshly computed server-side and displayed; two devices viewing the same report independently
re-fetch and always see the same server-computed data, with no staleness window beyond an
ordinary page load's own network latency. `report-schedule-service.ts` generates scheduled
reports server-side — this is generation timing, not a sync concern between client copies.

## 13. Analysis state

Identical pattern to reports (OCID-024 §25) — server-computed, browser-rendered, no separate
analysis cache or sync layer. The one partially client-triggered case
(`capability-registry-service.ts`'s semantic-search wrapper) still computes the embedding call
server-side; the browser only originates the query string, which is not itself state requiring
sync.

## 14. Small packet synchronization

**Real, tested, unwired — the one genuine "delta sync" building block in this codebase.**
`src/lib/browser-execution/sync-engine.ts` (244 lines, part of the 108/108-passing
`browser-execution` test suite, per OCID-025 §20/§23) implements `pullDeltaSync()` and a
`QueuedChange` type carrying a `baseVersion` field — real primitives for "sync only what
changed, with a version basis for conflict detection." It is not wired to any live server
endpoint, Service Worker, or UI trigger today (OCID-025 §23 states this plainly: "a real,
available primitive for a future implementation OCID to wire up, not as something already
running in production"). This document names it, per its own documentation-only scope, as the
existing real primitive a future implementation OCID should extend rather than replace or
duplicate — consistent with the SPEC's explicit prohibition on designing a new sync
architecture: one already exists in code, untested-in-production but unit-tested, and this
document defers to it rather than inventing a second one.

## 15. Background synchronization

**`NOT_YET_BUILT`** in compliance-tracker (OCID-024 §33, OCID-025 §20, confirmed independently
by this document's own discovery: zero `sync`/`periodicSync`/`registration.sync` hits, zero
Service Worker anywhere). The one thing that keeps a foreground tab reasonably fresh today is
polling (§7), which is not background sync by definition — it runs only while the tab is open
and focused. The sibling PROJEXA repo has a real, narrower, client-event-driven mechanism
(`syncQueuedWorkProgressEntries()` fires on the browser's `online` event, with a per-scope mutex
`syncLocks` deduping overlapping drains, per OCID-025 §20/§22) — real, but scoped to PROJEXA's
own offline work-progress queue, not a general compliance-tracker mechanism, and not a Service
Worker background-sync event either (it is triggered by a client-side event listener, which only
fires while the tab/app is at least loaded, not truly backgrounded).

## 16. Real time synchronization

**Does not exist.** No Supabase Realtime channel subscription (`.channel(`, `postgres_changes`),
no WebSocket, and no SSE anywhere in this codebase for user/business data (confirmed
independently by this discovery pass, matching OCID-024 §16's and OCID-025's grep results
exactly — `@supabase/supabase-js`/`@supabase/ssr` are dependencies used for auth/DB only, the
Realtime channel API is never invoked). The one forward-looking mention found anywhere in the
codebase is a schema comment on `docProcessingJobs` (`schema.ts` near line 10499): the app
"polls (or subscribes via Realtime once task #14 lands)" — an explicit acknowledgment that
Realtime subscription for that one job type is a real, named, not-yet-built future option, not
current behavior. Today, every cross-device/cross-tab freshness guarantee in this codebase is
polling-based (§7) or reload-based (§3-5), never push-based.

## 17. Offline synchronization

Real but narrow in both repos, general-purpose offline sync does not exist in compliance-tracker.
Two genuinely offline-capable flows exist today, both already catalogued by OCID-025 §18-19/§34:
(a) `browser-intent-cache.ts` — IndexedDB-backed, device-local, works offline by design, but
caches only a user's own past composer submissions, never business data, and never syncs back to
the server (there is nothing to sync — it is a pure recall cache); (b) PROJEXA's
`work-progress-queue.ts` — a real, per-user-scoped IndexedDB queue (via `idb-keyval`) that
captures work-progress entries (including photo blobs) offline and syncs opportunistically on
reconnect via `syncQueuedWorkProgressEntries()`, with `MAX_SYNC_ATTEMPTS` (5) before a permanent-
failure state (OCID-025 §22). Compliance-tracker itself has **no general offline-first data
layer for arbitrary CRUD or chat data** — `sync-engine.ts` (§14) provides the real, tested
primitives such a layer would need, but nothing today queues an offline task/chat write for
later replay in compliance-tracker; an offline user attempting a normal task/chat action in this
repo today gets a failed network request, not a queued-and-retried one.

## 18. Conflict detection

**Real primitive exists, unwired; real gap exists, live.** `sync-engine.ts`'s `QueuedChange.
baseVersion` field is the one real conflict-detection primitive in the codebase — comparing a
locally-queued change's base version against the server's current version to detect a genuine
remote conflict (OCID-025 §23/§24) — but it is not wired to any live endpoint. On the live,
production task-update path (§6), there is **no conflict detection at all**: `updateTask()`
performs an unconditional write with no version comparison, so two concurrent edits to the same
task produce no detectable conflict — the second write simply overwrites the first with no
signal to either party. This is the real, current, honest state: one conflict-detection
mechanism exists in tested library code, zero conflict detection exists on any live write path.

## 19. Conflict resolution

Real, tested, and precisely specified — but, again, unwired to any live path (OCID-025 §24):
`sync-engine.ts::coalesceQueuedChanges()` implements a documented rule set for merging queued
offline edits against the same entity: create+update coalesces to create; update+update
coalesces to update while keeping the *earliest* `baseVersion` (so the server can detect a
genuine conflict against the first local edit, not a second edit's already-stale basis);
anything+delete coalesces to delete; delete+create/update coalesces to a fresh create;
create+delete cancels out to nothing. This is real conflict-resolution logic, unit-tested as
part of the 108/108-passing suite, and this document names it — per its own documentation-only
mandate — as the existing mechanism a future implementation OCID should wire up rather than
design anew. PROJEXA's work-progress queue avoids the same-entity-conflict problem entirely by
construction: each queued entry is independent by `localId`, never a competing edit to an
existing row (OCID-025 §24) — a real, live, simpler strategy for the one flow that needs it
today, not a general answer for compliance-tracker's task/chat model, where concurrent edits to
the *same* row are the real, disclosed §6/§18 gap.

## 20. Last known verified state

Not a named mechanism anywhere in this codebase (confirmed: no "last known verified state,"
"lastVerifiedAt," or equivalent field found on `tasks`, `conversations`, or `messages`). The
closest real analog is simply **the current row in Postgres** — since there is exactly one
source of truth (§2) and no client-side authoritative cache, "the last known verified state" of
any task or chat is, today, definitionally whatever the server's current row says, re-fetched on
next read. There is no separate, distinct "verified" checkpoint distinct from "current" — this
document names that absence rather than inventing a verification-checkpoint concept the codebase
does not have.

## 21. State recovery

**`NOT_YET_BUILT`** (OCID-025 §25, confirmed independently: zero hits for "resume session,"
"reconnect," or "recover conversation state" anywhere client-side). `src/lib/supabase/
auth-guard.ts` enforces a maximum concurrent-session/device count (`activeSessionCount`) but this
governs *how many* sessions may exist, not recovery of an interrupted one. An interrupted session
today, on any device, recovers via standard Supabase Auth SSR cookie-based re-authentication on
next load — whatever was durably persisted server-side in `messages`/`conversations`/`tasks` is
what's there; whatever was only in-memory client state (§3, an unsent composer draft, an
unsubmitted chain selection) is lost, with the narrow exception of the four `localStorage` keys
already catalogued (OCID-024 §5).

## 22. Failed sync recovery

Real only within PROJEXA's own narrow offline queue (§17): a failed sync attempt retries up to
`MAX_SYNC_ATTEMPTS` (5) before being marked permanently `failed` and excluded from further
automatic retries (OCID-025 §22) — a real, bounded, disclosed retry policy for that one flow.
Compliance-tracker itself has no queued-write mechanism at all (§17), so there is no "failed
sync" state to recover from on the primary product's own write paths — a failed request today is
simply a failed HTTP request, surfaced to the user via `sonner`'s toast mechanism
(`<Toaster position="top-right" richColors />`, `src/app/layout.tsx`, per OCID-024 §26), with no
automatic retry or queued resubmission.

## 23. Local cache coordination

Real, narrow, IndexedDB-based, and already coordinated **within one device** for free: both
`browser-intent-cache.ts` and PROJEXA's work-progress queue are per-origin IndexedDB stores, so
they already work identically across every tab/window open on the same device without any
special coordination code — a property IndexedDB provides natively, not a feature either module
built (OCID-024 §7, OCID-025 §21). `ai-os/CONSTITUTION.yaml`'s `BROWSER-06`/`BROWSER-07` name the
broader, still-`NOT_YET_BUILT` target — a general cross-tab cache of *resolved capability-
tree/calculator work*, distinct from the two narrow real IndexedDB uses that exist today. There
is no cross-*device* local cache coordination anywhere (by definition — IndexedDB is per-
device), and none is claimed.

## 24. Server cache coordination

Real and explicitly disclosed as **not** distributed: `asset-registry-cache.ts`'s own header
states plainly that this codebase has no distributed cache or pub/sub mechanism, so two
concurrent serverless-function instances can independently hold slightly different cached views
of the same metadata (§5). This is a real, narrow, already-disclosed limitation on ephemeral
server-side lookups only — it does not affect the authoritative Postgres row data itself (every
instance reads/writes the same database), only in-process convenience caches layered on top of
it. No server-cache-coordination mechanism (e.g. Redis pub/sub invalidation) exists; none is
proposed here, consistent with this document's documentation-only mandate.

## 25. End user device switch

Real today only in the trivial, database-backed sense: because there is one source of truth
(§2) and no offline queue in compliance-tracker itself, a user switching from laptop to phone
(or vice versa) simply authenticates (`requireAuth()`, identical across clients per OCID-025
§27) and re-fetches the same server rows — whatever was durably saved (a sent message, a
created task, an updated task field) is there; whatever was only in-flight client state on the
first device (an unsent draft, an unpersisted chain-selection step) is not carried over,
matching §21's state-recovery finding exactly, since a device switch is, mechanically, the same
situation as a fresh session on a new client. `browser-intent-cache.ts`'s composer-history cache
is explicitly, by design, per-device — a user's chain-recall history does not follow them across
devices today (§9), a real, disclosed asymmetry with the "same verified state across devices"
principle (§1) for that one specific, narrow, device-local feature.

## 26. Chat continuity

Real for durably-persisted content, not real for in-flight composer state: every sent message is
a row in `messages`/`taskChatMessages`, visible identically from any device on next fetch/poll
(§7) — this is real chat continuity for what has actually been sent. There is no continuity
mechanism for an unsent draft or an in-progress chain-selection path started on one device and
resumed on another — that state lives only in the originating device's in-memory React state
(§3) and the four narrow `localStorage` keys, none of which are chat-draft-specific beyond
`GlobalChatDock.tsx`'s own single-device draft persistence (OCID-024 §5).

## 27. Task continuity

Real for the same reason as chat continuity: `tasks` rows are the one durable record, visible
identically from any device via direct fetch (§6). Continuity has the same real gap named in §6
and §18 — there is no version/conflict signal, so if two devices (or two tabs) both act on the
same task concurrently, the platform provides continuity of *the row*, not continuity of *intent*
across the two concurrent edits; the second write silently wins.

## 28. UMR continuity

Real and, per this document's own citation chain, directly demonstrated by the mechanism this
very document is part of: every OCID in this chain (`UMR-20260802-165606-4413` through
`UMR-20260803-041211-b7b7` and this document's own citing chain) is a real entry continuing the
same UMR lineage rather than starting a new one, per the standing rule
(`UMR-20260802-165434-cd91`, the unified project memory model) and confirmed live in
`/opt/veridian/ai-os/memory/superboss-register.sqlite`'s `umr_tasks` table for the dedicated
worker tasks spawned so far (per `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §2).
This document extends that same chain (see the front-matter UMR block) rather than opening a new
one — the concrete instance of "sync updates the existing UMR chain" (§1, principle 6) that this
document itself is required to satisfy, and does.

## 29. Traceability

Real, live, server-side: every mutating API call passes through `requireAuth()`/
`requireAuthOrApiKey()` (session/actor identity) and, for the subset of routes wired to it,
`recordOrchestraExecution`/audit logging (OCID-022 §2.3). `activity_log` (per `CONSTITUTION.yaml`
`UMR-01`, **ENFORCED**) is the real mechanism recording that activity happened. This gives real
traceability for *what changed and who changed it*, on the write side. It does not yet give
traceability for *which client/device* a given write came from in a sync-specific sense (no
device-id column was found on `tasks`/`messages`) — a real, narrow, newly-named gap relevant
specifically to a future sync-conflict audit trail, not previously named from this angle.

## 30. Sync auditability

There is no dedicated "sync log" or "sync event" table anywhere in this codebase (confirmed:
`docProcessingJobs`, `webhookDeliveries`, and `activity_log` are the closest real async/audit
tables, and none of them record client-sync events specifically — they record job status and
webhook delivery attempts, not device-to-device sync operations). Today's real auditability is
therefore the same as ordinary write auditability (§29): every persisted change is traceable to
an actor and a timestamp via the same mechanisms used for any other write, because there is no
separate sync-write path distinct from an ordinary API write (§2) — nothing currently writes via
a queued/replayed sync mechanism in compliance-tracker itself (the PROJEXA queue is the one real
exception, and its own sync attempts are visible via ordinary request logs to `/api/work-
progress`, not a dedicated sync-audit table).

## 31. Sync performance

No formal, numeric sync-performance target exists anywhere in this repo's governance trail
(consistent with OCID-024 §31's finding that no page-response-time SLA exists either — the one
real numeric latency budget found anywhere, `src/lib/prompt-compiler/pipeline.ts`'s
`STAGE_BUDGETS_MS`, is scoped to the prompt-compiler's own four internal stages, not to sync).
The real, current, de facto "performance" of the polling-based freshness mechanism (§7, §15-16)
is simply its poll interval — 5-8 seconds across the surfaces catalogued in §7 — which is a
staleness bound, not a measured or certified performance target.

## 32. Response time target

No formal numeric response-time target exists for synchronization specifically, matching OCID-
024 §31's identical finding for browser page-response time generally — this document does not
fabricate one where none exists in the codebase or governance trail, consistent with its
documentation-only mandate (setting a target would itself be a design/implementation decision
this document is prohibited from making). The only concrete numbers that exist today are the
poll intervals named in §7 (5-8s) — real, current, but explicitly not framed anywhere as a
committed SLA.

## 33. The zero-duplication target

This document's own SPEC requires "verify zero duplication" as a precondition to writing it, and
this document did: the discovery pass (front matter) found and cited, rather than re-built, every
existing sync-adjacent mechanism — `sync-engine.ts`, `browser-intent-cache.ts`, PROJEXA's work-
progress queue, the polling hooks, `asset-registry-cache.ts`. Nothing new was created. Applied
forward, "zero duplication" as an ongoing sync-runtime principle means: any future implementation
OCID that wires up delta sync, conflict resolution, or background sync **must** build on
`sync-engine.ts`'s existing, tested primitives (§14, §18-19) rather than authoring a second,
parallel sync engine — the same standing instruction `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_
2026-08-03.md` §1a already gives for the OCID-026-037 documentation cluster generally, restated
here specifically for sync/cache implementation work.

## 34. End user transparency

Real, by absence rather than by design: there is no "syncing..." indicator, no manual sync
button, and no sync-status UI element anywhere in this codebase (confirmed: no component renders
sync state distinct from ordinary loading/toast states). This satisfies principle 7 (§1) in the
narrowest possible sense — a user is never asked to manually sync because no sync operation
requiring their awareness exists yet in compliance-tracker's own live paths; the one real queued-
write flow (PROJEXA's offline queue) does surface its own state honestly per OCID-025 §9's own
finding — a queued photo shows as "saved on this device" while the rest of the entry syncs, an
explicit, disclosed partial-sync indicator for that one flow, not a general transparency
mechanism.

## 35. Synchronization certification

**No certification exists, and none is created by this document** (documentation-only mandate).
The most relevant existing certification effort is `UMR-20260802-165606-4413` (OCID-020, the
PROJEXA end-user certification sweep) — per `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-
03.md`, that sweep is itself still open, not independently verified complete, and its own scope
(navigation/UX click-through) does not include a dedicated sync-correctness pass (no multi-device
concurrent-edit test, no offline-queue-drain test, no conflict-detection test was found in its
22-spec Playwright suite per that document's citation). A real synchronization certification —
verifying the principles in §1 actually hold once any sync mechanism beyond ordinary CRUD is
implemented — is real, named, future scope, gated the same way every other implementation item
in this chain is gated: behind OCID-020's independent completion and `SEC-07`'s explicit unlock
sequence (038 implementation → 039 production certification → 040 final certification/freeze).

---

## Real synchronization summary table

| Area | Real status | Cited |
|---|---|---|
| Single source of truth (Postgres/Drizzle, tenant-scoped) | **Real, live** | §2 |
| Task update conflict detection | **Does not exist** — unconditional last-write-wins | §6, §18 |
| Chat cross-device freshness | **Real, polling-based (5-8s), no push** | §7, §16 |
| Mode pills / capability tree | **Real, always-fresh (no cache, so trivially in sync)** | §8 |
| Delta-sync primitives (`sync-engine.ts`) | **Real, unit-tested, unwired to any live path** | §14, §18, §19 |
| Background synchronization | **`NOT_YET_BUILT`** in compliance-tracker; narrow client-event-driven version real in PROJEXA | §15 |
| Real-time (Supabase Realtime/WebSocket/SSE) | **Does not exist** | §16 |
| Offline synchronization | **Real but narrow** — 2 device-local flows, no general offline data layer | §17 |
| Conflict resolution logic | **Real, tested, unwired** (`coalesceQueuedChanges()`) | §19 |
| State/session recovery | **Does not exist** — standard cookie re-auth only | §21 |
| Failed-sync retry | **Real only in PROJEXA's queue** (5 attempts, then permanent fail) | §22 |
| Local cache (device-scoped) | **Real, IndexedDB, cross-tab-free by IndexedDB's own nature** | §23 |
| Server cache coordination | **Real, explicitly non-distributed, disclosed** | §24 |
| Push notifications | **Does not exist** | (OCID-025 §26, carried forward) |
| Sync-specific audit trail | **Does not exist** — ordinary write-audit only | §30 |
| Sync certification | **Does not exist** — gated behind OCID-020/SEC-07 | §35 |

**Net position, stated plainly:** VERIDIAN's real synchronization model today is "one database,
fetched fresh, polled while a tab is open." That is a genuine, working, if unglamorous,
consistency model — it satisfies "one verified state" (§1) because there is only ever one place
state lives. What does not yet exist is anything that would be recognized as a *synchronization
runtime* in the fuller sense this document's own mandated section list describes: background
sync, real-time push, cross-device conflict detection/resolution wired to a live path, session
recovery, and sync certification. The real, tested, unwired building blocks for most of that
(`sync-engine.ts`) already exist in this codebase and are the correct starting point for whichever
future implementation OCID picks this up — not a reason to build a second version.

---

## Handoff to OCID-029

This document is the first canonical unified-synchronization-runtime artifact for the VERIDIAN
platform. It implements nothing and blocks nothing that was not already blocked. A future
implementation OCID that wants to close any gap catalogued above — wire `sync-engine.ts`'s delta-
sync/conflict-resolution primitives to a live endpoint, add background sync, add real-time push,
add task-update version/conflict detection, build session recovery, or run a real sync
certification pass — can cite this document as its baseline "what does synchronization actually
do today, and where exactly is the gap" reference, instead of re-running this discovery from
zero. Per this repository's own standing gatekeeper rule (`UMR-20260802-165034-5747`), any such
future directive must re-verify live state before dispatching real implementation work — this
document is a point-in-time synthesis (2026-08-03) and will go stale as real work lands, exactly
like the sibling OCID-022/024/025 documents it cites and `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.
md` before it.

**Ready to hand off to OCID-029.** This document's own mandate ends here — it defines
synchronization rules and real current state only, per its explicit prohibition on
implementation, new databases, new tables, or a new sync architecture. Whatever OCID-029 ("VERIDIAN
Universal Decision Engine v1.0," per `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`'s
table) needs from a synchronization perspective — e.g., which state a decision should be evaluated
against, what "last verified state" means for a decision input (§20) — has a real, cited answer
in this document rather than an undocumented assumption.

**Not acted on.** No implementation, database change, UI change, or UX change has been made
under this UMR. Awaiting Owner review, consistent with `SEC-07`'s implementation lock, which this
directive was scoped to respect throughout.

Canonical artifact: this file,
`ai-os/VERIDIAN_UNIFIED_SYNCHRONIZATION_RUNTIME_2026-08-03.md` — new, not a duplicate of any
existing file (confirmed via this session's own discovery pass and its
`ai-os/boss/ACTIVE-CLAIMS.yaml` claim entry; no prior file with this name or this document's full
scope exists anywhere in `ai-os/` — the closest adjacent prior art, `ai-os/priority21_workspace_
memory_design.md`, is scoped to a portable `.mv2` memory-capsule export/import, not general
end-user data sync, and explicitly defers the cross-device transport question rather than
answering it).

Real updated UMR: this document extends the existing chain rooted at `UMR-20260802-173631-ca85`
(ERP Functional Completeness Master Program) through `UMR-20260802-165606-4413` (OCID-020) and
the OCID-022 through OCID-027 chain, under its own parenting UMR `UMR-20260803-041211-b7b7`
(OCID-027, "VERIDIAN Global Knowledge Discovery and Reuse Runtime" — see the Numbering note above
for the real OCID-028 correction, `UMR-20260803-052107-71fa`). No new UMR chain was created.
