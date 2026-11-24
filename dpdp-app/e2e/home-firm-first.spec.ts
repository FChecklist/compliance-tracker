import { test, expect } from "@playwright/test"
import { ORG_DIRECT_ENABLED } from "../src/lib/org-direct.mjs"

// The firm-first home page (owner order, 24 Nov 2026), mock mode, by accessible names only.
// Needs the built site: VITE_MOCK=1 bun run build && bunx playwright test e2e/home-firm-first.spec.ts

test.describe("home page: firm first", () => {
  test("the central message, Discover / Decide / Do, and one Become a Partner button", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "DPDP is coming. Penalties are high.", exact: true })).toBeVisible()
    await expect(page.getByText("It is not an IT job. It is the job of the CA, CS or auditor to remind the client.")).toBeVisible()
    for (const w of ["Discover", "Decide", "Do"]) await expect(page.getByRole("listitem").filter({ hasText: w }).first()).toBeVisible()
    await expect(page.getByText("It is not a one-time job. It is weekly work.")).toBeVisible()
    const become = page.getByRole("link", { name: "Become a Partner", exact: true }).first()
    await expect(become).toHaveAttribute("href", "/partner/")
    await expect(page.getByRole("link", { name: "Terms of Service", exact: true }).first()).toHaveAttribute("href", "/terms/")
    await expect(page.getByRole("checkbox")).toHaveCount(0)
  })

  test("the organisation door is hidden: no link on the home page, and its landing address goes to the Partner door", async ({ page }) => {
    test.skip(ORG_DIRECT_ENABLED, "organisation-direct is switched on")
    await page.goto("/")
    await expect(page.locator('a[href="/dpdp-institution/"]')).toHaveCount(0)
    await page.goto("/dpdp-institution/")
    await expect(page).toHaveURL(/\/partner\/$/)
  })
})
