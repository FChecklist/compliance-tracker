// Playwright config of the live work-link BROWSER specs (scripts/verify/awl-live/*.live.playwright.ts). Not part of CI: these call the deployed
// Edge Function and the deployed inbox page with a throwaway link. Run from the repository root:
//   bunx playwright test -c scripts/verify/awl-live/playwright.config.ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.live\.playwright\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300_000,
  reporter: [["line"]],
  use: { headless: true, actionTimeout: 60_000, navigationTimeout: 60_000 },
})
