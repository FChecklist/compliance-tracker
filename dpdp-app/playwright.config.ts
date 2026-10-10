import { defineConfig, devices } from "@playwright/test"

// WO-DPDP-012 §6 ("AI-agent optimised"): the browser that drives the public
// site by accessible names only (e2e/agent-by-role.spec.ts). This config is
// dpdp-app's own -- the repo root's playwright.config.ts boots the Next.js
// app on :3000 and knows nothing about this static site; the two never share
// a server, a port or a spec directory.
//
// The site under test is the BUILT output (dist/), served by `vite preview`,
// exactly what Cloudflare Pages serves -- not the dev server, whose SPA
// fallback and module graph differ. So a build must exist first:
//   VITE_MOCK=1 bun run build && bunx playwright test
// VITE_MOCK=1 (src/lib/client.ts) swaps Supabase for src/lib/mock-client.ts,
// so no credentials are needed anywhere: the sign-in form "sends" a link to
// nowhere and the spec stops there, which is the point (§6: "the email click
// stays with the human").
//
// CI (.github/workflows/dpdp-app-ci.yml, job dpdp-app-e2e) is the proof
// surface. Locally this needs a Chromium and >2 GB free RAM -- see
// e2e/README.md before running it on a small machine.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A stray test.only would silently shrink the proof to one test.
  forbidOnly: !!process.env.CI,
  // No retries: a flaky pass here would be a claim about the site that the
  // instrument was never shown able to make reliably.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Only on failure: a trace of the sign-in screen holds the typed address
    // (a fake @example.test one here, but the habit matters). The output
    // directories are git-ignored (dpdp-app/.gitignore).
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Chromium only, deliberately: the spec proves the accessibility tree of
  // the site, which is the same tree in every engine; three browsers would
  // triple the CI time for no extra claim.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // --host 127.0.0.1 pins the bind address to the one baseURL uses: Vite's
    // default host is "localhost", which Node may resolve to ::1 first on a
    // CI runner, and Playwright's readiness probe of an IPv4 URL would then
    // wait out the full timeout against a server that is up on IPv6.
    // --strictPort so a busy port fails loudly instead of the site quietly
    // coming up on 4174 while baseURL still says 4173.
    command: "bun run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/",
    // In CI the job's own build step is the only build that exists, and the
    // server must be this config's own -- a pre-existing one on the port
    // would be a different site than the one just built.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
