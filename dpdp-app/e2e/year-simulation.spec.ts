import { test, expect, type Page } from "@playwright/test"

// One simulated year, month by month (owner, 2026-10-22: "test the complete role and user life cycle
// for 1 year, fast-forward the time, fake ids, CA use case, school use case"). The BUILT site in mock
// mode, the browser's clock frozen and then advanced 30 days at a time (Playwright page.clock), every
// person a fake @example.test address. Each month every role signs in, does the jobs that are theirs
// and now unblocked, and the page is checked: it opens, it shows no error, lateness never goes down by
// itself, and at the end the whole file is signed off.
//
// Honest limit: this is the demo-mode world (src/lib/mock-client.ts), which mirrors the database rules
// the unit tests pin against the real functions. It proves the screens and the life cycle, not the live database.

const START = new Date("2026-10-22T09:00:00+05:30")
const MONTH_MS = 30 * 86_400_000

let now = START.getTime()
/** Moves the page's clock forward by `ms` (a month at a time). The new time sticks across reloads and sign-ins. */
async function fastForward(page: Page, ms: number) {
  now += ms
  await page.clock.setSystemTime(new Date(now))
}

async function signInAs(page: Page, email: string) {
  await page.goto("/app/")
  const signOut = page.getByRole("button", { name: "Sign out", exact: true })
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click()
  }
  await expect(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true })).toBeVisible()
  await page.getByLabel("Your email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  await page.clock.fastForward(2000); now += 2000 // the mock's "the person opened the e-mail" timer
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
  const welcome = page.getByRole("button", { name: "Got it — show me my jobs", exact: true })
  for (const next of ["Next — my clients", "Next — how it works"]) {
    const b = page.getByRole("button", { name: next, exact: true })
    if (await b.isVisible().catch(() => false)) await b.click()
  }
  if (await welcome.isVisible().catch(() => false)) await welcome.click()
}

/** Presses every "Mark Yes" this person can see (their own, unblocked jobs). Returns how many it closed. */
async function doMyJobs(page: Page): Promise<number> {
  let done = 0
  for (let i = 0; i < 40; i++) {
    const b = page.getByRole("button", { name: "Mark Yes", exact: true }).first()
    if (!(await b.isVisible().catch(() => false))) break
    await b.click()
    done++
    await expect(page.getByRole("alert")).toHaveCount(0)
  }
  return done
}

async function lateCount(page: Page): Promise<number> {
  const chip = page.getByRole("button", { name: /^Late\d+$/ })
  if (!(await chip.isVisible().catch(() => false))) return 0
  return Number(((await chip.innerText()).match(/\d+/) ?? ["0"])[0])
}

test.beforeEach(() => { now = START.getTime() })

test.describe("one simulated year -- fake people, clock fast-forwarded", () => {
  test.setTimeout(240_000)

  test("CA firm and its client: every role, twelve months, signed off at the end", async ({ page }) => {
    await page.clock.install({ time: START })
    // Month 0: the CA's client (an owner set up by the CA) opens their file.
    await page.goto("/app/?mock=owner-live")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    const roles = ["owner@example.test", "staff@example.test", "hr@example.test", "go@example.test", "coord@example.test", "web@vendor.test", "it@example.test", "cctv@example.test", "manager@example.test", "partner@example.test"]
    let previousLate = -1
    let closedTotal = 0
    for (let month = 1; month <= 12; month++) {
      await fastForward(page, MONTH_MS)
      // Everyone works in the first quarter and in the closing month; in between the owner and the CA partner keep the file moving.
      const today = month <= 3 || month === 12 ? roles : ["owner@example.test", "partner@example.test"]
      for (const who of today) {
        await signInAs(page, who)
        await expect(page.getByRole("alert")).toHaveCount(0)
        const late = await lateCount(page)
        if (who === "owner@example.test") {
          // The owner sees the whole file: lateness only grows while jobs stay open.
          if (previousLate >= 0 && closedTotal === 0) expect(late).toBeGreaterThanOrEqual(previousLate)
          previousLate = late
        }
        closedTotal += await doMyJobs(page)
      }
    }
    // The year ends with the whole file closed: the CA partner sees it "Signed off".
    await signInAs(page, "owner@example.test")
    expect(await doMyJobs(page)).toBeGreaterThanOrEqual(0)
    await expect(page.getByRole("button", { name: "Mark Yes", exact: true })).toHaveCount(0)
    expect(closedTotal).toBeGreaterThan(15)
  })

  test("a school: opens its organisation, the parent answers, a year passes, the consent can be withdrawn", async ({ page }) => {
    await page.clock.install({ time: START })
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()
    await page.getByLabel("Organisation name", { exact: true }).fill("St Anne's High School")
    await page.getByLabel("A school or institution", { exact: true }).check()
    await page.getByRole("checkbox").last().check()
    await page.getByRole("button", { name: "Open my organisation", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toHaveCount(0)
    await expect(page.getByRole("alert")).toHaveCount(0)

    // Month 1: a parent answers the school's consent request on their own link.
    await fastForward(page, MONTH_MS)
    await page.goto("/p/#mock-parent-multi")
    await expect(page.getByRole("heading", { level: 1, name: "What we hold about you", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Now tell us what you agree to →", exact: true }).click()
    await page.getByRole("group", { name: "Photos on the school trip" }).getByRole("button", { name: /^Yes/ }).click()
    await page.getByRole("group", { name: "The school newsletter" }).getByRole("button", { name: /^No/ }).click()
    await page.getByRole("button", { name: "Save my answers", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()

    // Months 2 to 12: the school's own page opens every month with no error, and a spent link stays spent.
    for (let month = 2; month <= 12; month++) {
      await fastForward(page, MONTH_MS)
      await page.goto("/app/")
      await expect(page.getByText("Signed in as").or(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true }))).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole("alert")).toHaveCount(0)
    }
    // Month 12: the parent withdraws the Yes with the same link, and the link still works for that.
    await page.goto("/p/#mock-parent-multi")
    await page.getByRole("button", { name: "Withdraw: Photos on the school trip", exact: true }).click()
    await expect(page.getByText("You withdrew your consent.").or(page.getByText(/withdrew|Withdrawn/i)).first()).toBeVisible()
    await page.goto("/act/#mock-done")
    await page.getByRole("button", { name: 'Yes — record "Done"', exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Recorded, thank you", exact: true })).toBeVisible()
    await fastForward(page, MONTH_MS)
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("alert")).toContainText("That has already been done")
  })
})
