# VERIDIAN Universal Context and Predictive Runtime — v1.0

**UMR:** `UMR-20260803-042003-5e92` (OCID-034, this document's real dispatch UMR, per real PM decision
`UMR-20260803-063016-8bfc`) — `umr_tasks` table,
`/opt/veridian/ai-os/memory/superboss-register.sqlite`, confirmed by direct query, not narrated
(`owner-task-20260803-042001-2435815`, `unit_name:
veridian-worker@task-20260803-055118-ocid-034-veridian-universal-context-and.service`, real row
title: *"OCID-034 VERIDIAN Universal Context and Predictive Runtime document only"*). Parent, per
this task's own prompt and independently confirmed by the same direct query: `UMR-20260803-041851-085a`
— a real, distinct `owner_dispatch_gateway` row (`unit_name:
veridian-worker@task-20260803-055114-ocid-033-veridian-universal-end-user-wor.service`, real title:
*"OCID-033 VERIDIAN Universal End User Work Orchestration Runtime document only"*), correctly cited
as this task's parent.

**A note on a real citation-fabrication finding:** an earlier draft of this document self-minted a
separate "artifact UMR" (`UMR-20260803-055709-368e`) distinct from its real dispatch UMR above,
believing it followed an established convention. Real PM decision `UMR-20260803-063016-8bfc`
independently confirmed, via both `resource_governor.py --query-umr` and a direct raw query against
`umr_tasks` (1045 real rows, zero matches, exact and fuzzy) plus a full-text search across every
real table in `superboss-register.sqlite`, that this self-minted UMR was never a real, independently
registered record anywhere — the only place it existed was this document's own text and the
conversation instructing its correction. This document now cites only its real dispatch UMR, above.
See `ai-os/MASTER-TRACKER.yaml`'s recovery-matrix section (OCID-019 gap
`GAP-SELF-MINTED-ARTIFACT-UMR-FABRICATION`) for the broader finding: this same self-minted-artifact-UMR
pattern was independently confirmed present in at least two sibling documents in this same OCID series
as well, not fixed as part of this document's own correction.

**Real numbering correction, stated plainly rather than silently worked around:** the earlier
`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` (UMR `UMR-20260803-042918-60b8`, written
after both dispatch rows above already existed) labeled this exact mission text ("VERIDIAN Universal
Context and Predictive Runtime") as **OCID-20260803-033** in its own table, and labeled the End User
Work Orchestration Runtime mission as OCID-032. The live dispatch record queried directly for this
document is unambiguous and more authoritative than that snapshot's own table (which itself already
carries a self-documented correction for its 036/037 rows, `UMR-20260803-045159-ec55`): this task's
own registered title and UMR is **OCID-034**, and the Work Orchestration Runtime mission's real
dispatch UMR (`UMR-20260803-041851-085a`) is **OCID-033**. This is the same class of off-by-one
numbering drift already found and partially corrected elsewhere in this exact chain (PR #776,
"correct OCID-026/027/028/029/030 status table root cause"), one slot higher in the sequence. Not
re-litigated further here — this document uses its own real, queried dispatch numbering (**OCID-034**)
and does not attempt to re-derive or fix the snapshot table's row, which is out of this task's scope.

Also cites, per this task's own prompt: `UMR-20260803-040844-4a33` (OCID-022), `UMR-20260803-040929-9713`
(OCID-023), `UMR-20260803-041000-70ae` (OCID-024), `UMR-20260803-041047-03ee` (OCID-025),
`UMR-20260803-041122-b22d` (OCID-026), `UMR-20260803-041211-b7b7` (OCID-027), `UMR-20260803-041257-e9c3`
(OCID-028), `UMR-20260803-041351-0278` (OCID-029), `UMR-20260803-041459-7c97` (OCID-030),
`UMR-20260803-041700-a741` (OCID-031), `UMR-20260803-041743-d271` (OCID-032),
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program), `UMR-20260802-165606-4413`
(OCID-020, the real, still-open certification gate — see `SEC-07`, `ai-os/CONSTITUTION.yaml`),
`UMR-20260802-164659-9a31` (server artifact traceability audit), `UMR-20260802-165034-5747` (standing
gatekeeper rule), `UMR-20260802-165434-cd91` (unified project memory model).

**On "the OCID-021 implementation lock":** per this task's own prompt, this document is written "consistent
with the OCID-021 implementation lock which still permits discovery and matrix building to continue."
As already independently confirmed twice in this session's own chain (`ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`
§2), no artifact literally named "OCID-021" or "OCID-021 implementation lock" exists in this repo. The
real, findable gate with that effect is `SEC-07` (`ai-os/CONSTITUTION.yaml`), which locks
implementation/gap-closure/production-changes/completion-certification/platform-freeze behind OCID-020's
independent verification, while explicitly still permitting documentation, discovery, and matrix-building
— exactly the posture this document takes. This document does not implement anything, and correctly
treats `SEC-07`/`UMR-20260802-165606-4413` as the real gate, not the non-existent literal label.

**Status: documentation only.** This artifact implements no code, adds no database objects, changes no
UI, changes no AI/prompt behavior, and creates no new architecture. Every claim below is either (a)
real, live, evidenced state as of 2026-08-03, cited to a file:line or an existing canonical artifact,
or (b) an explicitly labeled gap already on record elsewhere in this repo's own governance trail, or
newly named here from the context/prediction angle specifically because no prior artifact had stated
it that way.

**Mandatory discovery performed before writing** (per this task's own directive: "search the complete
server... verify zero duplication"): direct grep/read of `src/lib/db/tenant-scoped.ts`,
`src/lib/services/veri-chat-service.ts`, `src/lib/prompt-compiler/context-assembly.ts`,
`src/lib/ai-router/mother-router.ts`, `src/lib/services/capability-learning-service.ts`,
`src/components/veri-chat/ChainSelector.tsx`, `src/lib/task-execution-engine.ts`,
`src/app/api/dynamic-chains/route.ts`, `src/lib/services/dynamic-chain-directory-service.ts`,
`src/lib/services/report-engine-service.ts`, `src/lib/prompt-compiler/prompt-ranking-recommendation.ts`,
`src/lib/services/construction-prediction-service.ts`, `src/lib/supabase/auth-guard.ts`; direct read of
`ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md`, `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`,
`ai-os/VERIDIAN_UNIVERSAL_END_USER_WORK_MODEL_2026-08-03.md` (OCID-023, still open on PR #768 at
writing time), `ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` (OCID-022, still open on
PR #765), `ai-os/CONSTITUTION.yaml`, `ai-os/OS.yaml`, `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`; and
`gh pr list`/`gh pr view` against `FChecklist/compliance-tracker` to confirm real, current merge state
of the whole OCID-022 through 034 chain at writing time (see §0a). Grep confirmed **zero hits** for
`ANALYSIS_LIBRARY`/`analysisRegistry`, no file named `decision-engine.ts` or `execution-engine.ts`, no
`manifest.json`/`manifest.webmanifest`, and no literal "option chain" string anywhere in `src/` — each
is named as a real gap below (§12, §14, §22 respectively), not invented as if it already existed.

---

## 0a. Zero-duplication check against sibling OCIDs (real, current PR state at writing time)

Per the PM decision recorded in the OCID-040 status snapshot (`UMR-20260803-045159-ec55`, binding on
"whichever worker picks up OCID-026 through OCID-037 next"): before writing, this worker checked
whether OCID-022/023 (or any later OCID) had already merged real content covering context/prediction
ground. Real, current state (`gh pr list --repo FChecklist/compliance-tracker`, re-checked at writing
time): **none of PR #765 (OCID-022), #766 (OCID-025), #767 (OCID-024), #768 (OCID-023), #771 (OCID-027),
#772 (OCID-030), #773 (OCID-029), #774 (OCID-028), or #775 (OCID-026) are merged to `main`** — all are
open. OCID-023's real, complete 739-line document (read directly from its branch) is a **task lifecycle
model** (state, ownership, assignment, delegation, transfer, approval, escalation, completion, reopen,
audit, history, timeline, attachments, chat, decisions, artifacts, reports, analysis, notifications,
search, permissions, visibility, retention, synchronization, recovery) — it names `task history`,
`task timeline`, and `task search` as task-lifecycle facts, but does **not** define how software
predicts a user's *next* action, reuses context *across* tasks/sessions/devices, or prepares context
*before* an AI call. Those are this document's real, distinct subject. Where this document's own
required sections overlap task-shaped ground (task context, work history context), it cross-references
OCID-023's real section numbers rather than restating them (see §3, §15). No genuinely new "Context and
Predictive Runtime" content was found in any other open or merged PR as of writing.

---

## 1. Context principles

Four real, binding principles, restating this task's own "mandatory execution principles" in
governance form so they are traceable, not just narrative:

1. **Verified context beats a repeated question.** If the software already holds a verified value for
   something (the user's org, role, current task, last report run, last function called), it must use
   that value rather than asking the end user to re-enter or re-select it. "Verified" means the value
   came from an authenticated, tenant-scoped read (§9, §10), not an unauthenticated guess.
2. **The user is never asked to re-enter information that already exists.** This is the concrete,
   testable form of principle 1 — a UI/API surface that presents a field the software could have
   pre-filled from verified context is treated as a real gap (see §23), not an acceptable default.
3. **Prediction happens before escalation, not instead of verification.** Software predicts the most
   likely next action, function, report, or analysis (§17–§24) and prepares that context, but a
   prediction is never substituted for a verified fact — a predicted next action is offered, not
   auto-executed, unless the specific action already carries its own confirmation-free authorization
   (e.g. `SEC-07`/Rule 12's autonomous-merge path, which is a different, already-governed decision, not
   one this document creates).
4. **AI receives verified, deterministic context, never a chat history it must re-derive facts from.**
   Everything AI-bound is prepared context (§26), and that preparation is minimized to what is actually
   needed (§27) — this is a repetition of an existing real architectural note, not a new proposal (see
   `ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` §4, "WATERTIGHT PROMPT TEMPLATE — mandatory for every
   AI-bound prompt").

---

## 2. End user context

**Real, existing mechanism:** `requireAuth()` (`src/lib/supabase/auth-guard.ts:264`) is the single,
mandatory entry point every API route calls (per `CLAUDE.md`'s own rule) and returns an `AuthContext`
carrying the authenticated user's identity, org, and role together — this is the base unit every other
context type in this document composes on top of. `requireAuthOrApiKey()` (`auth-guard.ts:392`)
extends the same context model to API-key callers, with an explicit documented distinction (line
429-441): API-key callers have scopes, not a role, and the role gate on `requireAuthOrApiKey()` exists
specifically so a scoped API key cannot silently act below a route's minimum role.

**Real gap named here, not previously stated this way:** `AuthContext` is re-derived on every request
(a fresh Supabase session read), not cached or reused across requests within a session in a way any
other part of the system (chat, task engine, report engine) can read without its own separate
`requireAuth()` call. There is no single, shared "current end user context" object threaded through a
request beyond the auth layer itself — each subsystem that needs org/user context (chat, task engine,
report engine) re-derives it from its own inputs rather than from one canonical, request-scoped
context object. This is not a defect in any one subsystem; it is the absence of a **shared context
carrier**, named as a real gap in §25 and §28.

---

## 3. Task context

Task context (what task is the user in, what state is it in, who owns it, what history does it carry)
is real, existing, and governed in full by OCID-023's own document
(`ai-os/VERIDIAN_UNIVERSAL_END_USER_WORK_MODEL_2026-08-03.md` §2–§16, §30) — this document does not
restate that model. What this document adds, as genuinely new ground: **how task context is reused for
prediction and AI preparation once it exists**, which OCID-023 does not cover. Concretely: `dispatchTool()`
(`src/lib/task-execution-engine.ts:89`) already reads `(db, orgId, userId, ...)` as its real input
signature — task context today is passed explicitly as function arguments at each call site, not
pulled from a shared context object (same gap as §2). `dynamicChains.modePill`/`pathKeys`
(`task-execution-engine.ts:1889-1915`) is the one real place task context is already used
*predictively* — the active mode pill and path selection narrow which capability the engine looks up,
which is the seed of §21's predictive-mode-pill section, not a new mechanism.

---

## 4. Chat context

**Real, existing mechanism:** VERI Chat's service layer (`src/lib/services/veri-chat-service.ts`, 249
lines) defines a real `VeriChatContext` type (`{orgId, userId}`, line 19) and gates every write through
`withTenantContext(ctx)` (e.g. line 22) — this is real, tenant-scoped chat context, not a stub.

**Real, honest gap, independently confirmed (not assumed) this session:** `veri-chat-service.ts` has
**no reference to Mother Router** (`src/lib/ai-router/mother-router.ts`) anywhere in the file — cross-
checked against `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`'s own §2 row 7 finding, which
independently states the same absence. This means chat context today is **narrower** than the full
`AuthContext`/task/org context available elsewhere in the system: a chat message is only ever known to
be `{orgId, userId}`-scoped, not also carrying the current task, the current mode pill, or the current
report/function the user was just looking at. Closing this gap (routing chat through the same context
carrier named in §2/§25/§28) is the single highest-leverage change this document identifies for making
AI escalation actually deterministic and context-complete — named here as a gap, not implemented.

UI layer, real and confirmed: `VeriChatPanel.tsx`, `VeriComposer.tsx`, `veri-chat-context.tsx`
(`src/components/veri-chat/`).

---

## 5. Session context

Real mechanism: Supabase Auth SSR session (`@supabase/ssr`), read fresh by every `requireAuth()` call
(§2) — a session's real, current permissions are governed by role/rank, not treated as a standalone
cacheable object today (per `auth-guard.ts:429`'s own comment, "a session's actual permissions are
governed by role/rank"). Session context in this document's sense (what has the user already told the
software this session, so it isn't asked again) is **only partially real**: the L0 UI Cache (§7) and
the L5 Context Cache (§6) each solve a narrow slice of this (recent selections; the original task
prompt, respectively), but there is no single, named "session context" object spanning both — named as
a gap, folded into §28 (global context reuse) rather than treated as a separate, third mechanism to
build.

---

## 6. Browser context

Real, existing mechanism, confirmed by direct file read: the **L0 UI Cache**
(`ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` §3, lines 107-113) — "Mode pills / recent selections /
prompt history already has a real implementation: the IndexedDB workflow-recall palette on
`VeriComposer`... prior work, 'browser intent cache'." This is real, client-side, browser-resident
context, already wired into the flow that feeds the API Gateway. Separately, the **L5 Context Cache**
(`AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` §2, lines 95-98) is real and **LIVE (partial)**: the original
task prompt is referenced by pointer instead of re-embedded on every resumed worker invocation
(`worker-entrypoint.sh`), confirmed by that document's own cited test evidence (`COST-CONTROL.md` Q8).
Its own honest caveat, repeated here rather than silently dropped: this pointer-reference pattern is
**not yet generalized** beyond the original-task-prompt case — other static browser/session context
(repo conventions, this very document) is not systematically pointer-referenced yet. That
generalization is named as remaining work in §28, not claimed done here.

**Real gap, independently confirmed:** grep for `localStorage`/`sessionStorage` across `src/` found
usage in 7 files (low volume) with no single, named browser-context module — each usage is local to
its own component, not part of a shared "browser context" abstraction. Named as a gap in §28.

---

## 7. PWA context

**Real, confirmed absence, not assumed:** grep for `manifest.json`, `manifest.webmanifest`, and any
service-worker registration found **zero matches anywhere in this repository**. There is no installable
PWA today, and therefore no PWA-specific context (offline queue state, install state, push-notification
subscription state) exists to reuse. This directly matches `ai-os/VERIDIAN_MOBILE_PWA_AND_VERI_CHAT_RUNTIME_2026-08-03.md`
(OCID-025)'s own real scope — that document (open on PR #766 at writing time, not re-read in full here
to avoid restating its content) is the authoritative source for what a future PWA layer would need;
this document simply confirms, independently, that no PWA context exists today to design predictive
behavior around. Any future PWA context (§28) inherits the same context-carrier gap named in §2.

---

## 8. Server context

Real, existing mechanism: every API route runs `requireAuth()` (§2) inside a Next.js 16 App Router
route handler, with Drizzle + `postgres.js` against Supabase Postgres (`compliance` schema, per
`CLAUDE.md`). Server-side context beyond auth is real but fragmented across three separate registries,
each independently confirmed this session (`ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`
§1.3, §1.4, §1.6): the `wiring_registry` table (7,918 rows, entity-relationship graph of what code/
functions/tables actually exist — `VERIFIED_MATCH` means the artifact is real, **not** that every
claim about what it's wired to is accurate, per that document's own confirmed caveat), the
`knowledge_engine` table (364 rows, artifact registry with UTM tagging), and the `system_index` table
(135 rows — the existence-check/dedup gate, queried via `scripts/superboss-register.py
check-duplicate`/`search`). These are real, live, host-level (`superboss-register.sqlite`) mechanisms
for the AI-OS governance layer's own context — they are **not** wired into the deployed product's own
request path (confirmed: grep for `utm` in `src/`/`drizzle/` found zero hits, per the wiring map's own
§1.5 correction). Server context for the product itself is therefore what §2/§9/§10 describe; the
richer registries above are governance-layer context, cited here so they are not duplicated, not
because the product reads them at request time.

---

## 9. Role context

Real, existing mechanism: `ROLE_RANK` (`src/lib/supabase/auth-guard.ts`, referenced at line 42) ranks
the real role hierarchy read from `dbUser.role`; a documented, real, previously-live bug (fixed, per
the file's own comment at lines 22-26) shows this is an actively maintained mechanism, not a stub — 6
newer roles (including `veridian_admin`, meant to be the *most* privileged) had once fallen through to
`?? 0` (the lowest rank) because `ROLE_RANK` hadn't been extended to recognize them. Role context is
real and already the correct axis for "does this user need to be asked, or does the software already
know they're authorized" — every route's `minimumRole` check (line 50) is exactly principle 1 (§1)
enforced today, at the authorization layer. This document does not change that mechanism; it names
role as one of the context facets the shared carrier (§2, §25, §28) should expose read-only, so
predictive UI (§17-§24) can hide/show actions by role without a second role lookup.

---

## 10. Organization context

Real, existing, load-bearing mechanism: `withTenantContext()` (`src/lib/db/tenant-scoped.ts:65`),
used pervasively — every write in `veri-chat-service.ts` (e.g. line 22), `dispatchTool()`'s
`(db, orgId, userId, ...)` signature (`task-execution-engine.ts:89`), and confirmed by
`ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` as the real RLS/org-scoping primitive. This
is the single most consistently-applied context mechanism found in this discovery pass — organization
context is not a gap; it is the one context facet already threaded through nearly every real write
path. §30 (multi-tenant context) restates this from the certification/governance angle rather than
duplicating the mechanism description.

---

## 11. Project context

**Real, existing mechanism, narrower than "project" implies:** `compliance.module_registry`
(Postgres, seeded via `drizzle/0017_wave20_module_registry_and_product_branches.sql`, confirmed real
per `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` §1.8) is the real, authoritative module
taxonomy an organization's enabled modules/products map to — this is the closest real analogue to
"project context" in this codebase (VERIDIAN is organized by compliance/ERP module and org, not by a
separate "project" entity distinct from `tasks`/`tickets`/`pmsIssues`, which OCID-023 already
documents in full). Where a genuine "project" concept exists (e.g. `pmsIssues` grouped under a
project), it is task context (§3) scoped by module registry, not a fourth independent context type —
named here so a future worker does not build a redundant "project context" object.

---

## 12. Function context

**Real, partial mechanism, gap named honestly:** there is no single runtime "callable-function registry
the AI can invoke" in `src/lib` — confirmed by this session's own discovery pass. The closest real
mechanisms are `TABLE_REGISTRY` (`src/lib/services/report-engine-service.ts:208`), `FORMULA_REGISTRY`
(same file, line 1379), and `dispatchTool()` (`task-execution-engine.ts:89`), each scoped to its own
subsystem (reports; task-execution tool dispatch) rather than a shared function catalog. `ai-os/FUNCTION_CATALOG.json`
is a real file but is a **static, mechanically-generated snapshot from 2026-07-20** claiming 5,019
functions — `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md` §1.9 already flags this as stale,
not live; this document does not cite specific counts from it as current. Function context — "what
function did the user just run, what functions are available to them right now given their role/org/
task" — is a real, named gap: no code path assembles that answer today. This is the direct dependency
for §18 (predictive function selection); it cannot be built until a real, live function registry
exists, which this document does not create (implementation is out of scope).

---

## 13. Report context

**Real, existing mechanism:** `report-engine-service.ts` is a real, live report registry —
`TABLE_REGISTRY` (line 208), `FORMULA_REGISTRY` (line 1379), and `getFullReportCatalog()` (line 1735)
together define what reports exist and what they compute. Report context (which report the user last
ran, with what filters, for which org) is not separately tracked beyond whatever the report's own
persisted output/run record captures — no dedicated "last report context" object was found. This is a
narrower, more tractable gap than function context (§12) precisely because the registry itself already
exists; only the "what did this user just do with it" layer is missing, named as a gap feeding §19.

---

## 14. Analysis context

**Real, confirmed absence:** grep for `ANALYSIS_LIBRARY`/`analysisRegistry` found **zero hits**. Unlike
reports (§13), there is no dedicated analysis-module registry in this codebase today — "analysis" as a
distinct, catalogued capability (separate from a report) does not yet exist as its own real
abstraction. The closest real, adjacent mechanism is `construction-prediction-service.ts` (§17), which
performs one specific deterministic analysis (completion-date prediction) without being part of any
broader analysis catalog. This is named plainly as a real gap, not worked around by redefining
"analysis" to mean "report" — §20 (predictive analysis selection) is correspondingly the most
speculative of the predictive sections below, precisely because its underlying registry does not exist
yet.

---

## 15. Work history context

Real, existing mechanism, already fully specified by OCID-023: `activityLog`/`auditLogs` tables and
TASK-04 (`ai-os/CONSTITUTION.yaml`) govern work history; OCID-023's own document (§14 "Task
auditability", §15 "Task history", §16 "Task timeline") already names the real, confirmed gap that
`recordActivity()` call sites cover the `ai_team_dispatch` activity type only — `customer_task`/
`orchestra_call` (the types that would cover real end-user work history) have **zero real call sites**
(OCID-023's own independently-confirmed finding, repeated here by citation, not re-verified a second
time). This document's own addition: work history is the raw material predictive next-best-action
(§16-§17) would read from — until the `customer_task`/`orchestra_call` gap OCID-023 names is closed,
any "predict the next action from what this user has done before" capability has an incomplete signal,
not a missing one (task-table history, e.g. `tasks.status` transitions, is real and queryable even
without the activity-log gap being closed).

---

## 16. Last known state

**Real, partial mechanism:** the L5 Context Cache (§6) is the one real, live example of "last known
state, reused instead of re-derived" — a resumed worker task reads its own original prompt by pointer
rather than re-deriving it. Outside that one case, "last known state" (what screen was the user on,
what was the last task they touched, what was the last report/function/analysis they ran) is **not**
centrally tracked — each subsystem may have its own local notion (e.g. a task's own `status` field is
its own last-known-state), but there is no cross-subsystem "last known state" object a predictive
layer could read from once. Named as a gap, and as the concrete precondition for §17.

---

## 17. Next best action

**Real, existing, deterministic (not ML) example:** `construction-prediction-service.ts:1-13` predicts
a completion date from velocity averages, explicitly documented in its own code as "no regression/ML
model" — this is real prior art for the *style* next-best-action logic in this codebase should follow:
deterministic, explainable, grounded in real historical data, not a black-box model. **No general
next-best-action mechanism exists today** — confirmed by grep (zero matches for "next best" /
"nextBestAction" style identifiers outside this document). Given §15's and §16's gaps (work history
and last known state are each only partially tracked), a real next-best-action feature has two real
dependencies to close first, named here rather than glossed over: (1) close the `customer_task`/
`orchestra_call` activity-log gap OCID-023 names, and (2) build the shared context carrier named in
§2/§25/§28. This document defines the target behavior (§1 principle 3) and its real dependencies; it
does not implement the feature.

---

## 18. Predictive function selection

Depends directly on §12 (function context), which is a named gap, not a real registry today. The
correct sequencing, stated here so a future implementer does not build this out of order: a live
function registry must exist before predictive selection over it is meaningful. `dispatchTool()`
(`task-execution-engine.ts:89`) and the mode-pill/path-key lookup (`task-execution-engine.ts:1908-1915`)
are the real, narrow existing precedent — the *current* mode pill already narrows which capability is
looked up, which is a real, working instance of "software already knows enough context to narrow the
next choice," just not yet generalized to a full function catalog.

---

## 19. Predictive report selection

More tractable than §18 because the underlying registry (§13, `report-engine-service.ts`) is real and
live today. No predictive layer exists on top of it yet (confirmed: `getFullReportCatalog()` at line
1735 returns the full catalog, not a per-user/per-context ranked subset) — this is a real, scoped,
buildable gap: rank `TABLE_REGISTRY`/`FORMULA_REGISTRY` entries by the user's real, verified context
(role §9, org §10, module §11, recent report runs §13) rather than presenting the full catalog
unranked. Named as a concrete, near-term implementation candidate — not implemented here.

---

## 20. Predictive analysis selection

Blocked on §14 (analysis context/registry does not exist). This document names the dependency rather
than proposing a design for a registry that does not yet exist — doing so would be exactly the
"new architecture" this document is prohibited from creating. Once a real analysis registry exists
(out of scope here), the same ranking approach named in §19 would apply.

---

## 21. Predictive mode pills

**Real, existing, already-predictive mechanism**, not a gap: `deriveCapabilityKey(modePill, pathKeys)`
(`src/lib/services/capability-learning-service.ts:27-31`) already derives a capability key from the
active mode pill and path selection, and `ChainSelector.tsx` (`src/components/veri-chat/ChainSelector.tsx:3`)
is real UI described in its own header as a "mode pill + cascading path picker." The L0 UI Cache (§6)
already persists "mode pills / recent selections" client-side (IndexedDB, on `VeriComposer`). Together
these are real, working predictive-mode-pill infrastructure: the system already narrows which mode
pill is likely next based on recent client-side selections. What is **not** yet real: that narrowing is
client-side/recency-based only — it does not yet also weight by the server-verified context this
document names elsewhere (role, org, current task). Named as a refinement, not a missing feature.

---

## 22. Predictive option chain

**Real, confirmed absence of the literal concept**, with a real, close analogue: grep found zero
matches for "option chain" anywhere in `src/`. The closest real, functioning equivalent is **Dynamic
Chains** — `src/app/api/dynamic-chains/route.ts:1-25` and `dynamic-chain-directory-service.ts`'s real
`searchChains()`/`detectMissingChain()` functions. A "chain" in this codebase already is a
server-tracked, searchable sequence of steps, and `detectMissingChain()` is itself a real, working
piece of predictive logic (it flags when no existing chain matches an intent, which is the negative
case of "predict the next step"). This document records the terminology mapping (the directive's
"option chain" = this codebase's real "dynamic chain") so a future worker does not build a second,
parallel concept under the "option chain" name — extending Dynamic Chains' existing search/detection
logic to rank *predicted* next chains (not just match on explicit search) is the real, scoped gap.

---

## 23. Predictive form population

**Real, confirmed absence as a named mechanism**, but real, verified context already exists to power
it: org (§10), role (§9), user identity (§2), and current task (§3) are all already available,
verified, server-side at request time via `requireAuth()`/`withTenantContext()`. No form-population
layer was found that reads this available context to pre-fill fields — every form today presumably
requires the user to select/type org-scoped values the server already knows. This is the most direct,
literal instance of principle 2 (§1): "the user is never asked to re-enter information that already
exists" is a real principle this document states but, per this discovery pass, is **not yet uniformly
true in the product**. Named as a real, concrete, and likely high-value gap — not implemented here.

---

## 24. Predictive navigation

**Real, confirmed absence:** grep found no predictive-navigation mechanism. The nearest real, adjacent
signal is work history (§15) and task state (§3, via OCID-023) — once the activity-log gap OCID-023
names is closed, "where does this user usually go after completing a task of this type" becomes
answerable from real data. Named as a gap dependent on §15, not designed further here.

---

## 25. Software context validation

**Real principle, partially real mechanism:** "software always knows the verified context before
making a decision" (this task's own mandatory execution principle, restated in §1) is enforced today
*only* at the authorization boundary — `requireAuth()`/`ROLE_RANK`/`withTenantContext()` (§2, §9, §10)
genuinely validate identity, role, and org before any write. It is **not** enforced as a general
principle beyond authorization: nothing in this codebase validates, before a predictive suggestion or
an AI escalation, that the context being used is actually current and verified (as opposed to stale
client-side state). This is the real target for a **shared context carrier** (§2, §4, §28): a single
place that stamps context as "verified, as of request time" so every downstream consumer (chat,
prediction, AI prep) can check that stamp rather than trusting whatever was passed to it.

---

## 26. AI context preparation

**Real, existing, and load-bearing:** `ai-os/AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` §4 ("WATERTIGHT
PROMPT TEMPLATE — mandatory for every AI-bound prompt") is the real, existing governing document for
this exact concept — this document does not restate its content, only confirms it exists and is the
authority. `AssembledContext`/`BusinessContext`/`UserContext` (`src/lib/prompt-compiler/context-assembly.ts:1-9`,
a confirmed real port of a prior Python `context_engine.py`, with `RelevanceScorer`/`ContextWindow`
types) is real, live code that assembles exactly this kind of prepared context before a prompt is
built. `MotherRouterContext` (`src/lib/ai-router/mother-router.ts:594`), consumed by `resolveModel()`,
is the real context object that determines which model/provider handles a request — `scope:
software_team | end_user_org | sales_marketing` (line 152-178), with a fourth `customer_success` scope
already typed but explicitly flagged in the file's own comment as having "no real dispatch call site
wired to it yet" (lines 180-184) — named here as a real, already-self-documented gap, not newly
discovered. AI context preparation is real and reasonably mature on the model-routing side; its real,
named gap (§4) is that VERI Chat itself does not yet feed into it.

---

## 27. AI context minimization

Directly governed by the same `AI_CACHE_AND_TRIAGE_ARCHITECTURE.md` §4 template (§26) — minimization
(sending only what the model needs, not a full history) is the explicit purpose of `RelevanceScorer`/
`ContextWindow` (`context-assembly.ts`) and of the L5 Context Cache's pointer-reference pattern (§6):
referencing the original task prompt by pointer instead of re-embedding it in full on every resumed
invocation is minimization in practice, already live for that one case. The same §6 caveat applies
here without repeating it: not yet generalized beyond that one case.

---

## 28. Global context reuse

This section names, once, the single real gap repeated by reference throughout this document rather
than restated at each site: there is **no shared, request-scoped context carrier** threaded through
auth (§2), chat (§4), session (§5), browser (§6), task execution (§3), and AI preparation (§26) today.
Each subsystem independently derives the slice of context it needs from its own inputs
(`requireAuth()`, `withTenantContext(ctx)`, `dispatchTool(db, orgId, userId, ...)`,
`VeriChatContext{orgId,userId}`, `MotherRouterContext`) — all real, all correctly tenant-scoped, but
each a **separate derivation**, not reads of one canonical object. This is not framed as a design flaw
requiring urgent rearchitecture — the tenant-scoping discipline (§10) is consistently and correctly
applied everywhere it matters for data isolation — but it is the real, named precondition for every
predictive section above (§17-§24) and for closing the "never ask the user to repeat themselves"
principle (§1, §23) generally rather than case-by-case. Global context reuse is the readiness target
this document sets for OCID-035 and beyond (§36); it is not implemented here.

---

## 29. Multi-brand context

**Real, confirmed:** this repository (`compliance-tracker`) operates under a single brand today —
`CLAUDE.md`'s own header states `Brand: VERIDIAN AI | Product: Veridian AI`. No second brand, white-
label surface, or brand-switching context was found anywhere in `src/`. `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`
§2 separately flags "VAIOS Layer 1-4" multi-tenant/multi-brand coverage as **not verified** in that
pass either. A real, adjacent-but-distinct axis exists and should not be conflated with brand:
multi-country/jurisdiction compliance-engine config (India + UAE wired, per prior work) is a real,
separate abstraction with its own registry, and that registry has **zero production callers** as of
the most recent check on record — jurisdiction context, not brand context. Multi-brand context is
named here as **not applicable to this codebase today, and not designed** — inventing a multi-brand
context model for a single-brand product would be exactly the "new architecture" this document is
prohibited from creating.

---

## 30. Multi-tenant context

Real, existing, and the most consistently-applied context mechanism found in this entire discovery
pass — restated by reference to §10 rather than duplicated: `withTenantContext()`
(`src/lib/db/tenant-scoped.ts:65`) is the real RLS/org-scoping primitive used pervasively across chat
writes, task dispatch, and (per `CLAUDE.md`'s own rule) every API route's data access. Nothing in this
document's discovery pass found a multi-tenant isolation gap — this matches the independently-confirmed,
positive multi-tenant isolation finding already on record elsewhere in this session's own chain (PR
#747: two real orgs, cross-org data leakage tested and not found on `/api/departments`). This document
does not re-run that test; it cites the existing, real result rather than re-deriving it.

---

## 31. Context synchronization

**Real, confirmed absence of a dedicated mechanism**, distinct from data synchronization more broadly
(which OCID-023 §28 "Task synchronization" already covers for task state specifically). Context
synchronization in this document's sense — keeping the *same* verified context consistent across
browser, server, and AI layers within one user session — has no dedicated mechanism today, precisely
because no shared context carrier exists yet (§28). Each layer's context is independently correct at
read time (per §2/§9/§10's real tenant/role scoping) but there is no cross-layer freshness or
consistency guarantee beyond "each layer re-derives its own slice correctly." Named as a gap that
depends on §28 being closed first — not a separate mechanism to build in parallel.

---

## 32. Context traceability

**Real, existing, and load-bearing at the governance layer:** the `knowledge_engine` table (364 rows)
and its UTM tagging convention (`utm_source/medium/campaign/content/term`, confirmed real on both
`knowledge_engine` and `capability_registry`, per `ai-os/EXISTING_MODULE_ENGINE_WIRING_MAP_2026-08-02.md`
§1.4-§1.5) is real, live context/artifact traceability — but confirmed, by that same document's own
correction, to be a **host-level `superboss-register.sqlite` convention only**, with **zero hits** for
`utm` in the deployed product's own `src/`/`drizzle/` schema. Product-level context traceability (which
verified context fact led to which predicted action, traceable after the fact) does not exist as a
distinct mechanism today — the closest real analogue is `auditLogs`/`activityLog` (OCID-023 §14),
which traces actions, not the context that predicted them. Named as a gap that only becomes buildable
once §17's next-best-action mechanism itself exists (there is nothing to trace yet).

---

## 33. Context governance

Real, existing, and this document is itself an instance of it: the UMR chain (§0, this document's own
header), `ai-os/CONSTITUTION.yaml`'s `SEC-07` (the real implementation lock, correctly cited in §0 in
place of the non-existent "OCID-021" label), and the PM overlap-resolution decision
(`UMR-20260803-045159-ec55`, applied in §0a) together are the real governance mechanism this document
itself follows. No separate "context governance" body or process needs to be invented — it is the same
UMR/CONSTITUTION/ACTIVE-CLAIMS discipline already governing every other artifact in this chain, applied
here to context-and-prediction content specifically.

---

## 34. Context certification

**Explicitly not claimed here, per this task's own "prohibited" instruction and consistent with
`SEC-07`:** this document does not certify that context reuse or prediction works end-to-end in the
live product — it certifies only that the *real, cited* mechanisms above exist or do not, as
independently confirmed at writing time. Certification of behavior (does the system actually avoid
re-asking the user, does prediction actually reduce clicks) requires live E2E verification, which
`SEC-07` correctly locks behind OCID-020/038/039 completing first, in that order. This document is
input to that future certification pass, not a substitute for it.

---

## 35. Performance targets

**No existing performance target for context assembly or prediction latency was found** — confirmed by
grep (no SLO/budget constant named for context assembly, mode-pill prediction, or AI context
preparation specifically). Real, adjacent existing targets do exist and should be the reference point
for setting one later, rather than this document inventing a number with no evidence behind it: the
Mother Router's in-process policy cache (`POLICY_CACHE_TTL_MS`, `mother-router.ts:53-63`) is the one
real, named latency-relevant constant found in this discovery pass. Setting an explicit context-
assembly/prediction latency target is named here as follow-up work for whichever OCID actually
implements this document's design (OCID-035 or later, §36) — not set here, to avoid stating an
unverified number as if it were a real, tested target.

---

## 36. Readiness for OCID-035

This document's real, honest readiness statement, per this task's own required output:

- **What is ready to hand off:** a complete, cited inventory of what context/prediction mechanism
  already exists (§2, §4, §6, §9, §10, §12-§13, §17, §21-§22, §26-§27, §30, §32) versus what is a real,
  named gap (§5, §7, §11, §14, §16, §18, §20, §23-§25, §28-§29, §31, §33-§35), with the single
  highest-leverage shared gap (§28, the missing shared context carrier) named once and referenced by
  every dependent section rather than restated.
- **What is explicitly not ready, and correctly so:** any implementation. `SEC-07` keeps
  implementation/gap-closure locked behind OCID-020's independent verification (§0), which remains open
  as of writing (per `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md` §5's own
  non-certification list, not re-verified a second time here since that document's own finding is
  current and load-bearing).
- **Real dependency for whichever OCID picks up predictive/context implementation next:** read this
  document's §28 (shared context carrier) and §12/§14 (function/analysis registries not yet existing)
  before designing — those are the two structural preconditions every predictive section above (§17-§24)
  depends on. A worker that starts implementing predictive function or analysis selection without those
  two in place will be building on top of gaps this document has already named, not new discoveries.
- **Zero-duplication confirmation, restated from §0a:** no other OCID in this chain, merged or open, as
  of writing, defines context reuse or prediction as its subject. This document is the first and only
  canonical artifact for that ground.

Canonical artifact created: this file
(`ai-os/VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md`). Amends the existing UMR
chain (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, `ai-os/OS.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml`);
does not start a new one.
