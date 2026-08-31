# VERIDIAN Universal Multi-Brand Multi-Tenant Platform Runtime v1.0 (Discovery)

**UMR:** `UMR-20260803-084718-ce79` (OCID-046), parented to OCID-045 (`UMR-20260803-084637-ada4`, itself
registered this same cycle, discovery-only, requested certification explicitly DECLINED), which chains
back through OCID-044 (`UMR-20260803-084547-22fd`), OCID-043 (`UMR-20260803-084429-7a70`), OCID-042
(`UMR-20260803-084332-5b52`), and OCID-041 (`UMR-20260803-084109-6875`) to `UMR-20260802-173631-ca85`
(OCID-021, the ERP Functional Completeness Master Program), OCID-020 (`UMR-20260802-165606-4413`), and
`SEC-07` (`ai-os/CONSTITUTION.yaml`). Amends the existing UMR chain, the existing
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` registration amendment (2026-08-03), and the existing canonical
artifact index (`ai-os/OS.yaml`); does not start a new chain.

**What this is, and is not:** the still-undone substantive discovery artifact for OCID-046, which the
2026-08-03 registration amendment in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` named as outstanding
("Canonical artifact: this file (this amendment) only — no new document created this cycle"). This document
performs a real, evidence-based inventory of the brand model, tenant model, organization model, role/rights
model, and function/report/analysis/prompt libraries that already exist in this repo today, and maps that
inventory against OCID-046's stated mission (every brand, including `projexa-ai.com` and `thefirm-ai.com`,
as a configuration of one platform; every tenant logically isolated on shared infrastructure; no brand/
tenant duplicating functions/reports/analysis/prompts/workflows without first discovering the existing
platform). It does **not** implement anything: no `CONSTITUTION.yaml` change, no tenant-runtime change, no
brand-runtime change, no new table, no new middleware, no domain-routing code. Per `SEC-07`, real
implementation stays locked until OCID-020 independently clears, followed by OCID-038 → OCID-039 → OCID-040
in that order — this document is discovery/matrix-building, which `SEC-07` explicitly permits to continue.

**Real, honest dependency note (from OCID-046's own directive, not softened here):** OCID-046 cites a
result from OCID-045 that does not exist — OCID-045 was registered this exact same cycle, minutes before
this document, is itself discovery-only, and its own requested certification of the OCID-041 through
OCID-045 chain was explicitly declined (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, OCID-045 amendment
paragraph). This document does not fabricate or pre-empt that missing certification. It also does not
assume OCID-041 through OCID-044's own discovery findings (execution-package format, context-packaging
runtime, provider-dispatch contract, verification/reintegration pipeline) apply here — OCID-046's mission
is a materially different surface (brand/tenant/org/role/function-library reuse, not external-AI
execution), and this document's inventory stands on its own evidence, independently gathered against this
repo's real schema, services, and existing OCID docs.

---

## 0. Mandatory discovery — real inventory, independently verified before writing

Every claim below was checked against live repo content (`src/lib/db/schema.ts`, `drizzle/*.sql`, real
service files, and existing `ai-os/*.md` artifacts) before this document was written, not assumed from
file/function names.

### 0.1 Brand model

No `brands` table exists anywhere in `src/lib/db/schema.ts` (zero hits for `export const brands`). What
exists instead:

- `organisations` (`schema.ts:28-140`) carries 5 white-label columns from
  `drizzle/0221_wave_b_white_label_branding.sql`: `brandPrimaryColor`, `brandAccentColor`, `faviconUrl`,
  `customDomain` (unique), `emailSenderName`.
- `productBranches` (`schema.ts:2100-2121`, `platformSchemaDB`) — a product-line catalog (`branchKey`,
  currently only `'grc'`; `displayName`; `domain`; `tagline`; `status`: `live`/`building`/`planned`;
  `buildTier`). This is the closest thing to a brand catalog, but it models sibling *products*, not the
  three domains (`projexa-ai.com`, `thefirm-ai.com`, veridian) as distinct brand identities.
- `platformApplications` (`schema.ts:725-733`) — `applicationKey` column comment: `'projexa' today;
  'the-firm' | 'fm-cs' | 'office-ai-os' | 'forge' in future` (line 731) — `the-firm` is a planned, not a
  live, row.
- `src/lib/services/org-branding-service.ts` — the single real read/write point. `resolveBranding()`
  (lines 91-118) resolves `brandName` via `organisations.primaryProductBranchId → productBranches
  .displayName`, **not** by Host header or domain — its own comment states "this repo has no
  tenant-routing middleware yet" (lines 59-65).
- No `middleware.ts` exists anywhere under `src/` — confirms zero domain-based routing today.
- No `NEXT_PUBLIC_BRAND`/`BRAND_ID`/`APP_BRAND` env var exists anywhere; only a
  `DEFAULT_BRAND_NAME = "VERIDIAN AI OS"` constant (`org-branding-service.ts:38`).

**Literal string search, repo-wide:**

- `thefirm-ai` appears in exactly one place: `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md:1283` (OCID-046's
  own mission text) — no code, no DB row, no config file.
- `projexa-ai` appears in `org-branding-service.ts:62` (a comment about a future DNS cutover) and
  `src/lib/db/schema.relations.test.ts:4` (a regression test referencing a real production bug found on
  projexa-ai.com). Neither is a brand-config row.
- **No live DB row, config file, or env var anywhere ties `projexa-ai.com` or `thefirm-ai.com` to a
  specific brand/tenant identity.** This matches `IMPLEMENTATION_MATRIX_2026-08-02.md`'s own Item 9
  finding (quoted in full in section 0.6 below).

**Existing "multi-brand" material:** no standalone `MULTI_BRAND` file exists. "Multi brand" appears only
as a subsection inside four differently-scoped OCID documents already on disk:
`VERIDIAN_GLOBAL_KNOWLEDGE_DISCOVERY_AND_REUSE_RUNTIME_2026-08-03.md` §24 ("Multi brand reuse"),
`VERIDIAN_UNIVERSAL_DECISION_ENGINE_2026-08-03.md` §19 ("Multi-brand decision reuse"),
`VERIDIAN_UNIVERSAL_SOFTWARE_EXECUTION_ENGINE_2026-08-03.md` §30 ("Multi-brand execution"), and
`VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md` §29 ("Multi-brand context"). None is a
dedicated brand-runtime artifact; each is a narrow slice inside a differently-scoped document.

### 0.2 Tenant model

- `src/lib/db/tenant-scoped.ts` (82 lines). `withTenantContext()` (lines 65-77) opens a Postgres
  transaction under a dedicated `app_runtime` role and sets 3 GUCs via `set_config()`:
  `app.current_org_id`, `app.current_client_ids`, `app.current_user_id` (lines 70-75), read by RLS
  policies (`compliance.current_org_id()` etc., per the file's own comment, lines 39-42). The file's own
  header documents a real historical bug: `SET LOCAL x = $1` is invalid Postgres syntax and silently
  no-op'd tenant scoping until fixed to `set_config()` (lines 43-53).
- `withTenantContext(` has 50 real call sites across `src/` (excluding tests) — consistent with the
  49/51 figure `IMPLEMENTATION_MATRIX_2026-08-02.md` already cites.
- RLS (`ENABLE ROW LEVEL SECURITY`) appears in 51 migration files (e.g.
  `drizzle/0003_enable_rls_exposed_compliance_tables.sql:10,13,16,19,22`).
- No `tenants` table exists. `organisations.id` is the tenant unit; every scoped row carries `orgId`
  (`branches.orgId`, `clients.orgId`, `departments.orgId`, `users.orgId` — `schema.ts:141-217`), not a
  `tenant_id` column (zero hits for `tenant_id` in `schema.ts`).

**Existing matrix quote, Item 8 ("Multi Tenant", ~75%):**
> "**Evidence**: `tenant-scoped.ts`'s `withTenantContext()` (commit `c2eca637`) sets real Postgres GUCs via
> `set_config()` under a dedicated `app_runtime` role... called in 49/51 service files. RLS enabled on 64+
> tables... `tenant-isolation.test.ts` (253 lines) exercises real service functions...
> **Remaining gap**: No table-by-table RLS correctness verification exists — only an app-layer test.
> PROJEXA itself has essentially no tenant isolation of its own; depends entirely on the compliance-tracker
> API bridge."

### 0.3 Organization model

`organisations` (`schema.ts:28-140`) — plan, entityType, accountType, regulatoryEntityType, trial fields,
licensedSeats, monthlyCostCapUsd, country, plus the brand columns from 0.1. Hierarchy underneath it
(`schema.ts:140-176`): `branches` (orgId FK), `clients` (orgId/branchId, `isSelf` flag for the implicit
"Self/Direct" client), `clientEntities` (per-client legal entities with GSTIN/PAN/CIN), `userClientAccess`
(per-user client scoping), `subscriptionPlans`. `departments` (`schema.ts:190-198`) and `users`
(`schema.ts:200-231`, `orgId`, `role`, self-referential `reportingToId`) sit alongside.

A dedicated "VERIDIAN Universal Organization Runtime v1.0" canonical document does **not** exist as a
standalone file. `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md:28` records this as a genuinely
unresolved numbering question, not settled fact:
> "OCID-20260803-029 | 'VERIDIAN Universal Organization Runtime v1.0' -- displaced from this document's
> original row 028, not independently confirmed, do not treat as settled... plausibly belongs at row 029 --
> but this is an inference from a pattern, not an independent confirmation."

The real org hierarchy (org → branch → client → clientEntity) is live, production code; it has never been
written up as its own discovery artifact under any confirmed OCID number.

### 0.4 Role and rights model

- `userRoleEnum` (`schema.ts:12-16`) — 11 values: `admin, manager, member, viewer` (original),
  `veridian_admin, branch_manager, senior_professional, team_member, client_viewer, external_auditor`
  (Wave 1), `stage_0` (self-serve guest tier).
- `src/lib/supabase/auth-guard.ts` — the real RBAC primitive: `UserRole` type, `ROLE_RANK`, `hasRole()`/
  `requireRole()`, `requireRoleOrScope()` (used by `client-access-service.ts`, `stage0-service.ts`,
  `approval-workflow-service.ts`, `support-sessions/start/route.ts`).
- `src/lib/services/permission-service.ts` (364 lines) — explicitly not a new role system; a single
  lookup table (`ERP_ACTION_ROLES`, action-string → minimum `UserRole`) built on top of `auth-guard.ts`'s
  existing rank system, added to close a real gap (routes checked org scope but not role).
- No dedicated `roles`/`permissions`/`rights` DB tables exist — RBAC is enum + code-level rank map, not
  normalized tables.
- `src/lib/ai-team/roster.ts` (659 lines) — the platform's own ~30-role internal AI org chart (distinct
  from customer-facing roles).
- `src/lib/guardrail-engine.ts` (98 lines, Wave 157) and `src/lib/model-tier-eligibility.ts` (84 lines,
  Wave 163) — opt-in validation-gate and model-eligibility registries, both real but narrowly scoped
  (deterministic gating, not a general rights model).

### 0.5 Function/report/analysis/prompt libraries

- `src/lib/services/report-engine-service.ts` (1790 lines) — `TABLE_REGISTRY` (~line 208), `FORMULA_
  REGISTRY` (line 1379), `getFullReportCatalog()` (line 1735, merges static `REPORT_CATALOG` with dynamic
  `reportDefinitions` DB rows, tenant-scoped via `withTenantContext`).
- `src/lib/services/capability-registry-service.ts` (188 lines) — real similarity/dedup functions:
  `findSimilarCapabilities` (line 90), `findSimilarPromptPatterns` (102), `findSimilarPromptVersions`
  (124), `findSimilarDynamicChains` (143), `auditDuplicateCapabilities(orgId, threshold=0.92)` (158) — the
  real duplicate-candidate auditor (not literally named `dedup*`, but functionally that role).
- `src/lib/services/dynamic-chain-directory-service.ts` — exists, confirmed present.
- The 247-entry VCEL engine registry and 195-role `AI_ROSTER_CATALOG.json`, and the versioned Prompt OS
  (`prompt_templates`/`prompt_versions`), are already independently discovered and documented in
  `VERIDIAN_GLOBAL_KNOWLEDGE_DISCOVERY_AND_REUSE_RUNTIME_2026-08-03.md` (OCID-027) — this document
  cross-references, not re-derives, that inventory.
- `chatgpt_promptlib_guard.py` is **not** in this repo; per `IMPLEMENTATION_MATRIX_2026-08-02.md` Item 4,
  the prompt-library content lives outside compliance-tracker, on the live server at
  `/opt/veridian/chatgpt-prompt-library/CSV/`, and is essentially empty relative to its stated target.

### 0.6 IMPLEMENTATION_MATRIX quotes — Item 9 (verbatim, real evidence already on record)

> "**Multi Brand — ~15%**. **Evidence**: `drizzle/0221_wave_b_white_label_branding.sql` adds 5 real
> columns to `organisations` (`brand_primary_color`, `brand_accent_color`, `favicon_url`, `custom_domain`,
> `email_sender_name`), backed by `org-branding-service.ts` and `BrandingSection.tsx` admin UI.
> **Remaining gap**: all columns NULL on every existing org (zero adoption, verified live). DNS
> verification, TLS provisioning, host-header routing explicitly not implemented per the migration's own
> header. Zero usages of these fields outside the service/settings form — nothing renders per-org theming
> today. No `brandId`/white-label logic anywhere in `projexa`... **Production ready**: No."

No other brand/tenant/org/role discovery artifact under the OCID-046 name exists anywhere in `ai-os/`
prior to this document — confirmed via `find . -iname "*MULTI_BRAND*"` (no hits) and a full grep of
`ai-os/*.md` for "OCID-046" (only the registration amendment in `IMPLEMENTATION_MATRIX_2026-08-02.md`).

---

## 1. Mapping OCID-046's mission against the real inventory

### 1.1 "Every brand, including projexa-ai.com and thefirm-ai.com, is a configuration of one platform"

**Not true today.** There is no brand catalog that enumerates `projexa-ai.com`/`thefirm-ai.com`/veridian
as rows of one table, no domain→brand resolution middleware, and no live DNS/TLS/host-header routing
anywhere in this repo. `productBranches` and `platformApplications` gesture at a multi-product future
(`the-firm` is a documented-but-not-created row) but neither is wired to an actual domain today. The 5
white-label columns on `organisations` are real and shipped, but adoption is zero (every column NULL on
every live org, per the matrix's own Item 9 finding) — the mechanism exists; the configuration data does
not.

### 1.2 "Every tenant is logically isolated on shared infrastructure"

**Substantially true, not fully verified.** `withTenantContext()` + RLS is real, live, and the dominant
isolation mechanism across 50 service call sites and 51 RLS-enabled migrations. The gap is verification
depth (no table-by-table RLS correctness audit exists — only one 253-line app-layer test), not the
mechanism's existence. PROJEXA itself has no independent tenant isolation and relies entirely on the
compliance-tracker API bridge.

### 1.3 "No brand or tenant creates duplicate functions, reports, analysis, prompts, or workflows without
first discovering the existing platform"

**Real, working, narrow-scope mechanism already exists** — `capability-registry-service.ts`'s
`findSimilarCapabilities`/`findSimilarPromptPatterns`/`findSimilarPromptVersions`/
`findSimilarDynamicChains`/`auditDuplicateCapabilities` — plus the org-level 4-layer search-before-build
discipline already documented in `MASTER_INDEX.yaml` and OCID-027's discovery-and-reuse runtime. What does
**not** exist is that discipline extended specifically across *brands*: today's dedup functions operate
within a single org/tenant's `capability_registry` rows, not across a brand boundary that does not yet
exist as a first-class concept. A "discover-before-build" gate that spans brands cannot be built until the
brand catalog in 1.1 exists to define what "another brand" even means at the data-model level.

---

## 2. Cross-cutting gap, stated once and not softened

Every individual primitive a universal multi-brand multi-tenant platform runtime would need to *reuse*
already exists, is real, and is in production use for its own narrow purpose: tenant isolation
(`withTenantContext`/RLS), an org hierarchy (`organisations`→`branches`→`clients`→`clientEntities`), a
role/rank system (`auth-guard.ts`/`permission-service.ts`), white-label columns
(`org-branding-service.ts`), and duplicate-detection functions (`capability-registry-service.ts`). What
does **not** exist is the one piece OCID-046's mission actually turns on: a **brand** as a first-class,
queryable entity distinct from an org/tenant, with real rows for `projexa-ai.com` and `thefirm-ai.com`,
resolved by domain at request time. Without that:

1. There is nothing to route on (`middleware.ts` does not exist; Host-header brand resolution has no
   target table to resolve against).
2. The white-label columns that do exist have zero real adoption to validate against.
3. Cross-brand dedup (section 1.3) has no "other brand" to compare against — the mechanism that would
   enforce "discover before duplicate" across brands cannot be exercised until brands are real rows.

This mirrors the same shape of gap OCID-044 found for its own domain (every primitive exists; nothing
sequences/generalizes them yet) — here the missing piece is a foundational data-model concept (a brand
row), not a missing pipeline stage.

---

## 3. What this document does not do

- Does not design a `brands` table, domain-routing middleware, or cross-brand dedup extension —
  implementation-scale work, locked under `SEC-07` until OCID-020 clears.
- Does not modify `schema.ts`, `org-branding-service.ts`, `tenant-scoped.ts`, `auth-guard.ts`,
  `permission-service.ts`, `report-engine-service.ts`, `capability-registry-service.ts`, or
  `CONSTITUTION.yaml`.
- Does not certify OCID-041 through OCID-045 as complete — OCID-045's own requested certification was
  independently declined this same cycle, for real, checked reasons recorded in
  `IMPLEMENTATION_MATRIX_2026-08-02.md`; this document does not revisit or soften that decline.
- Does not create real `thefirm-ai.com` or additional `projexa-ai.com` config rows.
- Does not mark OCID-046 complete.

---

## 4. Note for the Owner

The real gap this document found (section 2) is narrower and more concrete than "multi-brand is 15% done"
suggested on its own: nearly all of multi-tenant isolation, the org hierarchy, the role/rank system, and
duplicate-detection tooling are already production-real and reusable as-is. The one missing foundational
piece — a first-class `brands` concept with real rows for each live domain and request-time resolution —
is what everything else in OCID-046's mission (routing, white-label adoption, cross-brand dedup) is
actually blocked on. This is a real, honest observation surfaced by this discovery pass, not a decision
made here; it does not change the standing OCID-020 → OCID-038 → OCID-039 → OCID-040 unlock sequence or
authorize any implementation ahead of it.

---

## Canonical artifact and UMR chain

**Canonical artifact created (exactly one, as required):** this file,
`ai-os/VERIDIAN_UNIVERSAL_MULTI_BRAND_MULTI_TENANT_PLATFORM_RUNTIME_2026-08-03.md`.

**UMR chain:** amends the existing chain rooted at `UMR-20260802-173631-ca85` (OCID-021) and the
OCID-041/042/043/044/045 registration citing `UMR-20260803-084637-ada4` (OCID-045); registered under
`UMR-20260803-084718-ce79` (OCID-046). No new UMR chain was started.

**Index registration:** this file is registered in `ai-os/OS.yaml`'s document index so it is discoverable
via the same query-before-building discipline this document itself relies on in section 0.5.

**Status:** discovery only. Not implementation. Not a certification of OCID-041 through OCID-045 or the
OCID-020 → OCID-040 unlock sequence. `CONSTITUTION.yaml`, tenant runtime, and brand runtime are unchanged.
OCID-046 is **not** marked complete.
