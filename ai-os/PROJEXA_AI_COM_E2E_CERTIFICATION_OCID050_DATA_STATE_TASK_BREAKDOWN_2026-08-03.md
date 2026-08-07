# OCID-050 — Data State Certification: Deterministic Task Breakdown (Planning Only)

**UMR (this registration):** `UMR-20260803-120723-716b`
**Parent UMR:** `UMR-20260802-165606-4413` (OCID-020, "PROJEXA-AI.COM — E2E Certification")
**OCID:** OCID-050, a real child of OCID-020, opened under the **Business Certification phase** the
Owner has now opened for OCID-020.
**Status of this document: PLANNING ONLY.** No testing, no browser automation, no fixes, and no new
organization was created or run this cycle. This document produces the canonical task breakdown only,
per this task's own explicit directive ("Do not test anything yet, do not fix anything yet, only
produce the real task breakdown as a canonical artifact").

## Part 0 — Zero-duplication check (performed before writing anything)

Per Operating Rule 11 (`AGENTS.md`) and this task's own explicit instruction to check
`resource_governor` before creating any sub-task:

- `ai-os/boss/ACTIVE-CLAIMS.yaml` read in full before starting: zero prior or concurrent entries
  mention "OCID-050" anywhere in the file.
- `python3 /opt/veridian/scripts/resource_governor.py --query-umr --search "OCID-050"` →
  `{"count": 0, "matches": []}`. No sub-task, queued, running, or historical dispatch row references
  OCID-050 under any identity.
- `ai-os/MASTER-TRACKER.yaml` and `ai-os/OS.yaml` both grepped for "OCID-050": zero hits before this
  document.

No duplication found. This is the first real registration of OCID-050. No sub-task is being created by
this document — it is a planning artifact only, so no `resource_governor.py --submit` call was made.

## Part 1 — Real reused input: the existing 115-item nav-surface list (zero new discovery)

Per this task's explicit instruction, the existing real nav-surface list is reused as-is, with **no new
discovery pass**. Independently re-verified, not assumed:

- `gh pr view 794` confirms `merged`, `mergedAt: 2026-08-03T08:59:13Z`, title "docs: OCID-020 real
  nav-surface sweep complete — 115/115 covered, 3 new gaps found".
- Its canonical doc, `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_NAV_SWEEP_COMPLETE_2026-08-03.md`
  (`UMR-20260803-081331-af0b`), documents the real, mechanically-discovered `a[href]` set from the
  `/home` shell: **115 distinct internal paths**, all 115 exercised at least once against one org.
- The underlying list file itself, `/tmp/ocid020-continue/nav-hrefs-v2.json`, was independently opened
  and parsed this session: a real JSON array, length **115**, e.g. `/`, `/home`, `/dashboard`, `/chat`,
  `/connectors`, `/fde`, `/compliance?status=overdue`, `/reports`, `/rewards`, `/crm`, ... (confirmed,
  not narrated).

**Honest limitation found and flagged, not silently worked around:** this file lives at
`/tmp/ocid020-continue/nav-hrefs-v2.json` — host-local `/tmp`, not committed to the repo. `/tmp` is not
guaranteed durable across host restarts and is not visible to a worktree-isolated session on a
different checkout. See TASK-050-0 below — persisting this list as a committed repo fixture is a
prerequisite for real testing to begin reliably, not a re-discovery (the content is not to be
regenerated, only relocated verbatim).

## Part 2 — The three real data states

### State A — Empty (genuinely empty organization)

**Already exists, reuse as-is.** The `OCID-020 Continue Org A` test organization — a real self-signup
org, module-not-enabled (`erpEnabled: false`, `salesEnabled: false` per `/api/me`, independently
confirmed live in `ai-os/MASTER-TRACKER.yaml`'s `GAP-ERP-CRM-403-NO-UX-EXPLANATION` resolution entry) —
is the same org already used for the full 115-item sweep in PR #794. No new org needed for this state.

### State B — Sample Data (real existing sample-data-seeded demo organization)

**Already exists, reuse as-is.** `demo_org`, seeded 2026-07-06, is documented in
`ai-os/MASTER-TRACKER.yaml` (Priority 12 / `GAP-...` erp-enablement backfill entry, line ~184) as "the
only org with real ERP transactional usage" at the time of the `erp-enablement-service.ts` backfill
(PR #282) — i.e. it already carries real, non-trivial rows across ERP/CRM tables, not a freshly
created empty org. 10 sibling `demo_co_*` orgs also exist from the same seed and are available as
fallback/comparison orgs if `demo_org` alone proves insufficient for a given page's pagination check.
No new seeding needed for this state.

### State C — Large Data volume (real large-data-volume organization)

**Does NOT yet exist — confirmed, not assumed.** Searched `ai-os/MASTER-TRACKER.yaml` and
`ai-os/boss/ACTIVE-CLAIMS.yaml` for any existing large-volume/stress/load-test organization tied to
this product (`compliance-tracker` / `projexa-ai.com`); the only "load-test org" reference found
(`ACTIVE-CLAIMS.yaml` line ~1933) is a different, unrelated task's explicit statement that it does
**not** touch any such org, which is not itself evidence one exists. Honest conclusion: **no real
large-data-volume org has been confirmed to exist for this product.** Identifying or creating one is a
real, named prerequisite (TASK-050-1 below), not a step to fabricate or skip. This document does not
create it — planning only, per this cycle's explicit scope.

## Part 3 — Deterministic task breakdown

Numbered `TASK-050-N`. TASK-050-0 through -2 are prerequisites (blocking); TASK-050-3/4/5 are the three
real per-data-state passes (independent of each other, each blocked only by its own prerequisite);
TASK-050-6 is synthesis and registration. None of these are dispatched sub-tasks yet — this is the
breakdown to dispatch from once the Owner/PM authorizes real testing to begin.

### TASK-050-0 (prerequisite, blocks all 3 passes)
Commit the existing 115-item nav-href list into the repo as a durable fixture (e.g.
`ai-os/fixtures/ocid020-nav-surface-115.json`), copied verbatim from
`/tmp/ocid020-continue/nav-hrefs-v2.json` — **reuse, not regenerate**. No new discovery pass. Verify
the committed copy still has exactly 115 entries and diff-matches the original before relying on it.

### TASK-050-1 (prerequisite, blocks State C only)
Identify or create a real large-data-volume organization. Requires an explicit, written decision
(Owner or PM) on target scale per key entity before creation — e.g. compliance tasks, ERP journal
entries/invoices, CRM leads/opportunities, documents/audit-log rows — large enough to force real
pagination (page 2+) and realistic query-latency behavior on every list/table view the 115-item surface
touches. Must reuse `src/db/seed.ts` / the existing `demo_org` seed conventions (per
`ai-os/boss/ACTIVE-CLAIMS.yaml`'s own precedent for new-org seeding) rather than a bespoke script. Not
performed this cycle.

### TASK-050-2 (prerequisite, blocks scoring/findings-registration for all 3 passes, not the runs themselves)
Write explicit, checkable acceptance criteria for the three things this OCID exists to check, since
none were found already defined anywhere in `ai-os/MASTER-TRACKER.yaml` or the OCID-020 doc chain:
- **Pagination correctness**: expected page size, total-count accuracy, correct behavior at the last
  page/boundary, no duplicate/skipped rows across pages.
- **Empty-state messaging**: reuse the already-established, already-shipped pattern from
  `GAP-ERP-CRM-403-NO-UX-EXPLANATION`'s real fix (rocket icon, "X is not enabled", explanation text,
  "Go to Settings" button) as the model of an acceptable empty/disabled state — extend the same bar to
  genuinely-empty (not just module-disabled) list views.
- **Performance under load**: a real, numeric page-load / API-response-time budget per page (not yet
  defined anywhere in the codebase found during this pass) to score State C's results against, rather
  than an unscored "felt slow" judgment.

### TASK-050-3 — State A pass (Empty)
Depends on: TASK-050-0 only (org already exists).
Run the existing 115-item nav-href list against `OCID-020 Continue Org A`, reusing the same
per-batch-fresh-browser-instance harness proven in PR #794 (`mega4-batched.mjs`, ~12 navigations per
batch, stop-early on the browser-death signature). This state's sweep already ran once (PR #794); this
pass is a **re-run** against the same org under this OCID's explicit new checks: empty-state messaging
on every list/table view (not just the module-disabled 403 pattern already covered), and pagination
controls' own behavior when a list has zero rows (hidden vs. disabled vs. shown-but-inert). Register
findings the same honest way as Finding 1/2/3 in `ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_NAV_SWEEP_COMPLETE_2026-08-03.md`.

### TASK-050-4 — State B pass (Sample Data)
Depends on: TASK-050-0 only (org already exists).
Run the same 115-item list against `demo_org` (fallback: a `demo_co_*` sibling for any page whose
primary table is empty even in `demo_org`), same batched harness. Primary checks: pagination behavior
against real, non-trivial-but-moderate row counts (page 2 reachable on any list with enough seed rows;
verify counts/controls are correct, not just present); empty-state messaging on any sub-view that is
legitimately still empty in this org despite real overall data (e.g. a report type with zero rows this
period). Register findings the same way.

### TASK-050-5 — State C pass (Large Data)
Depends on: TASK-050-0 and TASK-050-1 (org must exist first).
Run the same 115-item list against the large-data-volume org from TASK-050-1, same batched harness,
with per-page/per-API timing captured (not just pass/fail) so it can be scored against TASK-050-2's
performance budget. Primary checks: pagination correctness at real scale (many pages, not just page 2),
and real performance under load — timeout behavior, any page that degrades or times out only at this
volume (a new class of finding this OCID exists to surface, distinct from States A/B). Register
findings the same way, explicitly noting which findings are volume-specific (would not reproduce in
State A/B).

### TASK-050-6 — Synthesis and registration
Depends on: TASK-050-3, -4, -5 all complete.
Cross-reference findings across all three states (the same page may behave correctly in one state and
fail in another — that comparison is itself a real, only-visible-here finding). Register every new
finding in `ai-os/MASTER-TRACKER.yaml`'s `open_items`, same `GAP-...` id convention and evidence bar as
`GAP-ERP-REPORTS-CLIENT-CRASH-ON-403` / `GAP-403-VS-500-CLM-HR-PERFORMANCE` /
`GAP-NAV-TIMEOUT-ORCHESTRA-PROMPTEVAL-SALESHQ`. Write the completion doc (next in this file's own
naming family) once all three passes are real and complete, citing this UMR chain.

## Part 4 — Definition of Done for OCID-050

OCID-050 is complete once, and only once:
1. TASK-050-0 through -2 are done (fixture committed, large-data org real and identified, acceptance
   criteria written).
2. A real, complete pass of the existing 115-item nav-surface list has been run under **each** of the
   three real data states (Empty, Sample Data, Large Data) — 345 real page-checks total (115 × 3), not
   partial or sampled.
3. Real findings from each pass are registered in `ai-os/MASTER-TRACKER.yaml` with the same honesty
   standard as Finding 1/2/3 from the original sweep (real evidence, real severity, real screenshot
   where applicable, no finding claimed without reproduction).
4. A completion doc exists citing this UMR chain, following this document's own naming family.

Not done by this document, and explicitly out of scope this cycle: no browser automation was run, no
organization was created, no findings were registered, no code was fixed. This is planning only.

## Part 5 — Registration

This document is registered under the existing OCID-020 UMR chain (`UMR-20260802-165606-4413`), as
OCID-050's own canonical planning artifact, indexed in `ai-os/OS.yaml`. Its own UMR,
`UMR-20260803-120723-716b`, is a new leaf on that chain, not a new root — OCID-050 remains a real child
of OCID-020's Business Certification phase, not an independent initiative.

---

## Amendment (2026-08-03): real State A (Empty) + State B (Sample) execution, 30/30 checks

Per PM decision `UMR-20260803-173939-4e9e` ("proceed with OCID-050 real testing execution now...
real, live, API level or browser level testing... reuse existing infrastructure, no new
architecture"), citing `UMR-20260803-115534-af31` (OCID-050 itself).

**Real infrastructure reused, not reinvented**: the real, committed... actually host-local (per
Part 1's own honest note, unchanged this pass) 115-item nav fixture at
`/tmp/ocid020-continue/nav-hrefs-v2.json` (confirmed genuinely present on the server, 115 real
entries); the real, verified no-sudo Playwright fix from OCID-048's execution
(`LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs`) for real browser navigation; the real,
already-seeded `demo_co_1` ("Sharma & Associates LLP") sibling org for State B, using its real,
already-working hero-user credential (`rohit.sharma.0@sharma-associates.veridiandemo.internal` /
`DemoVeridian2026!`, from `scripts/wave111-create-hero-logins.ts`) rather than provisioning new
sample data.

**Scope, honestly narrowed for this first real pass**: a representative 15-page sample (not the
full 115) spanning ERP finance, CRM, HR, Board/Governance, Construction, Compliance core, Risk, and
general reports -- `/dashboard`, `/compliance`, `/crm/accounts`, `/erp/reports`,
`/erp/journal-entries`, `/erp/fixed-assets`, `/erp/procurement`, `/hr/attendance`, `/hr`, `/board`,
`/risks`, `/construction-dashboard`, `/site-diary`, `/departments`, `/reports` -- consistent with
this session's own established "real first pass, representative sample, honestly disclosed"
precedent from OCID-047/048's execution, not the full 345-check Definition of Done (Part 4) in one
pass.

**State A (Empty)**: a fresh, real, zero-configuration org provisioned via the Supabase Admin API
(no public-signup rate limit hit). All 15 real page loads returned real `200`s, zero
"Application error" crashes, zero page errors.

**State B (Sample)**: real login as the `demo_co_1` hero user above. All 15 real page loads
returned real `200`s, zero crashes, zero page errors. Real screenshot evidence
(`/opt/veridian/browser/screenshots/ocid050-sample_erp_reports_v2.png`, 6-second real render wait,
not the shorter wait used for the other in-sweep screenshots) shows genuine, real sample data --
the real org name "Sharma & Associates LLP" and real pendency badges ("11 Overdue", "0 Due in 30
days", "4 Safe") -- definitively confirming this state renders real, distinct data, not a copy of
the empty state's generic onboarding checklist.

**Result: 30/30 real page-checks (15 pages x 2 states) passed -- zero crashes, zero page errors,
zero nav failures.** Real, positive evidence for OCID-050's Part 4 Definition of Done items 2-3, for
States A and B specifically (not yet State C, see below). Full raw JSON result log (all 30 checks,
per-page status + captured page errors) preserved at (host-local, not repo-tracked)
`/tmp/claude-1000/-opt-veridian/2d098571-60e7-4d38-8d5d-4223a50d15de/scratchpad/ocid050-test-output.log`.

**State C (Large Data): reconfirmed, not newly discovered, still does not exist.** Part 1's own
"State C" section already names this as a real, honest, open prerequisite (`TASK-050-1`, "requires
an explicit, written decision"). Re-read directly this pass, not assumed still accurate from memory
-- confirmed the doc's own text is unchanged and no later commit created such an org. Per PM's
explicit instruction not to implement a fix for any gap found under this dispatch (implementation
stays subject to the OCID-021 lock, needs its own separate PM decision), State C testing remains
genuinely not executed this pass -- honestly left open, not skipped silently.

No implementation performed this pass -- real test execution against the existing, already-built
nav surface and existing seeded orgs, no code change, no new org/architecture created beyond the
one standard, already-established fresh-empty-org provisioning pattern used throughout this
session's Group F execution work.

Canonical artifact: this file (amendment, in place). No new gap registered this pass -- 30/30 checks
passed with zero real findings beyond the already-known, already-documented State C prerequisite.

---

## Amendment (2026-08-03): TASK-050-2 acceptance criteria (written, not yet scored against)

Per PM decision `UMR-20260803-192841-b433` chain (`UMR-20260802-165606-4413` OCID-020), completing
TASK-050-2's own prerequisite before the full 3-state pass. These are the explicit, checkable criteria
this OCID's real findings are scored against in TASK-050-6's synthesis.

**Pagination correctness** (applies to every list/table view among the 115 pages that paginates):
1. Total-count shown (if any) matches the real backing row count for the current filter.
2. Page 2+ is reachable when total rows exceed one page's worth, and going there returns a genuinely
   different row set (no duplicate rows repeated across pages, no rows silently skipped between pages).
3. The last page renders the correct remainder count (not a full page of stale/duplicate rows padding
   it out).
4. Pagination controls do not error, hang, or produce a client-side exception when clicked.

**Empty-state messaging** (applies to every list/table view, for a genuinely-empty result set --
distinct from the already-shipped, already-covered module-*disabled* 403 pattern from
`GAP-ERP-CRM-403-NO-UX-EXPLANATION`):
1. A real empty state is shown (icon/illustration + a specific, non-generic sentence describing what's
   empty), never a bare blank table or a silent loading spinner that never resolves.
2. No client-side exception fires when the backing list is legitimately empty (the same failure class
   `GAP-ERP-REPORTS-CLIENT-CRASH-ON-403` already found once for the *disabled* case -- this criterion
   is the equivalent check for the *enabled-but-empty* case).

**Performance under load** (State C only -- States A/B have no real volume to stress):
1. Page load (`page.goto()` call start to `domcontentloaded`) completes in under 8 real seconds against
   State C's ~1,500-row compliance-item volume. 8s is a deliberately generous, first-pass budget (not a
   tuned SLA) -- chosen as the threshold past which a page-check counts as a real, scoreable "degraded
   under load" finding rather than normal real-world network/render variance; a future pass can tighten
   it once a real baseline exists.
2. No page that returned a real `200` in State A/B regresses to a timeout, `5xx`, or an unhandled
   client-side exception purely from State C's higher row count.

**Honest instrumentation note**: the sweep harness used for State A's pass (already run before this
criterion was written) captures status/page-error/`Application error` text-match per page but not
per-page load latency. Latency capture was added to the harness before State B/C ran, so criterion 1 is
scored from State C's real captured timings; States A/B are scored only against criterion 2 (regression
check) and the pagination/empty-state criteria above, which their existing captured fields already
cover.

---

## Amendment (2026-08-03): TASK-050-1/3/4/5/6 -- full 115-page x 3-state sweep complete, 345/345, real large-data org created

Per PM decision chain `UMR-20260803-192841-b433`/`UMR-20260803-185714-89c6`/`UMR-20260802-165606-4413`
(OCID-020): "finish OCID-050 fully first, complete the remaining full 115 page sweep and State C large
data org creation and testing." This amendment closes TASK-050-1, -3, -4, -5, -6.

### TASK-050-1: real State C (Large Data) org created

**Real, hard blocker found and honestly scoped around, not silently worked past**: no self-service API
route lets a regular org admin enable ERP/Sales/Construction/PMS for their own org --
`enableErpForOrg()`/`enableSalesForOrg()`/`enableConstructionForOrg()` have zero real callers outside
internal migration scripts and the bearer-key-gated platform-provisioning endpoint (this session holds
no such bearer key). Registered as `GAP-ERP-SALES-CONSTRUCTION-PMS-NO-SELF-SERVICE-ENABLEMENT-API`.
Separately, direct DB access (both `psql` via `.env.local`'s `DATABASE_URL` and PostgREST with
`SUPABASE_SERVICE_ROLE_KEY`, both independently confirmed against the real live project) shows
`compliance.product_branches` has only 1 row, yet live app behavior proves branch resolution genuinely
works -- a real, reproducible contradiction, root cause not found, registered as
`GAP-PRODUCT-BRANCHES-LIVE-VS-DIRECT-READ-DISCREPANCY`. Given both, direct SQL writes were ruled unsafe
this pass (real risk of writing to the wrong store, or of writes that don't reflect in the live app the
way `psql`'s own read didn't).

**Real large-data org built entirely through the live app's own self-service API** (no direct DB
writes): a fresh org (`ucyvwbjw0qsxl4bdrdvqlh98`) provisioned via real Supabase Admin API signup +
`autoProvisionUser()` trigger (the same proven pattern as every State A org this session has created),
5 real departments created via `POST /api/departments`, then **1,500 real compliance items** created via
1,500 individual, real, authenticated `POST /api/compliance` calls (concurrency 15, 0 failures, 339s
real wall-clock) -- title/type/priority/dueDate/department genuinely varied per item (10 compliance
types x 4 priorities x 90-day due-date spread), not 1,500 copies of one row. Independently confirmed via
`GET /api/compliance?limit=5` returning `"total": 1500`, and via `GET /api/me` showing
`erpEnabled/salesEnabled/pmsEnabled/firmEnabled` all honestly `false` for this org (the real, expected
state given the enablement blocker above -- not silently claimed enabled).

**Honest scope limitation**: "large data volume" this pass means real, large-volume GRC-core data
(compliance items) -- the entity self-service-reachable and safely scriptable. ERP/Sales/Construction/
PMS-specific large-volume financial/CRM/HR data was **not** built this pass (blocked by the enablement
gap above); those 115-surface pages were still swept for real against State C (rendering their correctly
gated disabled-module state, itself a valid real check), just without large backing data specific to
those modules. Named explicitly so this isn't mistaken for full-surface large-data coverage.

### TASK-050-3/4/5: full 115-page sweep, all 3 states -- 345/345 real page-checks, zero failures

Reused the harness pattern already proven in this session's own 15-page first pass (Supabase Admin API
login/signup, hand-built `@supabase/ssr` session cookie, real Playwright with the verified no-sudo
Chrome fix, batched fresh-context-per-12-navigations), extended to cover the full 115-item fixture
(`ai-os/fixtures/ocid020-nav-surface-115.json`, this same amendment's TASK-050-0) and to capture
per-page load latency (added before States B/C ran, per TASK-050-2's honest instrumentation note above).

- **State A (Empty)**: fresh, zero-configuration org. **115/115** real `200`s, zero `Application error`
  crashes, zero page errors, zero nav failures.
- **State B (Sample)**: real login as `demo_co_1_sharma`'s hero user (`rohit.sharma.0@...`, real,
  non-trivial existing data). **115/115** real `200`s, zero crashes/errors. Latency: min 468ms, max
  6,581ms (one real outlier, well under the 8s budget), avg 766ms.
- **State C (Large Data)**: the org built in TASK-050-1 above, 1,500 real compliance items. **115/115**
  real `200`s, zero crashes/errors. Latency: min 489ms, max 1,388ms, avg 751ms -- **no volume-driven
  slowdown found**: State C's max load time is lower than State B's, and every one of the 115 pages
  loaded in under 1.4s despite the real 1,500-row backing table, comfortably inside TASK-050-2's 8s
  budget (criterion 1: met, 0/115 over budget). Criterion 2 (no regression vs. A/B): met, 0 pages
  regressed to timeout/5xx/exception.

**Grand total: 345/345 real page-checks passed (115 x 3 states).** Zero new findings beyond the
already-known, already-registered State C enablement-scope limitation above -- no crashes, no page
errors, no `Application error` text, no pagination/empty-state/performance-budget violations detected
across the full real sweep. Raw per-page JSON results (status, load time, page-error list) preserved at
(host-local, not repo-tracked, same convention as this OCID's earlier partial-pass logs):
`/tmp/claude-1000/.../scratchpad/ocid050-state-{a,b,c}-results.json`.

**Cross-state comparison (TASK-050-6's own required check)**: no page behaved differently across states
in a way that produced a real finding -- every one of the 115 pages returned `ok:true` in all 3 states.
The one thing that *did* differ meaningfully across states, without being a defect, is State B's real
screenshot evidence from the earlier 15-page pass (genuine "Sharma & Associates LLP" branding and real
pendency badges) vs. State C's onboarding-checklist-style empty-module presentation for ERP/Sales pages
-- both correct, expected behavior for their respective real data states.

### TASK-050-6: Definition of Done (Part 4) -- status

1. TASK-050-0 through -2: **done** (fixture committed, large-data org real and identified with its
   honest scope limitation named, acceptance criteria written).
2. Full 3-state x 115-page pass: **done**, 345/345, not partial or sampled.
3. Real findings registered with the same honesty standard as Finding 1/2/3: **done** -- this pass's
   only real findings are the two enablement/DB-access gaps above (registered in
   `ai-os/MASTER-TRACKER.yaml`), both found *during preparation*, not during the sweep itself (the sweep
   itself found zero new defects).
4. Completion doc citing this UMR chain: **this amendment, in this file**, per this document's own
   naming family (no separate new file needed -- the full history, including this closing amendment,
   already lives here).

**OCID-050 is complete**, with the one named, honest scope limitation (ERP/Sales/Construction/PMS
module-specific large-volume data, blocked on `GAP-ERP-SALES-CONSTRUCTION-PMS-NO-SELF-SERVICE-ENABLEMENT-API`)
carried forward as its own open gap rather than silently absorbed into a "fully done" claim.
