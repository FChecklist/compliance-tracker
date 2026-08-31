# Accessibility (WCAG Compliance) gap-closure

Finding: [Critical] Accessibility (WCAG Compliance): "Accessibility regression
testing included in CI" — Gap: Zero automated accessibility testing in CI.
Recommended approach: reuse existing Playwright infra + `@axe-core/playwright`
rather than a new framework.

## Resume history (for future invocations of this task)
- Invocation 15 RESUME's checkpoint narrative described Token Usage Ledger /
  cost-estimate-5org-50user.md work — that belongs to a *different* task
  (`task-20260718-050114-cost-estimate--5-orgs-x-10-users`, merged as PR
  #416). Known task.yaml/RESUME cross-contamination issue, not real progress
  on *this* task. Disregarded; verified real state via `git log`/`git
  status`/`gh pr list` instead.
- First pass this invocation: found a genuine, working, locally-verified
  diff already sitting uncommitted on this branch from an earlier
  invocation (`e2e/accessibility.spec.ts`, `playwright.config.ts`,
  `bunfig.toml`, `package.json`/`bun.lock` for `@axe-core/playwright`).
  Committed + pushed it (splitting `.github/workflows/ci.yml` out — this
  session's `gh` token lacks the `workflow` OAuth scope, see memory
  `gh-token-lacks-workflow-scope`) and opened PR #1232.
- **Then discovered the branch was 1327 commits behind `main`** (created
  from `016c77614`, a very old point — this repo has many concurrent
  worker sessions merging constantly). PR #1232 showed
  `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`. A trial
  `git merge origin/main` hit real conflicts in `bun.lock`, `bunfig.toml`,
  `package.json`, `playwright.config.ts` — main had independently gained
  its OWN `playwright.config.ts` (using `@playwright/test`, fixed
  2026-07-20 after a `playwright/test`-subpath MODULE_NOT_FOUND crash),
  `bunfig.toml` (`root = "src"`, same effect as this task's
  `pathIgnorePatterns` approach but via a different mechanism), and a real
  first e2e test (`e2e/browser-execution-tiers.spec.ts`, phase_5 browser
  execution tiers work) — **but NOT** `@axe-core/playwright` or any
  accessibility test, so this finding was still genuinely open on `main`,
  not a duplicate.
- Aborted the merge (too large/risky to reconcile 1327 commits of
  unrelated drift by hand), reset this branch to `origin/main`, and
  **rebuilt the same change fresh against current `main`'s conventions**:
  `e2e/accessibility.spec.ts` imports from `@playwright/test` (not the
  stale `playwright/test` subpath), `playwright.config.ts`'s existing
  `testDir`/comments preserved and additively extended with
  `webServer`/`baseURL` (needed because, unlike the existing phase_5 test,
  AxeBuilder needs a real rendered page), `bunfig.toml` left untouched
  (main's `root = "src"` already excludes `e2e/` from `bun test`, no need
  for a second mechanism), `package.json`/`bun.lock` gained
  `@axe-core/playwright` as a new devDependency alongside the existing
  `@playwright/test`.
- Superseded PR #1232 (closed as superseded) — see this file's later
  section for the replacement PR number once opened. [placeholder,
  updated below]

## Completed
- [x] Read `AGENTS.md`/`CLAUDE.md` governance docs.
- [x] Confirmed the finding is still real on current `main` (not resolved by
      another concurrent session): `@axe-core/playwright` absent from
      `package.json`, no accessibility/axe test file anywhere in the repo.
- [x] Added `@axe-core/playwright` as a devDependency (`package.json`,
      `bun.lock`), alongside the existing `@playwright/test` — installed and
      confirmed present in `node_modules`.
- [x] Extended the existing `playwright.config.ts` (additive — did not
      replace its existing `testDir`/rationale comments) with `webServer`
      (boots `bun run dev`) + `baseURL`, needed because
      `e2e/accessibility.spec.ts` navigates real pages, unlike the existing
      `about:blank`-only `browser-execution-tiers.spec.ts`.
- [x] Added `e2e/accessibility.spec.ts`: `AxeBuilder` (wcag2a/wcag2aa/wcag21aa
      tags) against 5 real, confirmed unauthenticated + DB-free pages (`/`,
      `/login`, `/pricing`, `/terms`, `/privacy`) — the only part of the real
      app surface (`src/app/(app)/**` sits behind Supabase Auth SSR
      middleware + DB reads on render) reachable in CI without seeding a real
      Supabase project. Attaches full axe JSON violation report on failure.
- [x] Did NOT add/modify `bunfig.toml` — `main`'s existing `root = "src"`
      already keeps `bun test` scoped away from `e2e/`, a second, redundant
      mechanism would be noise.
- [x] Verified locally end-to-end against the rebuilt diff:
  - `bun install` → `@axe-core/playwright` resolves into `node_modules`
    alongside the pre-existing `@playwright/test`.
  - `bunx playwright test` → **6 passed** (the pre-existing
    `browser-execution-tiers.spec.ts` test + the 5 new accessibility tests),
    zero real WCAG 2.1 A/AA violations found on any of the 5 pages.
    (Local run needs `LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs`
    for the cached Chromium binary — a known sandbox-only issue, not a CI
    issue; see memory `veridian-chromium-missing-libs-nosudo-fix`. CI's
    `playwright install --with-deps` installs real system deps and will not
    hit this.)
  - `bun test` (unit suite) → 2560 pass / 0 fail — confirms the new
    Playwright spec is still correctly excluded from the bun:test run by
    `main`'s existing `bunfig.toml`.
  - `bun run lint` → 0 errors (3 pre-existing warnings unrelated to this
    change).
- [x] Did not touch `src/lib/services/permission-service.ts` or any other
      in-flight worker's scope — this change is confined to e2e/CI-config
      files only.

## Known blocker: `.github/workflows/ci.yml` still could not be pushed

Unchanged from the first attempt: this session's `gh` token lacks the
`workflow` OAuth scope, so GitHub rejects any push touching a workflow file.
**Not a functional blocker** — current `main`'s unmodified `ci.yml` e2e job
(`bunx playwright install --with-deps chromium || true` then `bunx
playwright test --pass-with-no-tests`) already discovers and runs
`e2e/accessibility.spec.ts` for real; `--pass-with-no-tests` only changes
behavior when zero tests are found. The prepared `ci.yml` diff (drop `||
true`/`--pass-with-no-tests`, add placeholder env vars + a Playwright report
artifact upload) is pasted into the PR description as a fast-follow for
whoever has `workflow` scope to apply.

## Remaining
- [x] Push the rebuilt branch. PR #1232 (opened before the rebase was
      discovered) auto-updated in place on the force-push -- no need for a
      separate replacement PR; its description was rewritten to match the
      rebuilt diff, including the `ci.yml` follow-up diff.
- [x] Fixed a real, PR-caused-but-not-PR-introduced CI failure: Terminology
      Guardrail Check flagged `playwright.config.ts`'s pre-existing (main's
      own, 2026-07-20-dated) "Fixed 2026-07-20" comment as 1 new unexempted
      `hardcoded_iso_date` finding, surfaced only because this PR is the
      first to touch that file since the comment was written (`--diff-only`
      only scans changed files). Added the documented exemption entry
      (`ai-os/registry/terminology-guardrail-exemptions.yaml`) per the
      check script's own instructions, rather than rewording unrelated
      content. Verified locally before pushing.
- [x] Posted the required 8-field AUDIT: PASS comment (self-audit --
      single-session, no separate implementer/auditor identity exists yet
      per the repo's own documented limitation, see memory
      `veridian-audit-pass-same-identity-limitation`).
- [x] Real GitHub Actions CI on PR #1232, checked directly (not assumed):
      Lint / Type Check / Unit Tests / Terminology Guardrail Check /
      audit-check / Guardrail Presence Check / Secret Scanning / Security
      Pattern Check / Doc Cross-Reference / Doc Quarantine Banner /
      Metadata Index Coverage / Asset Registry Coverage / Migration Number
      Collision / Analyze (CodeQL) all **pass**. Only `Vercel` deploy check
      fails, and only on a pre-existing, unrelated `build-rate-limit`
      infra issue (visible in its own check URL), not caused by this PR.
- [x] `Build` finished green; `E2E Tests` finished **FAILURE** (real failure,
      not the flaky Vercel infra one). Investigated with a real log pull
      (`gh run view --job=<id> --log-failed`, since the unfiltered `--log`
      silently truncates to ~31 lines here — new instance of the known
      large-output-truncation issue, see memory
      `veridian-shell-large-output-truncation-bug`): `webServer` (`bun run
      dev`) never became ready within the 120s timeout, **zero** stdout
      captured for the entire window (`Error: Timed out waiting 120000ms
      for the server to start`).
- [x] Root-caused with real local reproduction (this sandbox's port 3000 is
      occupied by an unrelated system Grafana instance, so verified against
      alternate ports 3011-3013 instead, and reverted the temporary
      `package.json` port edit used only for that local test — never
      committed). **Two distinct, independently-confirmed real bugs**, not
      one guess:
  1. `playwright.config.ts`'s `webServer` never actually received the
     placeholder `DATABASE_URL`/Supabase env vars its own pre-existing
     comment *claimed* it already used (matching the `build`/`unit-tests`
     CI jobs' precedent) — the `e2e` job in `ci.yml` sets zero env vars, so
     `src/proxy.ts`'s `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
     ...)` throws synchronously on every request. Confirmed locally:
     reproducible `500 "Your project's URL and Key are required..."` on `/`
     with those vars unset.
  2. Even with (1) fixed, `/` and `/login` **still** 500'd: found a second,
     previously-undiscovered real bug —
     `resolvePreAuthBrandByHost()` (`src/lib/services/org-branding-service.ts`)
     calls `db.query.productBranches.findFirst()` completely unguarded,
     despite its own comment explicitly claiming "never throws". A DB
     connection failure (e.g. the placeholder `DATABASE_URL`, which points
     at nothing real in CI) propagates as an unhandled render error on
     *every* unauthenticated request to `/` and `/login` (both call this
     pre-auth, confirmed via `grep`). This directly corrects the earlier
     "confirmed DB-free" claim in this file's own Completed section above
     for those two specific routes — `/pricing`/`/terms`/`/privacy` really
     are DB-free (re-verified, no `db`/`resolvePreAuthBrandByHost` import
     anywhere under those route dirs), but `/` and `/login` are not, and
     without this fix the accessibility scan would have been auditing a
     generic Next.js crash page instead of real content even after fixing
     (1).
- [x] Fixed both, minimally and narrowly scoped to what's required:
  - `playwright.config.ts`: `webServer.env` now supplies the placeholder
    vars for real (only when unset in the parent env, so a real local
    `.env.local`-configured Supabase project is never shadowed for
    developer-run `bunx playwright test`); `webServer.timeout` raised
    120s -> 300s (the separate `Build` job alone takes ~2m23s for a full
    production build of this app's ~99 routes, so a cold Turbopack compile
    of just the first dev-mode request under a resource-constrained CI
    runner plausibly still exceeds 120s); `stdout`/`stderr` set to `'pipe'`
    so a future webServer failure is diagnosable directly from the CI log
    instead of the total silence seen this time.
  - `src/lib/services/org-branding-service.ts`: wrapped
    `resolvePreAuthBrandByHost()`'s DB query in try/catch, degrading to
    `null` (platform-default branding, matching every other
    "unmatched host" outcome this function already returns) on failure —
    matches the function's own documented "never a broken UI" contract,
    and is a real production-reliability fix independent of this CI job (a
    transient DB outage should not 500 the public homepage/login page).
- [x] Verified locally end-to-end before pushing:
  - Before fix: `bun run dev` with CI-shaped env (placeholder/missing
    `DATABASE_URL`/Supabase vars) -> `/` responds in 6-14s but with HTTP
    500 (first the `proxy.ts` throw, then, once that's patched, the
    `resolvePreAuthBrandByHost()` throw).
  - After fix: `/` responds HTTP 200 with real rendered HTML in ~14s.
  - `bun run lint` -> 0 errors (same 3 pre-existing warnings, unchanged).
  - `bunx tsc --noEmit` -> 0 errors (needed `NODE_OPTIONS=--max-old-space-size=4096`
    in this resource-constrained sandbox to avoid an OOM crash; not a CI
    concern).
  - `bun test` -> 2560 pass / 0 fail (unchanged).
- [x] Committed (`0b435fd93`) and pushed to the same PR #1232 branch; fresh
      CI run in progress on the new head SHA.
- [ ] Confirm the fresh CI run (post-`0b435fd93`) goes fully green,
      especially `E2E Tests` for real this time — check before declaring
      this closed.
- [ ] Re-post/re-verify the `AUDIT: PASS` comment applies to the new head
      SHA (standard synchronize-after-comment fix, see memory
      `veridian-audit-check-issue-comment-sha-bug`, if needed).
- [ ] `gh pr merge` is expected to fail with the known repo-wide
      self-approval branch-protection deadlock (`required_approving_review_count: 1`,
      only one real GitHub identity exists here) — see memory
      `veridian-branch-protection-self-approval-deadlock-active`. Do not
      loop on merge attempts; one attempt is enough to reconfirm, document,
      and leave for the Owner, same as every other PR in this repo right
      now.
