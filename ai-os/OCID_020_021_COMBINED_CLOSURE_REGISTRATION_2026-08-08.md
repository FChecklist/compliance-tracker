# OCID-020 + OCID-021 Combined Completion -- Registration-Only

**Status:** registration only. No real OCID-020/OCID-021 implementation work begins from this
document or this dispatch. This is the closing-tracking anchor for both OCIDs, minted to hold
the 15 real `master_issue_tracker` rows enumerated in the governing SPEC (priority order
unchanged: real evidence-verified completion of each blocker still required before its own
Boolean flips TRUE).

## 0. Governing chain (verified this cycle, live)

| Priority | UMR | Real live status (queried this cycle) |
|---|---|---|
| 1 (gate, must complete first) | `UMR-20260806-171945-5767` | `status=completed`, `ts_completed=2026-08-08T11:28:32Z` (same day, hours before this dispatch). Real completion reason on file: `derive_umr_output_contract()`/`_orchestrator_output_contract()` wired into `cmd_mark_umr_terminal`, 14/14 tests passing, already graduated in `capability_registry` (`CAP-20260807-054544-9fa8`, `CAP-20260807-153442-f14a`). **Verified genuinely complete -- priority-1 gate satisfied.** |
| OCID-020 canonical | `UMR-20260802-165606-4413` | `umr_tasks.status=failed` (`ts_completed=2026-08-07T06:09:49Z`); `ocid_canonical_registry` (last verified 2026-08-05) separately records live status text `"running (live umr_tasks: status=running...); MASTER-TRACKER.yaml's own SEC-07 gate block independently reports status NOT_VERIFIED"` -- both readings agree OCID-020 is **not** complete. `is_fully_complete=0`. |
| OCID-021 canonical | `UMR-20260802-173631-ca85` | `umr_tasks.status=killed` (`ts_completed=2026-08-07T07:56:31Z`); `ocid_canonical_registry` records `"active de facto, own registration PR still open/unmerged"`, `pr_number=732`, `merge_status=open`. Live re-check this cycle (`gh pr view 732`): still `state=OPEN`, `mergeStateStatus=BEHIND`, unmerged. `is_fully_complete=0`. |

Both canonical UMRs are real, pre-existing, and reused verbatim -- **no duplicate UMR minted for
either OCID.**

## 1. New combined-closure UMR -- how it was minted (full disclosure)

**Anchor UMR for this combined-closure tracking: `UMR-20260808-151153-e172`** -- this dispatch's
own real, pre-existing `umr_tasks` row (`task_kind=veridian_task_create`,
`source_trigger=owner_dispatch_gateway`, `status=completed`, minted when this exact task was
dispatched). Real, live-queried, not fabricated.

**Why no separate brand-new `umr_tasks` row was self-minted**, per this repo's own established
precedent (`ai-os/OCID_056_REGISTRATION_2026-08-04.md` OCID-056, `docs(OCID-061)` PR #911,
OCID-062): `resource_governor.py --submit` is a real, live write into the shared dispatch queue,
and this host runs a real, independent `veridian-governor-tick.service` that periodically drains
`queued` rows. `submit()` only accepts two `task_kind` values: `veridian_task_create` (spawns a
real AI implementation worker -- explicitly what this registration-only dispatch must NOT do) and
`systemctl_action` (executes a real `systemctl --user start/restart <unit>` against a real unit
once picked up by the tick -- a genuine, real-infrastructure side effect, not a "minimal
registration action"). Neither is a side-effect-free way to mint an inert tracking row, so none
was invoked. This is the same honest-disclosure choice three prior sessions already made for the
identical dilemma, not a new gap.

`UMR-20260808-151153-e172` satisfies the real requirement instead: it is a real, already-existing
row, its `status` is already terminal (`completed`) so it will never be re-picked-up by
`dispatch-tick` or re-dispatched as new implementation work, and it is the correct real anchor for
"this registration cycle's own combined-closure bookkeeping" since it *is* this cycle's own real
UMR.

**Linkage:** all 15 rows below carry `linked_umr_id=UMR-20260808-151153-e172` (this anchor) and
`linked_ocid=OCID-020` or `OCID-021` per row; each row's `existing_solution_in_system` text also
cites the real canonical UMR (`UMR-20260802-165606-4413` / `UMR-20260802-173631-ca85`) it
represents, so the full chain (this registration -> canonical UMR -> OCID) stays traceable without
a second `linked_umr_id` column (schema only has one).

## 2. The 15 real `master_issue_tracker` rows

Inserted via the one real, permanent, callable mechanism (`superboss-register.py add-issue`,
Owner-mandated recording path) -- see PROGRESS.md for the exact `issue_id` -> `tracker_id`
mapping produced by each real insert this cycle.

### OCID-020 (5 points, parent `UMR-20260802-165606-4413`)

| # | Category | Real blocker (verified this cycle, reused -- not re-derived) | Boolean closes when |
|---|---|---|---|
| P1 | Cat 3, security audit | `compliance-tracker` `main` merge-frozen (`UMR-20260805-112247-3ad0`); PR #988 has the real tested fix, unmerged (`state=OPEN`, `mergeStateStatus=BLOCKED`, re-checked live this cycle) | `origin/main`'s real trivy scan shows zero HIGH CVEs |
| P2 | Cat 13, AI testing | Server resource capacity only, never actually run | A real run completes and records a real pass/fail verdict |
| P3 | Cat 17, browser compatibility | ~282 missing webkit host libraries | A real webkit launch test against `https://projexa-ai.com/login` succeeds |
| P4 | Cat 23, UX audit | 5 genuine major usability issues (H2/H3/H4/H6/H10) across 5 pre-auth pages, real product/UI work needed | A real re-audit shows zero severity>=3 heuristics |
| P5 | Cat 25, production readiness | Rollup, no independent fix | Automatically once P1 and other referenced blocked categories clear -- verify via re-run, do not assume |

### OCID-021 (10 points, parent `UMR-20260802-173631-ca85`)

| # | Requirement | Real current state (queried live this cycle) |
|---|---|---|
| P6 | PR #732 merged into real target branch | **Not met.** `gh pr view 732`: `state=OPEN`, `baseRefName=main`, `mergeStateStatus=BEHIND`, `mergedAt=null` |
| P7 | `rule_1_umr_reuse_verified=TRUE` | **Not met.** `ocid_compliance_state` (OCID-021/`UMR-20260802-173631-ca85`): `0` |
| P8 | `rule_2_outcome_classification_verified=TRUE` | **Not met.** `0` |
| P9 | `rule_3_no_premature_minting_verified=TRUE` | **Not met.** `0` |
| P10 | `rule_4_pm_visible_counts_verified=TRUE` | **Not met.** `0` |
| P11 | `rule_5_stall_detection_verified=TRUE` | **Not met.** `0` |
| P12 | `rule_6_zero_duplication_verified=TRUE` | **Not met.** `0` |
| P13 | `rule_7_structured_evidence_verified=TRUE` | **Not met.** `0` |
| P14 | `file_existing=1 AND file_work_implemented=1` | **Not met.** Both `0` |
| P15 | `audit_passed=1` (re-run after P7-P14, not the stale 2026-08-05 result) | **Not met** as of last real audit. `audit_done=1`, `audit_passed=0`, `last_audit_timestamp=2026-08-05T16:52:17Z` -- explicitly stale per this task's own SPEC, must be re-run after P7-P14, not assumed |

All 10 OCID-021 points are currently real, unmet Booleans -- none flipped by this registration
cycle. This document performs zero implementation toward any of them.

## 3. Recommended execution order (non-binding)

Per this task's own SPEC, documented here for whichever agent executes later:

**OCID-020:** P2 (lowest effort) -> P1 -> P5 (auto-verify via re-run) -> P3 -> P4 (highest effort).
**OCID-021:** P6 first -> P7-P14 together -> P15 last (final re-verification, not the stale
2026-08-05 result).

This ordering is a recommendation only -- not binding if real evidence at execution time suggests
a better order.

## 4. Standing execution gate

Once real execution of any of these 15 points begins, `task-gateway.py` is the mandatory single
gate, per direct Owner instruction 2026-08-08 (same standing rule already governing every other
real dispatch in this repo).

## 5. Zero duplication

No new audit was run to populate this registration -- every fact above was reused from data
already live in `superboss-register.sqlite` (`umr_tasks`, `ocid_canonical_registry`,
`ocid_compliance_state`, `master_issue_tracker` tracker_id 982-986) or from this task's own SPEC,
cross-checked live only where cheap and non-destructive (`gh pr view 732`/`988`, both read-only).
