# PROGRESS -- rebase-sweep2b-896 (real rebase-merge for PR #896)

## Scope
Real rebase-merge of PR #896 (`worker/task-20260804-125242-ocid-038-independently-verify-self-discl`,
"OCID-038: independent DB-forensic verification of a self-disclosed unintended write + real fix
for GAP-VERI-TODO-STUCK-LOADING-NOT-READY + mobile-viewport cooldown") onto current main, per this
repo's standard rebase-sweep protocol. Prior triage + adversarial-verify (already complete before
this sweep, not re-done here) confirmed real, additive, still-missing functionality on main:
`listVeriTodos()` in `veri-todo-service.ts` ran 5 sequential independent awaits instead of
`Promise.all`, and `veri-chat-context.tsx`/`VeriComposer.tsx` had zero occurrences of
`aiThreadsLoading` -- both real fixes genuinely absent from main.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-896` from
      `origin/worker/task-20260804-125242-ocid-038-independently-verify-self-discl`, `bun install`
      (1203 packages).
- [x] Independently re-confirmed the PR's real, narrow source diff before merging (3 files, 33
      insertions / 15 deletions): `veri-todo-service.ts` parallelizes exactly the 3 genuinely
      independent queries (`taskRows`/`commitmentRows`/`assigneeRows`) via `Promise.all` while
      correctly leaving the real data-dependent chain (`issueRows` needs `assigneeRows`,
      `statusRows` needs `issueRows`, `projectRows` needs `openIssues`) sequential -- not a
      cosmetic no-op fix. `veri-chat-context.tsx` adds a real `aiThreadsLoading` boolean (starts
      `true`, flipped `false` in the `/api/conversations` fetch's `.finally()`), threaded into
      context value/memo deps; `VeriComposer.tsx` consumes it to compute `discussNotReady` and
      gate the composer's disabled/placeholder state on it, closing the real race where a
      "discuss" submit before the AI-thread fetch resolved raced a null `aiThreadId`.
- [x] `git merge origin/main` (round 1) -- 2 real conflicts: `PROGRESS.md` (this repo's
      single-current-entry convention -- replaced wholesale with this entry, per the known
      gotcha) and `ai-os/boss/ACTIVE-CLAIMS.yaml` (main had independently pruned its `active:`
      list since this branch was cut -- took main's pruned list as base, re-appended this PR's
      own claim entry on top). All 3 real source fixes confirmed intact post-merge.
- [x] Found `veri-todo-service.ts` had zero sibling test coverage before this PR, tripping the
      real `New Test Coverage Check` CI gate. Added
      `src/lib/services/veri-todo-service.test.ts` (mocked `@/lib/db/tenant-scoped`, same
      convention as `crm-service.test.ts`'s `getSalesRepPerformanceDashboard` tests): a real
      regression guard proving the 3 independent queries are dispatched concurrently before any
      resolves, plus merge/sort/filter behavior and the empty-state short-circuit. Regenerated
      `docs/master/TEST_COVERAGE_GAP.md` (112/236 -> 113/236) via the documented workaround for
      `report-test-coverage-gap.mjs`'s isMain self-invocation bug in this shell.
- [x] Pushed `rebase-sweep2b-896`, opened replacement PR #1534 ("... [was #896]"), closed #896
      pointing to #1534.
- [x] `git merge origin/main` (round 2) -- main advanced again (PR #929's rebase-sweep, "OCID-050
      GET /api/me perf + settings isAdmin loading gate", merged as #1533). 1 conflict:
      `PROGRESS.md` (same wholesale-replace convention). Re-verified all 3 real source fixes and
      the new test file intact; pushed immediately.
- [x] `git merge origin/main` (round 3) -- main advanced a third time within minutes (PR #1019's
      rebase-sweep, "Close Cache & Synchronization / Cache Integrity & Security gaps", merged as
      `rebase-final-1019`/#1532) -- this repo is under unusually heavy concurrent rebase-sweep
      traffic right now (multiple sibling PRs landing every few minutes), matching the pattern
      already documented in this repo's own history for busy periods. 2 conflicts this round:
      `PROGRESS.md` (same wholesale-replace convention) and `ai-os/boss/ACTIVE-CLAIMS.yaml` (pure
      additive this time -- main's new entry for PR #1019 landed alongside, not instead of, this
      branch's own re-appended entry from round 1; kept both). Re-verified all 3 real source
      fixes and the new test file intact post-merge.

## Remaining
- [ ] Re-validate after round-3 merge: `bunx tsc --noEmit`, governance YAML parse,
      `node scripts/check-new-test-coverage.mjs`, targeted `bun test`.
- [ ] Push round-3 merge, re-check CI/mergeable state on PR #1534 immediately.
- [ ] Verify real CI on PR #1534 -- retry on transient network errors up to 5 times; ignore
      known-ambient failures (E2E Tests, Vercel platform-wide block, Secret Scanning on
      pre-existing files, Promptfoo Evals timeout). If main keeps advancing faster than CI can
      complete, may need another merge round before a clean CI run is achievable.
- [ ] Merge PR #1534 only when genuinely green (modulo the known-ambient ones).
