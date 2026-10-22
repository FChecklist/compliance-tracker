import { test, expect, type Page } from "@playwright/test"

// Guided errors, in a real browser, as each role (owner, 2026-10-22): a polite title, a plain
// explanation, numbered steps, a button that takes the person to the exact box, and a way back.
// Same rules as the other specs here: the BUILT site in mock mode (VITE_MOCK=1), every locator by
// accessible name, fake @example.test people only. The catalog is src/lib/guide/catalog.ts.

const TECH = /\b(json|payload|rpc|sql|http|api|undefined|null|exception|postgres|supabase|jwt|stack)\b/i

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
  const welcome = page.getByRole("button", { name: "Got it — show me my jobs", exact: true })
  if (await welcome.isVisible().catch(() => false)) await welcome.click()
}

/** The guide card on screen: a title, a sentence, numbered steps, no technical word. */
async function expectGuide(page: Page, title: string) {
  const card = page.getByRole("alert")
  await expect(card).toContainText(title)
  await expect(card.locator("ol li").first()).toBeVisible()
  expect(await card.innerText()).not.toMatch(TECH)
  return card
}

/** Pressing "Take me there" lands the cursor in the exact box, outlined; the way back returns to the message. */
async function takeMeThere(page: Page, box: ReturnType<Page["getByLabel"]>) {
  await page.getByRole("button", { name: /^Take me there/ }).click()
  await expect(box).toBeFocused()
  await expect(box).toHaveClass(/dpdp-guide-flag/)
  await page.getByRole("button", { name: "Done? Back to what you were doing" }).click()
  await expect(page.getByRole("alert")).toBeFocused()
}

const MORE_OR_CLOSE = { name: /^(More|Close) actions for / } as const

/** Opens the first job whose panel offers all four controls (the owner's own finished jobs offer only a note). */
async function openRowWithAllFour(page: Page) {
  const buttons = page.getByRole("button", MORE_OR_CLOSE)
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i)
    if ((await b.innerText()).startsWith("More")) await b.click()
    const tabs = await page.getByRole("tab").allInnerTexts()
    if (tabs.length === 4) return
    await b.click()
  }
  throw new Error("no job offers all four controls")
}

test.describe("guided errors -- every role, real browser", () => {
  test("public visitor: an empty or mistyped e-mail on the sign-in page", async ({ page }) => {
    await page.goto("/app/")
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
    await expectGuide(page, "Please type an e-mail address")
    await takeMeThere(page, page.getByLabel("Your email", { exact: true }))

    await page.getByLabel("Your email", { exact: true }).fill("not-an-address")
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
    await expectGuide(page, "Please check the e-mail address")
    await page.getByLabel("Your email", { exact: true }).fill("fake.person@example.test")
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveCount(0)
  })

  test("public visitor: a short passcode points at the passcode box", async ({ page }) => {
    await page.clock.install()
    await page.goto("/app/")
    await page.getByLabel("Your email", { exact: true }).fill("fake.person@example.test")
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
    await page.getByLabel("Passcode", { exact: true }).fill("12")
    await page.keyboard.press("Enter")
    await expectGuide(page, "That code did not work")
    await takeMeThere(page, page.getByLabel("Passcode", { exact: true }))
  })

  test("owner: an empty note, a date out of range, a reason missing -- each points at its own box", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowWithAllFour(page)
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    await expectGuide(page, "Please check your note")
    await takeMeThere(page, page.getByLabel("Your note", { exact: true }))

    await page.getByRole("tab", { name: "Change the date", exact: true }).click()
    await page.getByLabel("New due date", { exact: true }).fill("2035-01-01")
    await page.getByRole("button", { name: "Change the date", exact: true }).last().click()
    await expectGuide(page, "Please choose a date that is allowed")
    await takeMeThere(page, page.getByLabel("New due date", { exact: true }))
    // the fix works: a real date goes through
    const soon = new Date(Date.now() + 40 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10)
    await page.getByLabel("New due date", { exact: true }).fill(soon)
    await page.getByRole("button", { name: "Change the date", exact: true }).last().click()
    await expect(page.getByText(/^✓ Date changed to/)).toBeVisible()
  })

  test("owner: 'doesn't apply' without a reason, then without the tick", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowWithAllFour(page)
    await page.getByRole("tab", { name: "Doesn't apply", exact: true }).click()
    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expectGuide(page, "One box needs ticking first")
    await takeMeThere(page, page.getByRole("checkbox", { name: /This job really doesn.t apply/ }))
    await page.getByRole("checkbox", { name: /This job really doesn.t apply/ }).check()
    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expectGuide(page, "Please say why this does not apply")
    await takeMeThere(page, page.getByLabel(/Why doesn.t this apply/))
    await page.getByLabel(/Why doesn.t this apply/).fill("We have no cameras anywhere.")
    await page.getByRole("button", { name: "It doesn't apply", exact: true }).click()
    await expect(page.getByText("Marked as not applicable.")).toBeVisible()
  })

  test("owner: a dropped connection is a pop-up that says nothing is lost, and Try again works", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowWithAllFour(page)
    await page.getByLabel("Your note", { exact: true }).fill("Checked with the vendor on Monday.")
    await page.evaluate(() => { (window as unknown as { __dpdpMockFail?: string }).__dpdpMockFail = "Failed to fetch" })
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    const dlg = page.getByRole("alertdialog")
    await expect(dlg).toContainText("We could not reach the service")
    await expect(dlg).toContainText("Nothing you typed is lost")
    expect(await dlg.innerText()).not.toMatch(TECH)
    // the connection comes back; Try again presses the same button
    await page.evaluate(() => { (window as unknown as { __dpdpMockFail?: string }).__dpdpMockFail = undefined })
    await dlg.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(page.getByText("Note saved.")).toBeVisible()
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
  })

  test("owner: a fault on our side is a pop-up that apologises, with a reference and an e-mail link", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowWithAllFour(page)
    await page.getByLabel("Your note", { exact: true }).fill("A note.")
    await page.evaluate(() => { (window as unknown as { __dpdpMockFail?: string }).__dpdpMockFail = "Something failed on our side" })
    await page.getByRole("button", { name: "Save note", exact: true }).click()
    const dlg = page.getByRole("alertdialog")
    await expect(dlg).toContainText("This is not your doing")
    await expect(dlg).toContainText(/Reference: [A-Z0-9]{6}/)
    await expect(dlg.getByRole("link", { name: "E-mail us", exact: true })).toHaveAttribute("href", /^mailto:dpdp@veridian-aios\.com\?/)
    await dlg.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("button", { name: "Show what to do", exact: true })).toBeVisible()
  })

  test("staff: giving a job away is not offered, and a bad hand-over e-mail is guided for the owner", async ({ page }) => {
    await seed(page, "owner-live")
    await openRowWithAllFour(page)
    await page.getByRole("tab", { name: "Give to someone", exact: true }).click()
    await page.getByLabel("Their email address", { exact: true }).fill("nobody")
    await page.getByRole("button", { name: "Give this job", exact: true }).click()
    await expectGuide(page, "Please check the e-mail address")
    await takeMeThere(page, page.getByLabel("Their email address", { exact: true }))
  })

  test("CA partner: adding a client with a bad owner address", async ({ page }) => {
    await page.goto("/app/?mock=partner")
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
    await page.getByRole("button", { name: "Got it — show me my jobs", exact: true }).click()
    await page.getByRole("button", { name: /^🧾 My clients/ }).click()
    await page.getByRole("button", { name: "+ Add a client", exact: true }).click()
    await page.getByLabel("Client name", { exact: true }).fill("Joshi Motors")
    await page.getByLabel("Set it up for them — name the owner now", { exact: true }).check()
    await page.getByLabel("Owner’s email", { exact: true }).fill("not-an-address")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    await expectGuide(page, "Please check the e-mail address")
    await takeMeThere(page, page.getByLabel("Owner’s email", { exact: true }))
    await page.getByLabel("Owner’s email", { exact: true }).fill("owner@joshi.example.test")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    await expect(page.getByText("Joshi Motors")).toBeVisible()
  })

  test("school parent: a link that does not work says what to do, and has no technical word", async ({ page }) => {
    await page.goto("/p/#not-a-token")
    await expectGuide(page, "This link cannot be used")
    await expect(page.getByRole("button", { name: /^Take me there/ })).toHaveCount(0)
  })

  test("one-time link: a link used twice is explained, with nothing to press", async ({ page }) => {
    await page.goto("/act/#mock-done")
    await page.getByRole("button", { name: 'Yes — record "Done"', exact: true }).click()
    await page.reload()
    await expectGuide(page, "That has already been done")
  })

  test("school: a person opening their organisation without a name is guided to the name box", async ({ page }) => {
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()
    await page.getByLabel("A school or institution", { exact: true }).check()
    await page.getByRole("checkbox").last().check()
    await page.getByRole("button", { name: "Open my organisation", exact: true }).click()
    await expectGuide(page, "Please give the organisation’s name")
    await takeMeThere(page, page.getByLabel("Organisation name", { exact: true }))
    await page.getByLabel("Organisation name", { exact: true }).fill("St Anne's High School")
    await page.getByRole("button", { name: "Open my organisation", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toHaveCount(0)
  })
})
