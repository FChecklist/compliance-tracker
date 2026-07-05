import { defineConfig } from "playwright/test";

// Wave 79: `playwright` (not `@playwright/test`) is what's actually
// resolvable here -- a transitive dependency via promptfoo, per bun.lock --
// so this imports its `playwright/test` subpath rather than the separate
// `@playwright/test` package, which isn't installed. No config file
// existed before this, so Playwright's default testMatch
// (`**/*.@(spec|test).?(c|m)[jt]s`) scanned the whole repo and collided
// with the new src/lib/*.test.ts bun:test unit tests, breaking the E2E CI
// job (previously green only because zero E2E tests existed at all).
// testDir scopes discovery to a dedicated e2e/ directory -- currently
// empty, so `--pass-with-no-tests` still applies honestly (disclosed as an
// open gap in AI_OS_CERTIFICATION.md 3.8), but no longer picks up unit tests.
export default defineConfig({
  testDir: "./e2e",
});
