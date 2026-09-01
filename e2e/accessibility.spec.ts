// Accessibility (WCAG Compliance) gap-closure -- Review Framework Critical
// finding "Accessibility regression testing included in CI: Zero automated
// accessibility testing in CI". Recommended approach was to reuse the
// existing Playwright infrastructure (playwright.config.ts) with
// @axe-core/playwright rather than a new framework -- that's what this file
// does.
//
// Scope: unauthenticated, DB-free pages only. This repo's real app surface
// (src/app/(app)/**) sits behind Supabase Auth SSR + middleware
// (src/proxy.ts, PROTECTED_APP_ROUTE_PREFIXES) and most of it queries the
// DB on render, so exercising it in CI would require seeding a real
// Supabase project and a login flow -- out of scope for this finding (CI
// has no DATABASE_URL/Supabase credentials wired for the e2e job, only
// placeholders, same as the `build` job). The pages below were each read
// before being added here and confirmed to render with zero DB/auth
// dependency, so this is real, currently-reachable coverage rather than a
// vacuous pass -- not the full app surface, but a genuine CI-enforced floor
// that will catch a real regression on every page it covers, and the
// pattern (AxeBuilder against a rendered Playwright page) is what any
// future page's a11y test would also use.
//
// WCAG tags scoped to wcag2a/wcag2aa/wcag21aa (the same "WCAG 2.1 AA"
// baseline named in the finding), not the axe-core "best-practice" rule
// set, so failures here are real WCAG conformance issues, not opinionated
// extras.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

const PAGES: Array<{ name: string; path: string }> = [
  { name: "marketing home", path: "/" },
  { name: "login", path: "/login" },
  { name: "pricing", path: "/pricing" },
  { name: "terms", path: "/terms" },
  { name: "privacy", path: "/privacy" },
];

for (const { name, path } of PAGES) {
  test(`${name} (${path}) has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();

    // Attach the full JSON report so a failing CI run's artifact has the
    // node-level detail (selector, failure summary, help URL) without
    // needing to reproduce locally first.
    await test.info().attach("axe-results", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });

    const summary = results.violations.map(
      (v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -- ${v.helpUrl}`,
    );

    expect(summary, summary.join("\n")).toEqual([]);
  });
}
