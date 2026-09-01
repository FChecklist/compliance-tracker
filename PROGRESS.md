# PROGRESS -- rebase-sweep2b-659 (real rebase-merge for PR #659)

## Scope
Real rebase-merge of PR #659 (`feat/pms-rollup-completion-task47`, Task #47: PMS
subtask + milestone completion rollup) onto current main, per this repo's standard
rebase-sweep protocol. Prior triage + adversarial-verify (already complete before this
sweep) confirmed a real, additive gap: current main's `src/lib/services/pms-issue-
service.ts` (301 lines) has `completionPercentage` only as a leaf-level field with a
0-100 validation check (lines 169-174) -- no parent/rollup aggregation function exists.
Main's `src/lib/services/schedule-service.ts` (317 lines) has no milestone-completion
rollup logic either. The PR adds query-time (non-recursive, direct-child) rollup math
wired into GET /api/pms/issues/[id], GET /api/pms/milestones, and GET
/api/pms/schedule/gantt, with zero schema/migration changes -- genuinely additive.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-659` from
      `origin/feat/pms-rollup-completion-task47`, `bun install` (1203 packages).
- [x] `git merge origin/main` (1229 commits behind) -- merged clean with **zero
      conflicts** (git auto-merged; `git status` showed no UU/AA/DD entries after the
      merge commit). No PROGRESS.md, drizzle/meta/_journal.json, or terminology-
      guardrail-exemptions.yaml conflicts to resolve by hand this time -- confirmed via
      `git diff --stat origin/main...HEAD` still showing only this PR's own 5 files
      (pms-issue-service.ts/.test.ts, pms-taxonomy-service.ts/.test.ts,
      schedule-service.ts) after the merge.
- [x] Re-ran `bun install` post-merge -- picked up 83 packages the branch's pre-merge
      node_modules lacked (`@axe-core/playwright@4.13.0`, `jscpd`, `knip`,
      `@fchecklist/veridian-ui-kit`, newer `next`/`xlsx`).
- [x] Validated for real:
      - `node scripts/check-governance-yaml-parse.mjs` -- pass, 5/5 governance YAML
        files parse cleanly.
      - `bunx tsc --noEmit` -- OOMed at default/1536MB heap under concurrent
        bun/tsc load from other sessions sharing this laptop (documented repo gotcha);
        retried at `NODE_OPTIONS=--max-old-space-size=2200` once free RAM recovered to
        ~2.5GB -- clean, 0 errors (the one `@axe-core/playwright` module-not-found hit
        on the first clean run was the pre-merge-install gap above, not a real type
        error -- resolved by the second `bun install`).
      - `bun test` on both touched test files -- 15/15 pass (pms-issue-service.test.ts +
        pms-taxonomy-service.test.ts), plus schedule-service.test.ts (pre-existing,
        touched indirectly) -- 6/6 pass.
      - `node_modules/.bin/eslint.exe` on all 5 touched files -- 0 errors (1 pre-existing
        complexity warning on schedule-service.ts, non-blocking).
      - `docs/master/TEST_COVERAGE_GAP.md` -- regenerated manually per this repo's known
        `scripts/report-test-coverage-gap.mjs` isMain self-invocation bug (imported
        `buildStats`/`renderReport` directly via a `file://` URL instead of running the
        script). Updated 110/236 (46.6%) -> 111/236 (47.0%) reflecting the new
        pms-taxonomy-service.test.ts; verified byte-for-byte match against what the
        script's own pure functions produce.
      - `node scripts/check-terminology-guardrail.mjs --full-repo` -- pass, 2773 files
        scanned, 0 new findings.
      - `node scripts/check-migration-integrity.mjs` -- pass (333 journal entries; no
        live DB comparison, DATABASE_URL not set locally, expected).
      - `node scripts/check-migration-collision.mjs` -- not applicable: this PR touches
        zero files under `drizzle/` (confirmed via
        `git diff --stat origin/main...HEAD -- drizzle/`, empty). The script itself hit
        a pre-existing Windows-only bug (`new URL("../drizzle", import.meta.url)
        .pathname` yields a malformed `/C:/...` path that `readdirSync` rejects) --
        reproduced identically running the same script against `origin/main` directly
        in the reference checkout, confirming it predates this PR and is a Windows-
        local-dev artifact (CI runs on Linux, where this path form is valid), not a
        real regression.
- [x] Committed and pushed `rebase-sweep2b-659` to origin.

## Next
- [ ] Open replacement PR titled with `[was #659]`, citing the original.
- [ ] Close original PR #659 with a comment pointing to the replacement.
- [ ] Check real CI on the new PR; merge only once genuinely green modulo documented
      ambient failures (E2E Tests, Vercel, Secret Scanning on pre-existing files,
      Promptfoo Evals timeout).
