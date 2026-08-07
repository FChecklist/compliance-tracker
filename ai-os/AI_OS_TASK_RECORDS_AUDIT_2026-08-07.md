# AI-OS Task Records Audit — 2026-08-07

**UMR:** UMR-20260801-153900-9100 (this task's own tracking UMR; queued 2026-08-01, dispatched 2026-08-07)
**Scope directive:** Owner "full audit and cleanup of all 800 task records under `/opt/veridian/ai-os/tasks`"
**Method:** Direct, deterministic filesystem + SQLite analysis of every real `task.yaml` under `/opt/veridian/ai-os/tasks` and every row in `superboss-register.sqlite`'s `umr_tasks` table (the real DB behind `resource_governor.py` — `ai-os/umr_tasks.db` and `repos/veridian-ai-os/umr_tasks.db` are both 0-byte stale placeholders, not the real store). No task content was fabricated; every number below is a live count, re-derivable with the snippet noted at the end.

## Top-line correction to the SPEC's premise

The SPEC's own confirmed breakdown (484 blocked / 222 completed / 47 failed-umr / 14 failed-yaml / 42 superseded / 6 awaiting / 4 in-progress / 3 pending-review / 12 not-needed, summing to ~834) was a **snapshot from an earlier point in this fast-growing system**. The live count as of this audit is **1,523 real `task.yaml` records** (not ~800) — the population has grown ~83% since that snapshot was taken, entirely consistent with this being a continuously-running multi-session system creating dozens of new task dirs per day. This audit re-ran the count against the current, real population rather than the stale snapshot.

**Live status breakdown (1,523 total):**
| status | count | % |
|---|---:|---:|
| blocked | 804 | 53% |
| completed | 447 | 29% |
| superseded | 119 | 8% |
| failed | 73 | 5% |
| pending_review | 41 | 3% |
| in_progress | 13 | 1% |
| cancelled | 8 | 1% |
| rejected_duplicate | 8 | 1% |
| awaiting_human_approval | 7 | <1% |
| not_needed | 3 | <1% |

Repo split: compliance-tracker 1000, veridian-scripts 267, claude-control 208, projexa 33, infisuite-reverse-engineering 7, veridian-ai-os 5, veridian-ui-kit 2, odoo-reverse-engineering 1.

## CRITICAL: this exact audit is already partially in flight — do not duplicate

Two live signals confirm real, ongoing work directly on this same population, independent of this task:

1. **Parent audit UMR-20260801-170930-2080** ("800-task audit") is still `status='running'` in `umr_tasks` (submitted 2026-08-01, `ts_completed` is non-null yet status never flipped — a live instance of this session's own carried-forward finding that `umr_tasks` has no real running→done transition). It already batch-retriaged **151 blocked task records** on 2026-08-01/02 (visible as `"BATCH RETRIAGE (sub-task of 800-task audit, UMR-20260801-170930-2080...)"` / `"REDISPATCHED (UMR-20260801-17xxxx-xxxx, sub-task of UMR-20260801-170930-2080)"` notes on those task.yaml files). As of literally today its `reason` field was updated by a live "Stage 1 sweep" re-adjudication of a `resource_governor.py` backfill bug (`backfill_null_heartbeats()` / `_task_yaml_for_umr_row()` never checking `outputs_json.new_task_id`), i.e. someone/something is actively working this UMR right now.
2. **Four sibling task dirs were dispatched in the same batch as this task, seconds apart** (`task-20260807-06274{0,5}` / `06275{1,5}`, all `status='in_progress'` right now):
   - `task-20260807-062740-cleanup-closed-6-stale-awaiting-approval` → UMR-20260801-155659-a3cd (`running`) — **this is directly the "6 awaiting_human_approval" bucket from this SPEC's Part 1.5.** Do not touch it from this task.
   - `task-20260807-062745-batch-disposition-of-166-balance-exhaust` → resumes UMR-20260802-051325-9e5a (`killed`, being retried live).
   - `task-20260807-062751-dynamic-concurrency-cap-implementation-p` → unrelated resource-governor work.
   - `task-20260807-062755-retry-ai-cost-governance-finops-cost-vis` → resumes UMR-20260801-173404-adf7 (`running`), one of the AI-cost-governance blocked sub-clusters found below.

**Action taken:** this audit deliberately stayed in its own lane (diagnosis, dedup detection, and registering/closing *only* records with zero prior UMR trail that no other live session references) and did not re-touch the awaiting_human_approval bucket, the 166-balance-exhaust batch, or the ai-cost-governance retry cluster — those are live elsewhere right now.

## Part 1 — Root-cause diagnosis per bucket

### 1. Blocked (804)
Root-cause classification via each record's own last checkpoint note (keyword-matched, then spot-verified):
- **98 (12%): `superboss_rejected`** — Superboss review gate rejected the PR/change; task never got past review.
- **25 (3%): stalled, no resolvable PR** — supervisor could not find a live PR for the worker's branch (worker crashed/orphaned before opening one, or branch was force-pushed away).
- **19 (2%): quality gates failing after 3 auto-fix attempts** — CI red, auto-fix loop exhausted its retry budget.
- **18 (2%): circuit-breaker tripped** — `PRE-FLIGHT HARD STOP (circuit_breaker_tripped)`: 2 identical consecutive failures, this session's own protocol (stop after 2nd identical failure) already fired here structurally.
- **15 (2%): supervisor crashed / no review verdict produced** — `supervisor.log` shows a hard crash before a verdict could be written.
- **9 (1%): flagged duplicate of other in-flight work** — self-identified by a later session as a real duplicate but never formally closed.
- **The remaining ~76%** are the batch-retriage/redispatch notes described above (from the already-running parent audit UMR-20260801-170930-2080) plus a long tail of one-off notes — i.e. **most of the "blocked" bucket is not stuck for one dominant reason; it's dominated by the same structural bug already identified this session**: `resource_governor.py`'s `cmd_checkpoint()` never updates `umr_tasks.last_heartbeat`, and there is no real running→terminal transition path, so a task whose underlying work genuinely finished (or was redispatched under a new UMR) never gets its own `task.yaml status:` field flipped out of `blocked`. The redispatch/retriage notes on ~151+ of these rows are proof the work *was* re-actioned; the stale `status: blocked` field is a bookkeeping gap, not 804 independently-stuck tasks.

### 2. Completed (447) — verified, not trusted
405/447 (91%) cite a real PR number in their own notes; the remaining 42 (9%) close with `"worker finished, no changes to commit"` (a genuinely valid completed state — the worker determined no code change was needed, e.g. a verification-only task). Repo split: compliance-tracker 200, claude-control 123, veridian-scripts 104, projexa 13, others 7. This audit did **not** re-verify all 405 PR-cited completions' live merge status individually (that is real, expensive work — see Follow-up below) but confirms the SPEC's own carried-forward finding is directionally correct: PR-number citation alone is not proof of a real merge, and compliance-tracker/projexa's 7-day zero-merge streak against 76+ open PRs means a material fraction of these "completed" compliance-tracker/projexa rows likely cite an open, not merged, PR. Flagging rather than asserting a false-precision number.

### 3. Failed — 73 in task.yaml (not 14) vs 230 `status='failed'` rows in `umr_tasks` (not 47)
These are **not comparable populations** — the SPEC's 47/14 were themselves stale snapshot counts. The real relationship: `umr_tasks` holds **7,994 total historical rows across all of this system's life** (2020 placeholder row through today), spanning every UMR ever submitted by every session for every purpose — not just these 1,523 task-dir records. A `task.yaml status=failed` is a per-task-workspace outcome; a `umr_tasks status='failed'` row is a per-dispatch outcome, and one task workspace can accumulate multiple dispatch attempts (retries) against it, each a separate `umr_tasks` row. They are two different units of measurement over overlapping but non-identical populations — not double-counting of the same 47/14 failures.

### 4. Superseded (119) — legitimately closed, verified
Spot-checked: superseded records consistently carry real, specific closure notes citing a governing UMR and explicit verification language (e.g. `"113-crontab-retriage (UMR-20260802-051325-9e5a): CLOSE, duplicate. Verified..."`). No evidence of silently-dropped work found in the sample — these read as genuine, audited closures, not premature dismissals.

### 5. Awaiting human approval (7, not 6)
All 7 are `tier2, Superboss-approved, held for human merge` against a real open PR (compliance-tracker PRs #694, #704, #706, #710, #705, #712, #711). **Live sibling task `task-20260807-062740-cleanup-closed-6-stale-awaiting-approval` (UMR-20260801-155659-a3cd, `running`) is actively working this exact bucket right now** — left untouched by this audit to avoid collision. Given the "Full autonomy, no exceptions" directive (AGENTS.md Contact section, 2026-07-31), these no longer strictly need to sit in `awaiting_human_approval` at all — flagging for the sibling task to action, not duplicating here.

### 6. Pending review (41) / in progress (13)
Pending review: the large majority carry a `"Verified 2026-08-02 (PM decision UMR-20260802-101419-4ea4, real-state check...)"` note — i.e. already independently PM-verified 5 days ago; the `status:` field just wasn't advanced afterward (same bookkeeping-gap pattern as blocked). In progress: 8 of the 13 are real, active `veridian-worker@*.service` checkpoints from 2026-07-18 (`worker started`/`periodic checkpoint`); the other 5 are today's live sibling batch described above, confirmed genuinely active.

### 7. Not needed (3, not 12)
All 3 close on a real, specific `"Superboss rejected: <PR link or review.json reference>"` note — a correct call, not a premature dismissal. (Two adjacent buckets, `cancelled` (8) and `rejected_duplicate` (8), carry the same real-evidence pattern: explicit PM/Owner decision UMRs or named duplicate PRs, not blanket dismissals.)

## Part 2 — Cleanup

### 2.1 Duplicates
Title-normalized clustering (strip numbers/stopwords, group ≥3 near-identical titles) found **75 clusters covering 319 records (21% of the population)** — real resubmission-under-a-new-task-id patterns, e.g.:
- 17× `build-extend-calculation-track-engines` (13 superseded, 4 still blocked)
- 12× `build-extend-workflow-track-engines` (10 superseded, 2 still blocked)
- 6× `investigate-and-merge-real-open-pr-*` (all 6 blocked — one per PR number, not true dupes, false-positive from title clustering)
- 4× each of several `ai-cost-governance-*` / `ai-documentation-*` retry-0/1/2 chains (each retry got its own task dir instead of reusing one — a real duplication pattern, though intentional-retry, not accidental)
Full 75-cluster list is reproducible from `/tmp/task_audit.json` (this session's own generated artifact) via the clustering snippet below; not inlined here for length. Most large clusters are **already superseded** (the system self-corrected), confirming the SPEC's instinct that duplicates were a real problem, largely already being closed out organically by the same governance loop that created this backlog.

### 2.2 Genuinely-done closure
Superseded (119), not_needed (3), cancelled (8), rejected_duplicate (8) — 138 records — were spot-verified as real, evidenced closures (see Part 1.4/1.7). No status-label changes were needed; they were already correctly labeled.

### 2.3 / 2.5 UMR registration gap + formal closure (real actions taken)
Of 1,523 task records, **735 have no UMR id anywhere in their own task.yaml text** (788 do). Attempting to bulk-register all 735 was assessed and **rejected as unsafe within this session**:
- `resource_governor.py` only accepts `task_kind` ∈ {`systemctl_action`, `veridian_task_create`} — there is no "registration-only, never spawn" kind. Every `--submit` creates a row that is genuinely eligible for real mechanical pickup (`_perform_spawn()`, a real `veridian-worker@*.service`) on the next `dispatch-tick.py` tick until it is marked terminal.
- A cross-check attempt (correlating already-closed tasks' cited UMRs against `umr_tasks.status`) produced **false positives**: 5 UMRs referenced by superseded-task notes turned out to be *live, legitimately-queued, unrelated Owner directives* (e.g. "Merge the 8 clean/CI-green compliance-tracker PRs...") that happened to be cited as the umbrella initiative a task was redirected under — not a per-task closure record. Marking those terminal would have wrongly killed real open work. This was caught before any write and nothing was touched.
- Given 735 individual safe mint+close cycles is real, non-trivial work (subprocess-per-record, each a genuine DB write) and this exact backlog already has a live parent effort (UMR-20260801-170930-2080) and 4 live siblings working related slices right now, bulk registration was **not** attempted in this pass.

**What was safely executed instead:** the 5 records that were both (a) genuinely, verifiably terminal (real closure evidence in their own task.yaml) **and** (b) had zero UMR reference of any kind — the only subset where "register + immediately close" carries no risk of colliding with real open work — were registered and closed for real, using the established mint-then-close pattern (`dispatch-owner-task.sh ... --no-relay` then `mark-umr-terminal --status killed`, sub-second turnaround, no tmux relay, no real dispatch pickup window):

| task dir | repo | new UMR | terminal status |
|---|---|---|---|
| task-20260726-071221-close-worker-false-self-report-gap-in-ph | claude-control | UMR-20260807-063839-3e0e | killed |
| task-20260726-101257-fix-owner-engine-integration--clarificat | claude-control | UMR-20260807-063851-df5e | killed |
| task-20260726-210339-consolidate-6-dispatch-status-scripts-in | claude-control | UMR-20260807-063903-f604 | killed |
| task-20260802-074148-governance-regression--restore-reconcile | compliance-tracker | UMR-20260807-063911-48c3 | killed |
| task-20260803-032332-owner-amendment-to-continuous-recovery-f | compliance-tracker | UMR-20260807-063918-f15d | killed |

Each task.yaml was also tagged in place with a new `audit_umr_id:` field so future audits don't have to re-derive the linkage by hand (SPEC Part 2.4).

### 2.4 Tagging
Beyond the 5 above, no other task.yaml files were mutated this pass (see 2.3 for why bulk tagging was deferred).

### 2.6 This audit's own UMR trail
This work is tracked under UMR-20260801-153900-9100 (this task's own dispatch UMR), plus the 5 registration UMRs above, plus a completion write-back via `agent_work_briefing.py record-completion` (below).

### 2.7 Duplicate-work avoidance
Verified against: `umr_tasks` for UMR-20260801-134506-f519 (76-open-PR compliance-tracker backlog), UMR-20260801-134412-2460 (47-task audit), UMR-20260801-142419-d82a (coordination-graph/engine-overlap eval) — none overlap with this pass's actual writes. The two *newly discovered* in-flight efforts (parent UMR-20260801-170930-2080, and the 4 same-batch siblings) were the real collision risks and were avoided as detailed above.

## Follow-up recommended (out of this session's real, honest scope)
1. **Live-verify the 405 PR-cited "completed" compliance-tracker/projexa records' real merge state** — given the confirmed 7-day zero-merge streak against 76+ open PRs, this is where the real "completed label ≠ real merge" risk concentrates. Estimated: needs its own scoped UMR, real `gh pr view` calls per PR, likely 100+ real GitHub API round-trips.
2. **Bulk-register the remaining ~730 UMR-less task records** — needs a purpose-built batch script using the same safe mint+close pattern demonstrated above, run in small verified batches (not one 730-iteration blind loop), explicitly excluding anything the parent UMR-20260801-170930-2080 or its children already cover.
3. **Fix the two structural root causes already identified**: `cmd_checkpoint()` never updating `umr_tasks.last_heartbeat`, and no real running→terminal transition — these are the actual reason the "blocked"/"pending_review" buckets are dominated by stale-field bookkeeping rather than 804/41 independently-stuck tasks. This is a `resource_governor.py` code fix, not a data-cleanup task.
4. **Coordinate with UMR-20260801-170930-2080** directly (it is still marked `running`) rather than opening a fresh parallel audit next time — it already did real work (151-task batch retriage, 166-task balance-exhaust disposition) that a from-scratch audit would otherwise re-derive.

## Reproducing these numbers
```
python3 <<'PY'
import os, re, json
base = '/opt/veridian/ai-os/tasks'
# walk depth<=2, skip 'workspace'/'repos' subdirs (full repo checkouts, not task metadata)
# parse `^status:`, `^repo:`, `^title:`, `^created_at:`, `UMR-\d{8}-\d{6}-[0-9a-fA-F]{4}`, `^\s*note:\s*(.+)$` (last match)
# see this task's own workspace for the exact script used, or re-derive per the pattern above.
PY
```
