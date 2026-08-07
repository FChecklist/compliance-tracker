# VERIDIAN Universal Organization Runtime — v1.0

**Directive:** OCID-20260803-029 (Owner directive, tier 1). This document's own dispatch prompt
did not supply a distinct UMR id for OCID-029 itself, only its citation chain — recorded here
honestly rather than inventing one. Parent: `UMR-20260803-041257-e9c3` (OCID-028 directive, just
registered). Cites, without amending the substance of: `UMR-20260803-040844-4a33` (OCID-022),
`UMR-20260803-040929-9713` (OCID-023), `UMR-20260803-041000-70ae` (OCID-024),
`UMR-20260803-041047-03ee` (OCID-025), `UMR-20260803-041122-b22d` (OCID-026),
`UMR-20260803-041211-b7b7` (OCID-027), `UMR-20260802-173631-ca85` (ERP Functional Completeness
Master Program), `UMR-20260802-165606-4413` (OCID-020, PROJEXA end-user certification),
`UMR-20260802-164659-9a31` (server artifact traceability audit), `UMR-20260802-165034-5747`
(standing gatekeeper rule), `UMR-20260802-165434-cd91` (unified project memory model).

**Status: documentation only.** This artifact implements no code, changes no database, changes
no UI. Every claim below is either (a) real, live state as of 2026-08-03, cited to a file:line,
or (b) an explicitly labeled gap. Nothing here is invented, redesigned, or proposed as new
architecture — per this directive's own Primary Execution Rule, this document reuses, enhances
(in description only), wires (in description only), and standardizes the description of what
already exists.

**Honest disclosure on "the OCID-021 implementation lock" cited in this directive's own prompt:**
per `ai-os/CONSTITUTION.yaml` `SEC-07` (registered 2026-08-03 by real PM decision
`UMR-20260803-045159-ec55`), no artifact under the literal label "OCID-021" ever existed in this
repo — independently confirmed twice by prior sessions. The real, correctly-observed gate is
`SEC-07` itself / `UMR-20260802-165606-4413` (OCID-020), which locks **implementation,** gap
closure, production changes, completion certification, and platform freeze — not documentation.
This document performs no implementation, so it is unaffected and proceeds, exactly as this
directive's own text anticipates ("still permits discovery and matrix building to continue").

**Cluster-overlap check performed before writing (per `UMR-20260803-045159-ec55`'s binding
process decision):** at the time this document was written, `gh pr list` showed no open PR and
no merged `main` content for OCID-026/027/028/030/032/034/035/037 (the sibling
"search-first, reuse-first" cluster this OCID belongs to). PR #765 (OCID-022, End User
Experience Foundation) and PR #768 (OCID-023, Universal End User Work Model) were open but their
real scope — nav shell, Mode Pills, VERI Chat UX, task/work-item status/delegation/escalation
*model* — is end-user-experience- and task-lifecycle-shaped, not organization/tenant/role/rights-
shaped; §5 below cites OCID-023's own scope explicitly at the one point they touch (delegation)
to avoid restating it. No genuine duplication found.

**Discovery method:** direct, current-state reads of `src/lib/db/schema.ts` (organization,
user, role, rights, approval, delegation, workflow, visibility, and shared-link tables — cited
by exact table name and line number below), `src/lib/supabase/auth-guard.ts` (`requireAuth()`,
`ROLE_RANK`, `hasRole()`), `ai-os/system-tree/12-compliance-tracker-database.yaml`,
`ai-os/audit-tree/02-audit-organization.yaml`, `ai-os/priority18b_stage0_design.md`, and this
repo's own `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` — not re-derived from memory, not copied
from a prior document's prose.

---

## 1. Mission and non-negotiable baseline

VERIDIAN already has an organization model. This document does not design one. `organisations`
(`src/lib/db/schema.ts:28`) has been the single tenant root table since Wave 1 and is scoped by
an `orgId` column present on nearly every other table in the schema (confirmed pattern, also
documented at `ai-os/system-tree/12-compliance-tracker-database.yaml:11`). Every section below
answers "how does this already work" — where no unified mechanism exists, that is named as a
real, current gap (§10), not silently invented into one.

This document governs how **every organization** — compliance-tracker tenants today, PROJEXA
tenants (via the thin-client proxy), and any future VERIDIAN-brand tenant — operates inside the
one shared backend. One backend, many brands, many tenants, one rulebook.

---

## 2. The organization structure model (real)

### 2.1 Organization model
`organisations` (table `organisations`, `schema.ts:28-136`) is the tenant root: `id`, `name`,
`slug` (unique), `plan`, `entityType`, `accountType` (`'company'|'ca_firm'|'legal_firm'|
'consultant'`, Wave 7, line 35), `regulatoryEntityType` (Wave 8, line 48), `country` (line 113),
licensing/cost-cap fields, and `primaryProductBranchId` (line 104, links a tenant to a sibling
product line). There is no single `owner_id` column on `organisations` — see §3.4.

### 2.2 Multi-brand model
Not a separate brand entity — white-label branding lives directly on `organisations`:
`brandPrimaryColor`, `brandAccentColor`, `faviconUrl`, `customDomain`, `emailSenderName`
(`schema.ts:129-133`, added by `drizzle/0221_wave_b_white_label_branding.sql`), normalized by
`org-branding-service.ts` with real platform defaults (`#1C2B3A`/`#F5820A`). **Real, honest
status:** the columns exist and are populated per-org; there is no tenant-routing middleware
that resolves a brand by host header yet — `customDomain` is stored, not routed on. PROJEXA
(`ai-os/system-tree/20-projexa.yaml`, rule PRX-01) is the one operating proof this model works
end-to-end in principle: its backend is a genuine thin client, proxying real work to
compliance-tracker's `/api/v1/projexa` surface with zero LLM calls of its own — the same "one
backend, many brands" contract this section describes, already running in production for one
brand. The live routing gap on the specific `projexa-ai.com` domain is an operational/DNS fact,
already tracked in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 9 and not restated here as a
new finding.

### 2.3 Multi-tenant model
Enforced at two independent layers, both real: (a) application-level `orgId` scoping on nearly
every table; (b) Postgres Row Level Security. `withTenantContext()` (`src/lib/db/tenant-
scoped.ts`) runs queries through a dedicated, non-bypassing `app_runtime` role and sets session
GUCs; RLS is enabled on 64+ tables via a repeating migration pattern (`CREATE POLICY
app_runtime_org_scoped ... USING (org_id = ...)` plus a `service_role_bypass_*` policy — e.g.
`drizzle/0059_wave67_multi_entity_company.sql:37-45` — confirmed present across 51 migration
files). This is the real, live mechanism that makes the directive's Mandatory Rule "one
organization shall never see another organization" true today, not aspirational — cited
corroboration: `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` item 8 (~75%, mechanism real and
active, no table-by-table completeness audit yet).

### 2.4 Legal entity model
Two real, distinct, **not yet unified** legal-entity concepts exist:
- `clientEntities` (`schema.ts:161-172`), nested under `clients` (itself nested under
  `organisations`/`branches`) — carries `legalName`, `entityType`, `gstin`/`pan`/`cin`. This is
  the CA-firm/consultant-serves-multiple-clients shape.
- `erpCompanies` (`schema.ts:7264-7276`) — `orgId`, `companyName`, self-referencing
  `parentCompanyId` (nested company tree), `isGroup`. Comment at lines 7255-7263 states this is
  explicitly modeled on ERPNext's Company doctype and is distinct from `organisations`.

Reuse guidance for future work: do not add a third legal-entity table. Either concept already
covers the two real shapes this platform serves (accounting-firm client roster vs. group-company
structure) — a genuine unification of the two is a real, named gap (§10), not something this
document invents a fix for.

### 2.5 Business unit / department model
`departments` (`schema.ts:194-202`): `orgId`, `name`, `headId` (self-referencing single head) —
this is VERIDIAN's business-unit/department table today. `erpCostCenters`
(`schema.ts:7278-7287`) adds a parallel cost-center dimension (`parentCostCenterId`,
`departmentId`, `projectId`) for the accounting side of the same organizational structure.

### 2.6 Location model
**Real gap:** no standalone `locations` table exists in `schema.ts`. Location-shaped data today
lives as free-text/address fields on `organisations`, `clientEntities`, and `erpCompanies`
individually, not as a shared, reusable location entity. Named here, not fixed.

### 2.7 Project model
`projects` (`schema.ts:3957-3979`): `orgId`, optional `clientId`, self-referencing
`parentProjectId`, `leadUserId` — a real, dual-purpose table serving both GRC-style compliance
projects and PMS (Project Management System) work via nullable PM-specific columns. One project
table, reused across both use cases, not two.

### 2.8 Team model
**Real gap:** no standalone `teams` table exists (confirmed: zero table literally named `teams`
in `schema.ts`). Team-shaped grouping today is expressed through `departments`, `reportingToId`
on `users` (direct-manager chains), and per-workflow participant lists (e.g.
`conversationParticipants`), not a single reusable team entity. Named here, not fixed.

### 2.9 Governance-body model (real, adjacent)
`committees` (`schema.ts:2891-2903`): `orgId`, `chairId`, `cadence` — a real governance-body
table (board/audit-committee shaped), distinct from the operational org-structure tables above
but part of the same tenant tree via `orgId`.

---

## 3. The people model (real)

### 3.1 End user model
`users` (`schema.ts:205-247`): `id`, `name`, `email` (unique), `role` (`userRoleEnum`, default
`'member'`), `orgId` (nullable), `departmentId`, `authUserId` (links to Supabase
`auth.users.id`), `reportingToId` (self-FK, direct manager, line 219), `accountStage`
(`'stage_0'|null`, line 230). Identity/session resolution is real and live:
`requireAuth()` (`src/lib/supabase/auth-guard.ts:264-375`) resolves the Supabase Auth session,
looks up the matching `users` row by email, auto-links `authUserId`, and calls
`autoProvisionUser()` (lines 72-262) when no row exists yet — handling stage-0 token, invite
token, join code, and brand-new-org paths, in that priority order, as one real provisioning
funnel every new identity goes through.

### 3.2 Employee and associate model
**Functionally equivalent today, exactly as this directive's Mandatory Rules require** — there is
no separate `employee` vs `associate` table or role split in `schema.ts`. Both are represented by
the same `users` row shape, distinguished (if at all) by free-text/HR-context fields
(`employeeProfiles`, referenced at `schema.ts:5188`'s comment), not by a structurally different
identity or access model. This document records that equivalence as already real, not as a
target to build toward.

### 3.3 Admin model
Represented by `role = 'admin'` (rank 5 of 6, `ROLE_RANK`, `auth-guard.ts:31-38`) and
`role = 'veridian_admin'` (rank 6, the highest rank in the enum) — org-scoped administrative
authority, gated by `hasRole()`/`requireRole()` on API routes.

### 3.4 Owner model
**Real, honest gap:** there is no `owner_id` (or equivalent) column on `organisations` — no
single, structurally distinct "the Owner of this org" concept exists at the schema level today.
The directive's Mandatory Rule ("every user is replaceable except the Owner... the system shall
never depend on one employee") is true in practice for `admin`/`veridian_admin` roles — they are
role values, not a hardcoded identity, so any user can hold or lose that role without a schema
change — but there is no dedicated Owner row/flag distinguishing one specific admin as
irreplaceable-by-design. Named as a real gap for a future OCID to close (§10), not invented here.

### 3.5 Vendor user and customer user model
**Real gap, partially covered by role values:** there is no separate `vendor_user`/
`customer_user` table. The closest real mechanism is the `client_viewer` and `external_auditor`
values in `userRoleEnum` (`schema.ts:14`) — external-facing, rank-1 roles (same tier as
`viewer`/`stage_0` in `ROLE_RANK`) that function as the customer/vendor-facing access tier today.
This covers "restricted external access" but not a structurally distinct vendor/customer
identity type.

### 3.6 Level-zero user model
Real and fully implemented, per `ai-os/priority18b_stage0_design.md` (Priority 18b, Owner
directive 2026-07-15, Option B): `role = 'stage_0'` (`schema.ts:15`) ranks 1 in `ROLE_RANK` —
deliberately never merged with `viewer`/`client_viewer`/`external_auditor` so "unpaid self-serve
chat guest" is never ambiguous with paid/invited external roles. `stage0Sources`
(`schema.ts:266-278`): `userId`, `orgId`, `sourceType` (`'guest_access'|'share_link'`),
`sourceTokenId`, `sourceConversationId` — the **one place** a single identity can hold more than
one org relationship (multi-org membership for level-zero users specifically). Provisioning:
`src/lib/services/stage0-service.ts::consumeStage0TokenAndProvisionUser()`. Security boundary is
real and layered, not merely UX: `accountStage` is cosmetic; the actual gate is
`role = 'stage_0'` in `ROLE_RANK` (rejects every `requireRole(..., 'member')`-or-higher check),
plus `listStage0Inbox()`'s narrow query predicate (direct-conversation-only, never group/org-wide
visibility), plus standard org-scoped RLS (§2.3).

---

## 4. Role, responsibility, and rights model (real)

No `roles` table, no `permissions` table, no `role_permissions` junction — role is a single
enum column, `users.role` (`userRoleEnum`, `schema.ts:12-16`, 11 values: `admin`, `manager`,
`member`, `viewer`, `veridian_admin`, `branch_manager`, `senior_professional`, `team_member`,
`client_viewer`, `external_auditor`, `stage_0`). Responsibility/authority ordering is a real,
explicit numeric rank map, `ROLE_RANK` (`auth-guard.ts:31-38`): `viewer`/`client_viewer`/
`external_auditor` = 1, `member`/`team_member` = 2, `senior_professional`/`manager` = 3,
`branch_manager` = 4, `admin` = 5, `veridian_admin` = 6 (`stage_0` falls through to rank 0 —
lowest, below `viewer`). `hasRole()`/`requireRole()` (lines 40-55) gate API routes by rank
comparison — this is the real, deterministic, every-permission-is-role-based mechanism the
directive's Mandatory Rules require.

**Rights, as a deny-only overlay on top of role rank:** `abacPolicies`
(`schema.ts:7230-7245`) — `orgId`, `resourceType`, `action`, `effect` (restricted to `'deny'`
only, line 7228), `conditions` (jsonb attribute conditions), `priority`. Explicitly evaluated
**after** role-rank RBAC passes and can only narrow access, never widen it (comment,
lines 7219-7227) — service: `src/app/api/governance/abac-policies/route.ts` /
`abac-policy-service.ts`; evaluation: `src/lib/abac.ts::evaluateAttributeConditions()`.

**Real, honest gap:** no table-driven, per-action permission catalog exists (e.g. individually
grantable permission rows). Access control today is rank + deny-only-ABAC + RLS, not a classic
permission-matrix RBAC system. A future OCID wanting finer-grained rights should extend
`abacPolicies` (already the real extension point) rather than build a parallel permission table.

---

## 5. Approval, limit, delegation, transfer, and succession model (real)

VERIDIAN already has a generic, deterministic Approval Workflow Engine — the directive's
Mandatory Rule "every approval is deterministic" is a description of existing behavior, not a
target.

**Approval engine (Wave 51, `schema.ts:7133-7217`, `approval-workflow-service.ts`):**
`approvalWorkflowDefinitions` (`orgId`, `entityType`, `name`) → `approvalWorkflowStepDefinitions`
(`stepOrder`, `approverRole` as a minimum-rank string, `requiredApprovals`, plus a jsonb
`conditions` field for multi-condition gating) → `approvalWorkflowInstances` (polymorphic
`entityType`/`entityId`, `status`) → `approvalWorkflowStepInstances` (running
`approvalsReceived` counter) → `approvalWorkflowStepApprovals` (`approvedById`, `decision`).
This engine's own header comment records that it replaced two earlier, narrower mechanisms —
`approvalRequests` (single-step maker-checker) and `pmsWorkflowTransitions` (PMS-issue-only) —
both still present in schema for backward compatibility, not removed.

**Limit model:** `delegationOfAuthority` (table `delegation_of_authority`, `schema.ts:2903-2911`)
— `orgId`, `clientId`, `activity`, `thresholdDescription`, `approverRole`. This is the real,
configurable per-org, per-activity limit table the directive's "every limit is configurable"
rule already describes — static reference data, queried via `src/app/api/doa/route.ts`, feeding
the deterministic approval engine's threshold checks rather than a separate live workflow of its
own.

**Delegation and transfer-of-work model:** `scopedDelegations` (table `scoped_delegations`,
Wave 173, `schema.ts:1911-1943`) — `delegatorUserId` → `delegateUserId` OR `delegateRoleKey`
(exactly one of the two, app-validated), `scopeType` enum (`task|workflow|project|module|
communication_type|approval_type`), `scopeId`, independent `expiresAt`/`revokedAt`. This is the
real "every work item is transferable and delegable" mechanism, and the real succession
mechanism (delegate-to-role covers "whoever holds this role next" without naming an individual).
Self-service variant: `approvalPreferences` (Wave 161, `schema.ts:1899-1909`) — a per-user
"always approve/reject this category" preference, distinct from delegation (delegation moves
authority to another person/role; a preference is a standing instruction for the delegator's
own decisions).

**Cross-reference, not restated:** task/work-item-level status, transfer, and escalation UX is
in OCID-023's scope (Universal End User Work Model, `UMR-20260803-040929-9713`) — this section
covers the organizational mechanism (who may act for whom, under what threshold), OCID-023
covers the work-item lifecycle that mechanism attaches to. No duplication: this document does
not restate task-status semantics.

**Escalation:** `escalationRules` (`schema.ts:5575-5586`, real business/SLA escalation for
tickets) is a real, distinct mechanism from the AI-operational escalation ladder
(`escalation-ladder.ts`, `schema.ts:1702-1728`) — the schema's own comment at line 3543-3544
states these are deliberately not reused, because the AI-operational ladder is shaped around AI
dispatch failures, not business risk. Recorded here so a future OCID does not conflate the two.

---

## 6. Leave and exit model

**Leave (real):** `leaveRequests` (table `leave_requests`, `schema.ts:5184-5206`) — `orgId`,
`userId`, `companyId` (nullable, snapshotted at request time), `leaveType`, `startDate`/
`endDate`, `status` (`'pending'|'approved'|'rejected'|'cancelled'`), `approverId`. Paired with
`leaveBalances` (`schema.ts:5208+`). This is the real leave-request-and-approval mechanism;
approval routes through the same `approverId` pattern as the rest of §5, not a separate engine.

**Exit / succession (real gap):** no dedicated offboarding/exit/termination table exists in
`schema.ts` (confirmed: no `offboarding`, `exitChecklist`, `resignation`, or `termination` table
found). Today, a departing user's authority transfer is achieved compositionally, through
mechanisms that already exist for other purposes: revoking access
(`accessReviewCertifications.decision = 'revoked'`, checked by `requireAuth()` at
`auth-guard.ts:305-311`), reassigning their `reportingToId`-linked reports, and using
`scopedDelegations` to move their open scopes to a successor role/person before revocation. This
composition is real and usable today, but there is no single "exit workflow" artifact tying
those three steps together as one guided process — named here as a real gap (§10), not invented
into a fix.

---

## 7. Shared link and level-zero access model (real)

Two real link mechanisms, both org-scoped: `conversationShareLinks`
(`schema.ts:5734-5748` — `token`, `createdById`, `expiresAt`, `revokedAt`,
`stage0SignupCount`) for read-only sharing, and `conversationGuestAccess`
(`schema.ts:5760-5774` — `token`, `guestName`/`guestEmail`, `invitedById`) for write-capable
guest participation without a full `users` row. Public entry point:
`src/app/guest-chat/[token]/page.tsx`. "Verified link" (per this directive's Mandatory Rules) is
real: level-zero users enter exclusively through one of these two tokened paths — there is no
open, unauthenticated signup route into a specific org's VERI Chat outside this mechanism.

**VERI Chat for level-zero users, subject to rights (real, and correctly restrictive):** no
stage-0-specific gating exists inside the AI router itself (`src/lib/ai-router/`) — access
restriction happens one layer down, at the same `requireRole()`/`ROLE_RANK` layer as every other
role (§4), plus `stage0-service.ts::listStage0Inbox()`'s own narrow query predicate, which
returns only direct conversations/messages/instructions explicitly addressed to that guest —
never a general org channel. This matches the directive's own rule exactly: level-zero VERI Chat
access is real, and is rights-gated, not unrestricted.

---

## 8. Work, data, and audit visibility model (real)

**Audit visibility:** `auditLogs` (table `audit_logs`, `schema.ts:626-660`) — `action`,
`entityType`/`entityId`, `userId` (nullable for API-key actors), `actorRole` (snapshotted at
write time), `orgId`, `apiKeyId`, and an impersonation trail (`supportSessionId`/
`actingOnBehalfOfUserId`, for the Support Sessions feature). Written centrally via
`src/lib/audit.ts::logActivity()`, called from the approval engine, DOA routes, and elsewhere —
one real, shared audit-write path, not a per-feature reimplementation.

**Data visibility:** org-level RLS (§2.3) is the outermost boundary; within an org,
`userClientAccess` (`schema.ts:174-180` — `userId`, `clientId`, `accessLevel`:
`'full'|'aggregate_only'`) narrows client-level visibility for CA-firm/consultant tenants; role
rank (§4) further narrows by route.

**Work visibility ("one user shall never see another user's private work unless authorized"):**
no generic "private vs. shared" flag exists on work-item tables platform-wide; the real
equivalent today is conversation-level participant scoping (`conversationParticipants`) plus the
stage-0 narrow-inbox predicate (§3.6/§7) for guest-shaped work, and role/route gating for
everything else. There is no single, uniform "visibility" column reused across all work-item
types — named as a real gap (§10) for a future OCID to evaluate, not invented here.

---

## 9. Security model (real, cross-referenced not restated)

Multi-tenant isolation (§2.3) and rank+ABAC-deny access control (§4) are this document's own
scope. Two adjacent, already-governed security mechanisms are cited, not restated: `SEC-05`
(`ai-os/CONSTITUTION.yaml`) — platform code/schema changes are a Level-1-only organizational
boundary; `SEC-06` — production DDL/DCL execution gate (Category A human sign-off / Category B
deterministic recovery check), `ENFORCED`, merged via `claude-control` PR #123. Neither is an
organization-model concern specifically; both apply to any org operating inside VERIDIAN and are
listed here only so this document's security section does not silently omit them.

---

## 10. Real gaps catalogued (consolidated from §§2-8, not fixed here)

| Gap | Where named above | Real today |
|---|---|---|
| No single Owner row/flag on `organisations` | §3.4 | Admin authority is role-based (`admin`/`veridian_admin`), correctly replaceable, but no structurally distinct "the Owner" exists |
| No standalone `locations` table | §2.6 | Location data is free-text on org/entity tables individually |
| No standalone `teams` table | §2.8 | Team grouping expressed via departments + reporting chains + per-workflow participant lists |
| Two unreconciled legal-entity tables (`clientEntities`, `erpCompanies`) | §2.4 | Both real, serve different real shapes, not yet unified |
| No distinct vendor-user / customer-user identity type | §3.5 | Covered today by `client_viewer`/`external_auditor` role values, not a separate table |
| No single guided exit/offboarding workflow | §6 | Composable today from access-revocation + delegation + reassignment, not one artifact |
| No uniform work-item "private vs. shared" visibility column | §8 | Real per-feature scoping exists (conversations, stage-0 inbox), not a platform-wide convention |
| No table-driven fine-grained permission catalog | §4 | Rank + deny-only ABAC covers most real cases today |
| Multi-brand host-header routing not yet wired | §2.2 | Branding columns real and populated; routing middleware not yet built (already tracked, `IMPLEMENTATION_MATRIX` item 9) |

None of these gaps are implemented, designed, or scaffolded by this document — SEC-07 keeps real
implementation locked pending OCID-020, and this directive is documentation-only regardless.
They are named so a future OCID can scope real work against a real list instead of rediscovering
it.

---

## 11. Universal rules (restated from existing, real governance — not new policy)

Each rule below already holds today, per the citations above; this section exists so a future
OCID has one place to check "does this change respect the organization rules already in effect."

1. **One organization shall never see another organization.** Real: RLS + `app_runtime`-scoped
   queries, §2.3.
2. **One user shall never see another user's private work unless authorized.** Partially real:
   role/route gating and conversation-level scoping are real; no uniform visibility column
   exists yet (§8, §10).
3. **Every permission is role based.** Real: `ROLE_RANK` + `hasRole()`/`requireRole()`, §4.
4. **Every approval is deterministic.** Real: the generic Approval Workflow Engine, §5.
5. **Every limit is configurable.** Real: `delegationOfAuthority`, §5.
6. **Every work item is transferable and delegable.** Real: `scopedDelegations`, §5.
7. **Every user is replaceable except the Owner; the system never depends on one employee.**
   Real for role-based authority (any user can hold/lose `admin`/`veridian_admin`); the "except
   the Owner" carve-out has no structural Owner concept to attach to yet (§3.4, §10).
8. **Employee and associate are functionally equivalent.** Real: one `users` shape, no
   structural split, §3.2.
9. **Level zero users enter through verified links only.** Real: `conversationShareLinks`/
   `conversationGuestAccess` tokens are the only entry path, §7.
10. **VERI Chat is available to level zero users, subject to rights.** Real: gated by
    `ROLE_RANK` + `listStage0Inbox()`'s narrow predicate, §7.
11. **Everything remains multi-brand, multi-tenant, and reusable.** Real: §2.2/§2.3; PROJEXA is
    the live proof point for multi-brand reuse of one backend.

---

## 12. Certification and readiness for OCID-030

**This document does not certify** anything beyond its own accuracy at time of writing (per
§0's discovery method). It does not unlock SEC-07, does not certify OCID-020, and does not
authorize implementation of any gap listed in §10 — that remains locked behind SEC-07's real,
ordered unlock sequence (OCID-038 → OCID-039 → OCID-040), exactly as this directive's own
Prohibited section requires ("do not implement... only enhance what already exists," honored
here as "describe, do not implement").

**Ready for OCID-030 (VERIDIAN Universal Decision Engine v1.0)** in the sense this directive
asks: OCID-030's worker now has one canonical description of the organization/role/rights/
approval/delegation model to build a decision engine on top of — the real `ROLE_RANK`/
`abacPolicies` rights layer (§4), the real deterministic Approval Workflow Engine (§5), and the
real `delegationOfAuthority`/`scopedDelegations` limit-and-delegation mechanism (§5) are the
concrete substrate a decision engine document should cite and extend, not rediscover. Per
`UMR-20260803-045159-ec55`'s binding process decision, OCID-030's own worker must independently
re-verify this document's claims are still current before citing them, and must check for
cluster overlap against this document and any other OCID-026/027/028/032/034/035/037 content
that may have merged since this document was written.

**Canonical artifact:** this file,
`ai-os/VERIDIAN_UNIVERSAL_ORGANIZATION_RUNTIME_2026-08-03.md` — new, not a duplicate of any
existing file (confirmed via the cluster-overlap check recorded above and in this session's
`ai-os/boss/ACTIVE-CLAIMS.yaml` entry). Amends the existing UMR chain; no new chain started.
