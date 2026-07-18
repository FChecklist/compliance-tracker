# PROGRESS -- rescue PR #427 (worker/task-20260718-084003-calculation-engine--calculation-governan)

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no conflicting active claim for PR #427 rescue; registered claim & pushed (on this task's own branch, separate small chore commit)
- [x] Checked out PR #427 head (branch already in use by another worktree on
      this host, fetched as local branch `pr-427-rescue` from `refs/pull/427/head`)
- [x] Merged origin/main into the PR branch (merge, not rebase). Main had
      advanced substantially (mother router, ABAC, audit-search, support
      sessions, etc all landed since this PR opened). Conflicts:
      - PROGRESS.md: kept PR's own (--ours)
      - ai-os/boss/ACTIVE-CLAIMS.yaml: both sides independently appended new
        `active:` entries in the same region -- kept both (append-only log,
        not a real conflict, just adjacent inserts)
      - All other files auto-merged cleanly (schema.ts, task-execution-engine.ts,
        ChainSelector.tsx, VeriComposer.tsx, asset-registry-coverage.yaml, etc)
- [x] Checked PR's own migration: adds `drizzle/0225_calculation_engine_governance.sql`.
      Confirmed via `git ls-tree origin/main -- drizzle/` that main's real
      highest migration is now 0235 (support_sessions through
      register_ai_team_role_overrides, all merged after this PR opened) --
      real collision. Renamed to `drizzle/0236_calculation_engine_governance.sql`
      (git mv, precedent-matching prior rescue sessions' renumber commits).
      No internal filename references elsewhere in the codebase (grepped
      clean). schema.ts's calculationInvocations table / computationEngines
      version columns are independent of the migration filename -- unaffected.
      `scripts/check-migration-collision.mjs` (confirmed NOT wired into any
      CI workflow -- grepped `.github/`, zero hits) flagged a false-positive
      collision at 0225 when run locally, traced to this worktree's local
      `main` git ref being 40 commits stale vs `origin/main` (a known
      artifact of the multi-worktree host setup, not a real problem) --
      verified the real check (`git diff --name-only origin/main HEAD --
      drizzle/` for duplicate number prefixes) comes back clean.
- [x] Ran `bun install --frozen-lockfile && bunx tsc --noEmit && bun run lint && bun test`
      locally -- tsc clean (0 errors), lint clean (0 errors, 3 pre-existing
      unrelated warnings), bun test 1631 pass / 0 fail across 125 files
      (3205 expect() calls). Also spot-ran the PR's own new test files
      (golden-values.test.ts, structured-message.test.ts) individually: 23
      pass / 0 fail. Also ran the repo's own CI-adjacent guard scripts
      locally: asset-registry-coverage (439 tables accounted for), guardrail
      presence (88 markers), metadata-index-coverage (31 items) -- all pass.
- [x] Pushed merged + renumbered branch to PR #427's real head ref (origin
      worker/task-20260718-084003-calculation-engine--calculation-governan).
- [x] Read the PR's full diff myself (19 files via `gh pr diff 427`) before
      auditing -- schema/version-control additions (engineVersion,
      effectiveFrom/To on computationEngines), new FORCE-RLS org-scoped
      calculation_invocations audit table + invokeEngine() wrapper (writes
      an audit row on both success and failure paths), optional additive
      `breakdown` field on 4 statutory engines (income tax, GST, gratuity,
      TDS) rendered via a new "calculation" structured-message type, a
      16-fixture golden-value regression suite, and calculator-suggestion
      chips reusing the existing capability tree. No new API routes (so
      requireAuth() is N/A). id-generation convention matches existing
      tables. No real defects found.
- [x] Posted structured `AUDIT: PASS` PR comment (all 8 required fields):
      https://github.com/FChecklist/compliance-tracker/pull/427#issuecomment-5013301358
- [x] Investigated why CI never went green: GitHub Actions never created a
      check-suite for this branch at all across 3 separate remediation
      attempts (merge+renumber push 88b678ba, an empty-commit retrigger
      f80d687d, and a close+reopen of the PR) spanning ~10 minutes.
      Confirmed via `gh api .../check-suites` on both commits -- only
      third-party app suites (Vercel, Supabase, Cursor, Fly.io, Claude)
      appear, all stuck "queued", zero GitHub Actions suite entry at any
      point. Ruled out a config-level cause: `git diff origin/main --
      .github/workflows/` is empty (byte-identical to what's currently
      running fine elsewhere). Ruled out a repo-wide outage: `gh run list`
      in the same wall-clock window shows main and 2 sibling PR branches
      (worker/task-20260718-090002-... and worker/task-20260718-053002-...)
      all getting fresh, normally-completing pull_request-triggered CI runs.
      This is the same isolated per-branch GitHub Actions reliability
      anomaly documented in this session's ACTIVE-CLAIMS.yaml for PR #415's
      rescue (same symptom: stuck check-suite association, not fixable by
      further code changes in this repo).
- [x] TIER classification: this PR touches `drizzle/0236_calculation_engine_governance.sql`
      + `src/lib/db/schema.ts` -> **TIER2**. Per task constraints, will NOT
      merge this PR myself even if CI had gone green.

## Remaining
- [ ] CI has not gone green on PR #427 because GitHub Actions has not
      created a check-suite at all on this branch since the rescue's fixes
      were pushed -- confirmed infrastructure-side blocker (isolated to
      this one PR/branch, not a code defect, not a repo-wide outage), not
      something fixable by further pushes from this session. Needs
      GitHub-side investigation (Owner or a repo admin with dashboard/
      support access) or simply time.
- [ ] Because of the above, CI cannot be confirmed green in this session,
      and per task constraints this PR (TIER2 -- touches drizzle/*.sql +
      schema.ts) must not be merged regardless. No merge action taken on
      PR #427 itself. Reported to the Owner for sign-off, with the
      CI-trigger anomaly flagged as its own separate open item (now a
      second occurrence of the same symptom class as PR #415 -- may be
      worth a GitHub-side/support ticket if it recurs on future PRs too).
