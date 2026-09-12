import { defineConfig } from "@playwright/test";

// Fixed 2026-07-20 (E2E CI job was crashing on every single PR --
// MODULE_NOT_FOUND at config-load time, before any test even ran).
// Root cause: this config imported from "playwright/test" on the
// unverified assumption that `playwright` was resolvable as a transitive
// dependency via promptfoo. It was not -- confirmed directly: no
// node_modules/playwright existed, no "playwright" reference anywhere in
// package.json, and `bunx playwright test` (which fetches its OWN
// isolated playwright@latest into /tmp/bunx-*/ when the package isn't a
// real project dependency, completely bypassing node_modules) reproduced
// the exact CI failure locally. Fixed properly, not worked around: added
// @playwright/test as a real devDependency (the officially supported way
// to set this up) and import from it directly, so both bunx's local-
// package preference and this config's own module resolution have a real
// package to find.
//
// Wave 79 note (partially stale as of the Accessibility gap-closure below):
// e2e/browser-execution-tiers.spec.ts (VERIDIAN_Architecture_v2.0 phase_5)
// was the first real test added here and deliberately needs no server
// (about:blank + page.evaluate against real browser globals). testDir
// scopes discovery to a dedicated e2e/ directory. R38 later added a second
// real test (e2e/demo-gate-smoke.spec.ts, R-B1) -- --pass-with-no-tests was
// removed from the CI workflow accordingly (E-38).
//
// Accessibility gap-closure (Review Framework, Accessibility/WCAG
// Compliance, Critical finding "Accessibility regression testing included
// in CI"): e2e/accessibility.spec.ts DOES need a live server to point
// AxeBuilder at real rendered pages, unlike the phase_5 test above. webServer
// below boots `next dev` itself (the e2e CI job runs on a bare checkout with
// no build artifact to reuse from the separate `build` job). reuseExistingServer
// keeps this fast for local `bunx playwright test` runs against an
// already-running `bun run dev`.
//
// Fixed 2026-08-15 (real CI failure, PR #1232's E2E Tests job: webServer
// never became ready within the original 120s timeout, zero stdout captured
// -- Build times out at ~2m23s for a full production build of this
// codebase's ~99 app routes, so a cold dev-mode compile of the first
// request under a resource-constrained CI runner plausibly exceeds 120s
// too). Two real, independently-verified fixes, not one guess:
// (1) timeout raised to 300s to absorb a slow cold compile.
// (2) `env` below actually supplies the placeholder DATABASE_URL/Supabase
// vars this file's comment used to CLAIM were already being passed to the
// `build`/`unit-tests` CI jobs' precedent, but never actually were -- the
// `e2e` job in ci.yml sets zero env vars, so src/proxy.ts's
// `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)` throws
// synchronously on every single request (confirmed locally: reproducible
// 500 "Your project's URL and Key are required" on `/`), meaning even once
// the timeout is fixed, AxeBuilder would have been auditing a generic
// Next.js crash page instead of the real, intended (/, /login, /pricing,
// /terms, /privacy) content. Only set when unset, so a real local
// `.env.local`-configured Supabase project is never shadowed in local
// `bunx playwright test` runs.
const ciPlaceholderEnv = process.env.CI
  ? {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:placeholder@localhost:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    }
  : undefined;

// DOD-X4/P4.4 (2026-09-10): "ct main CI green with the Vercel-env test
// EXCLUDED, not tolerated." Before this, `bunx playwright test` in CI
// ATTEMPTED all 9 tests and 3 self-skipped (test.skip(!!process.env.CI, ...)
// in r48-uat-bank-reachability.spec.ts and r63-local-composer.spec.ts;
// demo-gate-smoke.spec.ts's own runtime ENV-2-reachability probe) -- CI
// still went green, but only because a skip doesn't fail the job, which is
// tolerance, not exclusion (D58: a result an instrument was never shown
// capable of turning red on is a claim, not a finding). Excluding these
// three here means they never appear in a CI run's test count at all
// (0 skipped, not 3) -- the run reports exactly the 6 tests that always
// execute for real (5x accessibility.spec.ts + browser-execution-
// tiers.spec.ts), and each excluded file's own test.skip(!!process.env.CI)
// stays in place as an unrelated belt-and-braces guard, not the primary
// mechanism, for anyone who somehow runs playwright without this config.
// r48/r63 are local-only manual diagnostics (need an already-running dev
// server this job's own webServer doesn't provide the way they expect) --
// unrelated to DOD-X4's Vercel/ENV-2 target, excluded here only so the
// CI-wide "zero skipped" reading holds, not reclassified as gate evidence.
// Local/manual runs are UNCHANGED: `bunx playwright test
// e2e/demo-gate-smoke.spec.ts` (optionally with E2E_PROJEXA_ORIGIN pointed
// at a local ENV-1 projexa dev server) still works exactly as before --
// this only narrows what CI itself attempts.
const ciExcludedSpecs = process.env.CI
  ? [
      "demo-gate-smoke.spec.ts",
      "r48-uat-bank-reachability.spec.ts",
      "r63-local-composer.spec.ts",
    ]
  : undefined;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ciExcludedSpecs,
  use: {
    baseURL: "http://localhost:3000",
    // R74 Y4-03: capture on failure only (not every run -- would fill the
    // git-ignored output dir fast and slow the suite for no benefit on
    // passing tests). A trace can contain a session token (GY-17) -- the
    // output directories below are confirmed git-ignored (test-results/,
    // playwright-report/) BEFORE this config was extended, not after.
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // NOT "bun run dev" -- that script pipes through `tee dev.log`, which
    // bun's Windows script runner does not support (CLAUDE.md's own
    // documented gotcha, confirmed again by this session directly before
    // relying on it: see R74 Phase 4 claude_log entry). Runs the same two
    // underlying steps `bun run dev` would, without the broken pipe.
    command: "node scripts/generate-protected-routes.mjs && npx next dev -p 3000",
    url: "http://localhost:3000",
    // T2 (W-CI, e2e-env1 job, ci.yml): that job boots a REAL production
    // `next start` on :3000 itself, with real secrets, BEFORE running
    // playwright at all (its specs need it as PROJEXA's live backend, not
    // as their own baseURL) -- reuseExistingServer must be true there, or
    // this config's own dev-mode webServer would try to bind the same port
    // and fail "already in use". The regular `e2e` job above is unaffected:
    // it never sets E2E_ENV1_JOB, so reuseExistingServer still defaults to
    // false in CI there, and that job still proves it can boot its own
    // server from cold, same as before this line existed.
    reuseExistingServer: !process.env.CI || process.env.E2E_ENV1_JOB === "true",
    timeout: 300_000,
    env: ciPlaceholderEnv,
    stdout: "pipe",
    stderr: "pipe",
  },
});
