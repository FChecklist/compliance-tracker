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
