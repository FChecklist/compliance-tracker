// A person's own rights (drizzle/0752), through the real signed-in screen in mock mode: "My data" shows what is held, a request gets a reference,
// a correction without words is refused, and a nominee can be saved and removed. By accessible names only, like the other specs.
import { expect, test } from "@playwright/test"

test.describe("My data (sections 11, 12 and 14)", () => {
  test("see what is held, ask for a copy, refuse an empty correction, nominate and remove", async ({ page }) => {
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: "My data" }).click()
    const panel = page.getByRole("dialog", { name: "Your data and rights" })
    await expect(panel.getByRole("heading", { name: "What we hold" })).toBeVisible()
    await expect(panel.getByText("E-mails we sent you: 3")).toBeVisible()

    // a copy of the data: gets a reference and shows in the list
    await panel.getByLabel("A copy of my data").check()
    await panel.getByRole("button", { name: "Send request" }).click()
    await expect(panel.getByRole("status")).toContainText("Your reference is D-2026-0001")
    await expect(panel.getByRole("heading", { name: "Your requests" })).toBeVisible()

    // a correction with no words is refused with a plain reason
    await panel.getByLabel("Correct my data").check()
    await panel.getByRole("button", { name: "Send request" }).click()
    await expect(panel.getByRole("status")).toContainText("Please say what is wrong")

    // nominee: needs a name, then saved, then removed
    await panel.getByRole("button", { name: "Save nominee" }).click()
    await expect(panel.getByRole("status")).toContainText("Please give the name")
    await panel.getByLabel("Nominee name").fill("Asha Verma")
    await panel.getByLabel("Relationship (optional)").fill("sister")
    await panel.getByRole("button", { name: "Save nominee" }).click()
    await expect(panel.getByRole("status")).toContainText("Your nominee is saved")
    await expect(panel.getByText("Asha Verma (sister)")).toBeVisible()
    await panel.getByRole("button", { name: "Remove nominee" }).click()
    await expect(panel.getByText("No nominee yet.")).toBeVisible()

    await panel.getByRole("button", { name: "Close" }).click()
    await expect(panel).toBeHidden()
  })
})
