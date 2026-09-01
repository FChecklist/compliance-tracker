# PROGRESS -- rebase-cleanup-1199 (real rebase-merge for PR #1199, replacement PR opened)
## Scope
Real rebase-merge of PR #1199 (`worker/task-20260815-033541-owner-delegated-
decision--provision-a-re`, "feat: real GTM cat15/16 dummy-tenant provisioning
+ tests (owner-delegated, finishes stranded PR 1002)") onto current main, per
this repo's standard rebase-sweep protocol. A prior attempt at this same
cleanup failed partway through with a transient network error (ECONNRESET),
not a real decision -- this is a fresh attempt, new worktree
(`wtree-cleanup-1199`), new branch (`rebase-cleanup-1199`).

Original PR content (already independently reviewed/used, not re-litigated
here): `scripts/gtm-provision-cat15-16-test-tenant.ts`, the script that
provisioned the real "Meridian Test Industries" GTM cat15/16 dummy tenant +
4 role-based test accounts and ran the real multi-tenant-isolation/role-
permission tests (both PASS, recorded in `gtm_certification_categories`).
**The real production-adjacent actions this script performs (credential
resets for the 4 real test accounts) were already executed live in a prior
session, outside code review -- this rebase-merge does NOT re-run or
re-trigger any of that script's actual provisioning logic. It only lands the
already-vetted, already-used script text into the repo for future reuse.**

Also removed before merging: `.scratch_final_check.py`, a 5-line ad hoc
CI-status-polling script accidentally committed to the PR branch (not part
of the real feature, not merged in).
## Completed
- [x] `gh pr view 1199` -- confirmed `mergeable: CONFLICTING` /
      `mergeStateStatus: DIRTY` (main had moved on). Field-by-field
      `--jq` queries used throughout instead of raw `--json` dumps: this
      session hit the standing `gh`/`git show` large-output-truncation
      gotcha (see `[[powershell_bracket_paths_silently_match_nothing]]` /
      `[[veridian_git_show_truncates_blob_output]]`) again on this PR's own
      `gh pr view --json` output (silently cut mid-string with a bare
      `...`), so every subsequent read of large text (this file's own old
      `ACTIVE-CLAIMS.yaml` diff included) used `git cat-file -p` /
      single-field `--jq` rather than trusting a raw redirected dump.
- [x] Worktree: `git worktree add /path/wtree-cleanup-1199 FETCH_HEAD` from
      a combined `git fetch origin main <PR-branch>` -- caught that
      `FETCH_HEAD` after a two-ref fetch resolved to `main`'s tip, not the
      PR branch (order/precedence gotcha); corrected by hard-resetting the
      worktree branch to the real `origin/<PR-branch>` remote-tracking ref
      before doing anything else. `bun install` (1203 packages).
- [x] `git merge origin/main` -- 2 real conflicts:
      - `PROGRESS.md` (this repo's single-current-entry convention,
        replaced wholesale with this entry).
      - `ai-os/boss/ACTIVE-CLAIMS.yaml`: main's copy has since been pruned
        down to only the `active:` section (the `recently_completed:`
        section and all its entries are gone from main entirely, and
        main's `active:` itself is unrelated ongoing rebase-sweep work for
        other PRs, e.g. `rebase-1530-final`/#1530 dated the same day).
        The PR branch's own diff (checked via `git diff <merge-base>
        <PR-head> -- ai-os/boss/ACTIVE-CLAIMS.yaml`) added exactly one
        entry under `recently_completed:` documenting the GTM cat15/16
        work. Per the live precedent already recorded in main's own file
        (the `rebase-1530-final` entry, appended the same day this file
        was pruned, with its own `rebase_note:` field), took main's
        pruned file as-is and appended this task's original claim text as
        a new entry at the end of `active:` (not resurrecting the deleted
        `recently_completed:` section) with an added `rebase_note:`
        documenting this merge.
      No `drizzle/` conflicts and no migration files anywhere in this PR's
      diff (confirmed via `git diff <merge-base> <PR-head> -- drizzle/`,
      empty), so no journal renumbering was needed.
      Deleted `.scratch_final_check.py` (`git rm`) after the merge --
      leftover ad hoc debug script, not part of the real feature.
- [x] Validated: `node scripts/check-governance-yaml-parse.mjs`,
      `bunx tsc --noEmit`, `bun test` on the touched files. Results
      recorded at merge-commit time (see commit body / PR description for
      exact output).
- [x] Pushed to `rebase-cleanup-1199`, opened a replacement PR ("... [was
      #1199]"), closed original PR #1199 pointing to the replacement.
## Remaining
- [ ] Check real CI on the replacement PR -- retry on transient network
      errors up to 5 times; ignore known-ambient non-blocking failures
      (E2E Tests, Vercel org-wide deployment-blocked, Secret Scanning on
      pre-existing files, Promptfoo Evals).
- [ ] Re-check `mergeable`/`mergeStateStatus` right before merging in case
      main advanced yet again; re-merge if so.
- [ ] Merge the replacement PR only when genuinely green (modulo the
      known-ambient ones).
- [ ] Independently verify post-merge via `gh pr view --json
      state,mergedAt` -- do not just trust the merge command's exit code.
