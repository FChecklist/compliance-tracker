# PROGRESS -- task-20260728-160922-fix-pr--618-real-audit-fail-reason

SPEC: PR #618 (phase_8 prompt translation/localization/marketplace) had
mergeable=unknown (found as CONFLICTING by the time this task started),
last audit said FAIL. Read the full audit comment, fix the real reason,
re-adopt, re-sweep. tier2/FAIL stays open for review.

## Completed
- [x] Read AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml governance
      chain -- no collision with another active session's claim on PR
      #618 or its files.
- [x] Read PR #618's full audit-comment history via the GitHub API
      (`gh api repos/.../issues/618/comments`, not `gh pr view --json
      comments` which silently truncates long bodies in this
      environment). Latest (2026-07-28T10:03:54Z): FAIL, "the diff
      supplied for this review is materially incomplete" -- 3 of 4 new
      service files + their tests never shown, prompt-export-import-
      service.ts truncated mid-function; secondary finding about
      drizzle/0269's self-correcting RLS-policy narrative.
- [x] Root-caused the "materially incomplete diff" claim for real instead
      of trusting the auditor's self-report: `ai-os/scripts/
      supervisor-entrypoint.sh` line 56 does `git diff
      "origin/$DEFAULT_BRANCH"...HEAD | head -c 60000` before handing the
      diff to the reviewing LLM. PR #618's real diff is 95,994 bytes --
      computed the exact cumulative byte offset per file in diff order
      and confirmed the 60,000-byte cutoff lands exactly inside
      `prompt-export-import-service.ts` (54,406 -> 60,557 bytes),
      matching the auditor's description precisely. Confirmed via `gh api
      .../pulls/618/files` that every file's own patch is fully present
      and untruncated at the GitHub API level -- this is a
      supervisor-review-pipeline defect, not a code defect in PR #618.
- [x] Confirmed the live, operational copy of this script is in the
      separate `claude-control` repo
      (`/opt/veridian/repos/claude-control/scripts/supervisor-entrypoint.sh`),
      not this repo's stale `ai-os/scripts/` mirror -- both have the
      identical `head -c 60000` line. Not fixing it there myself: it's
      shared infrastructure for every task's audit across the whole
      AI-OS, out of this task's compliance-tracker-only scope -- flagging
      it to the user instead (see Remaining).
- [x] Fixed what's genuinely actionable within this repo, directly on PR
      #618's own branch (`worker/task-20260728-051737-owner-engine-phase-8-real-gaps`):
      - Merged `origin/main` in (mergeable was CONFLICTING; trivial
        append-only PROGRESS.md conflict, ACTIVE-CLAIMS.yaml auto-merged
        clean). `gh pr view 618` now reports `mergeable=MERGEABLE`.
      - Found an abandoned prior session's workspace
        (`task-20260728-122700-investigate-pr--618-real-audit-fail-reas`,
        no live systemd unit, nothing pushed, no registered claim) had
        independently reached the same root-cause direction and left an
        uncommitted fix for the migration's self-correcting RLS narrative.
        Reviewed it, confirmed correct, re-applied it myself after
        independent verification against the real schema (app_runtime is
        `NOSUPERUSER NOBYPASSRLS` per drizzle/0215).
      - Rewrote drizzle/0269's RLS/GRANT block as a single clean `FOR ALL
        USING (true) WITH CHECK (true)` block per table instead of the old
        create-SELECT-only-then-DROP-then-recreate-FOR-ALL narrative.
      - Fixed a real bug found while verifying:
        `prompt-export-import-service.test.ts`'s `setupImport()` mocked
        `./prompt-os-service` with a semver-incorrect fake that leaked
        across test files within the same `bun test` process (bun's
        `mock.module()` replaces the module for the rest of the process,
        not just the current file), corrupting
        `prompt-os-service.test.ts`'s own real `nextSemanticVersion`
        assertions whenever both ran together. Removed the mock --
        nothing in this test asserts specific major/minor/patch values.
      - Verified: ran all 5 phase_8 test files together in one process --
        41/41 pass, confirming the leak fix actually works.
        `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` clean.
        Full-repo `bun test`: 2322 pass, 0 fail.
      - Committed + pushed directly to PR #618's branch (commits
        `29331150` merge+claim registration, `faa52ec0` the real fix).
        CI re-triggered on push.
- [x] Registered this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      (on PR #618's own branch, pushed in the first commit above).

## Remaining
- [ ] Owner decision needed: raise/remove the `head -c 60000` diff cap in
      claude-control's `supervisor-entrypoint.sh` (the actual live copy).
      Without that, a fresh re-sweep of this PR will very likely hit the
      identical truncation again -- PR #618's legitimate feature diff,
      even fully cleaned up, does not fit under 60,000 bytes, and the
      exact same file-and-a-half get cut off either way. This is a
      one-line, low-risk, backward-compatible change (only makes audits
      see MORE of the diff), but it's shared infrastructure for every
      task's audits across the whole AI-OS and lives in a repo outside
      this task's assigned workspace, so it needs explicit sign-off
      before anyone pushes it.
- [ ] Fresh supervisor re-sweep of PR #618 (mandatory, this session may
      not self-certify). tier2/FAIL stays open for human review per
      SPEC regardless of the re-sweep's outcome.
