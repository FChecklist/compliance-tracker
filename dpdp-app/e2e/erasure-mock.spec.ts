// MOCK ONLY (not live proof): F-071 "Erasure request" through the signed-in "My data" screen in mock mode. Live proof is pending the sign-in e-mail hook.
// An erasure request gets a reference and shows in "Your requests"; by accessible names only, like my-data.spec.ts.
import { expect, test } from "@playwright/test"

test.describe("Erasure request (mock)", () => {
  test("ask to erase my data: a reference is given and the request is listed", async ({ page }) => {
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: "My data" }).click()
    const panel = page.getByRole("dialog", { name: "Your data and rights" })
    await panel.getByLabel("Erase my data").check()
    await panel.getByRole("button", { name: "Send request" }).click()
    await expect(panel.getByRole("status")).toContainText("Your reference is")
    await expect(panel.getByRole("heading", { name: "Your requests" })).toBeVisible()
    await expect(panel.getByText("Erase my data").last()).toBeVisible()
  })
})
