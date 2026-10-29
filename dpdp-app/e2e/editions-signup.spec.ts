import { test, expect, type Page } from "@playwright/test"

// WO-DPDP-015: the two edition landing pages END TO END in a browser, mock
// mode (VITE_MOCK=1), by accessible names only (same rule as
// agent-by-role.spec.ts). "Start free" on /dpdp-firm/ and /dpdp-institution/
// used to point at the Next.js login (Vercel, off), so a new firm or school
// could not get in at all. Now: landing -> Start free -> sign in by email ->
// "Open your organisation" -> the owner's own first visit.
//
// 2026-10-27 (owner): the school / institution choice is hidden. There is no
// "what kind of organisation" question any more; every new account opens as the
// firm edition, including one that arrives through an old ?edition=institution
// link. The institution landing page is still served until the site rebuild
// retires it, so it stays in this loop and must now behave exactly like the firm
// one. Accounts already saved as "institution" are proved by mock-client.test.ts. The other roles' screens are proved by acceptance-70 and
// step5-by-role; the live-database version of every role is
// src/lib/services/dpdp-editions-roles.test.ts.

const BOX_K2 = "I have read and agree to the Terms & Conditions and the Privacy Policy."

type Edition = { slug: "firm" | "institution"; path: string; email: string; area: string }
const EDITIONS: Edition[] = [
  { slug: "firm", path: "/dpdp-firm/", email: "new-firm-owner@example.test", area: "All staff" },
  // The old school door: its link still says edition=institution, and the account it opens is the firm edition ("All staff", not "Teachers").
  { slug: "institution", path: "/dpdp-institution/", email: "new-school-principal@example.test", area: "All staff" },
]

async function signInFrom(page: Page, email: string) {
  await expect(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true })).toBeVisible()
  await page.getByLabel("Your email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  // The mock stands in for the human opening the emailed link (1.5 s); a stranger lands on "Open your organisation".
  await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible({ timeout: 10_000 })
}

for (const ed of EDITIONS) {
  test.describe(`${ed.path} -- a new ${ed.slug} owner, start to finish`, () => {
    test("Start free -> email -> Open your organisation (no type to choose) -> the owner's first visit -> the list", async ({ page }) => {
      await page.goto(ed.path)
      // Every "Start free" on the page opens the app, not the old Next.js login.
      const starts = page.getByRole("link", { name: "Start free →", exact: true })
      expect(await starts.count()).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < (await starts.count()); i++) {
        await expect(starts.nth(i)).toHaveAttribute("href", `/app/?edition=${ed.slug}`)
      }
      await starts.first().click()
      await expect(page).toHaveURL(/\/app\/$/) // the edition hint is consumed and stripped from the address

      await signInFrom(page, ed.email)

      // A person no organisation knows is asked to open theirs. There is nothing to choose about its type: no radio at all, and no school or institution wording.
      await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()
      await expect(page.getByRole("radio")).toHaveCount(0)
      await expect(page.getByText(/institution/i)).toHaveCount(0)
      await expect(page.getByText(ed.email)).toBeVisible()
      await expect(page.getByText("Invited by someone else?", { exact: false })).toBeVisible()

      // The name is required, and so is the K2 box: the button waits (disabled) and nothing is opened.
      await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeDisabled()
      await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()

      await page.getByLabel("Organisation name", { exact: true }).fill(`Mehta ${ed.slug} 1`)
      // The K2 box is never pre-ticked: the button waits (and says why) until it is.
      await expect(page.getByRole("checkbox", { name: BOX_K2 })).not.toBeChecked()
      await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeDisabled()
      await page.getByRole("checkbox", { name: BOX_K2 }).check()
      await page.getByRole("button", { name: "Open my organisation", exact: true }).click()

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
      await expect(page.getByRole("heading", { name: "Open your organisation", exact: true })).toHaveCount(0)
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
  test("has no kind of organisation to choose, only a name; a double click makes one; the invited are told what to ask for", async ({ page }) => {
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()
    // The school / institution choice is hidden: no radio, no such wording, and the button waits for the name and the K2 box.
    await expect(page.getByRole("radio")).toHaveCount(0)
    await expect(page.getByText(/institution|school/i)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeDisabled()

    await page.getByLabel("Organisation name", { exact: true }).fill("St Anne's High School")
    await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeDisabled() // the K2 box is still unticked
    await expect(page.getByText("Please tick the box to continue.", { exact: true })).toBeVisible()
    await page.getByRole("checkbox", { name: BOX_K2 }).check()
    await expect(page.getByRole("button", { name: "Open my organisation", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "Open my organisation", exact: true }).dblclick()

    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    // Always the firm's library now: the group area is "All staff", never "Teachers".
    await expect(page.getByLabel("All staff", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Teachers", { exact: true })).toHaveCount(0)
  })

  test("sign out from the screen gives the sign-in page back", async ({ page }) => {
    await page.goto("/app/?mock=visitor")
    await expect(page.getByRole("heading", { level: 1, name: "Open your organisation", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Use a different email", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Sign in or start free", exact: true })).toBeVisible()
  })
})
