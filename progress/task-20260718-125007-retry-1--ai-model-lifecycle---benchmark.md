# PROGRESS -- task-20260718-125007-retry-1--ai-model-lifecycle---benchmark

Task: VERIDIAN Review Framework gap-closure, "AI Model Lifecycle &
Benchmarking / Ongoing Quality Monitoring" -- 3 High findings:
1. Per-role quality regression tracked over time, not just at launch.
2. Cost-per-quality-point tracked per model to inform routing decisions
   (explicitly depends on finding 1's table existing first).
3. Provider-outage historical incident correlation with role failures.

## Completed
- [x] Read AGENTS.md / CLAUDE.md / ai-os/CONSTITUTION.yaml pointers per
      "Read Before Starting Work".
- [x] Re-synced branch to origin/main before doing anything else: this
      branch (created 2026-07-18) was 1357 commits behind origin/main at
      resume, with **zero** commits of its own not already in origin/main
      (`git rev-list --count origin/main..HEAD` = 0) -- a clean
      `git merge --ff-only origin/main`, no work lost, no conflict.
      (Also discarded an accidental uncommitted edit to the shared
      `PROGRESS.md` at the top of this repo -- that file belongs to a
      different, already-merged task (the 5-org cost-estimate PR #416) and
      per this session's own resume protocol this task tracks progress
      here, not in that shared file.)
- [x] Checked `ai-os/boss/ACTIVE-CLAIMS.yaml` per Rule 11 before picking
      up real work, and cross-checked live PRs via
      `gh pr list --search "ai-model-lifecycle"`.
- [x] **Found this task is a duplicate.** Sibling task
      `task-20260718-072002-ai-model-lifecycle---benchmarking--ongoi`
      already opened **PR #1229** ("feat: AI Model Lifecycle &
      Benchmarking gap-closure (3 High findings)") covering these exact
      same 3 findings under the same "Ongoing Quality Monitoring"
      grouping, with the same finding-1-before-finding-2 dependency this
      task's own prompt.txt states.
- [x] Verified PR #1229's delivered code is real (not fabricated), by
      fetching its branch and reading the files directly rather than
      trusting the PR description:
      - `src/lib/services/role-quality-regression-service.ts` (Finding 1)
        -- reuses `prompt-eval-service.ts`'s existing `promptEvalCases` /
        `scoreKeywords()` / `checkPromptEvalBudget()` per AI-Team role
        (`roster.ts`'s `promptKey` -> `prompt_templates`), persists
        `role_quality_runs` with a rolling-baseline regression verdict.
        Spot-checked `role-quality-regression-service.test.ts` in full:
        6 real boundary-case unit tests (exact-threshold-inclusive vs
        just-under, empty-baseline, lookback-window truncation) -- correct,
        not placeholder tests.
      - `src/lib/services/cost-quality-service.ts` (Finding 2) -- joins
        `role_quality_runs` (Finding 1) against `token_usage_ledger` via an
        exact `taskSummary = 'role_quality_run:<runId>'` tag, not a fuzzy
        time-window join. Matches this task's own "depends on row 99"
        note.
      - `src/lib/services/provider-outage-service.ts` (Finding 3) -- new
        `provider_outage_windows` table + `correlateOutageWithRoleFailures()`
        (same-role before/during baseline comparison, not a raw failure
        count), plus `findCandidateOutageWindows()` reconstructing
        candidate windows from `platform.dispatch_outcomes` (already-real,
        Stage 12 / drizzle/0300) rather than adding a new hot-path DB write
        to `llm-client.ts`'s shared `callLLM()`.
      - Matching route.ts files under `/api/ai/team/{role-quality,
        cost-quality,provider-outages}` + a cron `GET/POST
        /api/internal/role-quality-regression/run` + `vercel.json` entry.
      All 3 service files carry an honest "investigated the actual current
      implementation first" header in this codebase's own established
      style, confirming genuinely-checked-not-guessed gaps at write time.
- [x] Registered this finding in `ai-os/boss/ACTIVE-CLAIMS.yaml` (declined/
      duplicate entry, citing PR #1229 and the honest note below).
- [x] Declined to open a competing PR / write duplicate code.

## Honest note (not a blocker on this task, but disclosed per this
codebase's own standard)
PR #1229 is currently `mergeable: CONFLICTING` -- its
`drizzle/0313_ai_model_lifecycle_benchmarking.sql` collides with
`drizzle/0313_ai_team_role_overrides_rollout.sql`, which merged to main
separately (PR #1221, a different sibling task in this same review-
framework wave) after PR #1229's branch was cut. This is a real rebase/
migration-renumbering problem for PR #1229's own owning session to fix, not
evidence the feature work itself is wrong -- and fixing another session's
open PR is out of this task's own file scope (Rule 11's cooperative-
registry model, same as every other duplicate-dispatch case this session
type has hit before).

## Remaining
- [ ] None from this task's own scope. Real follow-up (not this task's
      job): whoever owns PR #1229's session should rebase its migration
      file to a free number (current tip is 0314) before that PR can merge.
