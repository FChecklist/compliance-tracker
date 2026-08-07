# PROGRESS -- task-20260806-235643-review-and-land-the-six-open-veridian-sc

Child UMR: UMR-20260807-000049-8303 (parent UMR-20260806-071025-1d28; also cites
UMR-20260806-122520-8918, UMR-20260806-142639-6fc3, UMR-20260806-042531-be9c -- all 4
independently confirmed as real rows in /opt/veridian/ai-os/memory/superboss-register.sqlite
before minting).

Real correction to SPEC premise: by the time this task started (2026-08-06T~23:56Z dispatch,
work started 2026-08-07T00:00Z), 3 of the 6 cited PRs had already been merged by someone else
in the live autonomous pipeline (veridian-scripts has no branch protection and is under heavy
concurrent churn -- ~56 open PRs, PR #232 already exists as of task start):
- PR 172 -- MERGED 2026-08-06T15:56:16Z (mergedBy FChecklist)
- PR 176 -- MERGED 2026-08-06T16:36:44Z (mergedBy FChecklist)
- PR 177 -- MERGED 2026-08-06T14:44:57Z (mergedBy FChecklist)
Only PR 173, 174, 175 remain genuinely OPEN. Reviewing those three, in the SPEC's relative
order (174 before 175 before 173, since 172/176/177 are already gone).

## Completed
- [x] Read AGENTS.md / CLAUDE.md / ACTIVE-CLAIMS.yaml (compliance-tracker) -- no existing
      claim on this gap; veridian-scripts has no ACTIVE-CLAIMS file of its own, coordination
      is via the UMR register's own task_identity dedup check (ran clean on mint).
- [x] Verified all 4 SPEC-cited UMRs are real rows in superboss-register.sqlite.
- [x] Minted child UMR-20260807-000049-8303 via resource_governor.py --submit, linked to
      parent UMR-20260806-071025-1d28 via inputs.parent_umr.
- [x] Live-requeried mergeable state for all 6 PRs (not the PM's stale 14:46 snapshot):
      172/176/177 already MERGED; 173/174/175 OPEN.

## Remaining
- [ ] Review PR 174 (superboss-register mark-umr-terminal evidence gate) -- run real tests
- [ ] Review PR 175 (prune-memory-backups cadence + event trigger) -- run real tests
- [ ] Review PR 173 (gtm_check_ux_audit aria-hidden exclusion) -- run real tests
- [ ] Merge whichever genuinely pass; record real reasons for any declined
- [ ] Write real evidence into child UMR row; mark-umr-terminal
- [ ] Final report: merged list, declined list + reasons, resulting open-PR count
