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
// audit198 gap-closure wave 2 (2026-07-21, ARTICLE-073: "Every critical
// business workflow shall include end-to-end integration testing"): the
// Wave 79 "zero E2E tests exist yet" honest gap is now partially closed --
// e2e/smoke.spec.ts has real tests, which means Playwright needs a real
// running app to test against. webServer below reuses the exact same
// `bun run dev` script (and its predev hook, scripts/generate-protected-
// routes.mjs) CI/local dev already use, on the default port 3000, with
// the same placeholder DB/Supabase env vars the `build` job in ci.yml
// already uses successfully -- these tests never issue a real DB query,
// same honest note as the Unit Tests job's own comment on this pattern.
export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://postgres:placeholder@localhost:5432/postgres",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
