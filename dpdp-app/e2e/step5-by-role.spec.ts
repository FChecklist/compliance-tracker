import { test, expect, type Page } from "@playwright/test"

// WO-DPDP-011 Step 5 in mock mode (VITE_MOCK=1), driven by accessible names
// only -- the same rule as agent-by-role.spec.ts (WO-DPDP-012 §6): every
// locator is getByRole / getByLabel / getByText with the control's exact
// accessible name; no CSS selector, test id or XPath anywhere. Runs under
// dpdp-app/playwright.config.ts (PR #1817) against the BUILT site served by
// `vite preview`; a fresh browser context per test means a fresh mock state.
//
// Unlike the §6 journey, these tests let the mock's 1.5 s "the human opened
// the email" timer run, because the screens under test all sit behind the
// sign-in. The three personas are src/lib/mock-client.ts's:
//   owner@example.test        the org's owner (wizard -> group job -> AI link)
//   partner@example.test      a CA partner (three steps -> My clients -> add)
//   client-owner@example.test an owner whose org a CA set up (review -> confirm)

async function signIn(page: Page, email: string) {
  await page.goto("/app/")
  await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
  await page.getByLabel("Your email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

test.describe("WO-DPDP-011 Step 5 -- the remaining WO-010 screens, by accessible names", () => {
  test("owner: wizard -> own group job answered -> AI link made once", async ({ page }) => {
    await signIn(page, "owner@example.test")

    // The owner's three-step wizard (Step 3), naming themself into the
    // "All staff" group so a group job becomes theirs to answer.
    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Who looks after what?", exact: true })).toBeVisible()
    await page.getByLabel("All staff", { exact: true }).fill("owner@example.test")
    await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()

    // Group jobs: the three answers, by name. "Done" closes a one-person
    // group; History records the answer with the roll-up.
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Doesn't apply to me", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "I can't", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Done", exact: true }).click()
    await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0)
    await expect(page.getByText(/answered "Done" for .* \(1 of 1\)/)).toBeVisible()

    // Copy AI link: shown once, on this host's /ai/ route.
    await page.getByRole("button", { name: "🤖 Make my AI Link", exact: true }).click()
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\/[A-Za-z0-9_-]+$/)).toBeVisible()
    await expect(page.getByRole("button", { name: "📋 Copy my AI Link", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "🤖 Make my AI Link", exact: true })).toHaveCount(0)
  })

  test("owner: an AI draft in the URL fragment is shown, changes nothing until Confirm, then is recorded", async ({ page }) => {
    await signIn(page, "owner@example.test")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()
    await expect(page.getByRole("button", { name: "🤖 Make my AI Link", exact: true })).toBeVisible()

    await page.goto("/app/#draft=mock-draft.mock-confirm")
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/app\/$/)
    await expect(page.getByText("Add a note to a job", { exact: true })).toBeVisible()
    await expect(page.getByText("drafted by AI, confirmed by")).toHaveCount(0)
    await page.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(page.getByRole("status")).toContainText("Confirmed")
    await expect(page.getByText(/drafted by AI, confirmed by owner@example\.test/)).toBeVisible()
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toHaveCount(0)
  })

  test("CA partner: three steps -> My clients -> + Add a client -> Open a client", async ({ page }) => {
    await signIn(page, "partner@example.test")

    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "This isn’t me", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Your clients", exact: true })).toBeVisible()
    await expect(page.getByText("Mehta Traders")).toBeVisible()
    await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
    await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Got it — show me my jobs", exact: true }).click()

    // The shell's "My clients (N)" entry, then the clients table with its
    // "Where it is" column and the add-a-client form.
    const myClients = page.getByRole("button", { name: "🧾 My clients (1)", exact: true })
    await expect(myClients).toBeVisible()
    await myClients.click()
    await expect(page.getByRole("heading", { level: 1, name: "My CA clients", exact: true })).toBeVisible()
    await expect(page.getByRole("columnheader", { name: "Where it is", exact: true })).toBeVisible()
    await expect(page.getByText("In progress", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "+ Add a client", exact: true }).click()
    await page.getByLabel("Client name", { exact: true }).fill("New Client Ltd")
    await page.getByLabel("A school", { exact: true }).check()
    await page.getByLabel("Set it up for them — name the owner now", { exact: true }).check()
    await page.getByLabel("Owner’s email", { exact: true }).fill("owner@newclient.example")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    await expect(page.getByText("New Client Ltd")).toBeVisible()
    await expect(page.getByText("Waiting for the owner to confirm", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "🧾 My clients (2)", exact: true })).toHaveCount(0) // the shell entry is hidden on this view
    await page.getByRole("button", { name: "Open Mehta Traders", exact: true }).click()
    await expect(page.getByRole("button", { name: "🧾 My clients (2)", exact: true })).toBeVisible()
  })

  test("owner set up by a CA: the review screen, then confirm lands on the jobs page", async ({ page }) => {
    await signIn(page, "client-owner@example.test")
    await expect(page.getByRole("heading", { name: "partner@example.test set this up for you", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Who looks after what", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Looks right — confirm", exact: true }).click()
    await expect(page.getByRole("heading", { name: "partner@example.test set this up for you", exact: true })).toHaveCount(0)
    await expect(page.getByText("🕘 History", { exact: true })).toBeVisible()
    await expect(page.getByText(/confirmed the list their CA set up/)).toBeVisible()
  })

  test("/act/: opening changes nothing; the button records; a second press is refused", async ({ page }) => {
    await page.goto("/act/#mock-done")
    await expect(page.getByRole("heading", { level: 1, name: "Sharma & Associates", exact: true })).toBeVisible()
    await expect(page.getByText("Opening this page has changed nothing.")).toBeVisible()
    await page.getByRole("button", { name: 'Yes — record "Done"', exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Recorded, thank you", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByText("This link has already been used. Nothing has changed.")).toBeVisible()
  })

  test("/act/ with no usable token is a plain refusal", async ({ page }) => {
    await page.goto("/act/#not-a-token")
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
  })

  test("/unsubscribe/: nothing until the button; statutory notices continue", async ({ page }) => {
    await page.goto("/unsubscribe/#mock-unsub")
    await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly email?", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Stop the weekly email", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Stopped", exact: true })).toBeVisible()
    await expect(page.getByText("owner@example.test")).toBeVisible()
  })

  test("/p/: the parent consent page -- No is a valid answer, and the link is single use", async ({ page }) => {
    await page.goto("/p/#mock-parent")
    await expect(page.getByRole("heading", { level: 1, name: "What we hold about you", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Now tell us what you agree to →", exact: true }).click()
    await expect(page.getByRole("button", { name: "Yes, I agree", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "No, I do not agree", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "No, I do not agree", exact: true })).toHaveCount(0)
  })
})
