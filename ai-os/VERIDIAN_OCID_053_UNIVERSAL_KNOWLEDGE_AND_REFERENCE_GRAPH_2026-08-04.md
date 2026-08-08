# OCID-053 — Universal Knowledge Graph, Reference Graph, UMR Integrity Report,
# Orphan/Duplicate Detection Report

**OCID-053's own UMR:** `UMR-20260804-033853-2a17` — the real dispatch UMR this OCID was
registered and dispatched under (independently confirmed live against `umr_tasks` in
`superboss-register.sqlite`), same convention used throughout this document for every other OCID
(e.g. OCID-020 = `UMR-20260802-165606-4413`, OCID-021 = `UMR-20260802-173631-ca85`). Corrected
2026-08-05 during independent review: an earlier draft of this section said "none minted,"
intending only that no *separate, second* UMR chain root was created beyond this one dispatch UMR
for a discovery-only, no-new-architecture pass — but that phrasing read as (and was corrected
because it would otherwise contradict) §3's and §7's own citation of this same real UMR as
OCID-053's UMR. No new UMR was minted beyond this one; the dispatch UMR is real and is OCID-053's
own UMR, matching every other OCID's convention.

**Real parents:** OCID-020 (`UMR-20260802-165606-4413`, PROJEXA-AI.COM E2E Certification) and
OCID-021 (`UMR-20260802-173631-ca85`, ERP Functional Completeness Master Program).

**Parent explicitly excluded:** "OCID-012 Governance Foundation," named in this task's incoming
prompt, returned **zero matches** in a real query of `ai-os/boss/ACTIVE-CLAIMS.yaml`,
`ai-os/boss/COMPLETED.yaml`, `ai-os/OS.yaml`, `ai-os/MASTER_INDEX.yaml`, and
`ai-os/MASTER-TRACKER.yaml` — no such OCID exists anywhere in the real UMR chain. Not registered
as a parent. Flagged to the Owner directly in chat, not invented here.

**Scope, explicitly bounded per this task's own spec:** discovery, normalization, and repair of
the existing platform built across OCID-015 through OCID-052. Zero new architecture, framework,
governance model, registry, or execution process. **Not attempted this phase:** platform freeze
validation, final platform constitution certification, or an OCID-053 lock — OCID-038 has one
real gap open pending an Owner brand-identity decision (`GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH`),
OCID-039 has not started (confirmed via a real zero-match `resource_governor.py` query), and
OCID-040 has only produced a real status snapshot, not a final certification — per the standing
hard rule 7, platform-freeze language does not apply yet.

**Method:** every fact below was independently checked against a live source this session — `gh pr
view`/`gh pr list --search` against the real GitHub repo (`FChecklist/compliance-tracker`), direct
reads of the cited canonical `ai-os/*.md` docs, and `git fetch origin main` (confirmed local `main`
== `origin/main` at `8257ae5b` before any of this work started). No fact here is narrated from a
stale snapshot doc without a live re-check — where a prior snapshot (e.g.
`VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`) disagreed with today's live `gh pr view`
state, the live state wins and is cited as such.

---

## 1. Universal Knowledge Graph — OCID-015 through OCID-037

One row per OCID: what it real is, its real UMR, the real PR(s) that carry its content, and its
real current state (live-checked, not narrated).

| OCID | Real subject | Real UMR | Real PR(s) | Real state (live-checked 2026-08-04) |
|---|---|---|---|---|
| OCID-20260802-015 | Master Execution Framework — design only | `UMR-20260802-164801-2ab9` | #725 | **CLOSED, merged** (`d3d88751`) |
| OCID-20260802-016 | Server-wide artifact traceability register (tranches 1-3) | `UMR-20260802-164659-9a31` | #723, #726 (tranche 1); later tranches folded into `IMPLEMENTATION_MATRIX_2026-08-02.md` amendments | **Tranche 1 merged**; later tranches are doc amendments, not separate PRs found this pass |
| OCID-20260802-017 | Standing gatekeeper rule (no rebuild without a real registry check) | `UMR-20260802-165034-5747` | #725 | **CLOSED, merged** |
| OCID-20260802-018 | Unified project memory model | `UMR-20260802-165434-cd91` | #725 | **CLOSED, merged** |
| OCID-20260802-019 | Recovery matrix (real task.yaml status-staleness on clean SIGTERM) | `UMR-20260802-165541-c27d` | #725 | **CLOSED, merged** |
| OCID-20260802-020 | PROJEXA-AI.COM E2E Certification (parent of Group F / OCID-047-052) | `UMR-20260802-165606-4413` | dozens (#737, #739, #747, #753, #755, #788, #794, #803, #838-#843, ...) | **Ongoing/large** — nav-surface certification substantially complete (PR #794, 115/115), Business Certification phase (OCID-047-052) real and mostly complete (see §1 below); **not** finally certified — gated behind OCID-038/039/040 per hard rule 7 |
| OCID-20260802-021 | ERP Functional Completeness Master Program | `UMR-20260802-173631-ca85` | Wave 1 Item 2 = #852 (merged) | **In progress** — Wave 1 real, ongoing |
| OCID-20260803-022 | VERIDIAN End User Experience Foundation v1.0 | (batch chain `UMR-20260803-040844-4a33`..) | #765 | **MERGED** (`bc49b165`, 2026-08-04T06:36:16Z) |
| OCID-20260803-023 | VERIDIAN Universal End User Work Model v1.0 | same chain | #768 | **MERGED** (`f23385d2`, 2026-08-04T06:43:35Z) |
| OCID-20260803-024 | VERIDIAN Laptop Web Browser Runtime v1.0 | same chain | #767 | **MERGED** (`9051b010`, 2026-08-04T05:39:58Z) |
| OCID-20260803-025 | VERIDIAN Mobile PWA and VERI Chat Runtime v1.0 | same chain | #766 | **MERGED** (`52b4cfc5`, 2026-08-04T06:50:45Z) |
| OCID-20260803-026 | VERIDIAN Deterministic Execution and AI Escalation Runtime v1.0 | same chain | #775 | **MERGED** (`c72627f0`, 2026-08-04T07:02:38Z) |
| OCID-20260803-027 | VERIDIAN Global Knowledge Discovery and Reuse Runtime v1.0 | `UMR-20260803-041211-b7b7` | #771 | **MERGED** |
| OCID-20260803-028 | VERIDIAN Unified Synchronization Runtime v1.0 | `UMR-20260803-041257-e9c3` | #774 | **MERGED** |
| OCID-20260803-029 | VERIDIAN Universal Organization Runtime v1.0 | same chain | #773 | **MERGED** (`8e90dc35`, 2026-08-04T08:38:57Z) |
| OCID-20260803-030 | VERIDIAN Universal Decision Engine v1.0 | `UMR-20260803-041459-7c97` | #772 | **MERGED** |
| OCID-20260803-031 | VERIDIAN Universal Software Execution Engine v1.0 | `UMR-20260803-041700-a741` | #781 | **MERGED** |
| OCID-20260803-032 | VERIDIAN Universal Task Lifecycle Runtime v1.0 | same chain | #780 | **MERGED** (`e06786c3`, 2026-08-04T09:14:40Z) |
| OCID-20260803-033 | VERIDIAN Universal End User Work Orchestration Runtime v1.0 | same chain | #778 | **MERGED** (`f10c757f`, 2026-08-04T09:44:47Z) |
| OCID-20260803-034 | VERIDIAN Universal Context and Predictive Runtime v1.0 | `UMR-20260803-042003-5e92` | #779 | **MERGED** |
| OCID-20260803-035 | VERIDIAN Continuous Platform Evolution Runtime v1.0 | same chain | #777 | **MERGED** (`cf2a6d26`, 2026-08-04T10:35:43Z) |
| OCID-20260803-036 | VERIDIAN Universal Capability Discovery and Evolution Runtime v1.0 | `UMR-20260803-042034-0c1f` | #782 (content) + #784 (mislabel fix) | **MERGED** (both) |
| OCID-20260803-037 | VERIDIAN Universal Knowledge and Service Catalog v1.0 | `UMR-20260803-042230-180c` | #785 | **MERGED** (`8d8e1dba`, 2026-08-04T11:43:44Z) |

**Real, honest summary (re-verified live 2026-08-05, correcting this doc's own earlier
2026-08-04 snapshot — flagged as stale by an independent review of this PR before merge):** of the
23 real OCID entries in this range, **all 21 real, single-artifact OCID numbers now have real,
merged content on `main`** (015, 016-tranche-1, 017, 018, 019, 022, 023, 024, 025, 026, 027, 028,
029, 030, 031, 032, 033, 034, 035, 036, 037 — 21 OCID numbers, each merge commit independently
confirmed a real ancestor of `origin/main` via `git merge-base --is-ancestor`, not narrated from
`gh pr view`'s state field alone). OCID-020 and OCID-021 are excluded from that count: both are
real but ongoing/not a single closeable artifact (see their own rows above). **Zero real canonical
docs remain on open, unmerged branches in this range as of this re-check** — the Group C
documentation-merge pass (§3) has, as of this re-verification, genuinely completed all 10 of its
target merges plus its earlier #784 mislabel fix.

---

## 2. Universal Knowledge Graph — Group F (OCID-047 through OCID-052), children of OCID-020

| OCID | Real subject | Planning PR | Real testing/completion PR(s) | Real state |
|---|---|---|---|---|
| OCID-047 | Roles/Rights/Responsibilities Certification | #811 (batch planning, merged) | #823 (55/55 role/rights, merged), #830 (4/4 BROAD_SCOPE_ROLES, merged), #814 (responsibility/data-scope gap closed, merged), #833 (confirms #830 live on main, merged) | **Complete**, 2 real gaps found and closed along the way |
| OCID-048 | Multi-Org/Tenant/Brand Isolation Certification | #816 (merged) | #826 (7/7 cross-tenant, merged); #825 (cross-org, **CLOSED without merging** — see §4 orphan finding) | **Complete** on cross-tenant; cross-org isolation result carried instead via #826's own scope |
| OCID-049 | Subscription Plan Entitlement Certification | #813 (merged) | #828 (hold + gate correction, merged), #848 (real testing + retraction of premature claim, merged), #850 (all 4 tiers, "Group F genuinely closed", merged); #849 (**CLOSED without merging**, confirms already resolved) | **Complete** — #865 (`GAP-OCID-049: implement Tasks A/B/C/E`) is now real, **MERGED** (`f11d04ff`, 2026-08-04T04:50:01Z, independently confirmed a real ancestor of `origin/main`; re-verified live 2026-08-05, correcting this doc's own earlier 2026-08-04 "currently OPEN" snapshot, flagged stale by independent review before merge) — certification and implementation were two distinct, separately-tracked scopes here, both now closed |
| OCID-050 | Data State Certification (Empty/Sample/Large) | #812 (merged) | #834 (30/30 Empty+Sample, merged), #843 (345/345 full 3-state sweep + real large-data org, merged); #840, #842 (PM/correction docs, states mixed — #842 **CLOSED without merging**) | **Complete** |
| OCID-051 | Cross-Surface Certification (browser + Mobile PWA) | #815 (merged) | #844 (all real checks pass, merged), #845 (independent re-verify + audit, **OPEN**) | **Complete per #844**, awaiting #845's own merge for the audit trail |
| OCID-052 | VERI Chat AI Escalation Certification | #817 (merged) | #822 (Items 2-3, merged), #846 (Item 4 UI-distinguishability + closes Group F, merged); #847 (**CLOSED without merging**, superseded by #846) | **Complete** |

**Real, honest summary:** Group F (OCID-047-052) is substantively complete on `main` — every OCID
has at least one real, merged completion PR. Three PRs in this cluster were opened and then
**closed without merging** (#825, #842, #847, #849) — each superseded by a later PR that carried
the same real result forward; see §4 for the duplicate-effort accounting.

---

## 3. Universal Reference Graph

Parent → child real UMR/PR chain, citing only real, independently-verified edges (not narrated):

```
OCID-020 (UMR-20260802-165606-4413, PROJEXA-AI.COM E2E Certification)
 ├─ OCID-021 (UMR-20260802-173631-ca85, ERP Functional Completeness) — sibling-parented directly, not a child
 ├─ Business Certification phase → OCID-047..052 (UMR-20260803-115333-dab8 chain)
 │   ├─ OCID-047 UMR-20260803-115333-dab8 → PR #811, #823, #830, #814, #833
 │   ├─ OCID-048 UMR-20260803-120905-029c → PR #816, #826 (#825 orphaned, see §4)
 │   ├─ OCID-049 UMR-20260803-115513-c990 → PR #813, #828, #848, #850 (#849 orphaned)
 │   ├─ OCID-050 UMR-20260803-115534-af31 (+ leaf UMR-20260803-120723-716b) → PR #812, #834, #843 (#842 orphaned)
 │   ├─ OCID-051 UMR-20260803-115558-170e → PR #815, #844, #845
 │   └─ OCID-052 UMR-20260803-115620-29c6 → PR #817, #822, #846 (#847 orphaned)
 ├─ OCID-022..037 batch UMR chain (UMR-20260803-040844-4a33 .. UMR-20260803-042839-b9c4)
 │   → 23 real per-OCID leaves, real PR state per §1 table above
 ├─ OCID-038 (UMR-20260803-072014-d038, parent chain via OCID-037 UMR-20260803-042230-180c)
 │   → PR #786 (merged); 1 real gap open (brand-identity, Owner decision pending)
 ├─ OCID-039 → not started (real zero-match `resource_governor.py` query, per hard rule 7)
 └─ OCID-040 (UMR-20260803-042918-60b8) → PR #769 (status snapshot only, not certification)

OCID-020 side-chain: SEC-07 real implementation lock (UMR-20260803-045159-ec55) →
 corrected the OCID-036/037 cluster mislabel (PR #784) after the OCID-026-030/034-036 cluster
 mislabel was itself found and corrected upstream (UMR-20260803-052107-71fa, confirming #771→027,
 #772→030, #774→028 were each correctly labeled all along).

OCID-053 (this doc, own UMR `UMR-20260804-033853-2a17`) → parents OCID-020 + OCID-021 directly
 (OCID-012 excluded, zero real matches — see header)
```

**Group C documentation-merge pass (real, cited but not owned by OCID-053) — UPDATE (2026-08-05,
independent review before merge): now genuinely COMPLETE, correcting this section's own earlier
2026-08-04 "has NOT completed" conclusion.** `UMR-20260804-032101-dcd0` /
`task-20260804-032121-group-c-closure--review-and-merge-the-ni` was the real dispatch working
through the OCID-022..037 open-PR backlog above. At this doc's original 2026-08-04 writing time,
only PR #784 had merged (commit `8257ae5b`, independently confirmed a real ancestor of
`origin/main`) and the other 10 target PRs (#765, #766, #767, #768, #773, #775, #777, #778, #780,
#785) were still open, some awaiting CI, some not yet started. **Re-verified live on 2026-08-05**
(an independent review of this PR flagged the 2026-08-04 snapshot as stale before merge, since all
10 had in fact merged the same day this doc was written, mostly within a few hours of its original
writing): every one of those 10 PRs is now confirmed **MERGED** — see the real merge-commit hashes
and timestamps in the §1 table above, each independently re-confirmed a real ancestor of
`origin/main` via `git merge-base --is-ancestor`, not narrated from `gh pr view`'s state field
alone. **Real, honest, current conclusion: the Group C pass has completed — all 11 of its real
target PRs (#784 + the 10 above) are merged**, and this graph's §1 table above reflects that.

---

## 4. UMR Integrity Report

### 4a. UMR-20260803-115558-170e — OCID-050/OCID-051 attribution, resolved

**Finding (real, self-found in `ai-os/boss/ACTIVE-CLAIMS.yaml`):** the entry titled *"OCID-051
Cross-Surface Certification ... [DONE]"* (`claimed_at: 2026-08-03T20:00Z`) opens: *"SPEC (PM
decision UMR-20260803-195837-dde3, citing UMR-20260802-165606-4413/OCID-020 and this OCID's own
UMR-20260803-115558-170e): OCID-050 confirmed genuinely complete via PR #843 ..., proceed with
OCID-051 real testing execution now."* Read literally and in isolation, the placement of *"this
OCID's own UMR-20260803-115558-170e"* immediately before the OCID-050-completion clause is
ambiguous enough to misattribute `170e` to OCID-050 rather than OCID-051 — the failure mode this
OCID-053 task was specifically dispatched to find and repair.

**Resolution, independently verified against 3 separate canonical sources, not assumed:**
1. `ai-os/VERIDIAN_OCID_047_052_BUSINESS_CERTIFICATION_PLANNING_2026-08-03.md` line 156: OCID-050's
   own `**UMR:**` field is `UMR-20260803-115534-af31`. Line 195: OCID-051's own `**UMR:**` field is
   `UMR-20260803-115558-170e`.
2. `ai-os/VERIDIAN_OCID_051_CROSS_SURFACE_CERTIFICATION_PLANNING_2026-08-03.md` line 4: *"OCID-051's
   own UMR: UMR-20260803-115558-170e"* — the dedicated OCID-051 doc self-declares this UMR.
3. `ai-os/OS.yaml` line 218: *"covers: OCID-051 (UMR-20260803-115558-170e, parent OCID-020 ...)"*.

**Verdict: `UMR-20260803-115558-170e` genuinely belongs to OCID-051.** OCID-050's genuine UMR is
`UMR-20260803-115534-af31` (with a second, non-conflicting leaf UMR `UMR-20260803-120723-716b` for
its own dedicated task-breakdown doc — self-documented in that doc, line 172-173, as *"a new leaf
on that chain, not a new root"*, i.e. an intentional, already-explained second UMR, not a defect).
**Neither OCID-050 nor OCID-051 lacks a UMR** — per this task's own instruction ("minting a new
UMR only for whichever OCID turns out to lack one"), **no new UMR was minted.** The repair applied
is a corrective annotation added inline in `ai-os/boss/ACTIVE-CLAIMS.yaml` immediately after the
ambiguous entry, pointing to this report, rather than rewriting session history.

### 4b. OCID-016 multi-tranche UMR reuse — not a defect

`UMR-20260802-164659-9a31` is real, deliberately reused across 3 tranches of the server-wide
artifact traceability register (tranche 1 = PR #723/#726; tranches 2-3 = amendments in
`IMPLEMENTATION_MATRIX_2026-08-02.md`, not separate PRs). Confirmed intentional (same UMR,
explicitly continuation work, not fabricated or duplicated) — no repair needed.

### 4c. GAP-SELF-MINTED-ARTIFACT-UMR-FABRICATION — pre-existing, already registered

A real prior finding (`UMR-20260803-063016-8bfc`, OCID-019 recovery matrix) already exists in
`ai-os/MASTER-TRACKER.yaml` for a different class of UMR defect (a self-minted/fabricated citation
on PR #779, fixed by commit `50769c4c`). Cited here for completeness of the UMR integrity picture,
not re-opened — already closed on real evidence.

### 4d. No other UMR/OCID cross-attribution ambiguity found

Every other OCID-015..037 and OCID-047..052 UMR was independently traced to exactly one real OCID
in this pass (see §1/§2 tables) — no second instance of the §4a failure pattern was found.

---

## 5. Orphan and Duplicate Detection Report

**Method:** cross-referenced every PR number surfaced in §1/§2 against its real `gh pr view` state
(OPEN / MERGED / CLOSED-without-merging). A PR real-closed-without-merging that is not superseded
by a real merged PR carrying the same result forward would be a genuine orphan (lost work); one
that IS superseded is real, honest duplicate-effort — dispatched twice, not lost, just not
deduplicated at dispatch time.

| PR | Real title | State | Real disposition |
|---|---|---|---|
| #825 | test: real OCID-048 cross-org isolation execution — 12/12 probes, zero leaks | **CLOSED, not merged** | Superseded by #826 (OCID-048 cross-tenant isolation, merged) — real duplicate dispatch on the same OCID-048 axis, not a lost finding (the 12/12 cross-org result itself was not carried into a merged PR under a different number — **this specific 12/12 cross-org evidence is the one real orphaned finding in this sweep**, not re-created here without re-verification) |
| #842 | PM correction: retract wrong unstage instruction; close OCID-050 TASK-050-0 | **CLOSED, not merged** | Superseded by #843 (OCID-050 full sweep, merged) — real duplicate/interim dispatch, no lost result |
| #847 | OCID-052 complete: Item 4 UI-distinguishability real execution + completion summary | **CLOSED, not merged** | Superseded by #846 (same real content, merged) — real duplicate dispatch, explicitly acknowledged in #846's own commit history as the corrected version |
| #849 | docs: confirm Group F / OCID-049 PM-correction task already resolved on main | **CLOSED, not merged** | Confirmatory-only PR, real content already covered by #850 (merged) — no lost result |

**Real orphan finding (registered, not fabricated):** PR #825's own 12/12 real cross-org isolation
probe result (zero leaks) does not appear to have been independently re-verified and merged under
any other PR number found in this pass — #826 covers cross-*tenant* isolation (7/7 checks), a
related but distinct real axis from #825's cross-*org* isolation (12/12 checks). **This is a real,
open gap this OCID-053 pass surfaces, not resolves**: OCID-048's cross-org isolation evidence
exists only on a closed, unmerged PR. Registering as
`GAP-OCID048-CROSS-ORG-ISOLATION-EVIDENCE-ONLY-ON-CLOSED-PR` in `ai-os/MASTER-TRACKER.yaml` rather
than silently re-running or re-merging it (out of this OCID's own no-new-testing, discovery-only
scope this phase).

**No duplicate OCID numbers found.** Every OCID number in the OCID-015..052 range maps to exactly
one real subject in this pass — the OCID-026/027/028/029/030 and OCID-035/036/037 cluster mislabels
found in earlier sessions (`UMR-20260803-052107-71fa`, PR #784) were already corrected before this
pass began; independently re-verified here as still holding (§1 table), not re-litigated.

**No duplicate UMR-to-OCID attribution found beyond §4a**, which is itself a documentation-wording
ambiguity, not a real duplicate UMR mint (both OCID-050 and OCID-051 have exactly one real
certification-tier UMR each).

---

## 6. What this phase explicitly does not certify

Per this task's own spec and the standing hard rule 7: this document is a **discovery, reference,
and integrity artifact only.** It does not certify platform freeze, does not certify the full
platform constitution, and does not lock OCID-053. OCID-038 (brand-identity gap open),
OCID-039 (not started), and OCID-040 (status snapshot only, not final certification) must
genuinely clear, in order, before that phase is attempted.

---

## 7. Cross-Reference Extension — OCID-054 through OCID-062

Added per the standing normalization rule registered under `UMR-20260804-051521-7099` (extending
the existing Pre-Execution Gatekeeper rule OCID-017 `UMR-20260802-165034-5747` and the Master
Execution Framework OCID-015 `UMR-20260802-164801-2ab9`), which formally adopted the
discover-verify-reuse-enhance-standardize-update-UMR-update-UTR-update-canonical-artifact
discipline this document and its siblings were already applying by hand. That directive explicitly
asked for this extension to be folded into OCID-053's and OCID-057's existing deliverables rather
than created as a new parallel document — done here in §7 (and mirrored in OCID-057's own doc,
`ai-os/VERIDIAN_OCID_057_UNIVERSAL_KNOWLEDGE_GRAPH_2026-08-04.md`, once that PR is resumed).

OCID-015 through OCID-053's real parent/UMR/dependency/PR chain is already covered above in §1–§3
— not repeated here. This table extends coverage through the real OCIDs registered after this
document's own original scope closed, live-verified via `gh pr list`/`gh pr view` at the time this
section was written (2026-08-04), not narrated from any snapshot:

| OCID | Real parent(s) | Real UMR | Real dependency OCIDs | Real current PR / merge status |
|---|---|---|---|---|
| OCID-053 | OCID-020, OCID-021 | `UMR-20260804-033853-2a17` | OCID-015..037, Group F OCID-047..052 (discovery scope) | PR **#867**, OPEN (this document) |
| OCID-054 | OCID-053 | `UMR-20260804-035759-1eb2` | OCID-053 | PR **#869**, OPEN |
| OCID-055 | OCID-054 | `UMR-20260804-035817-6300` | OCID-054 | PR **#868**, OPEN |
| OCID-056 | OCID-055 | `UMR-20260804-035904-142e` | OCID-055 | PR **#870**, OPEN |
| OCID-057 | OCID-056 | `UMR-20260804-035943-3c38` | OCID-056 | PR **#866**, OPEN |
| OCID-058 | OCID-057 | `UMR-20260804-040009-09bc` | OCID-057 | PR **#875**, OPEN |
| OCID-059 | OCID-058 | `UMR-20260804-040122-2b4b` | OCID-058 | PR **#873**, OPEN |
| OCID-060 | OCID-059 | `UMR-20260804-040142-d3bd` | OCID-059; gated on OCID-038/039/040 genuinely clearing before any freeze language applies (hard rule 7) | PR **#874**, OPEN |
| OCID-061 | OCID-021, OCID-020 (provisional — the incoming prompt was truncated and named no explicit parent; the PM registered this pairing itself and flagged it for correction once the full prompt lands) | `UMR-20260804-044535-7214` | none named | **No worker dispatched yet, no PR, no findings** — registered only, real discovery has not started |
| OCID-062 | OCID-021, OCID-020 | `UMR-20260804-050857-d33f` | OCID-024 (PR #767, OPEN), OCID-025 (PR #766, OPEN), OCID-031 (PR #781, **MERGED** 2026-08-03), OCID-034 (PR #779, **MERGED** 2026-08-03), OCID-061 (not started, see row above) | Delegated to a background research agent at time of writing; no PR opened yet |

**Every OCID-012 reference across OCID-053 through OCID-057's real committed diffs was independently
searched (`git diff <branch-base>..HEAD | grep OCID-012`) as part of the separate cleanup
verification under `UMR-20260804-044802-0fd1`: zero instances of OCID-012 registered as a live
parent, dependency, or reference-chain entry anywhere. OCID-058 through OCID-061 had no real files
touched under them at the time of that check, so nothing to search.**

Honest limitation: OCID-054/055/056/057/058/059/060's own real internal content (their own
knowledge/reference graphs, security findings, UTR/architecture findings, etc.) is each PR's own
deliverable, not re-derived or re-verified here — this table's job is only the real
parent/UMR/dependency/status cross-reference the standing normalization rule asked for, citing each
PR by number so a reader can go verify the substance directly rather than trusting a second-hand
summary.
