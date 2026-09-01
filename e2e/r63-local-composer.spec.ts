import { test, expect } from "@playwright/test";

// R63 local testing (2026-08-29): real Playwright automation against the
// local dev server (http://localhost:3000), using the actual login form
// (not mint-session -- this specifically tests the real, full user path,
// including the auth_user_id fix applied earlier this session). Diagnoses
// whether the composer's chain-selector "Dispatch" action actually creates
// a task, using Playwright's own network-request capture rather than
// polling /api/tasks blindly.

const BASE_URL = "http://localhost:3000";
const DEMO_EMAIL = "democeo@projexa-ai.com";
const DEMO_PASSWORD = "TestR63Verify_29Aug!";

test("R63: login -> select PROJEXA chain -> dispatch -> real task created", async ({ page }) => {
  // CI-safety fix (found the hard way -- this failed PR #1454's E2E Tests
  // job with ERR_CONNECTION_REFUSED at http://localhost:3000/login): this
  // spec is a manual local-dev diagnostic against a real running `bun run
  // dev` server on THIS laptop, not a CI-safe test -- no dev server is
  // started in the CI runner (see ci.yml's e2e job: no `webServer` in
  // playwright.config.ts, no local build/serve step), and demo-gate-
  // smoke.spec.ts already establishes the repo's convention for what a
  // real CI-safe E2E test targets (production, not localhost). GitHub
  // Actions sets CI=true on every run; skip there rather than failing on
  // an environment this test was never meant to run against.
  test.skip(!!process.env.CI, "Local-only manual diagnostic against a running `bun run dev` server -- not wired for CI (no dev server started there).");

  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder("you@company.com").fill(DEMO_EMAIL);
  await page.getByPlaceholder("Enter your password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  // Local dev only: Turbopack compiles /home on-demand on first hit, which
  // can genuinely take 20-30s+ (not an issue in production's pre-built
  // routes) -- a generous timeout here, not a real slowness bug.
  await page.waitForURL(/\/home/, { timeout: 45000 });

  // Confirm the auth fix: /api/me must be 200, not 500.
  const meRes = await page.request.get(`${BASE_URL}/api/me`);
  expect(meRes.ok(), "/api/me must return 200 after the auth_user_id fix").toBeTruthy();
  const me = await meRes.json();
  expect(me.veriChatV2Enabled, "veriChatV2Enabled must be true").toBe(true);

  // Select the PROJEXA > project_management chain.
  await page.getByRole("button", { name: "PROJEXA" }).first().click();
  await page.getByText("project_management", { exact: true }).click();

  // Log EVERY POST request during this window -- don't pre-guess the endpoint.
  const posts: string[] = [];
  page.on("requestfinished", async (req) => {
    if (req.method() === "POST") {
      const res = await req.response();
      posts.push(`${req.url()} -> ${res?.status()}`);
    }
  });

  await page.getByText("Construction Project Dashboard", { exact: true }).click();
  await page.waitForTimeout(500);

  const dispatchButton = page.getByRole("button", { name: /dispatch/i }).first();
  const dispatchCount = await dispatchButton.count();
  console.log("DISPATCH_BUTTON_FOUND:", dispatchCount);
  if (dispatchCount > 0) {
    await dispatchButton.click();
  } else {
    const startButton = page.getByRole("button", { name: /start (with this chain|thread)/i }).first();
    const startCount = await startButton.count();
    console.log("START_BUTTON_FOUND:", startCount);
    if (startCount > 0) await startButton.click();
  }

  await page.waitForTimeout(3000);
  console.log("ALL_POST_REQUESTS:", JSON.stringify(posts));

  const tasksRes = await page.request.get(`${BASE_URL}/api/tasks?limit=1`);
  const tasks = await tasksRes.json();
  console.log("LATEST_TASK:", JSON.stringify(tasks.tasks?.[0] ?? tasks));
});
