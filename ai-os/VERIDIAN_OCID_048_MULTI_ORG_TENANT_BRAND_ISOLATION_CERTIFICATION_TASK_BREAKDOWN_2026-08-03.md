# VERIDIAN OCID-048 — Multi Organization / Multi Tenant / Multi Brand Isolation Certification — Real Task Breakdown

**Status: planning only.** This document implements no code, runs no test, provisions no
infrastructure, and certifies nothing. It exists solely to register OCID-048 as a real child of
OCID-020 and produce a real, deterministic, bounded task breakdown for the certification work a
future execution cycle will actually run. Per this task's own SPEC: no new database, no new
tables, no new architecture — every task below reuses the organization/tenant/brand model already
built into VERIDIAN.

**UMR:** `UMR-20260803-120905-029c` (this task's own directive, `task-20260803-120306-register-
ocid-048-multi-organization-mul`, dispatched directly by the Owner — not routed through
`resource_governor.py`'s `umr_tasks` queue, confirmed via `--query-umr --task-identity`
returning zero rows; same pattern already observed for other interactively/directly-dispatched
OCID documentation tasks, e.g. OCID-031/034, whose own UMRs are likewise absent from that
ledger). Parent: `UMR-20260802-165606-4413` (**OCID-020**, the PROJEXA end-user certification
sweep). OCID-020 is itself the real, current gating condition of `ai-os/CONSTITUTION.yaml`'s
`SEC-07` implementation lock (`CONSTITUTION.yaml:653`) — this document performs discovery/
planning only, which `SEC-07` explicitly permits while the lock is open.

**Phase:** "Business Certification" — a phase name introduced by this task's own dispatch prompt.
No prior artifact in this repo names this phase; this document is its first real registration,
recorded honestly as new rather than presented as if it already existed elsewhere.

---

## 0. Duplication check performed before writing this document

Per `AGENTS.md` Rule 11 and this task's own explicit "check resource_governor before creating any
sub-task" instruction, the following was checked — real commands run, not narrated — before any
of the content below was written:

1. **`ai-os/boss/ACTIVE-CLAIMS.yaml`** — read in full (`active:` has 197 entries at the time of
   this check, `recently_completed:` the standard rolling ~15). Grepped for
   `tenant|isolat|multi.org|multi.brand|rls|048|business.cert` — zero collisions with OCID-048's
   own scope; the one RLS-related hit (`task-20260728-032915-fix-pr-610-rls-gap-on-crm-sales-
   targets`) is an unrelated, already-closed CRM-specific RLS bug fix, not a planning/certification
   task.
2. **`resource_governor.py --query-umr --search "OCID-048"`** → `{"count": 0, "matches": []}`.
3. **`resource_governor.py --query-umr --search "Tenant B"`** → 8 matches, all unrelated
   historical-backfill rows from the 2026-08-02 800-task audit (e.g.
   `backfill-task-20260726-042710-fix-pr561-cross-tenant-governance-bypass`) — none is a demo-org
   provisioning task.
4. **`ai-os/MASTER-TRACKER.yaml`**, **`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`**,
   **`ai-os/STANDING_DIRECTIVE.yaml`**, **`ai-os/boss/COMPLETED.yaml`** — grepped for
   `OCID-048`, `Tenant B`, `demo org`, `second org`, `cross-tenant` — no literal, verbatim
   "create a Tenant B demo org" task exists anywhere in this repo's governance trail. The real,
   closest, already-open item is `IMPLEMENTATION_MATRIX_2026-08-02.md`'s **Stream D**
   (`IMPLEMENTATION_MATRIX_2026-08-02.md:217`) and the explicit **"Still open, not yet tested"**
   note in `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_CONTINUATION_2026-08-02.md:75-79` — both cited
   and reused by §4 below, not duplicated.
5. **OCID-046 cross-check** — `IMPLEMENTATION_MATRIX_2026-08-02.md`'s 2026-08-03 amendment
   (lines 1280-1291) already registered **OCID-046, "VERIDIAN Universal Multi-Brand Multi-Tenant
   Platform Runtime"**, parented to OCID-045→044→043→042→041→OCID-021 (a *separate* chain, the
   Universal External Execution program). OCID-046 is real but its own certification was
   explicitly **declined** at registration time, it has **zero canonical artifact written**, and
   it is locked behind the same OCID-020→038→039→040 sequence pending a fresh Owner override. See
   §2 for why OCID-048 does not duplicate it.
6. **OCID-047** — grepped for `OCID-047` across `ai-os/` — zero hits. A real, honest numbering
   gap between the OCID-041–046 external-execution registration and this OCID-048 directive, not
   invented or silently skipped over.

No sub-task, UMR, or file was created as a result of this check beyond what is listed in this
document's own registration footprint (§8) — consistent with this cycle's planning-only scope.

---

## 1. What OCID-048 is

OCID-048 is the Business-Certification-phase child of OCID-020 responsible for proving, with real
evidence gathered later (not this cycle), that VERIDIAN's already-built organization/tenant/brand
model actually delivers the three guarantees a multi-organization, multi-tenant, multi-brand
platform must have:

1. **Data isolation** — organization A can never see organization B's data, and vice versa.
2. **Brand-as-configuration** — a distinct brand (this document uses `projexa-ai.com`, the real,
   already-live example) is a configuration of the one shared VERIDIAN platform, not a separate
   codebase or separate deployment.
3. **No cross-tenant leakage** — no API route, page, or background job exposes one tenant's rows
   to another tenant's session, beyond what is already spot-checked today.

This document produces the task breakdown only. Running the tasks, gathering the evidence, and
issuing the actual certification are explicitly **out of scope this cycle**.

## 2. Relationship to OCID-046 — explicitly not the same scope, not duplicated

OCID-046 ("VERIDIAN Universal Multi-Brand Multi-Tenant Platform Runtime") sounds adjacent but is a
different kind of work, registered under a different parent chain, and currently has no
substantive content:

| | OCID-046 | OCID-048 (this document) |
|---|---|---|
| Parent | OCID-045 → 044 → 043 → 042 → 041 → OCID-021 (Universal External Execution program) | OCID-020 directly (Business Certification phase) |
| Subject | Designs a *future runtime* for multi-brand/multi-tenant support, generically, for the eventual external-execution architecture | Certifies the *already-built, already-live* organization/tenant/brand model that exists today (`withTenantContext()`, RLS, `organisations` table, brand columns) |
| Canonical artifact | None yet — registration only, substantive discovery explicitly not yet dispatched | This document (task breakdown); a future evidence/certification doc once execution runs |
| Lock status | Locked behind OCID-020→038→039→040, needs a fresh Owner override to proceed past discovery | This document itself stays inside the discovery/planning permission `SEC-07` already grants; actual test *execution* (§5) will independently need to confirm it is not itself blocked by the same lock before it runs |

OCID-048 does not design new multi-brand/multi-tenant architecture and does not overlap OCID-046's
future-runtime mission. It certifies what is already built. If OCID-046 is ever picked up for real
implementation, its own discovery pass should treat this document's §3 inventory as a starting
point rather than re-deriving it, per this repo's standing reuse convention.

## 3. Real existing infrastructure this plan is grounded in (no new architecture)

All real, evidenced, already-live as of `IMPLEMENTATION_MATRIX_2026-08-02.md` item 8/9 and this
document's own re-checks:

- **Tenant isolation mechanism**: `withTenantContext()` (`tenant-scoped.ts`, commit `c2eca637`)
  sets real Postgres GUCs via `set_config()` under the dedicated `app_runtime` role (not the
  RLS-bypassing `postgres` role); called in 49/51 service files. RLS is enabled on 64+ tables.
  `tenant-isolation.test.ts` (253 lines) exercises it at the app layer.
- **Real prior positive evidence, already gathered, not re-derived here**: PR #747
  (`task-20260802-210700`) created two real, separate organizations via the Supabase Admin API
  ("Org A", "Org B"); Org B created a real department
  (`Org-B-Only-Department`, `orgId: dane6ps2f1k1fmg1tgndvl85`) via `POST /api/departments`, and
  Org B's own `GET /api/departments` returned only its own 2 rows. A second, independent run
  (`multitenant-v2.json`, referenced in `PROJEXA_AI_COM_E2E_CERTIFICATION_CONTINUATION_2026-08-02.md:75`)
  confirmed a direct cross-org fetch-by-ID returns `404 Department not found`, not the other
  org's data. **Both are real PASS results, but scoped to exactly one route
  (`/api/departments`)** — this is the honestly-disclosed gap §5 below closes.
- **Org/account provisioning mechanism, already proven, reused not reinvented**: real signup on
  `https://projexa-ai.com/signup` (`#fullName`/`#org`/`#email`/`#password`) + real Supabase
  Admin-API email-confirm bypass (`PUT {SUPABASE_URL}/auth/v1/admin/users/<id>`, body
  `{"email_confirm": true}`, using `compliance-tracker`'s own `SUPABASE_SERVICE_ROLE_KEY`) — the
  exact method `PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md` §3a-3b and PR #747 both used.
  No new provisioning mechanism is needed.
- **Brand model, already real, currently zero-adoption**: `drizzle/0221_wave_b_white_label_
  branding.sql` added 5 real columns to `organisations` (`brand_primary_color`,
  `brand_accent_color`, `favicon_url`, `custom_domain`, `email_sender_name`), backed by
  `org-branding-service.ts` and the `BrandingSection.tsx` admin UI. Per
  `IMPLEMENTATION_MATRIX_2026-08-02.md` item 9, every existing org has these columns `NULL` today
  — real, live-verified zero adoption, not a hidden gap.
- **`projexa-ai.com` is already, in real production, the same shared platform**: it is served by
  the `veridian-compliance-ai` Vercel project, per the Wave 10 domain revert
  (`UMR-20260802-134939-145d`), confirmed live via Vercel API + curl + page-body check (logged in
  `ai-os/boss/COMPLETED.yaml`, PR #720). This is direct, already-existing evidence toward
  confirmation #2 (§1) — one deployment, one codebase, serving the `projexa-ai.com` hostname.
  DNS/TLS/host-header per-brand routing is explicitly **not implemented** (migration's own
  header) — a real, disclosed limitation the task breakdown below does not attempt to design
  around, per the "no new architecture" constraint.
- **Existing live browser test harness**: the real 22-spec Playwright suite at
  `/opt/veridian/repos/projexa-ocid020-wt/e2e/*.spec.ts` (`playwright.config.ts`'s
  `use.baseURL` already defaults to `https://projexa-ai.com`), run against the no-sudo Chromium
  build at `/opt/veridian/browser/chrome`, with screenshot output convention
  `/opt/veridian/browser/screenshots/`. Confirmed via directory listing: **zero existing spec
  file names contain "tenant"/"isolat"/"org"** — no multi-org isolation spec exists yet in this
  suite. This is the real harness §5's T4 extends; it is not a new harness.

## 4. The real pending item being reused, not duplicated

Per this task's SPEC's explicit instruction, the "create a separate Tenant B demo org for
cross-tenant isolation test" work is **not** a new task minted here. It is the direct continuation
of two already-real, already-open items:

- `IMPLEMENTATION_MATRIX_2026-08-02.md`'s **Stream D**, "Multi-tenant RLS table-by-table
  verification": *"Build a real DB-level cross-org leak test against existing tenant-scoped
  tables"* — real scope, deterministic/close-ended "if scoped to existing tables only", currently
  parked in that document's own Phase 4 ("needs a scoping pass before execution").
- `PROJEXA_AI_COM_E2E_CERTIFICATION_CONTINUATION_2026-08-02.md`'s own words: *"Still open, not yet
  tested: the same probe against every other tenant-scoped route/table (this only covers
  `/api/departments`) ... Any continuation of this OCID-020 sweep ... should build on this closed
  slice rather than re-testing `/api/departments` tenant isolation from zero."*

§5's T1–T4 below **are** Stream D, scoped and sequenced for real execution, with the "Tenant B"
naming from this task's SPEC mapped onto the already-real "Org B" concept PR #747 established.
Whether Org A/Org B still exist as live rows, or need re-provisioning, is a real open question left
to T1 to check first — not assumed either way here, since no live query was run this cycle
(planning only).

## 5. Real deterministic task breakdown

Each task below: single purpose, bounded real scope, one canonical artifact, explicit dependency.
"Deterministic" = yes only if the real remaining work is a named, bounded list, not open-ended
exploration — same bar `IMPLEMENTATION_MATRIX_2026-08-02.md`'s own stream table uses.

| # | Task | Purpose | Real bounded scope | Canonical artifact (once run) | Deterministic | Depends on |
|---|---|---|---|---|---|---|
| **T1** | Confirm/provision the Tenant B demo org | Establish a real, persistent second organization (reusing "Org B" from PR #747 if it still exists live; re-provisioning it via the same Admin-API method in §3 only if it does not) so future isolation runs stop re-creating throwaway orgs per session | One real `organisations` row + one real confirmed-user credential, confirmed live via a direct query/API call before reuse or re-creation | `ai-os/boss/COMPLETED.yaml` entry recording the real org id/credential location (not the raw secret) | Yes | None (first real step) |
| **T2** | Enumerate the real tenant-scoped route/table checklist | Turn Stream D's open-ended "no table-by-table RLS verification exists" gap into a named, bounded list — the actual list of the 49/51 service files already calling `withTenantContext()` and the 64+ RLS-enabled tables | A generated list (one row per service file / table), cross-checked against `IMPLEMENTATION_MATRIX_2026-08-02.md` item 8's own counts | New checklist file, e.g. `ai-os/tasks/ocid-048/RLS_ROUTE_CHECKLIST.md` | Yes | T1 not required (read-only discovery); can run in parallel |
| **T3** | Define the real cross-org leak probe pattern | One reusable probe shape, proven correct once against `/api/departments` (PR #747): (a) Org B's own list endpoint returns only Org B's rows, (b) Org B's direct fetch-by-ID of a real Org-A-owned resource returns `404`/`403`, never `200` with Org-A data | Documented probe pattern + a helper function/script, applied per T2 row | Section of the T4 spec file below (not a separate doc) | Yes | T2 |
| **T4** | Wire T3 into the existing live browser test harness as a real, versioned spec | Replace the throwaway `/tmp/ocid020-continue/mega*.mjs` + `multitenant-v2.json` one-off scripts with one new, re-runnable Playwright spec (`e2e/`) so isolation testing is not re-invented ad hoc every OCID-020 sweep | One new spec file exercising T3's probe against every T2 row, using T1's Org A/Org B credentials | `/opt/veridian/repos/projexa-ocid020-wt/e2e/<new>-tenant-isolation.spec.ts` (or the equivalent path in whichever repo is live at execution time) | Yes | T1, T2, T3 |
| **T5** | Real brand-as-configuration confirmation | Populate the 5 real `brand_*` columns (§3) on one real org (T1's Tenant B, or a third dedicated "Brand Org" if reusing Tenant B would confound T1-T4's isolation-only purpose), confirm the UI renders the change (`org-branding-service.ts`/`BrandingSection.tsx`), and confirm the identical `projexa-ai.com` deployment (no separate repo, no separate Vercel project) serves it — i.e. brand differences are config-row-driven, not deploy-driven | One real org with non-null brand columns + one real before/after UI screenshot + one real confirmation there is no second codebase/deployment | Screenshot(s) + a short evidence note, same style as `PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md`'s own screenshot appendix | Yes, bounded to the 5 existing columns — explicitly does **not** attempt DNS/TLS/host-header routing (out of scope, no new architecture) | T1 (if Tenant B is reused for this) |
| **T6** | Real evidence package + OCID-048 certification writeup | Once T1–T5 have real, executed results, produce the actual certification artifact mapping each result to the Definition of Done (§6) | One new canonical doc, evidence-cited (file:line / screenshot / real HTTP response), same rigor standard as the OCID-020 sweep docs | `ai-os/VERIDIAN_OCID_048_..._CERTIFICATION_RESULT_<date>.md` | Yes, but explicitly **gated** — not started until T1-T5 produce real results | T1, T2, T3, T4, T5 |

**Explicitly not scheduled this cycle**: none of T1–T6 are executed by this document. This is the
breakdown only.

## 6. Definition of Done (verbatim, mapped)

Per this task's own SPEC, OCID-048 is done, once real testing later begins and completes, when
all three hold with real evidence:

1. **Real isolation tests across at least two real organizations, using the existing live browser
   test harness** → satisfied by T1 (two real orgs) + T4 (the real harness run, not a throwaway
   script).
2. **Real evidence that one organization can never see the real data belonging to another
   organization** → satisfied by T3's probe pattern applied across T2's full checklist, executed
   in T4, with results (not just a plan) captured in T6.
3. **Real confirmation that brand differences are limited to UI and business configuration only**
   → satisfied by T5's real column-populate-and-render check plus the already-real, already-cited
   single-deployment evidence in §3 (Wave 10 domain revert, PR #720).

## 7. Explicit non-goals this cycle

- No test is executed. No org is created or modified. No migration runs. No PR against `src/`,
  `drizzle/`, or any Playwright spec is opened by this task.
- No new database table, column, or architecture is proposed anywhere in this document — every
  task in §5 reuses `organisations`, `withTenantContext()`, RLS, the existing brand columns, and
  the existing Playwright harness, exactly as the SPEC requires.
- No certification is issued. §6's Definition of Done is stated as the target, not claimed as met.
- OCID-046 is not touched, re-scoped, or advanced by this document (§2).
- This document does not attempt to resolve DNS/TLS/host-header custom-domain routing
  (`IMPLEMENTATION_MATRIX_2026-08-02.md` item 9's own disclosed gap) — out of scope for a
  configuration-only brand-isolation certification.

## 8. Registration / traceability

- Canonical artifact: this file.
- Indexed in `ai-os/OS.yaml` (required by `scripts/check-metadata-index-coverage.mjs`).
- Cross-referenced, in place (not duplicated), from `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s
  Stream D row.
- Claim registered and later closed in `ai-os/boss/ACTIVE-CLAIMS.yaml` per Rule 11.
- `ai-os/CONSTITUTION.yaml` is **not** amended by this document — no new lock, no new rule; OCID-048
  operates inside the discovery/planning permission `SEC-07` already grants under the existing
  OCID-020 gate.

---

## Amendment (2026-08-03): real API-level execution of T1-T3 (T4/T5's UI half honestly deferred)

Per PM decision `UMR-20260803-151912-8be6` ("proceed with real testing execution for OCID-048...
focus on the parts that are genuinely API level testable without heavy browser DOM rendering...
real evidence required... if a genuine sub part truly needs browser DOM rendering, honestly flag
that sub part as blocked... rather than skipping it silently or faking a result").

**T1 (executed, real, this pass)**: rather than attempting to locate/reuse PR #747's original "Org
A"/"Org B" (whose credentials were never persisted anywhere in this repo, confirmed by the same
credential search done for OCID-052's execution), two fresh real organizations were provisioned via
the Supabase Admin API (`POST /auth/v1/admin/users`, `email_confirm: true` — the rate-limit-safe
method already validated for OCID-047/052), each with a real admin user, real server-side
`autoProvisionUser()` org creation confirmed live.

**T2 (executed, real, scoped)**: rather than the full 49-service-file/64-table checklist (explicitly
out of scope for a first real pass, per this session's own established "real first pass" precedent
from OCID-047/052), 3 real, distinct, non-ERP-gated tenant-scoped resources were selected —
`departments`, `fraud-cases`, `legal-matters` — each confirmed via direct code read to use
`requireAuth()` + `withTenantContext()` (or an equivalent explicit `orgId` filter) with both a real
list/create route and a real fetch-by-id route, and no module-enablement gate (so a fresh,
zero-configuration org can exercise them immediately, unlike ERP/CRM routes).

**T3 (executed, real, per this document's own already-defined probe pattern)**: each org created
one real row per resource; each org then probed the OTHER org's data two ways — (a) list-scoping:
does the viewer's own list endpoint ever include the owner's real row, (b) direct fetch-by-id: does
requesting the owner's real row ID by URL ever return `200` with real data instead of `404`.

**Real result: 12/12 probes (3 resources x 2 directions x 2 check-types) showed zero cross-org
leakage.** Every list endpoint returned only the requesting org's own rows; every direct fetch-by-id
of the other org's real, live row id returned `404`, never the other org's real data. This is real,
positive, bidirectional evidence for Definition of Done item 2 (§6) across 3 distinct real modules —
not merely "no bugs found," a genuine confirmation the isolation mechanism holds under a live probe.

**T4, honestly flagged as blocked, not skipped or faked**: wiring T3's probe into the real,
versioned Playwright spec this document's own §5 T4 calls for genuinely requires the browser test
harness. `GAP-PLAYWRIGHT-BROWSER-MISSING-SYSTEM-LIBS` (registered during OCID-052's execution,
confirmed to explicitly block this OCID by name) makes this impossible on this server right now. The
API-level probe above proves the SAME underlying isolation guarantee T4 would exercise, but does not
substitute for a real, re-runnable, versioned spec file — that remains genuinely open.

**T5, honestly flagged as blocked (its UI-rendering half), not attempted or faked**: T5's own
Definition of Done requires confirming the UI renders a populated brand column and capturing a real
screenshot -- inherently browser-level, same blocker as T4. No API route exists in this codebase
that reads back the 5 real `brand_*` columns (confirmed via a real code search:
`grep -rl "brandPrimaryColor\|brand_primary_color" src/app/api/` returned zero matches) -- so there
is no honest API-level substitute available for T5 the way there was for T4. Not attempted via a
direct DB write either, since that would test DB write mechanics only, not the actual T5 mission
(config-driven UI rendering), and this document would rather leave T5 genuinely open than report a
partial result that could be misread as satisfying it.

**T6 remains gated, unchanged**: T1-T3's real results above are ready to feed a future T6 evidence
package once T4/T5 are unblocked, per this document's own dependency chain.

Canonical artifact: this file (amendment, in place). Full raw JSON result log (12 probes) available
in this task's `PROGRESS.md` section.
