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

export default defineConfig({
  testDir: "./e2e",
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
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: ciPlaceholderEnv,
    stdout: "pipe",
    stderr: "pipe",
  },
});
