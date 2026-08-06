# PROGRESS -- task-20260806-155951-re-dispatch--structural-fix-for-relay-de

SPEC: re-dispatch of the relay-dead-zone fix (prior attempt UMR-20260806-115423-500d, cited as
"stranded, no real task directory ever created"), covering `dispatch-owner-task.sh` (must never
mark a row dispatched from an attempted tmux relay alone; relay = best-effort notification only;
the only legitimate transition out of `queued` is `dispatch-tick.py`'s real mechanical pickup),
plus "Update SKILL.md to state plainly a printed RELAYED message is never proof of delivery."

Note on scope: the actual target files (`dispatch-owner-task.sh`, `dispatch-tick.py`,
`resource_governor.py`) live in the separate `veridian-scripts` repo
([[veridian-scripts-separate-repo-live-checkout]]), not in this `compliance-tracker` workspace --
this task's own `repo:` field is just the default. Real work happened there; this file records the
summary and the trail back to it.

## Completed
- [x] Read `dispatch-owner-task.sh` live and on `origin/main` of `veridian-scripts`: the required
      fix is **already merged** -- PR #166 (`FChecklist/veridian-scripts`, merge commit
      `38650b35b24954ca9277029798c579e6baf9c658`, source commit `8df34d5`,
      `mergedAt=2026-08-06T13:25:57Z`, UMR-20260806-115423-500d). Confirmed both relay branches
      (session found / session absent) now call `superboss-register.py mark-umr-relay-attempted`
      only (writes `ts_relay_attempted`/`relay_outcome`/`relay_detail`), never touch `status` /
      `ts_dispatched` / `ts_completed`. A row stays `status='queued'` either way, eligible for
      `resource_governor.py`'s `next_queued_task()` (`SELECT * FROM umr_tasks WHERE
      status='queued'`, invoked from `dispatch-tick.py`'s own tick) -- the one real,
      tmux-independent mechanical pickup path, exactly as this SPEC requires.
- [x] Confirmed the live production script (`/opt/veridian/scripts/dispatch-owner-task.sh`) and
      `dispatch-tick.py`/`resource_governor.py` are byte-identical to `origin/main` -- the fix is
      genuinely deployed, not just merged on paper.
- [x] Queried `UMR-20260806-115423-500d`'s real row in `umr_tasks` directly (sqlite, read-only,
      never grep/find for a UMR id): `status='completed'`, `ts_completed=2026-08-06T14:48:28Z`.
      Already reconciled by a prior session hours before this task was dispatched, with a reason
      field citing this same PR #166 evidence -- **not** left stranded at the time of this task's
      own investigation.
- [x] Checked "Update SKILL.md" -- **false premise**. No `SKILL.md` file has ever existed in
      `veridian-scripts` (`git log --all -- '**/SKILL.md'`, empty) or in any other repo checkout
      under `/opt/veridian/repos/*` on this server (checked every `.git` tree). Matches
      `veridian-scripts`' own `PM_CYCLE_PRECHECK_VERIFICATION_2026-08-06.md` finding #4 for an
      unrelated SPEC the same day. The only mention of `SKILL.md` anywhere in this codebase is a
      comment in `generate_pm_report_v3.py` naming a Windows-laptop-only path
      (`C:\Users\Dell\.claude\scheduled-tasks\veridian-server-sentinel\SKILL.md`), out of scope for
      a server-side session per the Owner's 2026-07-31 "server works independently, laptop can be
      closed" directive (`AGENTS.md` Contact section). No file fabricated. The fact itself is
      already stated plainly in `dispatch-owner-task.sh`'s own header comment and its printed
      relay output ("never proof of delivery").
- [x] Logged the finding via `superboss-register.py log-action` (`ACT-20260806-161013-9ee4`), and
      opened `veridian-scripts` PR #191 (docs-only, no code change) with the full evidence in that
      repo's own `PROGRESS.md`: https://github.com/FChecklist/veridian-scripts/pull/191

- [x] `veridian-scripts` PR #191 merged (`2026-08-06T16:12:47Z`, squash) -- that repo has no CI
      gate/branch protection blocking a docs-only merge (unlike this repo, see below), confirmed by
      several same-day precedent PRs (#186/#188/#189) merging the identical way.
- [x] Opened `compliance-tracker` PR #996 (this branch) recording the same finding for this repo's
      own governance trail.

## Remaining
- [ ] PR #996 is `mergeStateStatus=BLOCKED`/`reviewDecision=REVIEW_REQUIRED` --
      [[veridian-branch-protection-self-approval-deadlock-active]]: `main` requires 1 approving
      review, but every credential in this environment resolves to the same GitHub identity
      (`FChecklist`), so no independent review can be submitted and `gh pr merge --admin` is known
      to fail regardless (confirmed recurrence, same as PRs #959/#981). Per that standing finding's
      own guidance, not burning a merge attempt or re-flipping `required_approving_review_count`
      without a fresh explicit Owner directive -- documenting and leaving PR #996 open is the
      correct action here, consistent with prior sessions' precedent.
- [ ] No code change expected in this `compliance-tracker` workspace -- nothing else in scope here;
      the real fix and its docs record are both already merged in `veridian-scripts`.
