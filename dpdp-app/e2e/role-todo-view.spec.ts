import { expect, test, type Page } from "@playwright/test"

// Owner feedback on the local demo: every role opens on "What you have to do"
// (only that person's jobs, one big button each), editing is obvious, and a
// professional sees a guided "how to create DPDP compliance for a client"
// plus a dashboard across all their clients. Mock mode, no network.

// The other specs drive the full table, so playwright.config.ts presets the remembered view to "full";
// these tests clear it to prove what a person who has never chosen sees.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.removeItem("dpdp.view") } catch { /* ignore */ } })
})

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

test.describe("What you have to do", () => {
  test("the owner opens on their own jobs, not the full table", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByRole("heading", { name: "What you have to do", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "✓ Mark done" }).first()).toBeVisible()
    await expect(page.getByRole("button", { name: "✎ Add a note" }).first()).toBeVisible()
    await expect(page.getByRole("table")).toHaveCount(0)
  })

  test("marking a job done moves it off the list and the count follows", async ({ page }) => {
    await seed(page, "owner-live")
    const count = page.getByText(/\d+ to do · \d+ finished/)
    const before = Number(((await count.innerText()).match(/^(\d+)/) ?? [])[1])
    expect(before).toBeGreaterThan(0)
    await page.getByRole("button", { name: "✓ Mark done" }).first().click()
    await expect(count).toHaveText(new RegExp(`^${before - 1} to do`))
  })

  test("Edit opens the note / give / date form, and the full list is one tap away with its More column still reachable", async ({ page }) => {
    await seed(page, "owner-live")
    await page.getByRole("button", { name: "Edit this job" }).first().click()
    await expect(page.getByRole("tablist").first()).toBeVisible()
    await page.getByRole("button", { name: "See the full list of every job →" }).click()
    await expect(page.getByRole("table")).toBeVisible()
    await expect(page.getByRole("button", { name: /^More actions for / }).first()).toBeVisible()
    await expect(page.getByText("Not done yet", { exact: true }).first()).toBeVisible()
  })
})

test.describe("Professional view", () => {
  test("a CA partner sees the five-step guide and a dashboard across all clients", async ({ page }) => {
    await seed(page, "partner")
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
    await page.getByRole("button", { name: "Got it — show me my controls", exact: true }).click()
    await page.getByRole("button", { name: /My clients \(\d+\)/ }).click()
    await expect(page.getByRole("heading", { name: "How to create DPDP compliance for a client" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "All your clients at a glance" })).toBeVisible()
    await expect(page.getByText(/On track|Needs a push|Needs attention/).first()).toBeVisible()
  })
})
