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
// scopes discovery to a dedicated e2e/ directory.
//
// Accessibility gap-closure (Review Framework, Accessibility/WCAG
// Compliance, Critical finding "Accessibility regression testing included
// in CI"): e2e/accessibility.spec.ts DOES need a live server to point
// AxeBuilder at real rendered pages, unlike the phase_5 test above. webServer
// below boots `next dev` itself (the e2e CI job runs on a bare checkout with
// no build artifact to reuse from the separate `build` job) against the
// same placeholder env vars the `build`/`unit-tests` CI jobs already use --
// the pages under test (/, /login, /pricing, /terms, /privacy) are all
// unauthenticated and DB-free, confirmed by reading each route before
// adding it here, so the placeholder DATABASE_URL/Supabase vars never need
// to resolve a real connection. reuseExistingServer keeps this fast for
// local `bunx playwright test` runs against an already-running `bun run
// dev`.
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
