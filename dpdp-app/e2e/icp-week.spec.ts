import { expect, test, type Page } from "@playwright/test"

// The weekly ICP routine on the signed-in page: Identify (the register), Classify (the facts and the derived flags), Prove (the sign-off).
// Mock mode, no network (src/lib/icp-mock.ts follows the same rules as drizzle/0761). Driven by accessible names only.
// NOT run on the author's small laptop (a build and a Chromium need > 2 GB free); CI's dpdp-app-e2e job is the proof surface.

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

test.describe("This week: Identify, Classify, Prove", () => {
  test("the owner sees three stages, a step count and the plain 'not a legal rating' line", async ({ page }) => {
    await seed(page, "owner")
    await expect(page.getByRole("heading", { name: "This week: Identify, Classify, Prove" })).toBeVisible()
    for (const n of ["1. Identify", "2. Classify", "3. Prove"]) await expect(page.getByRole("heading", { name: new RegExp(`^${n}`) })).toBeVisible()
    await expect(page.getByTestId("icp-score")).toContainText("It is not a rating of your legal position")
  })

  test("start from the library, classify a children's data set, and the rules show what needs a look", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "Start from the library" }).click()
    await expect(page.getByRole("status")).toContainText("added from the library")
    const reg = page.getByTestId("icp-register")
    await expect(reg.getByRole("list", { name: /Things to look at for/ }).first()).toContainText("Not classified yet")

    await page.getByLabel("What kind of line").selectOption("person_group")
    await page.getByLabel("Name of the line").fill("Enrolled students")
    await page.getByRole("button", { name: "Add to register" }).click()
    const line = reg.locator('[data-item="Enrolled students"]')
    await line.getByRole("button", { name: "Classify or change" }).click()
    const form = line.getByRole("group", { name: "Classify Enrolled students" })
    await form.getByLabel("Whose data is it?").selectOption("student")
    await form.getByLabel(/Is it children/).selectOption("yes")
    await form.getByLabel("Why do you hold it?").fill("Admission and teaching")
    await form.getByLabel("On what basis?").selectOption("not_sure")
    await form.getByLabel("How long do you keep it?").selectOption("3650")
    await form.getByRole("button", { name: "Save" }).click()
    await expect(line.getByRole("list", { name: /Things to look at for/ })).toContainText("Children's data with no lawful basis recorded")
  })

  test("the register refuses a person's e-mail or phone number as a name", async ({ page }) => {
    await seed(page, "owner")
    await page.getByLabel("Name of the line").fill("asha@example.com")
    await expect(page.getByRole("alert").filter({ hasText: "looks like a person" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Add to register" })).toBeDisabled()
  })

  test("'Nothing new this week' and 'Sign off Prove' are recorded and tick their steps", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "Nothing new this week" }).click()
    await expect(page.locator('[data-step="anything_new"]')).toHaveAttribute("data-done", "true")
    await page.getByRole("button", { name: "Sign off Prove" }).click()
    await expect(page.locator('[data-step="week_signed_off"]')).toHaveAttribute("data-done", "true")
  })

  test("a staff member does not get the routine at all", async ({ page }) => {
    await seed(page, "staff")
    await expect(page.getByRole("heading", { name: "This week: Identify, Classify, Prove" })).toHaveCount(0)
  })
})
