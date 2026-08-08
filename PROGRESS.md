# PROGRESS -- task-20260808-151224-register--not-execute--combined-priority

Registration-only dispatch: OCID-020 + OCID-021 combined completion, closed together.
No real OCID-020/021 implementation begins here. Governing chain: `UMR-20260806-171945-5767`
(priority 1) -> OCID-020 canonical `UMR-20260802-165606-4413` -> OCID-021 canonical
`UMR-20260802-173631-ca85`.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, confirmed no active claim conflicts with this task's
      exact scope (only historical OCID-020/021 entries, all closed/read-only), registered this
      session's own claim.
- [x] Verified priority 1 (`UMR-20260806-171945-5767`) is genuinely, evidence-verified complete:
      `status=completed`, `ts_completed=2026-08-08T11:28:32Z`, real completion reason on file
      (`derive_umr_output_contract()` wired into `cmd_mark_umr_terminal`, 14/14 tests, graduated
      capability_registry rows `CAP-20260807-054544-9fa8`/`CAP-20260807-153442-f14a`). **Gate
      satisfied -- proceeded.**
- [x] Queried real live data for OCID-020 (`UMR-20260802-165606-4413`) and OCID-021
      (`UMR-20260802-173631-ca85`) from `superboss-register.sqlite`
      (`/opt/veridian/ai-os/memory/superboss-register.sqlite` -- confirmed this is the real live
      DB, 2.9GB, modified today; the two DB paths the script's own path-resolution logic prefers,
      `ai-os/superboss-register.sqlite` and `scripts/superboss-register.sqlite`, are both 0-byte
      stale copies, consistent with prior session's memory note on this):
      - `ocid_canonical_registry`: OCID-020 `is_fully_complete=0`, status text
        `"running (live umr_tasks: status=running...); MASTER-TRACKER.yaml's own SEC-07 gate
        block independently reports status NOT_VERIFIED"`. OCID-021 `is_fully_complete=0`,
        status text `"active de facto, own registration PR still open/unmerged"`, `pr_number=732`,
        `merge_status=open`.
      - `ocid_compliance_state` for OCID-021/`UMR-20260802-173631-ca85`: all 7 rules = 0,
        `file_existing=0`, `file_work_implemented=0`, `audit_done=1`, `audit_passed=0`,
        `last_audit_timestamp=2026-08-05T16:52:17Z` (the "stale 2026-08-05 result" the SPEC
        itself names).
      - `master_issue_tracker` tracker_id 982-986: pre-existing OCID-020 CAT03/13/17/23/25 rows,
        reused `existing_solution_in_system` text (`"Real check script already exists for this
        category (see gtm_check_*.py family)..."`) rather than re-deriving.
      - Live read-only re-check (cheap, non-destructive, not a re-audit): `gh pr view 732` ->
        `state=OPEN`, `mergeStateStatus=BEHIND`, `mergedAt=null`. `gh pr view 988` ->
        `state=OPEN`, `mergeStateStatus=BLOCKED`, `mergedAt=null`. Both confirm the SPEC's own
        already-verified blocker facts, no new audit performed.
- [x] Decided how to satisfy "create one real, new UMR... task_kind that does not spawn an AI
      implementation worker" without a real live-queue side effect: per this repo's own
      established precedent (`ai-os/OCID_056_REGISTRATION_2026-08-04.md`, OCID-061 PR #911,
      OCID-062), `resource_governor.py --submit` was **not** invoked -- it is a real write into
      the shared dispatch queue drained by a real, independent `veridian-governor-tick.service`;
      its only two accepted `task_kind` values are `veridian_task_create` (spawns a real AI
      worker -- explicitly forbidden here) and `systemctl_action` (executes a real
      `systemctl --user start/restart` against a real unit once picked up -- a real
      infrastructure side effect, not "minimal registration"). Used this dispatch's own real,
      pre-existing, already-terminal `umr_tasks` row `UMR-20260808-151153-e172`
      (`task_kind=veridian_task_create`, `status=completed`) as the real anchor UMR instead --
      real, live-queried, already terminal so it can never be re-dispatched. Full reasoning in
      `ai-os/OCID_020_021_COMBINED_CLOSURE_REGISTRATION_2026-08-08.md` section 1.
- [x] Wrote `ai-os/OCID_020_021_COMBINED_CLOSURE_REGISTRATION_2026-08-08.md` documenting the
      governing chain, the anchor-UMR disclosure, all 15 points' real current state, the
      recommended (non-binding) execution order, and the standing `task-gateway.py` gate note.

## Remaining
- [ ] Register all 15 real `master_issue_tracker` rows via `superboss-register.py add-issue`
- [ ] Confirm all 15 inserts succeeded (query back from live DB), record tracker_id map
- [ ] `agent_work_briefing.py record-completion` call
- [ ] Commit + push, open PR
