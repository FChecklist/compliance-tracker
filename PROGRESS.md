# PROGRESS -- task-20260808-234728-build-umr171945-0024--real-caller-identi

Governing chain: UMR-20260806-171945-5767, master_issue_tracker issue_id UMR171945-0024
(tracker_id 1021), real code file: /opt/veridian/scripts/task-gateway.py (separate
FChecklist/veridian-scripts live-checkout repo, NOT this compliance-tracker repo).

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, registered this session's claim (commit e548fa96d,
      pushed to this branch)
- [x] Confirmed real open issue UMR171945-0024 via `superboss-register.py list-issues`
      against the real DB (/opt/veridian/ai-os/memory/superboss-register.sqlite --
      NOT the stale committed .sqlite snapshots in the repo checkouts)
- [x] Found real, correct, uncommitted work already present in the live
      /opt/veridian/scripts/task-gateway.py checkout (from an earlier turn of this
      same task, pre-context-summarization): `submit`'s `--source` choices widened
      from `["owner", "ai_agent"]` to
      `["owner", "ai_agent", "trusted_executor", "end_user", "external_integration"]`,
      plus an explicit `caller_identity` alias key in cmd_submit's JSON output.
      Verified: `python3 -c "import ast; ast.parse(...)"` -- syntax OK. No PR/branch
      existed yet for it.

## Remaining
- [ ] Create a branch in /opt/veridian/scripts (veridian-scripts repo), commit the
      caller_identity change, push, open PR
- [ ] Real boolean test: submit one real instruction with each of the 5 --source
      values, confirm each recorded + queryable via superboss-register.py search
- [ ] Confirm CI green, merge PR (or note branch-protection blocker if hit)
- [ ] Record completion via agent_work_briefing.py record-completion
- [ ] Close UMR171945-0024 via close-issue with real resolution notes
- [ ] Move ACTIVE-CLAIMS.yaml entry to recently_completed, commit+push, open/merge
      compliance-tracker PR for this branch's ai-os/ changes
