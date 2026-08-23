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
// Wave 79 note was already stale by the time this file was last touched
// (e2e/browser-execution-tiers.spec.ts existed) and R38 adds a second real
// test (e2e/demo-gate-smoke.spec.ts, R-B1) -- --pass-with-no-tests was
// removed from the CI workflow accordingly (E-38).
export default defineConfig({
  testDir: "./e2e",
});
