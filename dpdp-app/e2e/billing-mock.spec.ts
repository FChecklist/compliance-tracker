// MOCK ONLY (not live proof): O-043 -- the Billing panel offers the monthly plan at its published price (the trial pack is not offered in the mock state, so F-086/F-090 are NOT covered).
// No payment is made (the pay button only opens the gateway; nothing is charged in mock mode). Live proof pending the sign-in e-mail hook.
import { expect, test } from "@playwright/test"

test.describe("Billing panel prices (mock)", () => {
  test("the monthly plan shows its price before any payment", async ({ page }) => {
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: /💳/ }).click()
    const panel = page.getByRole("dialog", { name: "Billing" })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole("radiogroup", { name: "Plan" })).toBeVisible()
    await expect(panel.getByText(/Monthly -- Rs\s?999/)).toBeVisible()
  })
})
