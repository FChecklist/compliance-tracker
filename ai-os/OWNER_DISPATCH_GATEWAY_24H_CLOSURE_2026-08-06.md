# Owner-Dispatched UMR 24h Closure -- Real Discovery + Classification (2026-08-06)

**Parent mandate:** SPEC dispatched to `task-20260806-075804-close-all-real-owner-dispatched-umrs-fro`
("Owner standing mandate. Query umr_tasks where source_trigger equals owner_dispatch_gateway...").
Referenced by other same-day rows as `UMR-20260806-071025-1d28`.

## 1. Real premise correction (query live, not the SPEC's snapshot numbers)

The SPEC's own dispatch text stated "as of this dispatch the real count is 95, broken down as 59
running, 21 killed, 7 rejected_duplicate, 5 queued, 3 completed" -- but its own preceding sentence
also instructs: *"this is the real authoritative list, do not hand type it"*, i.e. query live rather
than trust the hand-typed snapshot. Doing so (`superboss-register.sqlite`, `umr_tasks` table,
`source_trigger='owner_dispatch_gateway'`, `ts_submitted >= now - 24h`, read-only `mode=ro` URI
connection, safe under the DB's own `.writelock`) returns a materially different, real, live count:

| status | SPEC's stated count | Real live count (queried 2026-08-06T08:03Z) |
|---|---|---|
| running | 59 | 30 |
| killed | 21 | 22 |
| rejected_duplicate | 7 | 16 |
| queued | 5 | 5 |
| completed | 3 | 39 |
| failed | *(not mentioned)* | 9 |
| **TOTAL** | **95** | **121** |

This is consistent with the SPEC's own explicit warning ("Do not trust the status column alone,
that is a known unreliable signal") and with this being a live, rapidly-mutating table (one other
row in this same 121, `UMR-20260805-142048-4edb`'s sibling, independently reports ~22 rows it
believes are falsely `running`). The 121-row live set is treated as ground truth for this closure
pass, per the SPEC's own instruction, not the 95/59/21/7/5/3 snapshot.

## 2. What these rows actually are (real structural finding)

All 121 rows have `task_kind = 'veridian_task_create'` -- every row is a **dispatch-gateway
request**, not a unit of work in itself. Real structure, confirmed by direct inspection of
`outputs_json`/`metadata_json`:

- 102 of 121 rows have a real `ts_dispatched` and (once dispatched) a real
  `outputs_json.new_task_id`, which names the real spawned task workspace
  (`ai-os/tasks/<new_task_id>/`) and its real git branch (`worker/<new_task_id>`).
- 19 rows never dispatched: 9 legitimately `rejected_duplicate` (deduped before spawning anything),
  5 still `queued`, 5 `completed` immediately as pure PM-decision/citation documents (no code work
  spawned -- `outputs_json.doc_path` is the real evidence), 1 `failed` before dispatch.
- The table's own `status` column reflects the *dispatch-gateway request's* lifecycle, not
  necessarily the real state of the spawned task's own branch/PR -- this is the real source of the
  "unreliable status column" warning.

## 3. Method (real, deterministic, scripted -- no AI narration used for classification)

1. Read-only SQL query against `superboss-register.sqlite` (`file:...?mode=ro`, safe under the live
   `.writelock`) -> `discovery/raw_rows.json` (121 rows, all columns).
2. Bulk `gh pr list --repo FChecklist/<repo> --state all --json ... --jq '... | @tsv'` across the 3
   repos referenced anywhere in this codebase's own OCID-resolution tooling
   (`compliance-tracker`, `veridian-scripts`, `projexa` -- `DEFAULT_OCID_RESOLVER_REPOS` in
   `/opt/veridian/scripts/superboss-register.py`) -> `discovery/prs_<repo>.tsv` (692 PRs indexed by
   branch name). *(Note: used `--jq '...|@tsv'` rather than `--json` array output -- this sandbox's
   `gh --json` array mode silently truncates to ~121 bytes, a known environment bug, not a real gh
   defect.)*
3. Local, offline join: for each of the 121 rows, derive `worker/<new_task_id>` from
   `outputs_json.new_task_id` and look it up in the indexed PR table. No further network calls
   needed once the two datasets are local -> `discovery/classified.json`.
4. Deterministic bucketing by `(status, PR presence, PR state)` -> `discovery/buckets.json`.

This found real PR evidence the codebase's own existing `reconcile-umr-status` CLI tool (which
searches for the *parent UMR ID text* inside PR titles/bodies) does not surface, because the real
relationship for a dispatch-gateway row is parent-UMR -> `outputs_json.new_task_id` -> child branch
name, not parent-UMR-ID-cited-in-PR-text. Flagged as a real, scoped gap in that tool's evidence
search (recommend extending `_find_pr_evidence_for_umr`/`reconcile_umr_status_against_pr` to also
match on `outputs_json.new_task_id`-derived branch names, via a reviewed PR to
`superboss-register.py` in its own repo -- not patched here; see §6).

## 4. Real classification (121 / 121 accounted for)

| bucket | count | real meaning | action |
|---|---:|---|---|
| `completed_merged_consistent` | 19 | status + real PR state agree | no action, evidence-cite only |
| `stale_running_merged_needs_reconcile` | 6 | DB says `running`, real PR already `MERGED` | status stale -- see §6 |
| `stale_killed_merged_needs_reconcile` | 1 | DB says `killed`, real PR already `MERGED` (merged *after* the kill timestamp -- work was resumed/finished by a follow-up dispatch) | status stale -- see §6 |
| `completed_open_needs_playbook` | 7 | DB says `completed`, real PR still `OPEN` | genuine 7-step playbook candidate |
| `rejected_duplicate_with_real_pr_anomaly` | 7 | DB says `rejected_duplicate`, but a real open PR with real commits exists | genuine judgment call -- is the PR itself the real duplicate, or was the reject label wrong? |
| `running_open_live_do_not_touch` | 18 | DB says `running`, real PR `OPEN` -- consistent, and this branch may be another live session's in-flight work | read-only staleness check only (§7), never merge |
| `failed_open_needs_check` | 5 | DB says `failed`, real PR still `OPEN` | check whether PR is actually salvageable |
| `failed_closed` | 1 | DB says `failed`, real PR `CLOSED` (not merged) | consistent, evidence-cite only |
| `running_closed_dead` | 1 | DB says `running`, real PR `CLOSED` (not merged) -- abandoned | reconcile to a terminal non-running status |
| `killed_no_pr` | 21 | killed before any PR opened | explain (see §5), no PR-side action possible |
| `completed_no_pr_docs_only` | 5 | never dispatched a task; pure PM-decision citation doc | evidence = doc file, already terminal |
| `completed_dispatched_no_pr` | 8 | dispatched a real task, DB says `completed`, but no PR found under that branch name in any of the 3 indexed repos | needs a real per-row check (doc-only work again, or PR under an unindexed repo/renamed branch) |
| `running_no_pr_needs_check` | 5 | DB says `running`, no PR yet | may be genuinely early-stage; check task workspace checkpoint |
| `failed_no_pr` | 3 | failed before any PR opened | explain from real metadata |
| `rejected_duplicate_never_dispatched` | 9 | correctly deduped pre-dispatch | consistent, no action |
| `queued_never_dispatched` | 5 | still waiting on the dispatch gateway | not this task's call to force-dispatch |

Full row-level UMR IDs for every bucket: `discovery/buckets.json`. Full per-row PR match evidence
(PR number/state/mergeable/URL/repo): `discovery/classified.json`. Raw DB rows:
`discovery/raw_rows.json`.

## 5. Killed rows (22) -- real explanation, not narration

`ts_sigterm` timestamps for the 22 `killed` rows cluster overwhelmingly into one real, tight window:

- **20 of 22** rows have `ts_sigterm` between **2026-08-05T20:34:53Z and 2026-08-05T20:41:47Z** (a
  real 7-minute span) -- independent tasks, different `new_task_id`s, killed within seconds to
  minutes of each other. This timing correlation is itself real, deterministic evidence of one
  shared cause (a mass supervisor/lock-recovery restart), not 20 unrelated individual failures.
  Honest limitation: no independently-checked incident log entry (`ai-os/CONTROLLER.yaml`,
  `ai-os/boss/*`) was found that names this specific 20:34-20:41Z window explicitly -- the timing
  clustering itself is the real evidence being cited, not a matched incident report.
- **1 outlier**, `UMR-20260805-002929-5560`, killed at `2026-08-05T01:38:43Z`, isolated in time --
  a genuine individual kill, not part of the mass event.
- **1 outlier**, `UMR-20260806-050055-d145`, killed at `2026-08-06T06:16:27Z` (today) -- also
  isolated (not part of a same-day cluster), but its underlying work was real and continued: its
  real PR (`veridian-scripts#125`) merged at `2026-08-06T07:04:40Z`, ~48 minutes *after* this row's
  own kill timestamp, meaning a follow-up dispatch picked the real work back up and finished it
  (this is `stale_killed_merged_needs_reconcile`, §4).

None of the 22 killed rows' underlying real work is unrecoverable: 1 was resumed and merged (above);
the remaining 21 have no PR under their own branch name in any of the 3 indexed repos, i.e. real
work was genuinely interrupted before reaching a PR -- consistent with a mass kill event, not a
targeted rejection of any one task's content.

## 6. Write-path decision -- why `umr_tasks.status` is not being directly corrected here

`superboss-register.py`'s own header states its write discipline explicitly: *"Real raw SQL against
this file from outside this script... is NOT the standard procedure -- extend the function library
here instead... rather than writing a second parallel script."* This file
(`superboss-register.sqlite`) also has an extensive, still-active corruption/recovery history
*today* (`ai-os/memory/superboss-register.sqlite.CORRUPTED-*`,
`.recover-sql-20260806T025938Z.sql`, `.prerecover-backup-20260806T073100Z`,
`.preswap-backup-20260806T073427Z`, all dated 2026-08-06, the last two roughly 30 minutes before
this task's own dispatch).

Given that, and that the one exposed canonical CLI for this (`reconcile-umr-status --apply`) doesn't
find the branch-name-matched evidence this pass found (§3), the 7 stale rows in §4 are **not**
force-corrected via raw SQL here. Instead: real evidence for each is logged as a
`pm_decisions_pending` row (title, detail, real PR URL/number/merged-at, `related_umr`), opened and
resolved in the same pass since the evidence is factual/non-controversial (a real merged PR is a
real completion) -- see `discovery/pm_decisions_log.json` for the real decision IDs once written.
The `umr_tasks.status` column itself is left as the honestly-disclosed real gap: extending
`reconcile_umr_status_against_pr`'s evidence search to also match `outputs_json.new_task_id`-derived
branch names (not just UMR-ID-in-PR-text) is flagged here as the real fix, to be done as a reviewed
PR against `veridian-scripts` (a separate live-checkout repo from this task's own
`compliance-tracker`), not as an ad hoc patch under this task's time budget.

## 7. Remaining real work (not yet done -- see `PROGRESS.md`)

- `completed_open_needs_playbook` (7) and `rejected_duplicate_with_real_pr_anomaly` (7): each needs
  the real 7-step playbook (PR state, audit comment vs head SHA, conflict resolution, merge,
  independent post-merge verification) run individually -- genuine judgment calls, dispatched to
  parallel agents, max 5 concurrent, one UMR/branch/PR per agent, never two agents on the same
  file/branch/PR/UMR.
- `running_open_live_do_not_touch` (18): real staleness check only (age of `updatedAt` vs `now`,
  cross-checked against the real task workspace's own checkpoint file) for any idle >2h; no merge,
  no branch edits -- these may be other live sessions' real in-progress work.
- `failed_open_needs_check` (5), `completed_dispatched_no_pr` (8), `running_no_pr_needs_check` (5),
  `failed_no_pr` (3): each needs a real per-row workspace/metadata check.
