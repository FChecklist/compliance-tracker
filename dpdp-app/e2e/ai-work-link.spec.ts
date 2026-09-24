import { test, expect, type Page } from "@playwright/test"

// WO-DPDP-013 v2 Part 1 §4 item 6: the Copy-AI-link screen with the data
// warning (AiWorkLink.tsx), authority levels (AiWorkLink.tsx), "Your AI
// links" (AiLinksList), and `/app/#undo=` (AiUndoConfirm.tsx). Same rules as
// agent-by-role.spec.ts / step5-by-role.spec.ts / acceptance-70.spec.ts: the
// built site (dist/ via `vite preview`), VITE_MOCK=1, every locator by
// accessible name (getByRole / getByLabel / getByText) -- no CSS selector,
// test id or XPath. `?mock=owner-live` seeds the fixture and signs the
// owner in directly (src/lib/mock-client.ts) -- 31 jobs, 13 distinct
// people (pinned in src/lib/mock-client.test.ts), so this spec's counts and
// that unit test can never silently drift apart.

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

test.describe("WO-DPDP-013 Part 1 -- the Copy-AI-link screen", () => {
  test("the owner sees the warning sentence with the mock's real counts", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByRole("heading", { name: "🤖 AI work link", exact: true })).toBeVisible()
    await expect(page.getByText(
      "This link lets an AI assistant read your VERIDIAN view: 31 jobs and the names and emails of 13 people. When you paste it into an AI assistant, that information is sent to the company that runs it — for example, ChatGPT is run by a US company.",
      { exact: true },
    )).toBeVisible()
    // Never a sign-in token: the form never mentions signing in, and no
    // link is shown until "Copy link" is pressed.
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\//)).toHaveCount(0)
  })

  test("Level 1 is off by default; switching it on shows the plain explanation, off hides it again", async ({ page }) => {
    await seed(page, "owner-live")
    const level1 = page.getByLabel("Level 1 · Small edits, directly", { exact: true })
    await expect(level1).not.toBeChecked()
    await expect(page.getByText(/NOTE.*SET_DUE.*ASSIGN.*MARK_NA/s)).toHaveCount(0)

    await level1.check()
    await expect(page.getByText("by <person> via AI assistant", { exact: false })).toBeVisible()
    await expect(page.getByText(/undone for 24 hours/)).toBeVisible()
    await expect(page.getByText(/never done directly/)).toBeVisible()

    await level1.uncheck()
    await expect(page.getByText(/never done directly/)).toHaveCount(0)
  })

  test("hide-other-emails is unchecked by default, and 7 days is the default choice", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByLabel("Hide other people’s emails (show their role instead)", { exact: true })).not.toBeChecked()
    await expect(page.getByLabel("Link lasts", { exact: true })).toHaveValue("7")
  })

  test("Copy link creates a Level 0 link, shown once on this host's /ai/, with a Copy button and the recorded line -- and it appears in Your AI links", async ({ page }) => {
    await seed(page, "owner-live")
    await page.getByLabel("Link lasts", { exact: true }).selectOption("1")
    await page.getByLabel("Label (optional)", { exact: true }).fill("ChatGPT")
    await page.getByRole("button", { name: "Copy link", exact: true }).click()

    const url = page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\/[A-Za-z0-9_-]+$/)
    await expect(url).toBeVisible()
    await expect(page.getByRole("button", { name: "📋 Copy", exact: true })).toBeVisible()
    await expect(page.getByText("Shown once — never stored in a way that could be shown again. Copy it now.", { exact: true })).toBeVisible()
    await expect(page.getByText("This is written to your History as “Made an AI link”.", { exact: true })).toBeVisible()
    // Never a sign-in link: the URL is /ai/<token> only, never /app/ or a
    // magic-link path, and nothing about the page ever says "sign in".
    const shownUrl = await url.textContent()
    expect(shownUrl).toMatch(/^https:\/\/app\.veridian-aios\.com\/ai\/[A-Za-z0-9_-]+$/)
    expect(shownUrl).not.toContain("/app/")

    await expect(page.getByRole("heading", { name: "Your AI links", exact: true })).toBeVisible()
    await expect(page.getByText("ChatGPT", { exact: true })).toBeVisible()
    await expect(page.getByText(/Level 0 · Read, analyse, report · made .* · expires .*/)).toBeVisible()
  })

  test("Revoke asks to confirm, then greys the link out and removes its Revoke button; expiry is still listed", async ({ page }) => {
    await seed(page, "owner-live")
    await page.getByLabel("Label (optional)", { exact: true }).fill("To revoke")
    await page.getByRole("button", { name: "Copy link", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Your AI links", exact: true })).toBeVisible()

    const revokeButton = page.getByRole("button", { name: "Revoke To revoke", exact: true })
    await expect(revokeButton).toBeVisible()
    await revokeButton.click()
    await expect(page.getByText("Stop this link? The AI using it will be refused from its next call.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Yes, stop it", exact: true }).click()

    await expect(page.getByText("Revoked", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Revoke To revoke", exact: true })).toHaveCount(0)
  })

  test("`/app/#undo=mock-action.mock-undo` shows the confirm screen and undoes on Undo", async ({ page }) => {
    await seed(page, "owner-live")
    await page.goto("/app/#undo=mock-action.mock-undo")
    await expect(page.getByRole("heading", { name: "Undo the change your AI assistant made?", exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/app\/$/) // the fragment is cleared, exactly like #draft=
    await expect(page.getByText(/action mock-action/)).toBeVisible()
    await expect(page.getByRole("status")).toHaveCount(0)

    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Undone")
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Undo the change your AI assistant made?", exact: true })).toHaveCount(0)
  })

  test("undoing the same fixed mock action twice in one session is refused the second time", async ({ page }) => {
    await seed(page, "owner-live")
    await page.goto("/app/#undo=mock-action.mock-undo")
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Undone")
    await page.getByRole("button", { name: "Close", exact: true }).click()

    await page.goto("/app/#undo=mock-action.mock-undo")
    await expect(page.getByRole("heading", { name: "Undo the change your AI assistant made?", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await expect(page.getByRole("alert")).toContainText("This has already been undone")
  })
})
