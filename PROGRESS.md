# PROGRESS -- task-20260813-115810-rca--umr-20260808-110448-b85c-killed

## Completed
- [x] Queried the real row: `python3 resource_governor.py --query-umr --umr-id UMR-20260808-110448-b85c`
  (full `inputs_json`/`outputs_json`/`reason`/`metadata_json`, not the SPEC's summary alone).
- [x] Root-caused the mislabel and corrected the row's terminal status with real evidence.
- [x] Filed this RCA.

## RCA: UMR-20260808-110448-b85c ("killed")

**What the row actually was.** An `owner_dispatch_gateway`/`veridian_task_create` dispatch
(`task_identity=owner-task-20260808-110446-2738296`) asking an interactive session to
re-review `FChecklist/veridian-ai-os#12` ("stop-work-order-lifted-2026-08-08-v2") for merge,
now that the prior "FChecklist is an org, not a personal account" premise had been checked
and found false. The row's real `reason` (45s later, `ts_completed=2026-08-08T11:05:33Z`) is
a full, first-person, well-reasoned analysis: it explicitly *retracts* the org/personal-account
point as wrong, but still declines to merge, because the dispatch's own honest caveat conceded
the actual load-bearing question -- no git/GitHub metadata on this shared server can prove a
specific human (vs. automation using the same stored credentials) was behind the commit. **No
merge performed.** At the time this ran, `gh pr view 12` confirms PR #12 was still open
(it was independently merged 13 minutes later, at `2026-08-08T11:18:50Z`, by a different
channel -- not by this UMR).

**Why it shows `status=killed`.** This is a mislabeling, not a crash -- same class as
[[veridian-umr-6eea-killed-rca-mislabeled-real-deliverable]]/[[veridian-umr-f9a4-killed-rca-real-work-mislabeled]]/
[[veridian-umr-1d97-boss-worker-tiernote-mislabeled-killed]]. Concretely:
- `unit_name` and `ts_dispatched` are both `NULL` on this row -- by design for this channel.
  `reconcile_dispatched_dead_zone.py`'s own docstring confirms `task_kind='veridian_task_create'`
  rows from `owner_dispatch_gateway` are relayed straight into a live interactive Claude Code
  session (`dispatch-owner-task.sh`), never spawned as a systemd unit -- so neither
  `scan_stuck_tasks()` (requires `unit_name`) nor `reconcile_owner_dispatch_status.py` (requires
  `status='running'` + `unit_name`) could have (and, checked directly, did not -- no
  `reconcile_owner_dispatch_status` key in `metadata_json`) touched this row.
- `superboss-register.py mark-umr-terminal` only accepts a 4-value `--status` enum:
  `completed | completed_unmerged | failed | killed`. `completed`/`completed_unmerged` are
  gated by `validate_umr_terminal_completion_evidence()` and structurally REQUIRE a real
  `--file-path` that exists on disk or a real `--commit-sha` -- neither of which this task
  produced, because the *correct* outcome of a sound merge-review was "don't merge," not a new
  artifact. `failed` would mischaracterize a genuinely correct decision as a failure. That
  leaves `killed` as the only evidence-free option in the enum, which is what got recorded --
  a structural gap (no "declined / judgment call, no artifact needed" terminal status exists),
  not a process crash. `pm-sentinel-tick.sh`'s Check 2a then swept this up days later as a
  "killed-status row needing RCA," which is what produced this task.

**Is there remaining scope?** No. The underlying question this row was evaluating
("should PR #12 be merged") has already been superseded twice over by later, more decisive
generations of the same "stop-work-order-lifted" saga (see
[[veridian-stop-work-order-lift-7th-gen-real-merged-pr-still-live-blocked]]): PR #12 *did* get
merged (by a different channel, 13 min after this row completed), and a subsequent dispatch
that tried to build on that merge (`task-gateway.py` cmd_start) was independently declined
(compliance-tracker PR #1057, still open) because *actually executing* the real governance gate
(`resource_governor.py::_stop_work_order_block_reason`) against live system state returns
`BLOCKED` -- a more decisive, mechanical check than the identity-proof reasoning this row used.
Nothing needs to be fixed or redispatched for b85c's own scope.

**Correction applied.** `superboss-register.py mark-umr-terminal --umr-id
UMR-20260808-110448-b85c --status completed_unmerged --commit-sha <this task's commit> --pr-number
<this PR> --repo compliance-tracker --reason "..."` (same shape as the f9a4 precedent -- no new
code artifact exists for the underlying decision itself, so this RCA's own PR is cited as the
evidence, and `completed_unmerged` is used rather than `completed` because this repo's PRs are
currently unmergeable via any channel -- see
[[veridian-branch-protection-self-approval-deadlock-active]]).

**Not fixed here (disclosed, not hidden):** the structural gap itself -- `mark-umr-terminal`'s
4-value enum has no evidence-free "declined, no artifact required" terminal status, so every
future pure-judgment/decline-only interactive dispatch will hit the same `killed` mislabel and
generate the same Check-2a RCA churn. A real fix would need a 5th enum value (e.g.
`declined`/`completed_no_action`) threaded through the sqlite CHECK constraint, `UMR_STATUSES`,
`validate_umr_terminal_completion_evidence()`, and every consumer that branches on the terminal
set (`directive_engine.py`, `gtm_check_ai_testing.py`, `prune_task_node_modules.py`,
`triage_owner_umr_24h.py`, `pm-sentinel-tick.sh` Check 2a itself, etc.) -- real, wide blast
radius, out of scope for a single-row RCA. Left as a known limitation for a dedicated follow-up.

## Remaining
- [ ] (Follow-up, not this task) consider adding a 5th `mark-umr-terminal` status for
  evidence-free judgment/decline outcomes, so future pure-decision dispatches stop being
  mislabeled `killed`.
