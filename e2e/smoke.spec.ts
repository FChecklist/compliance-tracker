import { test, expect } from "@playwright/test";

// audit198 gap-closure wave 2 (2026-07-21, ARTICLE-073: "Every critical
// business workflow shall include end-to-end integration testing").
//
// Honest scope: this is a real, running smoke-level E2E suite -- it
// replaces the prior zero-test `--pass-with-no-tests` state (Wave 79) with
// tests that actually boot the app (via playwright.config.ts's webServer)
// and drive a real browser against it. It covers the critical paths every
// other workflow depends on: the public entry point, the login page, and
// proxy.ts's real unauthenticated-redirect enforcement for protected app
// routes. It does NOT yet cover authenticated critical business workflows
// (compliance task completion, approval chains, etc.) -- that needs a real
// auth fixture (a seeded test user + session cookie), which is a genuine,
// flagged follow-up, not silently claimed as done here.

test("landing page loads and renders the real VERIDIAN marketing content", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle(/VERIDIAN/i);
});

test("login page renders a real login form", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("form")).toBeVisible();
});

test("an unauthenticated request to a protected app route is redirected to login by proxy.ts", async ({ page }) => {
  // /clients is a real protected route under src/app/(app)/clients,
  // listed in the auto-generated protected-routes allowlist
  // (scripts/generate-protected-routes.mjs) that proxy.ts's middleware
  // enforces.
  await page.goto("/clients");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("redirectTo")).toBe("/clients");
});
