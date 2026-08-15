# PROGRESS -- task-20260718-115006-retry-1--ai-engineering-quality--overal

## Finding
- [Medium] Overall Code Quality Score -- "Strong documentation discipline offset
  by monolithic files and low test coverage." Recommended: split schema.ts by
  domain module and task-execution-engine.ts by responsibility; raise test
  coverage on the largest files first.

## Investigation (read before coding, per task instructions)
- Prior invocations of this exact task (result.json, 3 entries) all died to an
  infra-side OpenRouter 402 credits error before doing any real work -- no
  prior progress to resume from content-wise.
- This is NOT a fresh gap. An open PR (#688, branch
  worker/task-20260801-173901-retry-ai-engineering-quality-code-struct,
  authored 2026-08-01 by this same owner-authorized agent class) already does
  almost exactly this: splits task-execution-engine.ts's dispatchTool()/
  dispatchEngine() into src/lib/services/task-execution/{tool-dispatch,
  engine-dispatch}.ts, and deliberately defers schema.ts's *physical* split
  (adding a navigational-aid comment instead) because it's a hot file with
  many concurrently-open PRs appending to it.
- PR #688 is now `CONFLICTING`/`DIRTY` (2 weeks of churn on both files since
  Aug 1 -- e.g. more `dispatchEngine()` switch-cases added for newly
  registered engines). Re-checked live before starting: 9 open PRs currently
  touch schema.ts (#1238, #1237, #1234, #1231, #1229, #1227, #1212, #1046,
  #1020) -- the "hot file, don't force a physical split" reasoning from
  8e2edde4a / PR #688 still holds, arguably more so.
- Plan: replicate PR #688's real approach (extract dispatchTool/dispatchEngine
  out of task-execution-engine.ts; schema.ts gets a navigational-aid comment,
  not a physical split) directly on top of current main via cherry-pick +
  conflict resolution, on this task's own branch, so this task's own commit
  carries the real schema.ts/task-execution-engine.ts diff (completion gate).
  PR #688 will be noted as superseded/duplicate in the new PR description so
  it can be closed rather than left to rot.

## Completed
- [x] Read ACTIVE-CLAIMS.yaml, confirmed no live conflicting claim on
      schema.ts/task-execution-engine.ts modularity specifically.
- [x] Confirmed via `git merge-base --is-ancestor` that 8e2edde4a (PR #688)
      never landed on main.
- [x] Reverted a stray uncommitted PROGRESS.md diff that predated this
      invocation (shared-file cross-contamination risk per project protocol
      -- this task must not touch the shared PROGRESS.md, only this file).
- [x] Registered ACTIVE-CLAIMS.yaml entry, committed + pushed separately
      (fast, per protocol) before doing the real work.
- [x] Split src/lib/task-execution-engine.ts (2437 -> 995 lines) by
      responsibility: extracted `dispatchTool()` (~270 lines, still exported
      under its original `@/lib/task-execution-engine` path via a re-export
      so its 2 external call sites don't change) into new
      src/lib/services/task-execution/tool-dispatch.ts (281 lines), and
      `dispatchEngine()` + its 2 local helpers (~1170 lines, internal-only)
      into new src/lib/services/task-execution/engine-dispatch.ts (1199
      lines). Each new file only imports what its own function body uses
      (not a blind copy of the original import block).
- [x] schema.ts: NOT physically split (re-confirmed live: 6 open PRs still
      touch it, same reasoning as 8e2edde4a's deferral). Added a 10-line
      navigational-aid comment citing the real current count of its 125
      `// ─── Section Name ───` domain headers and a `grep` tip -- comment
      only, zero functional change.
- [x] Added src/lib/services/task-execution/engine-dispatch.test.ts (13
      tests, 20 assertions) -- dispatchEngine() had zero prior coverage
      (task-execution-engine.test.ts's own header scopes itself to
      buildNovelUmrHint() only and explicitly excludes it). Covers several
      pure-calculator engine branches, 2 error paths, and the one
      DB-touching branch (gst_return_validation_engine, all 4 of its
      outcomes) via a fake TenantDb -- no live DB opened.
- [x] Verified: `tsc --noEmit` clean; `bun test` 1434 pass / 0 fail across
      104 files (1421 pre-existing + 13 new); `bun run lint` 0 errors, same
      3 pre-existing unrelated warnings, no new ones.
- [x] Reviewed the full diff by hand before committing (this session did
      the investigation/planning/verification itself; delegated only the
      mechanical extraction+test-writing to a sub-agent, then checked its
      diff and re-ran tsc/test/lint independently rather than trusting its
      self-report).

## Remaining
- [x] Committed + pushed; PR #1258 opened; comment left on stale PR #688
      pointing to the replacement.
- [x] Moved this session's ACTIVE-CLAIMS.yaml entry to `recently_completed`.
- [ ] **task-execution-engine.ts split had to be REVERTED from PR #1258.**
      After the initial split+push, `origin/main` was found to have
      diverged further mid-task: a new `invokeEngine()` audit-wrapper
      architecture landed (engine-invocation.ts, breakdown.ts, plus
      business-rule-validator.ts / calculation-cross-verification.ts /
      mother-router.ts / new CRM engine services), none of which existed
      when this task's split was built. Rebuilding the split against the
      new content hit real tsc errors (missing-module + missing-export)
      that ran out of remaining budget to safely resolve. Reverted
      task-execution-engine.ts to origin/main's real current version rather
      than ship a split that might not compile. **This finding's
      task-execution-engine.ts split is a genuine remaining gap** -- needs
      a fresh follow-up task once main settles.
- [x] schema.ts navigational-aid comment DID survive and merge cleanly --
      this is the one part of the finding actually closed by PR #1258.

## Honest final state
PR #1258 ships: (1) the schema.ts navigational-aid comment (real, merged
clean), (2) ACTIVE-CLAIMS.yaml claim lifecycle. It does NOT ship the
task-execution-engine.ts split -- that was built once, verified clean
(tsc/test/lint all passed at that point), then had to be reverted after
main moved out from under it before this task's own commits could be
pushed+merged. A follow-up task should redo the same split (dispatchTool()/
dispatchEngine() extraction into src/lib/services/task-execution/) against
whatever main looks like when it runs, accounting for the new invokeEngine
audit-wrapper layer this task discovered.

## Notes for reviewer
- This finding ("Overall Code Quality Score") substantially overlapped
  already-attempted work: PR #688 (2026-08-01, branch
  worker/task-20260801-173901-retry-ai-engineering-quality-code-struct) did
  almost the same split but bundled 4 *other* unrelated findings into the
  same commit and never merged (now conflicting after 2 weeks of drift).
  This PR is scoped to just the one finding named in this task's prompt --
  intentionally did not pull in #688's REUSABLE-UTILITIES.md, the FK-
  constraints migration, or the requireAuth/guardrail-presence CI checks,
  since those belong to different findings and risk scope creep /
  permission-service.ts-adjacent churn this task was told to avoid.
