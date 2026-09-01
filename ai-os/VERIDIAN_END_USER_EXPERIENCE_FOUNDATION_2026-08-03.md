# VERIDIAN End User Experience Foundation — v1.0

**UMR:** `UMR-20260803-040844-4a33` (OCID-20260803-022, real dispatch UMR — corrected
2026-08-05 per `UMR-20260805-083603-9efa`; this document originally self-minted a separate,
fabricated "artifact UMR" (`UMR-20260803-041653-9de5`) that was never really registered
anywhere, believing it followed established convention; see
`ai-os/MASTER-TRACKER.yaml`'s `GAP-SELF-MINTED-ARTIFACT-UMR-FABRICATION` entry for the full
verification method and precedent). Parent: `UMR-20260802-173631-ca85`
(ERP Functional Completeness Master Program). Extends, not replaces, the existing master
program — no new program, no new audit. Cites and does not amend the substance of:
`UMR-20260802-165606-4413` (OCID-020, PROJEXA end-user certification directive),
`UMR-20260802-164659-9a31` (server-artifact traceability audit),
`UMR-20260802-165034-5747` (standing gatekeeper rule),
`UMR-20260802-165434-cd91` (unified project memory model),
`UMR-20260802-165541-c27d` (recovery framework).

**Status: documentation only.** This artifact implements no code, changes no database, changes
no UI, changes no UX. Every claim below is either (a) real, live, evidenced state as of
2026-08-03, cited to a file:line or an existing canonical artifact, or (b) an explicitly
labeled gap already on record elsewhere in this repo's own governance trail — nothing here is
invented, redesigned, or proposed as new architecture.

**Discovery method:** two independent research passes against live server state (UI/UX +
navigation shell; VERI Chat/VERI Assistant + multi-tenant/brand gating), cross-checked against
`ai-os/CONSTITUTION.yaml`, `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` (the real, live UMR
chain this document extends), `VERI_CHAT_GOVERNANCE.md`, `VERIDIAN_DMP_DCF_CONSTITUTION.md`,
`ai-os/audit-tree/09-onboarding-ux.yaml`, `ai-os/system-tree/20-projexa.yaml`, and
`ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md` — not re-derived from memory.

**Honest disclosure on this document's own directive**: the originating task prompt cites an
"OCID-021 implementation lock... gating real implementation until OCID-020 is independently
verified complete." The real OCID-021 (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, amendment
dated 2026-08-03) is the Category A/B production-DB governance split (`SEC-06`) — already
closed/merged, topically unrelated to end-user UX, and not an "implementation lock" on
anything. `UMR-20260802-165606-4413` is the real UMR for OCID-020 itself, not OCID-021. OCID-020
is also, separately, confirmed **not yet independently verified complete** (this repo's own
`PROGRESS.md`, most recently inherited from `task-20260802-210700`, states the ERP master
program "stays locked until this fix AND the rest of the real certification sweep are
independently verified complete"; the certification sweep's own most recent
`ai-os/boss/ACTIVE-CLAIMS.yaml` entries show it `blocked`, not closed). Neither discrepancy
changes what this task was asked to do — produce one documentation-only artifact — so it did
not block this work; it is recorded here, and in this session's `ACTIVE-CLAIMS.yaml` entry, for
the Owner's awareness rather than silently corrected into the directive's own text.

---

## 1. Mission and non-negotiable baseline

This is not a new ERP, not a new product, not a new architecture. VERIDIAN is the complete
platform, the single integrated backend, and the single source of truth: all business logic,
databases, tables, business rules, workflow rules, reports, analysis, prompts, AI capabilities,
VERI Chat capabilities, and VERI Assistant capabilities belong to VERIDIAN. FChecklist
compliance-tracker, FChecklist PROJEXA, and every repository under FChecklist are one logical
system, not independent products. `projexa-ai.com` is the first brand of VERIDIAN and a thin
client — the backend is always VERIDIAN; future brands reuse the same backend; UI/UX stay
common, only branding, industry configuration, and role experience differ.

**The end user is the king.** Every design decision in this document is evaluated from the end
user's perspective. The end user should never need to understand ERP, AI, or VERIDIAN as
concepts — they should see only their own brand and experience one simple product.

This document does not redesign, rebuild, replace, or duplicate anything. It is a synthesis of
what already exists, written from the end user's vantage point, so that future OCIDs have one
canonical place to check "what does the end user actually see today" before dispatching any
UX-affecting work.

---

## 2. What the end user actually sees today (real, live, cited)

### 2.1 The app shell — one product, many modules, no VERIDIAN/ERP jargon in the nav itself

`AppSidebar.tsx` (`getNavSections()`, lines 112-529) renders roughly 24 sections and well over
100 individual links from the end user's point of view — Overview, Reports & Analysis,
Sales/CRM, Projects, Construction, Finance/ERP, Compliance, Governance, Company Secretarial,
Legal, People & HR, Risk, Sector Regulators, Audit, Third-Party/ESG, Integrity, Incidents,
Access & Approvals, Admin, and a Tools group (Checklists, Tasks, Penalty Tracker, Team, Help
Centre). Five links are pinned above the section list at all times (lines 589-597): Home,
Dashboard, Chat, Connectors, Agents/FDE. `AppTopbar.tsx` adds real-time search (line 186), a
notifications dropdown (lines 111-141), a user menu (Profile/Settings/Sign-Out, lines 143-178),
a persistent "Invite a team member" control on every screen (lines 194-206, citing onboarding
directive U-D28), a theme toggle, and a language switcher. Both components wrap the shared
`@fchecklist/veridian-ui-kit/shell` package (`AppSidebar.tsx:6`, `AppTopbar.tsx:15`) — the same
shell primitives PROJEXA itself reuses (§2.6 below).

**What actually gates which sections a given end user sees is org-type and module-enablement,
not end-user role**: `accountType` (line 126, e.g. company vs. firm), `pmsEnabled` (line 175),
`firmEnabled` (line 224). Finance/ERP and Sales/CRM sections render unconditionally today — the
code comment at line 232 states plainly "no erpEnabled flag exists" for nav-level gating (the
gating that does exist for those modules happens one layer down, at the API, per §3.3 below).
Real, live: "one backend, different modules visible per org" already works. Not yet real:
"different modules visible per end-user role" — the codebase has a separate, real per-user
role/rank system (`src/lib/supabase/auth-guard.ts:28-55`, `ROLE_RANK`, `hasRole()`/
`requireRole()`) but it gates API routes only; a grep of `AppSidebar.tsx` for `role` returns
zero hits. This is a real, named gap, not previously written down as a distinct end-user-facing
item anywhere else in this repo's governance trail — see §3.6.

### 2.2 Dynamic Mode Pills + Chain Selector — intent-based navigation, not a rigid menu tree

`ai-os/CONSTITUTION.yaml` §6 (`navigation_and_intent`, lines 297-347) is the authoritative rule
set; `VERIDIAN_DMP_DCF_CONSTITUTION.md` is its narrative source. The design intent: pills and a
cascading Chain Selector, computed live per org (not hardcoded), are the flexible instruction
interface end users use instead of memorizing a menu tree — chat and structured pills are two
entry points into the same underlying capability graph. Real mechanism:
`capability-tree-service.ts::buildCapabilityTree()` serves `GET /api/capability-tree`, rendered
by `VeriComposer.tsx` and `ChainSelector.tsx` (399 lines) with an `IntentCommandPalette.tsx`
(197 lines) as a keyboard-driven variant.

Rule-by-rule real status, per the constitution's own machine-readable tags (not restated as new
claims — each `status:` value below is quoted directly from `CONSTITUTION.yaml`):

| Rule | What it means for the end user | Status |
|---|---|---|
| DMP-01 | Pills/Chain Selector render live, per-org, not hardcoded | **ENFORCED** |
| DMP-02 | Every activity is chain-classified | **PARTIALLY_ENFORCED** — true only for tasks/conversations created *through* the Chain Selector; chats generally, reports, and workflows have zero capability-tree lookup |
| DMP-03 | The chosen chain is persisted on the activity it classifies, so permissions/approvals/notifications/audit could eventually all derive from one reference | **PARTIALLY_ENFORCED** — only carries dispatch routing today, not permissions/approvals |
| DMP-04 | "My Option Is Not Available" never silently fails — it's captured and routed for review | **ENFORCED** (`fde-service.ts::submitFdeRequest()`) |
| DMP-05 | Per-screen adaptive pills + a personalized library of frequent chains | **NOT_YET_BUILT** — confirmed zero "library" concept anywhere in the codebase |
| DMP-06 | A Dynamic Chain Master Directory with duplicate/broken/obsolete chain detection | **POLICY_ONLY** — the graph substrate (`entity_relationships` table) exists with zero chain-relationship rows written |

### 2.3 VERI Chat and VERI — real conversational path, one confirmed asymmetry

Conversation-level chat has a real, live, production LLM round trip:
`src/app/api/conversations/[id]/messages/route.ts` → `chat-service.ts::sendMessage()` →
`generateAiReply()` (chat-service.ts:613) → `resolveModelConfig(orgId, "user_assistant_oa")`
(`orchestra-model-resolver.ts`) → `llm-client.ts::callLLM()`, which makes real `fetch` calls to
`api.anthropic.com` and `openrouter.ai`. Before the model is called, real deterministic gates
run in order: policy enforcement, a deterministic-route check, a dialogue-script check, then
floor-tier escalation and a post-call low-confidence retry, a software-first reply gate, and
audit logging (`recordOrchestraExecution`) — matching `CONSTITUTION.yaml` §5's software-first
rule (SF-01, **ENFORCED**: deterministic path first, AI is the fallback, not the default).

**Confirmed, still-real asymmetry**: `src/app/api/tasks/[id]/chat/route.ts` (47 lines) only
inserts the user's own message into `taskChatMessages` and returns — no LLM call anywhere in
that file. An end user typing into a task's chat thread gets no AI reply; the identical action
in a conversation thread does. This matches `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 6
and Stream G exactly — not a new finding, confirmed still accurate by direct read of the route
file.

VERI's own identity rules (`CONSTITUTION.yaml` §7, `veri_identity`, lines 349-382;
`VERI_CHAT_GOVERNANCE.md`) matter directly to the end user experience: VERI ("Your Assistant")
has its own dedicated 1:1 thread and is a distinct identity from VERI Chat (the multi-party
human/guest messaging surface) — VERI participates in VERI Chat only when a human invites it,
and, per `VERI_CHAT_GOVERNANCE.md`, "reads, summarizes, recommends — never auto-acts." VERI-03/
VERI-05 (**ENFORCED**): VERI never auto-creates, auto-assigns, or auto-sends without approval,
never impersonates, never claims to have completed an action it did not take, and every
VERI-initiated action is traceable. VERI-04 (**POLICY_ONLY**): a rule that new conversations
require at least a 2-level Mode Pill/Chain Selector before creation exists in the constitution
but no conversation-creation flow currently enforces it.

### 2.4 The approval experience for high-impact actions

Directly relevant to end-user trust: `CONSTITUTION.yaml` §4 (`human_ai_boundary`) and its HAB
rules describe what an end user actually sees when VERI or the platform proposes something
consequential. HAB-04 (**ENFORCED**): the approval interaction is a real menu — Approve Once /
Edit & Approve / Reject / Always Approve for this type — persisted per user and revocable, not a
binary Confirm/Cancel decided fresh every time (`approval_preferences` table). HAB-02
(**PARTIALLY_ENFORCED**): 9 categories of high-impact action (delete/archive/payment/approval/
rejection/compliance_submission/access_changes/data_export/configuration_changes) require
explicit end-user confirmation via `checkHighImpactConfirmation()`; the gap is that this is
wired at one real call site (`task-service.ts::createTask`), not as unconditional middleware
across every route yet.

### 2.5 Multi-tenant isolation — invisible to the end user by design, and real

`withTenantContext()` (`src/lib/db/tenant-scoped.ts`) sets real Postgres session GUCs under a
dedicated `app_runtime` role (not the RLS-bypassing `postgres` role) and is called in 49/51
service files; RLS is enabled on 64+ tables. This is exactly what the end user should never have
to think about — one org's data never surfaces in another's session — and it is real and live,
not aspirational (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 8, ~75%, no table-by-table
audit yet but the mechanism itself is real and actively used).

### 2.6 Multi-brand reality — the fields exist, the routing does not yet

`drizzle/0221_wave_b_white_label_branding.sql` adds five real columns to `organisations`:
`brand_primary_color`, `brand_accent_color`, `favicon_url`, `custom_domain`, `email_sender_name`
(mirrored in `src/lib/db/schema.ts`). `org-branding-service.ts` is the single normalization
point for these fields, with real defaults (`#1C2B3A`/`#F5820A`). **Confirmed by direct read of
that service's own comments**: there is no tenant-routing middleware yet — `customDomain` is
stored but not routed on; branding resolves only per-org, after login, not by host header on
anonymous/public pages. The migration's own header and a live query both confirm zero adoption:
every existing org has all five columns `NULL`. This matches
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 9 (~15%) and Stream E exactly.

### 2.7 PROJEXA as the first brand — a real thin client, with a real current routing gap

`ai-os/system-tree/20-projexa.yaml` (rule PRX-01) confirms PROJEXA's own backend genuinely is a
thin client in the way the brand baseline describes: `callVeridian()` proxies real work to
compliance-tracker's `/api/v1/projexa` surface; PROJEXA's own database holds only tenant/auth/
chat plumbing, with zero LLM SDK calls of its own. This part of the brand baseline is real
today, not aspirational.

**However**, the live domain `projexa-ai.com` does not currently serve the PROJEXA thin client
at all. Per the Wave 10 domain revert (`UMR-20260802-134939-145d`, `ai-os/boss/COMPLETED.yaml`
`WAVE-10-REDO`), `projexa-ai.com`/`www.projexa-ai.com` are bound to the `veridian-compliance-ai`
Vercel project directly — real page title `VERIDIAN COGNITIVE AI OS`, "PROJEXA" absent from the
rendered page. This is a deliberate, Owner-decided, already-documented state (not a bug this
document is raising for the first time), but it means the brand baseline's own "one brand, one
simple product" promise is not fully realized on the one live public domain today: a visitor to
`projexa-ai.com` currently sees VERIDIAN's own generic shell, not a PROJEXA-branded experience.
The standalone PROJEXA thin client itself is reachable at `projexa-smoky.vercel.app`.

The most recent real, authenticated end-to-end certification pass on `projexa-ai.com`
(`ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md`, OCID-020) found, and this document
does not re-litigate or re-fix, three concrete end-user-facing findings:
- **Finding A** — a real, reproducible client-side crash on the Compliance Register and Pendency
  View, root-caused to an unnamed Drizzle relation pair between `departments` and `users`.
  **Already fixed** and merged (PR #747, per `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s own
  2026-08-02 amendment) — cited here for completeness of the end-user picture, not as an open
  item.
- **Finding B** — a fresh self-signup org sees CRM and ERP module shells render, but every
  backing API call silently `403`s with no "this module isn't enabled for your organization,
  contact your admin" messaging. **Still open**, not addressed by this document. See §3.2.
- **Finding D** (same certification pass) — the VERI Chat composer on the live site is
  chip/pill-gated rather than free-text-first, i.e. an end user cannot simply start typing a
  question without first navigating a Mode Pill/Chain Selector path. Recorded here as a real,
  current observation of the live product; not independently re-verified by this document's own
  discovery pass beyond citing the certification doc.

---

## 3. Known gaps that affect the end user experience specifically (catalogued, not fixed)

This document implements nothing. Every gap below already exists in this repo's own governance
trail (cited), or is newly *named* here as a documentation-only observation because no prior
artifact had stated it from the end-user-experience angle specifically. None of these are
proposed as new architecture — each maps to an already-existing real file/table/service that a
future, separately-dispatched OCID would extend.

### 3.1 Task-level VERI Chat has no AI reply
`src/app/api/tasks/[id]/chat/route.ts` inserts the user's message and stops — no LLM call.
Already tracked as `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 6 / Stream G. Not fixed here.

### 3.2 Silent 403s for modules a fresh org hasn't enabled
CRM and ERP page shells render for a brand-new self-signup org; their backing APIs 403 with no
explanatory UI. Already tracked as `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` "Finding B" /
Stream E's adjacent scope. Not fixed here.

### 3.3 Six unbuilt VERI Chat composer UX items
Sidebar↔composer sync, overlay/backdrop, breadcrumb reposition, per-segment ×, external-AI
handoff link, resizable composer — named in `VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md`
and already tracked as `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 2 / Stream I. That spec's
own source is explicitly a local-only static HTML mockup, never built or deployed — cite it as
design intent, not as already-shipped. Not fixed here.

### 3.4 Composer is chip-gated, not free-text-first, on the live site
Per `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md` Finding D (§2.7 above). Not fixed
here.

### 3.5 Multi-brand fields exist but nothing renders them and no domain routes on them
Per §2.6/§2.7 above — zero adoption, no host-header resolution, `projexa-ai.com` itself
currently serves the generic VERIDIAN shell rather than a PROJEXA-branded one. Already tracked
as `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 9 / Stream E. Not fixed here.

### 3.6 Nav-level module visibility is gated by org type, not end-user role — newly named here
Confirmed by direct read of `AppSidebar.tsx` (zero references to `role`) against the real,
separate `ROLE_RANK`/`hasRole()` system in `src/lib/supabase/auth-guard.ts`, which gates API
routes but not sidebar rendering. This is consistent with, but distinct from, the org-type
gating documented in §2.1 — no prior artifact in this repo's governance trail had named this
specific role-vs-nav gap from the end-user-experience angle. Not fixed here; named so a future
OCID can scope it without rediscovering it.

### 3.7 Onboarding UX spec is design intent, not yet fully built
`ai-os/audit-tree/09-onboarding-ux.yaml` transcribes the Owner's own onboarding requirements —
"VERIDIAN AI is no longer a compliance tool," a Mode Pills-driven welcome flow, auto-connectors,
an always-visible invite-team-member control (already real, §2.1), Google-first sign-in,
passcode-not-password. Cited here as the aspirational source for a future onboarding-completeness
OCID to check against — not restated as already-shipped fact.

### 3.8 Dynamic Mode Pills: two structural gaps still open
DMP-05 (per-screen adaptive pills, personalized chain library) is **NOT_YET_BUILT**; DMP-06 (a
Dynamic Chain Master Directory with duplicate/broken-chain detection) is **POLICY_ONLY** with a
ready-but-empty graph substrate. Both per `CONSTITUTION.yaml` §6, already tracked there — not
re-litigated here, cited for completeness of the end-user navigation picture.

---

## 4. End user experience principles (consolidated from existing, real governance — not new rules)

These are not new policy. Each principle below already exists, in force, somewhere in this
repo's real constitution or governance docs; this section exists only to give a future OCID one
place to check "does this change respect the end-user-facing rules already in effect" before
touching any UI/UX surface.

1. **One backend, one brand per visitor.** VERIDIAN is always the engine; the end user's own
   organization's brand configuration (or, until §2.6/2.7 close, the current default VERIDIAN
   shell) is what they see. No end user should ever be shown "ERP," "AI orchestration," or
   "VERIDIAN" as a concept they need to understand to get their own work done.
2. **Software first, AI as fallback** (`CONSTITUTION.yaml` SF-01, **ENFORCED**). Deterministic,
   predictable behavior is what an end user gets by default; AI free-text reasoning is invoked
   only when no deterministic path exists.
3. **Every high-impact action gets a real choice, not a rubber stamp** (HAB-04, **ENFORCED**):
   Approve Once / Edit & Approve / Reject / Always Approve, persisted, revocable.
4. **VERI never acts unasked, never impersonates, never claims false completion, and is always
   traceable** (VERI-03/VERI-05, **ENFORCED**).
5. **Intent-based navigation (Mode Pills/Chain Selector) is the intended primary interface**,
   with the traditional nav sidebar as the always-available structural fallback — real and live
   for pill rendering and chain-fallback capture (DMP-01/DMP-04, **ENFORCED**), still maturing
   for full chain classification and per-screen adaptivity (DMP-02/03/05, **PARTIAL/NOT_YET**).
6. **A module a user's organization hasn't enabled should say so, not fail silently** — this is
   the honest gap named in §3.2/§3.6, not yet a real, enforced principle in the codebase, but
   consistent with every other confirmation/approval pattern already enforced elsewhere in this
   constitution (principle 3 above); named here as the standard a future fix should meet.

---

## 5. Handoff to a future OCID-023

This document is the first canonical end-user-experience foundation artifact for the VERIDIAN
platform. It implements nothing and blocks nothing that was not already blocked. A future
OCID-023 (or any later-numbered directive) that wants to close any of the gaps catalogued in
§3 — task-level VERI Chat reply generation, module-not-enabled messaging, the six composer UX
items, free-text-first composer entry, multi-brand rendering/routing, role-based nav gating, or
onboarding-flow completion — can cite this document as its baseline "what does the end user see
today, and where exactly is the gap" reference, instead of re-running discovery from zero. Per
this repository's own standing gatekeeper rule (`UMR-20260802-165034-5747`), any such future
directive must re-verify live state before dispatching real implementation work — this document
is a point-in-time synthesis (2026-08-03) and will go stale as real work lands, exactly like
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` and every other point-in-time audit already
cross-referenced above.

**Not acted on.** No implementation, database change, UI change, or UX change has been made
under this UMR. Awaiting Owner review, consistent with the OCID-020 implementation lock this
directive was scoped to respect.

Canonical artifact: this file, `ai-os/VERIDIAN_END_USER_EXPERIENCE_FOUNDATION_2026-08-03.md` —
new, not a duplicate of any existing file (confirmed via the gatekeeper check recorded in this
session's `ai-os/boss/ACTIVE-CLAIMS.yaml` entry).
