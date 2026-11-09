// MOCK ONLY (not live proof): the weekly routine at the top of the signed-in page -- three stages with numbered steps, a latest-log line each,
// the weekly rhythm (last run / next run / missed), and the person's own "This week is checked" sign-off. By accessible names only.
import { expect, test } from "@playwright/test"

test.describe("Weekly routine (mock)", () => {
  test("three stages, numbered steps, latest log, rhythm, and the sign-off", async ({ page }) => {
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    const welcome = page.getByRole("button", { name: "Got it — show me my controls", exact: true })
    if (await welcome.isVisible().catch(() => false)) await welcome.click()

    const routine = page.getByRole("region", { name: "Your weekly routine" })
    await expect(routine).toBeVisible()
    for (const [n, name] of [[1, "Discover"], [2, "Act"], [3, "Confirm"]] as const) {
      await expect(routine.getByRole("heading", { name: `Stage ${n} · ${name}` })).toBeVisible()
    }
    await expect(routine.getByText("Step 1.")).toHaveCount(3)
    await expect(routine.getByText("Step 3.")).toHaveCount(3)
    for (const name of ["Discover", "Act", "Confirm"]) await expect(routine.getByRole("group", { name: `Latest log, ${name}` })).toContainText("Latest log:")

    const rhythm = routine.getByRole("group", { name: "Weekly rhythm" })
    await expect(rhythm).toContainText("Last run:")
    await expect(rhythm).toContainText("Next run:")
    await expect(rhythm).toContainText("Missed weeks")
    await expect(routine.getByRole("list", { name: "The last four weeks" }).getByRole("listitem")).toHaveCount(4)
    await expect(routine.getByText(/This week: \d+ done · \d+ still open · \d+ late/)).toBeVisible()

    await routine.getByRole("button", { name: "This week is checked" }).click()
    await expect(routine.getByRole("status").filter({ hasText: "This week is checked (" })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("region", { name: "Your weekly routine" }).getByText(/This week is checked \(/)).toBeVisible({ timeout: 10_000 })
  })
})
