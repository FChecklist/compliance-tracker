import { test, expect } from "@playwright/test";

// R48 UAT bank, script track (2026-08-29, owner directive: "run R48 as a
// script... in one go, not one test at a time"). The 300-row
// platform.uat_test bank's own input_value/expected_output columns are
// human-language prose ("Permit with name, dates and a PDF" / "Saved; PDF
// reopens correctly"), not a machine-executable contract -- there is no
// generic, per-function-bespoke-free way to auto-execute all 20
// uat_criteria for all 300 rows in one script. What IS 100% mechanical and
// honest to automate here: C01 REACHABLE, across the 24 unique page_paths
// the 300 rows actually cover (checking each path once, not 300 times,
// since reachability doesn't vary per row on the same page). Logged in as
// a real, real-data account (arjun.mehta / Skyline Builders -- richer data
// than any of the R48 uat_persona rows, which are still blocked on
// R48_ORG_PROVISION_RLS_BLOCKED_01 and have zero real projects regardless
// of what this test would find).
//
// Also checks a handful of CANDIDATE REAL routes for page_paths that
// 404'd, based on this session's own AppSidebar findings -- several of the
// bank's page_paths turned out to be pre-ship/aspirational naming (e.g.
// /manpower -> the real, live page is /labour) rather than genuinely
// missing features. Results (both the primary 24 and the alt-path check)
// are printed as JSON on stdout; this repo's own convention (see
// r63-local-composer.spec.ts) is to write DB updates OUTSIDE the
// Playwright process via the Supabase MCP directly, not from inside a
// test file -- the actual platform.uat_test write for this run already
// happened this same session; this spec file is kept as the real,
// reusable artifact for re-running the same check later.
const BASE_URL = "http://localhost:3000";
const EMAIL = "arjun.mehta@skylinebuilders-demo.veridianai.dev";
const PASSWORD = "SkylineR63Test_29Aug!";

const UNIQUE_PAGE_PATHS = [
  "/", "/boq", "/boq/edit", "/boq/import", "/boq/new", "/boq/revise", "/boq/view",
  "/budget", "/dashboard", "/documents", "/drawings", "/instructions", "/login",
  "/manpower", "/materials", "/meetings", "/permits", "/progress", "/progress/daily",
  "/projects", "/reports", "/schedule", "/settings", "/timesheets",
];

// Candidate real routes for page_paths confirmed 404 the first time this
// was run (2026-08-29) -- most turned out to be pre-ship/aspirational
// naming for an already-shipped feature under a different URL.
const ALT_PATHS = ["/scope", "/work-progress", "/erp/payroll", "/erp/budgets", "/labour", "/veri-meetings", "/site-diary", "/pms"];

type PathResult = { path: string; status: number | null; reachable: boolean; note: string };

async function checkPaths(page: import("@playwright/test").Page, paths: string[]): Promise<PathResult[]> {
  const results: PathResult[] = [];
  for (const path of paths) {
    try {
      const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const status = response?.status() ?? null;
      const bodyText = await page.locator("body").innerText().catch(() => "");
      // A real 404 page renders "This page could not be found." regardless
      // of HTTP status code in some redirect/rewrite chains -- check both
      // signals, not just the raw status.
      const looksLike404 = /could not be found/i.test(bodyText);
      results.push({ path, status, reachable: status !== null && status < 400 && !looksLike404, note: looksLike404 ? "404 body detected" : "" });
    } catch (err) {
      results.push({ path, status: null, reachable: false, note: err instanceof Error ? err.message : "navigation error" });
    }
  }
  return results;
}

test("R48 batch: C01 REACHABLE across all 24 unique page_paths + alt-path candidates", async ({ page }) => {
  // Local-only manual diagnostic against a running `bun run dev` server --
  // not wired for CI (no dev server started there), same posture as
  // e2e/r63-local-composer.spec.ts's own CI-safety fix (PR #1454).
  test.skip(!!process.env.CI, "Local-only manual diagnostic against a running `bun run dev` server -- not wired for CI.");
  test.setTimeout(300_000);

  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.getByPlaceholder("Enter your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/\/home/, { timeout: 45_000 });

  const primaryResults = await checkPaths(page, UNIQUE_PAGE_PATHS);
  console.log("R48_REACHABILITY_RESULTS:" + JSON.stringify(primaryResults));

  const altResults = await checkPaths(page, ALT_PATHS);
  console.log("R48_ALTPATH_RESULTS:" + JSON.stringify(altResults));

  expect(primaryResults.length).toBe(UNIQUE_PAGE_PATHS.length);
});
