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
    // SCAN A SETTLED PAGE, not a frame of an entrance animation.
    //
    // /pricing wraps its hero in framer-motion `fadeUp` variants. axe reported
    // one serious color-contrast node at [".px-3"] -- foreground #fbf5ed on
    // #fffdf9, 1.06:1 -- and #fbf5ed exists nowhere: not in globals.css, not in
    // the built CSS, not in the ui-kit. It is a BLEND, the badge's real colour
    // (#b45309, and `.text-ct-saffron-text{color:#b45309}` is present in the
    // production stylesheet) composited over the background at the opacity it
    // happened to have when the scan ran. Measured on a settled page the same
    // element computes rgb(180,83,9) and passes.
    //
    // So the failure was real arithmetic about a state no user sees for more
    // than a few hundred milliseconds, and it cost three CI round trips and two
    // wrong guesses at which element was at fault. reducedMotion is the
    // deterministic fix rather than a sleep: framer-motion honours
    // prefers-reduced-motion natively, so the entrance animations resolve to
    // their final state immediately instead of the test racing them.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
    // reducedMotion + networkidle was not enough on its own: the spec passed
    // alone and failed when run beside the other four, which is the signature
    // of a race rather than a fix. So wait for the CONDITION instead of for a
    // proxy of it -- no element mid-fade. A partly-faded element is exactly
    // what produces a blended foreground colour, and it is the only thing this
    // wait is about, so it can be asserted directly and cheaply.
    await page
      .waitForFunction(
        () =>
          ![...document.querySelectorAll<HTMLElement>("body *")].some((el) => {
            const o = Number.parseFloat(getComputedStyle(el).opacity);
            return o > 0 && o < 0.99;
          }),
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {
        // Not fatal: a page that legitimately holds a translucent element for
        // ever must still be scanned, and axe reporting a real low-contrast
        // node there would be a real finding.
        console.warn(`[a11y] ${path}: elements still mid-opacity after 15s -- scanning anyway`);
      });

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

    // The node TARGET, not just the count. Twice now a /pricing
    // color-contrast failure has cost a full CI round trip per guess, because
    // the count is identical whichever element is at fault and the attachment
    // above only reaches an artifact upload this workflow does not do. A
    // failure that names the selector is one a reader can act on from the log
    // alone; `.slice(0, 3)` keeps a 40-node failure from burying the summary.
    const summary = results.violations.map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) -- ${v.helpUrl}` +
        v.nodes
          .slice(0, 3)
          .map(
            (n) =>
              `
      at ${JSON.stringify(n.target)}` +
              (n.failureSummary ? ` -- ${n.failureSummary.replace(/\s+/g, " ")}` : ""),
          )
          .join(""),
    );

    expect(summary, summary.join("\n")).toEqual([]);
  });
}
