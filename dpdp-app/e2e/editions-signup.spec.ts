import { test, expect, type Page } from "@playwright/test"

// WO-DPDP-015: the two edition landing pages END TO END in a browser, mock
// mode (VITE_MOCK=1), by accessible names only (same rule as
// agent-by-role.spec.ts). "Start free" on /dpdp-firm/ and /dpdp-institution/
// used to point at the Next.js login (Vercel, off), so a new firm or school
// could not get in at all. Now: landing -> Start free -> sign in by email ->
// "Open your organisation" (the edition already chosen) -> the owner's own
// first visit. The other roles' screens are proved by acceptance-70 and
// step5-by-role; the live-database version of every role is
// src/lib/services/dpdp-editions-roles.test.ts.

const BOX_K2 = "I have read and agree to the Terms & Conditions and the Privacy Policy."

type Edition = { slug: "firm" | "institution"; path: string; heading: string; button: string; nameLabel: string; email: string; area: string }
const EDITIONS: Edition[] = [
  { slug: "firm", path: "/dpdp-firm/", heading: "Open your professional account", button: "Open my firm account", nameLabel: "Firm name", email: "new-firm-owner@example.test", area: "All staff" },
  { slug: "institution", path: "/dpdp-institution/", heading: "Open your organisation account", button: "Open my organisation", nameLabel: "Organisation name", email: "new-school-principal@example.test", area: "Teachers" },
]

async function signInFrom(page: Page, email: string, heading: string) {
  await expect(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true })).toBeVisible()
  await page.getByLabel("Your email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  // The mock stands in for the human opening the emailed link (1.5 s); a stranger lands on the opening screen for the door they came through.
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible({ timeout: 10_000 })
}

for (const ed of EDITIONS) {
  test.describe(`${ed.path} -- a new ${ed.slug} owner, start to finish`, () => {
    test("Start free -> email -> Open your organisation (edition chosen) -> the owner's first visit -> the list", async ({ page }) => {
      await page.goto(ed.path)
      // Every "Start free" on the page opens the app, not the old Next.js login.
      const starts = page.getByRole("link", { name: "Start free →", exact: true })
      expect(await starts.count()).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < (await starts.count()); i++) {
        await expect(starts.nth(i)).toHaveAttribute("href", `/app/?edition=${ed.slug}`)
      }
      await starts.first().click()
      await expect(page).toHaveURL(/\/app\/$/) // the edition hint is consumed and stripped from the address

      await signInFrom(page, ed.email, ed.heading)

      // A person no organisation knows is asked to open theirs; the edition they came from is already chosen.
      await expect(page.getByRole("heading", { level: 1, name: ed.heading, exact: true })).toBeVisible()
      await expect(page.getByText(ed.email)).toBeVisible()
      await expect(page.getByText("Invited by someone else?", { exact: false })).toBeVisible()

      // The name is required, and so is the K2 box: the button waits (disabled) and nothing is opened.
      await expect(page.getByRole("button", { name: ed.button, exact: true })).toBeDisabled()
      await expect(page.getByRole("heading", { level: 1, name: ed.heading, exact: true })).toBeVisible()

      await page.getByLabel(ed.nameLabel, { exact: true }).fill(`Mehta ${ed.slug} 1`)
      if (ed.slug === "firm") await page.getByLabel("Kind of firm", { exact: true }).selectOption("ca")
      // The K2 box is never pre-ticked: the button waits (and says why) until it is.
      await expect(page.getByRole("checkbox", { name: BOX_K2 })).not.toBeChecked()
      await expect(page.getByRole("button", { name: ed.button, exact: true })).toBeDisabled()
      await page.getByRole("checkbox", { name: BOX_K2 }).check()
      await page.getByRole("button", { name: ed.button, exact: true }).click()

      // The owner's own first visit: the list, then who looks after what.
      await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Who looks after what?", exact: true })).toBeVisible()
      await expect(page.getByLabel(ed.area, { exact: true })).toBeVisible()
      await page.getByLabel(ed.area, { exact: true }).fill(ed.email)
      await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()

      // Their page: their organisation's name, their jobs, the AI work link, the History with the creation recorded.
      await expect(page.getByText(`Mehta ${ed.slug} 1`).first()).toBeVisible()
      await expect(page.getByRole("heading", { name: "🤖 AI work link", exact: true })).toBeVisible()
      await expect(page.getByText(/Organisation "Mehta .* 1" created/)).toBeVisible()

      // And it is theirs on the next visit: a reload signs them straight back into their organisation.
      await page.goto("/app/")
      await expect(page.getByRole("heading", { name: ed.heading, exact: true })).toHaveCount(0)
      await expect(page.getByText(`Mehta ${ed.slug} 1`).first()).toBeVisible()
    })

    test("the page has one way in and it is /app/: Sign in too, and no link to the old login", async ({ page }) => {
      await page.goto(ed.path)
      await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/app/")
      const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
      expect(hrefs.filter((h) => /\/dpdp\/login/.test(h))).toEqual([])
    })
  })
}

test.describe("a visitor with no organisation", () => {
  test("must choose a door (professionals or organisations) and name it; a double click makes one; the invited are told what to ask for", async ({ page }) => {
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your account", exact: true })).toBeVisible()
    // No edition was chosen on a landing page: two doors, no form yet.
    await expect(page.getByRole("button", { name: /^For professionals/ })).toBeVisible()
    await expect(page.getByLabel("Organisation name", { exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: /^For organisations/ }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation account", exact: true })).toBeVisible()
    // Organisations never see the professional block.
    await expect(page.getByLabel("Kind of firm", { exact: true })).toHaveCount(0)
    await page.getByLabel("Organisation name", { exact: true }).fill("St Anne's High School")
    await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeDisabled() // the K2 box is still unticked
    await expect(page.getByText("Please tick the box to continue.", { exact: true })).toBeVisible()
    await page.getByRole("checkbox", { name: BOX_K2 }).check()
    await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Open my organisation", exact: true }).dblclick()

    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    // The school's library, not the firm's: the group area is "Teachers".
    await expect(page.getByLabel("Teachers", { exact: true })).toBeVisible()
  })

  test("sign out from the screen gives the sign-in page back", async ({ page }) => {
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your account", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Use a different email", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true })).toBeVisible()
  })
})
