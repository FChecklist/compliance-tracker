import { test, expect, type Locator, type Page } from "@playwright/test"

// The four job controls on the person's own page (owner, 2026-09-30): add a
// note, give the job to someone, change the date, say "doesn't apply". Same
// rules as agent-by-role.spec.ts / acceptance-70.spec.ts: the BUILT site
// (dist/ via `vite preview`, playwright.config.ts) in mock mode (VITE_MOCK=1),
// every locator is getByRole / getByLabel / getByText by accessible name -- no
// CSS selector, test id or XPath. `?mock=<scenario>` seeds a fresh world and
// signs that persona in (src/lib/mock-client.ts); the mock mirrors
// drizzle/0605 + 0666, and src/lib/services/dpdp-browser-rpc-page-controls.
// test.ts pins those same rules against the real database.
//
// What is proved here that the unit tests cannot: the controls are reachable
// by a keyboard/agent (a "More" button, then tabs), a refusal appears inline
// where the person is looking, and what was done is in History afterwards.

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
  const welcome = page.getByRole("button", { name: "Got it — show me my jobs", exact: true })
  if (await welcome.isVisible().catch(() => false)) await welcome.click()
}

const MORE = { name: "More ▾", exact: true } as const

// The sentence a row shows after a control succeeded (a staff member has no History on their page, so this is their only confirmation).
const saidOnRow = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text })

// The first row whose panel offers exactly these tabs, opened. Rows are tried
// in page order and closed again when they do not fit, so the test names the
// kind of job it needs rather than a fixture row number.
async function openRowOffering(page: Page, tabs: string[]): Promise<Locator> {
  const buttons = page.getByRole("button", { name: /^(More ▾|Close)$/ })
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i)
    if ((await button.innerText()).startsWith("More")) await button.click()
    const offered = await page.getByRole("tab").allInnerTexts()
    if (offered.length === tabs.length && tabs.every((t) => offered.includes(t))) return button
    await button.click()
  }
  throw new Error(`no row offers exactly: ${tabs.join(" | ")}`)
}

test.describe("job controls on the person's own page -- by accessible names", () => {
  test("owner: a note is written, the panel closes, and History shows the words", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByRole("button", MORE).first()).toBeVisible()
    await page.getByRole("button", MORE).first().click()
    await expect(page.getByRole("tab", { name: "Add a note", exact: true })).toBeVisible()

    // An empty note is refused on the page itself, in words.
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("Write a few words first.")

    const note = "The signed copy is with the CA; we chase again on Friday."
    await page.getByLabel("Your note", { exact: true }).fill(note)
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    await expect(page.getByLabel("Your note", { exact: true })).toHaveCount(0)
    await expect(saidOnRow(page, "Note saved.")).toBeVisible()
    await expect(page.getByText(/Added a note to/).first()).toBeVisible()
    await expect(page.getByText(note)).toBeVisible()
  })

  test("owner: a date outside India's sensible window is refused inline; a real one is kept and recorded", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowOffering(page, ["Add a note", "Give to someone", "Change the date", "Doesn't apply"])
    await page.getByRole("tab", { name: "Change the date", exact: true }).click()

    await page.getByLabel("New due date", { exact: true }).fill("2035-01-01")
    await page.getByRole("button", { name: "Change the date", exact: true }).last().click()
    await expect(page.getByRole("alert")).toContainText("Pick a date from")

    const soon = new Date(Date.now() + 40 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10)
    await page.getByLabel("New due date", { exact: true }).fill(soon)
    await page.getByRole("button", { name: "Change the date", exact: true }).last().click()
    await expect(page.getByLabel("New due date", { exact: true })).toHaveCount(0)
    await expect(saidOnRow(page, /^✓ Date changed to \d{2} \w{3} \d{4}\.$/)).toBeVisible()
    await expect(page.getByText(new RegExp(`due on ${soon}`)).first()).toBeVisible()
  })

  test("owner: 'doesn't apply' needs a reason and a tick, then the job is marked and the reason is in History", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowOffering(page, ["Add a note", "Give to someone", "Change the date", "Doesn't apply"])
    await page.getByRole("tab", { name: "Doesn't apply", exact: true }).click()

    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expect(page.getByRole("alert")).toBeVisible()

    const reason = "We have no cameras anywhere."
    await page.getByLabel(/Why doesn.t this apply/).fill(reason)
    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("Tick the box to confirm")

    await page.getByRole("checkbox", { name: /This job really doesn.t apply/ }).check()
    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expect(page.getByLabel(/Why doesn.t this apply/)).toHaveCount(0)
    await expect(saidOnRow(page, "Marked as not applicable.")).toBeVisible()
    await expect(page.getByText(/Marked ".*" as not applicable/).first()).toBeVisible()
    await expect(page.getByText(reason)).toBeVisible()
  })

  test("owner: giving a job to someone shows the new person on the row; a bad address is refused first", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowOffering(page, ["Add a note", "Give to someone", "Change the date", "Doesn't apply"])
    await page.getByRole("tab", { name: "Give to someone", exact: true }).click()

    await page.getByLabel("Their email address", { exact: true }).fill("not-an-address")
    await page.getByRole("button", { name: "Give this job", exact: true }).click()
    await expect(page.getByRole("alert")).toBeVisible()

    await page.getByLabel("Their email address", { exact: true }).fill("Priya.New@Company.example")
    await page.getByRole("button", { name: "Give this job", exact: true }).click()
    await expect(saidOnRow(page, "Job given to priya.new@company.example.")).toBeVisible()
    await expect(page.getByText("priya.new@company.example").first()).toBeVisible()
  })

  test("owner: a finished job takes a note and nothing else", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowOffering(page, ["Add a note"])
    await expect(page.getByRole("tab")).toHaveCount(1)
    await expect(page.getByRole("tab", { name: "Give to someone", exact: true })).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "Change the date", exact: true })).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "Doesn't apply", exact: true })).toHaveCount(0)
  })

  test("staff: only a note, and 'doesn't apply' on their own jobs -- never a date or a hand-over", async ({ page }) => {
    await seed(page, "staff")
    const buttons = page.getByRole("button", { name: /^(More ▾|Close)$/ })
    await expect(buttons.first()).toBeVisible()
    const rows = await buttons.count()
    expect(rows).toBeGreaterThan(0)
    for (let i = 0; i < rows; i++) {
      await buttons.nth(i).click()
      expect(await page.getByRole("tab").allInnerTexts(), `row ${i + 1}`).toEqual(["Add a note", "Doesn't apply"])
      await buttons.nth(i).click()
      await expect(page.getByRole("tab")).toHaveCount(0)
    }
  })

  test("staff: a note on their own job is confirmed on the row (they have no History to read it in)", async ({ page }) => {
    await seed(page, "staff")
    await page.getByRole("button", MORE).first().click()
    await page.getByLabel("Your note", { exact: true }).fill("Waiting on HR for the list.")
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    await expect(page.getByLabel("Your note", { exact: true })).toHaveCount(0)
    await expect(saidOnRow(page, "Note saved.")).toBeVisible()
    await expect(page.getByRole("heading", { name: /History/ })).toHaveCount(0)
  })

  test("the Grievance Officer and the coordinator can note any job, but on no job can they give it away or move its date", async ({ page }) => {
    for (const scenario of ["go", "coord"]) {
      await seed(page, scenario)
      const buttons = page.getByRole("button", { name: /^(More ▾|Close)$/ })
      await expect(buttons.first()).toBeVisible()
      const rows = await buttons.count()
      expect(rows, scenario).toBeGreaterThan(10)
      for (let i = 0; i < rows; i++) {
        await buttons.nth(i).click()
        const offered = await page.getByRole("tab").allInnerTexts()
        expect(offered, `${scenario} row ${i + 1}`).toContain("Add a note")
        expect(offered, `${scenario} row ${i + 1}`).not.toContain("Give to someone")
        expect(offered, `${scenario} row ${i + 1}`).not.toContain("Change the date")
        await buttons.nth(i).click()
      }
    }
  })
})
