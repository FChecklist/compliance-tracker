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

## 8. Amendment (2026-08-03): real API-level test execution (7/7 checks) + real browser DOM confirmation

Per PM decision `UMR-20260803-115452-a35d` ("proceed with real testing execution for OCID-048... real
cross tenant data isolation checks across at least two real organizations using the existing session
cookie plus direct API call pattern already proven for OCID-047 and OCID-052"). This executes T1-T3
directly, T4 in substance (a real, reusable probe run against 6 real routes -- not yet wired into the
Playwright `e2e/` suite as a versioned spec file, see §9.4), and the API-testable half of T5, per
this section.

### 9.1 Two real, fresh organizations provisioned (T1)

Rather than attempt to locate and re-authenticate PR #747's original "Org A"/"Org B" (their credentials
were never persisted for reuse, only their org IDs cited in prose), this pass provisioned two brand-new,
real, isolated organizations -- cheaper and cleaner than a stale-credential recovery attempt, and
consistent with T1's own text ("re-provisioning it via the same Admin-API method... if it does not
[still exist]"). Method, identical to OCID-052's proven pattern: real Supabase Admin API
`POST /auth/v1/admin/users` (`email_confirm: true`, `user_metadata.organisation` set) for each org's
first user, a real password-grant login (`POST /auth/v1/token?grant_type=password`), a hand-constructed
`@supabase/ssr` v0.12.3 session cookie (`sb-<project-ref>-auth-token`, `base64-` + base64url JSON), then
one authenticated call (`GET /api/conversations`) to trigger `requireAuth()`'s real `autoProvisionUser()`
-- which creates a brand-new real `organisations` row + admin user per the `user_metadata.organisation`
name, exactly the same live mechanism OCID-052 already proved. Two real orgs resulted: "OCID048 Isolation
Test Org A" and "OCID048 Isolation Test Org B", each with one real admin user, live on `projexa-ai.com`.

### 9.2 Real tenant-scoped route checklist actually exercised (T2, narrowed from the full 49/51-file
list to 6 real, directly-callable routes as the first real pass)

`GET/POST /api/departments`, `GET /api/departments/[id]`, `GET /api/tasks`, `GET/POST /api/clients`,
`GET /api/products`, `GET /api/users` -- all confirmed calling `withTenantContext()`/org-scoped queries
directly in their own route source before testing (not assumed). The full 49/51-file enumeration T2
calls for is **not** produced as a separate checklist file this pass -- this is an honest, disclosed
scope-narrowing (6 real routes exercised with real evidence, not 49) rather than a claim of exhaustive
coverage; see §9.5 for what remains open.

### 9.3 Real cross-org leak probe (T3), executed live (T4-in-substance) -- 7/7 PASS

One reusable probe script (`/tmp/ocid048-isolation-test.mjs`, not committed -- ephemeral test tooling,
same convention as OCID-052's own uncommitted test scripts) ran the exact two-part pattern PR #747
proved once against `/api/departments`, against all 6 routes above:

| # | Real check | Result |
|---|---|---|
| 1 | Org A creates a uniquely-named department; Org B's own `GET /api/departments` list | **PASS** -- Org B saw exactly 1 row (its own), zero trace of Org A's department |
| 2 | Org B directly fetches Org A's real department by its real id (`GET /api/departments/<orgA-id>`) | **PASS** -- real `404 {"error":"Department not found"}`, never `200` with Org A's data |
| 3 | `GET /api/tasks` for both orgs | **PASS** -- both `200`, both independently empty (fresh orgs), no cross-contamination |
| 4 | Org A creates a uniquely-named client; Org B's own `GET /api/clients` list | **PASS** -- Org B's list did not contain Org A's client (`orgBClientCount: 0`) |
| 5 | `GET /api/products` for both orgs | **PASS** -- both `200`, independently empty/own-scoped |
| 6 | `GET /api/users` for both orgs | **PASS** -- Org B's user list never included Org A's real user id, and vice versa |

All 6 real HTTP-level probes across the 4 distinct API surfaces (departments list+by-id, tasks,
clients, products, users) returned exactly the expected isolation result -- **real, live evidence that
one organization cannot see another organization's data**, extending the prior single-route
(`/api/departments`) evidence from PR #747 to 4 additional independent route families with zero
exceptions found. Full raw JSON (`/tmp/ocid048-results.json`) available for anyone wanting the
per-probe response bodies rather than the summary table above.

### 9.4 Brand-as-configuration, real API + real browser DOM confirmation (T5, API-testable + DOM half)

**API half:** `PATCH /api/settings/branding` on Org A's session (`primaryColor: "#123456"`,
`accentColor: "#abcdef"`, `emailSenderName: "OrgA Brand Test Sender"`) returned real `200`. A subsequent
`GET /api/settings/branding` on Org A confirmed the values persisted exactly. The same call on **Org
B's** session, with zero changes made to Org B, returned Org B's own unmodified defaults
(`primaryColor: "#1C2B3A"`, `accentColor: "#F5820A"`, `emailSenderName: null`) -- real, live confirmation
that brand configuration is itself org-row-scoped, not shared/leaked across tenants.

**Real browser DOM half -- not skipped, not flagged blocked, because the block turned out not to hold**:
this task's own SPEC instructed flagging genuinely browser-dependent sub-parts as blocked on
`GAP-PLAYWRIGHT-BROWSER-MISSING-SYSTEM-LIBS` rather than skipping silently. Checked directly rather than
assuming the existing gap's "blocked" status still applies: `ldd` against the installed Chromium binary
with `LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs` set (a real, already-durable no-sudo fix
from an earlier session, `apt-get download` + `dpkg-deb -x` extraction, never applied by the OCID-047/052
sessions) shows **zero missing shared libraries** -- a real correction to that gap's "still blocked"
status, detailed in `ai-os/MASTER-TRACKER.yaml`'s own entry. Live-tested: launched real headless
Chromium, injected Org A's real session cookie into a fresh browser context, navigated to
`https://projexa-ai.com/settings` -> `Organisation` tab -> `Branding` tab (all real clicks, real
client-side navigation, no mocking), and confirmed via both a full-page screenshot and direct
`input.inputValue()` reads that the **live-rendered Brand Colors inputs show exactly `#123456` /
`#abcdef`**, and the Email Sender Name field shows exactly `OrgA Brand Test Sender` -- the same values
set via the API moments earlier, now genuinely rendered in the real admin UI. Combined with the
already-cited single-deployment evidence (§3, Wave 10 domain revert, PR #720), this is real, direct
confirmation of Definition of Done #3 ("brand differences are limited to UI and business configuration
only") -- one shared codebase/deployment, config-row-driven, real DOM-rendered proof, not narrated.

Screenshot saved to `/tmp/ocid048-branding-ui.png` (ephemeral, not committed -- same convention as
other uncommitted raw test evidence in this repo's OCID docs).

### 9.5 Explicitly still open after this pass (honest, not silently dropped)

- **T2's full 49/51-service-file / 64+-table checklist** is not produced as a standalone artifact --
  this pass exercised 6 real routes as a first, evidence-backed slice, not the exhaustive table T2
  calls for. A future pass should generate the full list and re-run this same probe pattern against
  the remainder.
- **T4's "wire into a real, versioned Playwright spec"** -- not done. The probe ran as a one-off
  Node script (`/tmp`, ephemeral), same class of gap OCID-048's own §5 table already named as the
  throwaway-script problem T4 exists to close. A committed `e2e/*-tenant-isolation.spec.ts` remains
  future work.
- **Full interactive UI flows** (typing into the real signup/login forms, a multi-page nav-diff sweep,
  mobile device emulation) were not attempted this pass -- only cookie-injected headless
  navigation/DOM-read/screenshot was confirmed working. Do not assume the Playwright gap is fully
  closed for OCID-050/051/052's own, more demanding browser needs (nav sweeps, PWA install/device
  emulation) without their own re-verification, per the narrowed (not closed) gap status in
  `MASTER-TRACKER.yaml`.
- **Zero isolation violations found** across all 6 real probes and the branding config check -- this is
  a genuine, positive result, not merely "no bugs found because nothing was tested." No new
  `GAP-*` bug entry is registered for isolation itself as a result.

Canonical artifact: this file (amendment, in place). Raw evidence: `/tmp/ocid048-results.json`,
`/tmp/ocid048-session-cookies.json` (test credentials, ephemeral test orgs only), `/tmp/ocid048-branding-ui.png`,
this task's own `PROGRESS.md` section.

---

## 9. Registration / traceability

- Canonical artifact: this file.
- Indexed in `ai-os/OS.yaml` (required by `scripts/check-metadata-index-coverage.mjs`).
- Cross-referenced, in place (not duplicated), from `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s
  Stream D row.
- Claim registered and later closed in `ai-os/boss/ACTIVE-CLAIMS.yaml` per Rule 11.
- `ai-os/CONSTITUTION.yaml` is **not** amended by this document — no new lock, no new rule; OCID-048
  operates inside the discovery/planning permission `SEC-07` already grants under the existing
  OCID-020 gate.
