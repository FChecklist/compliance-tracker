# PROGRESS -- task-20260727-025248-integrate-knowledge-engine-wiring-regist

Redispatch of task-20260726-210059 (killed within its first minute by the
Owner's emergency OOM/fail2ban stop-all-workers incident response, not a
defect in its own scope).

## Repo correction

`task.yaml` says `repo: compliance-tracker`, but `generate_wiring_registry.py`,
`status-remediation-tick.py`, `dispatch_core.py`, and `superboss-register.sqlite`
all live in **claude-control** (`/opt/veridian/repos/claude-control`), confirmed
by direct file search before branching (per SPEC's own instruction to verify).
Real work + PR happen in a worktree at
`/opt/veridian/ai-os/tasks/task-20260727-025248-integrate-knowledge-engine-wiring-regist/claude-control-workspace`
on branch `worker/task-20260727-025248-integrate-knowledge-engine-wiring-regist`,
not in this compliance-tracker workspace. This file tracks session-level
progress per this task's own PROTOCOL; claude-control's own PROGRESS.md is
gitignored there (`988cdcb`, "per-workspace worker scratch file") so the
real before/after counts + delta live in that repo's PR description instead,
per its own established convention.

Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` before starting real edits.

## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance docs, confirmed no
      conflicting active claim on wiring_registry/knowledge_engine/generate_wiring_registry.py.
- [x] Verified real repo location (claude-control, not compliance-tracker) and set up a
      dedicated worktree for it.
- [x] Audited real current state against the live `superboss-register.sqlite`
      (read-only queries, then one real idempotent generator run for timing):
      - `wiring_registry`: 7709 rows total; `engine` entity_type already covers
        all 20/20 real engines from `20_ENGINES_10_GATEWAYS_PHASE_PLAN_2026-07-24.yaml`'s
        `engine_inventory` (this part of SCOPE item 1 was already closed by prior work).
      - `knowledge_engine`: 343 rows (204 canonical + 139 derived) -- this is where the
        SPEC's "343 governance/constitution docs" figure comes from; it is the live,
        already-existing full row count of this table (tagged `governance`/`constitution`
        on most but not all rows), not an undiscovered doc set.
      - After careful path-collision-aware analysis (naive path-string dedup produced
        false positives of "175 missing" / "6 missing" -- both wrong; documented as a
        cautionary note for future audits of this generator): as of the last real
        generator run (2026-07-26T19:20 UTC), **all 343/343** `knowledge_engine` rows
        ARE already reflected in `wiring_registry` as `file` entities. Row-existence
        coverage was NOT the real gap.
      - The REAL, confirmed gap: (a) no `content_hash` column on `wiring_registry` at
        all, so re-running the generator cannot detect that an already-covered engine
        file or governance doc's *content* changed (only path-existence is checked);
        (b) governance/constitution docs are folded into the generic `file` entity_type
        via `knowledge_engine` merge, not a first-class dedicated type the way scripts
        get `entity_type='script'`; (c) generation is a one-off manual run, never
        scheduled -- nothing keeps it current as the OBJECTIVE requires ("auto-updating");
        (d) no unified query helper spans both `wiring_registry` and `knowledge_engine`
        in one sub-second call (each has its own FTS5 index already, just not combined).
      - Real full-generator-run timing: ~2.05s wall clock for all 7709 rows -- cheap
        enough to run every status-remediation-tick (10 min) with no throttling needed.
- [ ] Extend `generate_wiring_registry.py`: `compute_content_hash()`, `content_hash` on
      engine/gateway entities, new `entity_type='governance_doc'` first-class rows
      (built before the knowledge_engine merge so it enriches instead of duplicating,
      same pattern already used for scripts).
- [ ] Extend `superboss-register.py`: `content_hash` column migration (idempotent
      ALTER, tested against the real pre-existing/non-fresh schema per the round-1
      lesson) + widen `entity_type` CHECK for `governance_doc`.
- [ ] Add a query helper module for sub-second combined wiring_registry +
      knowledge_engine lookup.
- [ ] Hook a wiring_registry refresh into `status-remediation-tick.py`'s existing tick
      (no new cron entry).
- [ ] `tests/test_wiring_registry_full_coverage.py` against a realistic pre-existing
      schema fixture.
- [ ] Open PR against claude-control.

## Remaining
- [ ] See Completed checklist above for in-flight items.
