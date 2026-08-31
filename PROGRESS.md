# PROGRESS -- rebase-995-v2 (replacement for PR #995, winner of #995 vs #997)

## Scope

PR #995 and PR #997 independently built the same 5 report engines
(CO-001, CO-003, FI-GL-002, FI-GL-007, FI-GL-008). #995 was chosen as the
winner: it registers its migrations correctly in
`drizzle/meta/_journal.json` (#997 does not) and routes cost-center reports
under `/api/v1/projexa/` matching main's existing convention (`ar-aging`,
`asset-to-gl-reconciliation` already live there; #997 instead used a new
`/api/erp/reports/` prefix for these two). #997's 6 unique reports
(SD-006, FI-AP-001/002/003, FI-AR-001/002/005) are NOT part of this PR --
tracked separately as a follow-up PR that cherry-picks just that remainder
onto this PR once merged.

## Completed
- [x] Found two stale local leftovers from an earlier same-day attempt at
      this exact rebase (`rebase-995` and `rebase-995-b2`, both unpushed) --
      both had silently deleted unrelated, still-live main functionality
      (crm-service.ts -432 lines, action-autonomy-decision.ts removed
      entirely + its test, CRM leads bulk-reassign/export/import routes
      removed, 3 internal cron routes removed, `drizzle/0360_task_assignees`
      itself deleted). Discarded both rather than building on top of a
      corrupted base; did a fresh `git worktree add -b rebase-995-v2` from
      current `origin/main` instead and a real 3-way `git merge` of PR #995's
      actual source branch (`worker/task-20260806-091101-build-extend-
      calculation-track-engines`, verified HEAD SHA matches GitHub exactly).
- [x] Real merge conflicts (4 files, everything else auto-merged clean):
      `PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml` (both resolved
      keep-both/append at the time -- corrected below, see note), `src/lib/
      services/report-engine-service.ts` (two purely-additive import/
      function-registry hunks, combined both sides), `drizzle/meta/
      _journal.json` (renumbered, see below).
- [x] Migration collision: PR #995's 5 migrations were authored as
      `0313`-`0317` back when main was at that point (Aug 6); main was then
      at `0360` (idx 315 in `_journal.json`, confirmed via `git cat-file -p
      origin/main:drizzle/meta/_journal.json` -- plain `git show` truncates
      blob output at ~31 lines on this box, a known gotcha). Checked
      `ai-os/boss/ACTIVE-CLAIMS.yaml`'s live `active:` section and all ~30
      currently-open PRs for any real reserved migration number above 0360:
      none found. Renumbered all 5 to `0361`-`0365` (file renames via
      `git mv` + matching `_journal.json` idx 316-320, contiguous, valid
      JSON verified).
- [x] `governance-yaml-parse`: clean. `bun test` on the two touched/new test
      files: `erp-financial-report-service.test.ts` 17/17 pass,
      `report-engine-service.test.ts` 21/21 pass. Repo-wide sweep for
      leftover merge-conflict markers: none.
- [x] `tsc --noEmit`: did not complete locally after ~40 minutes -- this
      sandbox was under severe multi-session resource pressure (90+
      concurrent `bash` processes observed at the time), the same
      pre-existing sandbox limitation already documented elsewhere in this
      file's own history. Deferred to CI's real Type Check job.
- [x] Pushed, opened PR #1497 ("... [was #995]"), closed #995 citing
      supersession.
- [x] `main` moved 11 commits during the push/PR-open window (picked up
      PR #1492 "rebase-968" and #1493 "rebase-1430-f020-gl-posting") --
      re-merged `origin/main` into this branch. Real conflicts this pass:
      `PROGRESS.md`, `drizzle/meta/_journal.json` only (both from the
      routine append-only files; no code-file conflicts -- confirmed via
      `git diff` on the incoming commit range touching none of the 5
      service/route files this PR changes).
- [x] **Correction on this re-merge**: this file (`PROGRESS.md`) explicitly
      documents its own convention two entries back ("this file follows this
      repo's established convention of holding only the *current* active
      entry, not an accumulated log ... a prior invocation of this same task
      had mistakenly concatenated three old entries end-to-end here instead;
      that mistake is corrected in this pass, not repeated"). My first
      conflict resolution on this file (the keep-both/append noted above)
      repeated exactly that mistake. Fixed here: replaced wholesale with
      only this current entry, per the file's own documented rule.

## Remaining
- [ ] Push this re-merge, confirm CI is green on PR #1497 for real (not
      assumed), merge.
- [ ] Move the corresponding `ai-os/boss/ACTIVE-CLAIMS.yaml` entry
      (`task-20260806-091101-build-extend-calculation-track-engines`) from
      `active:` to `recently_completed:` once merged, per this file's Rule 3.
