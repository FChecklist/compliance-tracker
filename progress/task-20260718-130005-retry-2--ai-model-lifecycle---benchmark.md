# PROGRESS -- task-20260718-130005-retry-2--ai-model-lifecycle---benchmark

Task: "[retry 2] AI Model Lifecycle & Benchmarking: Evaluation & Promotion
Process" -- close 2 findings (prompt.txt):
- [High] Model evaluation gate before any roster.ts promotion
- [Critical] A/B or shadow-testing capability for a candidate model

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml -- no active entry for this task
      or overlapping file scope at time of work.
- [x] Per the task's own instruction ("read the actual current
      implementation first ... the codebase has moved since this
      evaluation was written"), checked live state before writing any
      code. Found this is a duplicate of an already-completed sibling
      task: **task-20260718-071005-ai-model-lifecycle---benchmarking--evalu**
      (same 2 findings, same title family) was merged into `main` as
      **PR #1221** at 2026-08-15T07:55:54Z -- a few hours before this
      retry-2 invocation started. Verified live via `gh pr view 1221`
      (state MERGED) and confirmed `origin/main` actually contains the
      real code (not just the PR's self-reported body claim):
      - **Finding 1 (High)** was already resolved earlier still, by
        **PR #417** (merged 2026-07-19): `.github/workflows/ai-prompt-evals.yml`
        exists on `origin/main`, path-filtered to
        `src/lib/ai-team/roster.ts` (and 6 other prompt-bearing files),
        and runs the real `promptfooconfig.yaml` promptfoo suite via
        `promptfoo eval` on every PR touching those paths. Confirmed by
        reading the live file (4283 bytes, `git cat-file -p
        origin/main:.github/workflows/ai-prompt-evals.yml`), not just the
        PR description.
      - **Finding 2 (Critical)** was resolved by PR #1221 itself:
        `src/lib/ai-team/roster-overrides.ts` (15186 bytes, live on
        `origin/main`) resolves the effective model per-dispatch from a DB
        override (`ai_team_role_overrides`), including an optional
        `candidateModel` + `rolloutPercentage` (0-100, CHECK-constrained)
        column pair added by `drizzle/0313_ai_team_role_overrides_rollout.sql`
        (2323 bytes, live) for real A/B / shadow-testing of a candidate
        model against roster.ts's static default. `team-service.ts`'s
        `runRole()` and the tier-eligibility pre-flight at all 3 real
        dispatch surfaces (AGENTS.md Rule 10) both resolve through this
        same layer, so an override/rollout can never bypass
        model-tier-eligibility.ts's guardrail.
      Both findings' "Recommended approach" text in this task's own
      prompt.txt is close to, but not identical to, what actually shipped
      (e.g. rollout lives as a column pair on the existing override table,
      not literally a bare new column on `roster.ts`'s own static config)
      -- consistent with the task's own warning that the recommended
      approach is a suggestion, not a spec, and the real fix is judged
      against the underlying gap, not the literal recommended text.
- [x] Per this task's own instruction ("if a finding turns out to already
      be resolved ... say so in PROGRESS.md rather than making an
      unnecessary change"): no functional/behavioral change made. Fast-
      forward merged `origin/main` into this task's branch (was ~30
      commits behind) so the branch's own history actually contains
      PR #417 + PR #1221's real fixes, rather than leaving them only
      reachable via `origin/main`.
- [x] Added one additive, non-functional documentation comment to
      `src/lib/ai-team/roster.ts`'s own module header, pointing future
      readers at `roster-overrides.ts` (the effective-model resolution
      layer), the rollout-percentage A/B mechanism, and
      `ai-prompt-evals.yml` (confirmed its path filter really does cover
      `roster.ts`, so this diff itself will trigger that workflow) --
      this file had zero prior mention of either mechanism, so a reader
      of `roster.ts` alone had no pointer to how model promotion/rollout
      actually works today. No `RoleDefinition`/`AI_TEAM_ROSTER` data
      changed.
- [x] Verification: `bunx tsc --noEmit` clean; `bun run lint` clean (only
      the same 3 pre-existing unrelated warnings PR #1221 already noted).

- [x] (invocation 16/20) Merged current `origin/main` (was 8 commits
      behind after invocation 14/20's PR #1017 merge) -- clean, no
      conflicts. Re-verified `bunx tsc --noEmit` (needed
      `NODE_OPTIONS=--max-old-space-size=4096`; default heap OOM'd in this
      environment -- unrelated to this change, a plain resource limit) and
      `bunx eslint src/lib/ai-team/roster.ts` both clean after the merge.
- [x] Pushed branch and opened **PR #1270**:
      https://github.com/FChecklist/compliance-tracker/pull/1270

## Remaining
- [ ] Watch PR #1270 CI (Type Check / Lint / Unit Tests / Promptfoo Evals
      still pending as of last check; `Vercel` preview failed on a build
      rate-limit, not a real code issue; `audit-check` fails until the
      AUDIT comment below is posted -- both expected at this stage).
- [ ] Post the AUDIT verdict comment once the substantive CI checks are
      green (Rule 10 process -- this diff is not on an `ai-team/<role>/*`
      branch so the mandatory merge-gate doesn't strictly apply, but doing
      it anyway is harmless and consistent with prior closures in this
      task family).
- [ ] Merge PR #1270 once green (per Rule 6, via PR -- no direct push to
      `main`).
