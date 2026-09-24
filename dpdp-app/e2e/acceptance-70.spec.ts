import { test, expect, type Page } from "@playwright/test"

// WO-DPDP-011 Step 6: the spec's 70 behaviour checks (WO-DPDP-010: "tlaw"
// 18, "tfirst" 28, "troles2" 24) as Playwright tests against the REAL built
// static app, one test per check, exactly 70. The original jsdom files were
// never committed, so each check below is DERIVED from spec/veridian-
// dpdp.html itself; e2e/ACCEPTANCE-70.md is the derivation table (id ->
// spec section/line -> what is asserted -> which mock fixture). Every test
// title quotes the behaviour in the spec's own words.
//
// Same rules as agent-by-role.spec.ts / step5-by-role.spec.ts: the built
// site (dist/ via `vite preview`, playwright.config.ts) in mock mode
// (VITE_MOCK=1); every locator is getByRole / getByLabel / getByText /
// getByTitle by accessible name -- no CSS selector, test id or XPath. The
// mock (src/lib/mock-client.ts) is seeded per test by `?mock=<scenario>` on
// /app/, which signs that persona in directly; a plain form sign-in keeps
// the stored state so one test can sign out and back in as someone else
// against the same org. `page.goto("/app/")` (no query) is how a test
// proves something PERSISTED. Every number asserted here is pinned to the
// fixture by src/lib/mock-client.test.ts.

const ORG = "Sharma & Associates"
const OWNER = "owner@example.test"
const GO_TITLE = "IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027"
const DPDP_TITLE = "DPDP Act 2023 and Rules 2025 — in force from 13 May 2027"
const AADHAAR_TITLE = "Aadhaar Act 2016 — in force today"
const GOOD_PRACTICE_TITLE = "Not a legal duty — it keeps the work moving"
const GRIEVANCE_OFFICER = "Grievance Officer (responsible for DPDP policy)"
const OWNER_CONFIRMS = "Owner confirms all the answers are true"
const MANAGER_CHECKS = "CA manager checks the proof"
const PARTNER_SIGNS = "CA partner signs the file"
const GROUP_JOB = "Check your own laptop and phone for customer data — never forward it on personal WhatsApp"
const WELCOME_GOT_IT = "Got it — show me my jobs"
const NOT_ME = "This isn’t me"

// The seeded world, signed in as its persona (mock-client.ts MOCK_SCENARIOS).
async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

// A real sign-in through the form, keeping whatever state is stored: the
// mock's 1.5 s "the human opened the email" timer runs.
async function signIn(page: Page, email: string) {
  await page.goto("/app/")
  await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
  await page.getByLabel("Your email", { exact: true }).fill(email)
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
}

// The invited person's welcome, acknowledged.
async function gotIt(page: Page) {
  await page.getByRole("button", { name: WELCOME_GOT_IT, exact: true }).click()
  await expect(page.getByRole("button", { name: WELCOME_GOT_IT, exact: true })).toHaveCount(0)
}

// The CA partner's three steps, acknowledged.
async function partnerThreeSteps(page: Page) {
  await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
  await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
  await gotIt(page)
}

async function markYes(page: Page, what: string | RegExp) {
  await page.getByRole("row", { name: what }).getByRole("button", { name: "Mark Yes", exact: true }).click()
  await expect(page.getByRole("row", { name: what }).getByText("YES", { exact: true })).toBeVisible()
}

// The Due date column's own format (JobsTable.tsx DueCell): en-IN "dd Mon",
// for a job due `days` from today. The mock seeds due dates relative to
// today too, so this is the same arithmetic on the same day.
function ddMon(days: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

const chip = (page: Page, label: string, n: number) => page.getByRole("button", { name: new RegExp(`^${label}\\s*${n}$`) })
const row = (page: Page, what: string | RegExp) => page.getByRole("row", { name: what })
const CUSTOMER_DATA_ROW = /Customers.*Write down where it is kept, why you need it, and who can open it/

// =====================================================================
// tlaw -- 18 checks on the law/date labels and tags the spec renders
// =====================================================================
test.describe("tlaw -- the law and date labels", () => {
  test("LAW-01 SPDI: 'IT Act §43A and SPDI Rules 2011 — in force TODAY, until 13 May 2027' on every job that cites an s: code", async ({ page }) => {
    await seed(page, "owner-live")
    const spdi = page.getByTitle(GO_TITLE)
    await expect(spdi).toHaveCount(11) // the 11 firm jobs with an s: code (mock-client.test.ts)
    await expect(spdi.first()).toHaveText("SPDI R5(9)")
    await expect(row(page, "Publish a privacy policy on the website").getByTitle(GO_TITLE)).toHaveText("SPDI R4")
  })

  test("LAW-02 DPDP: 'DPDP Act 2023 and Rules 2025 — in force from 13 May 2027', sections joined with ' · '", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByTitle(DPDP_TITLE)).toHaveCount(27) // every firm job but the four g:/s:-only ones
    await expect(row(page, "Name the " + GRIEVANCE_OFFICER).getByTitle(DPDP_TITLE)).toHaveText("DPDP §8(9) · §8(10)")
  })

  test("LAW-03 Aadhaar Act: 'Aadhaar Act 2016 — in force today' on 'Mask Aadhaar copies'", async ({ page }) => {
    await seed(page, "owner-live")
    const aadhaar = page.getByTitle(AADHAAR_TITLE)
    await expect(aadhaar).toHaveCount(1)
    await expect(aadhaar).toHaveText("Aadhaar Act §29")
    await expect(row(page, "Mask Aadhaar copies — keep only the last 4 digits visible").getByTitle(AADHAAR_TITLE)).toBeVisible()
  })

  test("LAW-04 Good practice: 'Not a legal duty — it keeps the work moving' on the CA's own chain steps", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByTitle(GOOD_PRACTICE_TITLE)).toHaveCount(3) // Name a DPDP coordinator, CA manager checks, CA partner signs
    await expect(row(page, MANAGER_CHECKS).getByTitle(GOOD_PRACTICE_TITLE)).toHaveText("Good practice")
    await expect(row(page, PARTNER_SIGNS).getByTitle(GOOD_PRACTICE_TITLE)).toHaveText("Good practice")
  })

  test("LAW-05 '⚡ required today' under every job an s: or a: code asks for, and under no other", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByText("⚡ required today", { exact: true })).toHaveCount(12) // LIBRARY.firm.filter(isToday) = 12
    await expect(row(page, "Publish a privacy policy on the website").getByText("⚡ required today", { exact: true })).toBeVisible()
    await expect(row(page, "Name a DPDP coordinator").getByText("⚡ required today", { exact: true })).toHaveCount(0) // g: only
    await expect(row(page, "Put up a notice wherever there is a camera").getByText("⚡ required today", { exact: true })).toHaveCount(0) // d: only
  })

  test("LAW-06 tags sort today's law first -- SPDI / Aadhaar Act, then DPDP, then Good practice ('asdg')", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(row(page, "Name the " + GRIEVANCE_OFFICER)).toHaveText(/SPDI R5\(9\)\s*DPDP §8\(9\) · §8\(10\)\s*⚡ required today/)
    await expect(row(page, "Mask Aadhaar copies — keep only the last 4 digits visible")).toHaveText(/Aadhaar Act §29\s*DPDP §8\(5\) · R6\s*⚡ required today/)
    await expect(row(page, "Publish a privacy policy on the website")).toHaveText(/SPDI R4\s*DPDP §5 · R3\s*⚡ required today/)
  })

  test("LAW-07 the filter chips count All / Mine / Not done / Late / Required today / Nobody named / Done, and 'Required today' shows only those jobs", async ({ page }) => {
    await seed(page, "owner-live")
    for (const [label, n] of [["All", 31], ["Mine", 1], ["Not done", 25], ["Late", 3], ["Required today", 9], ["Nobody named", 1], ["Done", 5]] as const) {
      await expect(chip(page, label, n)).toBeVisible()
    }
    await chip(page, "Required today", 9).click()
    await expect(row(page, "Publish a privacy policy on the website")).toBeVisible()
    await expect(row(page, "Name a DPDP coordinator")).toHaveCount(0) // g: only, not required today
    await expect(row(page, "Put up a notice wherever there is a camera")).toHaveCount(0) // d: only
  })

  test("LAW-08 'red data types are sensitive — stricter rules apply': Aadhaar is red, Salary is not", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByText("Aadhaar", { exact: true }).first()).toHaveCSS("color", "rgb(158, 38, 32)") // #9E2620, the spec's .dt.sens
    await expect(page.getByText("Bank details", { exact: true }).first()).toHaveCSS("color", "rgb(158, 38, 32)")
    await expect(page.getByText("Salary", { exact: true }).first()).toHaveCSS("color", "rgb(75, 79, 122)") // --dpdp-ink2
  })

  test("LAW-09 the seal: 'N of M' done and 'P% done', counting live jobs only", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByText("5 of 30", { exact: true })).toBeVisible() // 31 jobs, 1 n/a, 5 done
    await expect(page.getByText("17% done", { exact: true })).toBeVisible() // round(5/30*100)
  })

  test("LAW-10 the parts track: one node per part, 'N of M' under each, '✓' when a part is complete", async ({ page }) => {
    await seed(page, "owner-live")
    for (const name of ["Basics", "Know your data", "Tell people & take consent", "Keep it safe", "Firms you share data with", "Requests & complaints", "Sign off"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible() // the node's label (the table's headers read "Part n · Name", not this)
    }
    for (const [title, n] of [["2 of 3 done", 1], ["2 of 7 done", 1], ["0 of 6 done", 1], ["1 of 5 done", 1], ["0 of 3 done", 3]] as const) {
      await expect(page.getByTitle(title)).toHaveCount(n)
    }
    await expect(page.getByText("2 of 7", { exact: true })).toBeVisible()
    await expect(page.getByText("0 of 3", { exact: true })).toHaveCount(3)
    // No part is complete in this fixture, so no ring shows ✓ in place of
    // its number -- Part 7 needs the CA's two steps, not just the owner's.
    await expect(page.getByText("✓", { exact: true })).toHaveCount(0)
  })

  test("LAW-11 the Done? column: a 'YES' stamp on a done job, 'No' on someone else's open job, 'Mark Yes' only on your own", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(row(page, "Name the " + GRIEVANCE_OFFICER).getByText("YES", { exact: true })).toBeVisible()
    const theirs = row(page, "Publish the Grievance Officer’s name and contact — on your website or a free VERIDIAN page")
    await expect(theirs.getByText("No", { exact: true })).toBeVisible()
    await expect(theirs.getByRole("button", { name: "Mark Yes", exact: true })).toHaveCount(0)
    await expect(row(page, OWNER_CONFIRMS).getByRole("button", { name: "Mark Yes", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark Yes", exact: true })).toHaveCount(1) // the owner has exactly one open job of their own
  })

  test("LAW-12 the table is grouped 'Part n · Name' with 'N of M done' on each header", async ({ page }) => {
    await seed(page, "owner-live")
    for (const [header, done] of [["Part 1 · Basics", "2 of 3 done"], ["Part 2 · Know your data", "2 of 7 done"], ["Part 3 · Tell people & take consent", "0 of 6 done"], ["Part 4 · Keep it safe", "1 of 5 done"], ["Part 5 · Firms you share data with", "0 of 3 done"], ["Part 6 · Requests & complaints", "0 of 3 done"], ["Part 7 · Sign off", "0 of 3 done"]] as const) {
      await expect(page.getByRole("cell", { name: new RegExp(`^${header.replace(/[&]/g, "&")}\\s*${done}$`) })).toBeVisible()
    }
  })

  test("LAW-13 due dates read 'dd Mon' (en-IN)", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(row(page, OWNER_CONFIRMS).getByText(ddMon(25), { exact: true })).toBeVisible() // due in 25 days (LIB.firm)
    await expect(row(page, MANAGER_CHECKS).getByText(ddMon(27), { exact: true })).toBeVisible()
    await expect(row(page, PARTNER_SIGNS).getByText(ddMon(30), { exact: true })).toBeVisible()
    await expect(row(page, CUSTOMER_DATA_ROW).getByText(ddMon(-6), { exact: true })).toBeVisible()
  })

  test("LAW-14 a late job carries an 'N days late' tag next to its date; a done job never does", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(row(page, CUSTOMER_DATA_ROW).getByText("6 days late", { exact: true })).toBeVisible()
    await expect(row(page, "Publish a privacy policy on the website").getByText("3 days late", { exact: true })).toBeVisible()
    await expect(row(page, "Group company signs a data-sharing agreement").getByText("1 days late", { exact: true })).toBeVisible()
    await expect(page.getByText(/\d+ days late/)).toHaveCount(3) // chip "Late 3"
    await expect(row(page, "Write down where the recordings are kept and for how long").getByText(/days late/)).toHaveCount(0) // done, due date in the past
  })

  test("LAW-15 a job that depends on another shows 'Waiting' (no button) until the step before it is done", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(row(page, MANAGER_CHECKS).getByText("Waiting", { exact: true })).toBeVisible()
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toBeVisible()
    await expect(page.getByText("Waiting", { exact: true })).toHaveCount(2)
    await expect(row(page, MANAGER_CHECKS).getByRole("button")).toHaveCount(0)
  })

  test("LAW-16 the chain runs owner → manager → partner: the owner's Yes frees the manager's step and no other", async ({ page }) => {
    await seed(page, "owner-live")
    await markYes(page, OWNER_CONFIRMS)
    await expect(row(page, MANAGER_CHECKS).getByText("Waiting", { exact: true })).toHaveCount(0)
    await expect(row(page, MANAGER_CHECKS).getByText("No", { exact: true })).toBeVisible() // open now, but the manager's, not the owner's
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toBeVisible() // still behind the manager
    await expect(page.getByText(`Said Yes to "${OWNER_CONFIRMS}"`)).toBeVisible()
  })

  test("LAW-17 ... then the manager checks, then the partner signs -- each step only after the one before", async ({ page }) => {
    test.slow() // three real sign-ins, each with the mock's 1.5 s inbox wait
    await seed(page, "owner-live")
    await markYes(page, OWNER_CONFIRMS)
    await signOut(page)

    await signIn(page, "manager@example.test")
    await gotIt(page)
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toBeVisible()
    await markYes(page, MANAGER_CHECKS)
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toHaveCount(0)
    await signOut(page)

    await signIn(page, "partner@example.test")
    await partnerThreeSteps(page)
    await markYes(page, PARTNER_SIGNS)
    await expect(page.getByText("Waiting", { exact: true })).toHaveCount(0)
    await expect(page.getByText(`Said Yes to "${PARTNER_SIGNS}"`)).toBeVisible()
    await expect(page.getByText(`Said Yes to "${MANAGER_CHECKS}"`)).toBeVisible()
    await expect(page.getByText(`Said Yes to "${OWNER_CONFIRMS}"`)).toBeVisible()
  })

  test("LAW-18 'grey — doesn't apply' is struck through with no person; 'nobody' is the amber tag on an unassigned job", async ({ page }) => {
    await seed(page, "owner-live")
    const payroll = row(page, "Payroll firm signs the data agreement")
    await expect(payroll.getByText("Doesn't apply", { exact: true })).toBeVisible()
    await expect(page.getByText("Payroll firm signs the data agreement", { exact: true })).toHaveCSS("text-decoration-line", "line-through")
    await expect(payroll.getByText("—", { exact: true })).toHaveCount(1) // the person cell; the data set / types cells are filled
    const nobody = row(page, "Group company signs a data-sharing agreement")
    await expect(nobody.getByText("nobody", { exact: true })).toBeVisible()
    await expect(page.getByText("nobody", { exact: true })).toHaveCount(1)
  })
})

// =====================================================================
// tfirst -- 28 checks on the first-visit flows
// =====================================================================
test.describe("tfirst -- first visits", () => {
  test("FIRST-01 owner, step 1: 'First, create the DPDP list' -- '31 jobs', one card per part with its job count", async ({ page }) => {
    await seed(page, "owner")
    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible()
    await expect(page.getByText("31 jobs", { exact: true })).toBeVisible()
    await expect(page.getByText("Create your list", { exact: true })).toBeVisible()
    await expect(page.getByText("Who looks after what", { exact: true })).toBeVisible()
    for (const card of ["Part 1Basics — 3 jobs", "Part 2Know your data — 7 jobs", "Part 3Tell people & take consent — 6 jobs", "Part 4Keep it safe — 5 jobs", "Part 5Firms you share data with — 4 jobs", "Part 6Requests & complaints — 3 jobs", "Part 7Sign off — 3 jobs"]) {
      await expect(page.getByText(card, { exact: true })).toBeVisible()
    }
  })

  test("FIRST-02 owner, step 1: 'Nothing is sent to anybody yet.' and '✓ Create the list' moves to step 2", async ({ page }) => {
    await seed(page, "owner")
    await expect(page.getByText("Nothing is sent to anybody yet.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Who looks after what?", exact: true })).toBeVisible()
    await expect(page.getByText("✓", { exact: true })).toBeVisible() // step 1's rail marker is now a tick
    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toHaveCount(0)
  })

  test("FIRST-03 owner, step 2: 'An email next to each' -- every area is a labelled field with its help line and 'N jobs: …'", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    for (const area of [GRIEVANCE_OFFICER, "DPDP coordinator", "Customer data", "Staff records", "Website firm", "CCTV", "Accounts", "All staff", "IT & computers", "Payroll firm", "Group company"]) {
      await expect(page.getByLabel(area, { exact: true })).toBeVisible()
    }
    await expect(page.getByText("answers complaints and looks after the privacy policy — in a small organisation, usually the owner", { exact: true })).toBeVisible()
    await expect(page.getByText("every employee — paste all their emails; each answers for their own laptop and phone", { exact: true })).toBeVisible()
    await expect(page.getByText("4 jobs: Write down where it is kept, why you need it, and who can open it · Give a privacy notice when you collect their data — on the form, invoice or website · Take consent before sending marketing messages — and make stopping as easy as starting — and 1 more", { exact: true })).toBeVisible()
    await expect(page.getByText("1 job: Write down how long each is kept — keep only what tax and labour law require, delete the rest", { exact: true })).toBeVisible()
  })

  test("FIRST-04 owner, step 2: the Grievance Officer and DPDP coordinator are prefilled with 'your email — change if someone else'", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await expect(page.getByLabel(GRIEVANCE_OFFICER, { exact: true })).toHaveValue(OWNER)
    await expect(page.getByLabel("DPDP coordinator", { exact: true })).toHaveValue(OWNER)
    await expect(page.getByText("your email — change if someone else", { exact: true })).toHaveCount(2)
    await expect(page.getByLabel("Customer data", { exact: true })).toHaveValue("")
    await expect(page.getByText("2 of 11 answered. Empty ones stay amber — that is fine.", { exact: true })).toBeVisible()
  })

  test("FIRST-05 owner, step 2: a person's area is one email box; the group ('All staff') is 'paste every email, separated by commas'", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await expect(page.getByLabel("Customer data", { exact: true })).toHaveAttribute("type", "email")
    await expect(page.getByLabel("Customer data", { exact: true })).toHaveAttribute("placeholder", "name@example.com")
    await expect(page.getByLabel("All staff", { exact: true })).toHaveAttribute("placeholder", "paste every email, separated by commas")
    await expect(page.getByLabel("All staff", { exact: true })).toHaveJSProperty("tagName", "TEXTAREA")
  })

  test("FIRST-06 owner, step 2: 'Don’t have one? Tick we don’t have this' -- only on the areas that can be, and it greys the box out", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    const dontHave = page.getByRole("checkbox", { name: "We don’t have this", exact: true })
    await expect(dontHave).toHaveCount(4) // Website firm, CCTV, Payroll firm, Group company -- in the wizard's own order
    await dontHave.nth(2).check() // Payroll firm
    await expect(page.getByLabel("Payroll firm", { exact: true })).toBeDisabled()
    await expect(page.getByLabel("Website firm", { exact: true })).toBeEnabled()
    await expect(page.getByText("3 of 11 answered. Empty ones stay amber — that is fine.", { exact: true })).toBeVisible()
  })

  test("FIRST-07 owner, step 2: 'These do not look like email addresses — fix them or clear the box' and nothing is saved", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await page.getByLabel("Customer data", { exact: true }).fill("notanemail")
    await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()
    await expect(page.getByText("These do not look like email addresses — fix them or clear the box: Customer data: notanemail", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Who looks after what?", exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toBeVisible() // still the owner's first visit
  })

  test("FIRST-08 owner, step 2: '✓ Save and send the first emails' names people, groups and doesn't-applies, records each, and the wizard never returns", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await page.getByLabel("Customer data", { exact: true }).fill("staff@example.test")
    await page.getByLabel("All staff", { exact: true }).fill("member@example.test, member2@example.test")
    await page.getByRole("checkbox", { name: "We don’t have this", exact: true }).nth(2).check() // Payroll firm
    await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Who looks after what?", exact: true })).toHaveCount(0)
    await expect(row(page, "Name the " + GRIEVANCE_OFFICER).getByText("YES", { exact: true })).toBeVisible() // naming the GO is itself the job
    await expect(row(page, CUSTOMER_DATA_ROW).getByText("staff@example.test")).toBeVisible()
    await expect(row(page, GROUP_JOB).getByText("All staff")).toBeVisible()
    await expect(row(page, "Payroll firm signs the data agreement").getByText("Doesn't apply", { exact: true })).toBeVisible()
    await expect(page.getByText(`Named ${OWNER} as ${GRIEVANCE_OFFICER}`, { exact: true })).toBeVisible()
    await expect(page.getByText("Named staff@example.test as Customer data", { exact: true })).toBeVisible()
    await expect(page.getByText('Named 2 people to "All staff"', { exact: true })).toBeVisible()
    await expect(page.getByText('Marked "Payroll firm" as not applicable', { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "First, here is your DPDP list", exact: true })).toHaveCount(0)
    await expect(row(page, CUSTOMER_DATA_ROW).getByText("staff@example.test")).toBeVisible()
  })

  test("FIRST-09 owner: 'Not sure? Leave it empty — it shows amber' -- 'N jobs have nobody looking after them' and 'Show me' lists exactly those", async ({ page }) => {
    await seed(page, "owner")
    await page.getByRole("button", { name: "✓ Create the list", exact: true }).click()
    await page.getByRole("button", { name: "✓ Save and send the first emails", exact: true }).click()
    // 31 jobs - the 2 the mock seeds as already done - the 3 chain steps
    // (owner / manager / partner) - the 4 more the prefilled Grievance
    // Officer + DPDP coordinator areas hand the owner = 22 (the "Mine 5"
    // chip is the owner's chain step plus those 4). Measured on the built
    // site, not derived: the first cut of this check assumed 25.
    await expect(page.getByText("22 jobs have nobody looking after them", { exact: true })).toBeVisible()
    await expect(page.getByText("Type an email into each amber row — or mark it “doesn’t apply” if it is not relevant to you.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Show me", exact: true }).click()
    await expect(chip(page, "Nobody named", 22)).toBeVisible()
    await expect(page.getByText("nobody", { exact: true })).toHaveCount(22)
    await expect(row(page, OWNER_CONFIRMS)).toHaveCount(0) // the owner's own job is not in the "nobody" view
  })

  test("FIRST-10 CA partner, step 1 of 3: 'Welcome' -- '{org} named you as their CA partner — you have N jobs of your own'", async ({ page }) => {
    await seed(page, "partner")
    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toBeVisible()
    await expect(page.getByText(`${ORG} named you as their CA partner — you have 1 job of your own here, and you sign the file once the CA manager has checked it.`, { exact: true })).toBeVisible()
    for (const step of ["This client", "Your clients", "How it works"]) await expect(page.getByText(step, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Next — my clients", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: NOT_ME, exact: true })).toBeVisible()
  })

  test("FIRST-11 CA partner, step 2 of 3: 'Your clients' -- every client that named you, and '+ Add a client' (optional)", async ({ page }) => {
    await seed(page, "partner")
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Your clients", exact: true })).toBeVisible()
    await expect(page.getByText("Mehta Traders", { exact: true })).toBeVisible()
    await expect(page.getByText("As CA partner · 4 of 31 done · In progress", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "+ Add a client", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Next — how it works", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Back", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toBeVisible()
  })

  test("FIRST-12 CA partner, step 3 of 3: 'How it works' -- the chain, then 'Got it' lands on the jobs page and is recorded once", async ({ page }) => {
    await seed(page, "partner")
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
    await expect(page.getByRole("heading", { name: "How it works", exact: true })).toBeVisible()
    await expect(page.getByText(/the owner confirms, the CA manager checks the proof, and you sign\. Your signing job stays “Waiting” until the step before it is done/)).toBeVisible()
    await gotIt(page)
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toBeVisible()
    await expect(page.getByText("partner@example.test saw their DPDP jobs for the first time", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toHaveCount(0)
  })

  test("FIRST-13 CA partner: '✗ This is not me' -- 'Yes, tell the owner' hands the jobs back and shows the waiting screen", async ({ page }) => {
    await seed(page, "partner")
    await page.getByRole("button", { name: NOT_ME, exact: true }).click()
    await page.getByRole("button", { name: "Yes, tell the owner", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: `We’ve told ${ORG}’s owner`, exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toHaveCount(0)
  })

  test("FIRST-14 owner, when the CA set it up: '{CA} has set this up for you' -- the list by part, who looks after what, nothing sent", async ({ page }) => {
    await seed(page, "client-owner")
    await expect(page.getByRole("heading", { name: "partner@example.test set this up for you", exact: true })).toBeVisible()
    await expect(page.getByText("31 jobs", { exact: true })).toBeVisible()
    await expect(page.getByText("Part 1Basics — 3 jobs", { exact: true })).toBeVisible()
    await expect(page.getByText("Part 7Sign off — 3 jobs", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Who looks after what", exact: true })).toBeVisible()
    await expect(page.getByText("go@example.test — 4 jobs", { exact: true })).toBeVisible()
    await expect(page.getByText("staff@example.test — 4 jobs", { exact: true })).toBeVisible()
    await expect(page.getByText("All staff — 1 job", { exact: true })).toBeVisible()
    await expect(page.getByText("1 job has nobody yet — that is fine for now.", { exact: true })).toBeVisible()
    await expect(page.getByText("Nothing is sent to anybody yet.", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Looks right — confirm", exact: true })).toBeVisible()
  })

  test("FIRST-15 owner, when the CA set it up: '✓ Looks right — confirm' is recorded and the review never returns", async ({ page }) => {
    await seed(page, "client-owner")
    await page.getByRole("button", { name: "Looks right — confirm", exact: true }).click()
    await expect(page.getByRole("heading", { name: "partner@example.test set this up for you", exact: true })).toHaveCount(0)
    await expect(page.getByText("Do this now", { exact: true })).toBeVisible()
    await expect(page.getByText("client-owner@example.test confirmed the list their CA set up", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "partner@example.test set this up for you", exact: true })).toHaveCount(0)
    await expect(page.getByText("Do this now", { exact: true })).toBeVisible()
  })

  test("FIRST-16 invited staff: '{org} named you … — you have N jobs', with 'Got it' and 'This is not me'", async ({ page }) => {
    await seed(page, "staff")
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to VERIDIAN", exact: true })).toBeVisible()
    await expect(page.getByText(`${ORG} named you as someone who looks after some of their DPDP jobs — you have 4 jobs of your own.`, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: WELCOME_GOT_IT, exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: NOT_ME, exact: true })).toBeVisible()
  })

  test("FIRST-17 invited Grievance Officer: '{org} named you as their Grievance Officer — you have N jobs'", async ({ page }) => {
    await seed(page, "go")
    await expect(page.getByText(`${ORG} named you as their Grievance Officer — you have 4 jobs of your own.`, { exact: true })).toBeVisible()
  })

  test("FIRST-18 invited DPDP coordinator: '{org} named you as their DPDP coordinator — you have N job'", async ({ page }) => {
    await seed(page, "coord")
    await expect(page.getByText(`${ORG} named you as their DPDP coordinator — you have 1 job of your own.`, { exact: true })).toBeVisible()
  })

  test("FIRST-19 invited CA manager: '{org} named you as their CA manager — you have N job'", async ({ page }) => {
    await seed(page, "manager")
    await expect(page.getByText(`${ORG} named you as their CA manager — you have 1 job of your own.`, { exact: true })).toBeVisible()
  })

  test("FIRST-20 invited group member ('Everyone'): the group's job counts as theirs -- 'you have 1 job of your own'", async ({ page }) => {
    await seed(page, "member")
    await expect(page.getByText(`${ORG} named you as someone who looks after some of their DPDP jobs — you have 1 job of your own.`, { exact: true })).toBeVisible()
  })

  test("FIRST-21 '✓ Got it — show me my page' lands on the page, is recorded, and the welcome never returns", async ({ page }) => {
    await seed(page, "go")
    await gotIt(page)
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(page.getByText("go@example.test saw their DPDP jobs for the first time", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "Welcome to VERIDIAN", exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
  })

  test("FIRST-22 '✗ This is not me / not my job': asked to confirm, 'Never mind' goes back, 'Yes, tell the owner' shows the waiting screen", async ({ page }) => {
    await seed(page, "staff")
    await page.getByRole("button", { name: NOT_ME, exact: true }).click()
    await expect(page.getByText("We’ll tell the owner this needs reassigning, and won’t show your name on these jobs as done.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Never mind", exact: true }).click()
    await expect(page.getByRole("button", { name: WELCOME_GOT_IT, exact: true })).toBeVisible()
    await page.getByRole("button", { name: NOT_ME, exact: true }).click()
    await page.getByRole("button", { name: "Yes, tell the owner", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: `We’ve told ${ORG}’s owner`, exact: true })).toBeVisible()
    await expect(page.getByText("You said these jobs weren’t yours. We’ve let the owner know it needs reassigning — nothing more to do here until they fix it.", { exact: true })).toBeVisible()
  })

  test("FIRST-23 after 'this is not me': the waiting screen stays, and the owner's History says who needs reassigning", async ({ page }) => {
    await seed(page, "staff")
    await page.getByRole("button", { name: NOT_ME, exact: true }).click()
    await page.getByRole("button", { name: "Yes, tell the owner", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: `We’ve told ${ORG}’s owner`, exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByRole("heading", { level: 1, name: `We’ve told ${ORG}’s owner`, exact: true })).toBeVisible({ timeout: 10_000 })
    await signOut(page)
    await signIn(page, OWNER)
    await expect(page.getByText("staff@example.test said this isn't them -- needs reassigning", { exact: true })).toBeVisible()
  })

  test("FIRST-24 parent: 'Hello from {org}' -- the notice first, then 'Yes' is recorded with today's date", async ({ page }) => {
    await page.goto("/p/#mock-parent")
    await expect(page.getByRole("heading", { level: 1, name: "What we hold about you", exact: true })).toBeVisible()
    await expect(page.getByText(`From ${ORG}.`, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Now tell us what you agree to →", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Now tell us what you agree to", exact: true })).toBeVisible()
    await expect(page.getByText("Press Yes or No. No is a perfectly good answer — either way, your answer is recorded with today’s date.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Yes, I agree", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()
    await expect(page.getByText("Your answer is recorded with today’s date.", { exact: true })).toBeVisible()
  })

  test("FIRST-25 parent: 'No' is a valid answer -- recorded the same way, and the link is then single use", async ({ page }) => {
    await page.goto("/p/#mock-parent")
    await page.getByRole("button", { name: "Now tell us what you agree to →", exact: true }).click()
    await page.getByRole("button", { name: "No, I do not agree", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()
    await expect(page.getByText(`This link has done its job. If you change your mind, ask ${ORG} for a fresh one.`, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "Saved, thank you", exact: true })).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
  })

  test("FIRST-26 parent: a link that is not valid or has expired is refused, and nothing has changed", async ({ page }) => {
    await page.goto("/p/#not-a-token")
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("This link is not valid or has expired")
    await expect(page.getByText("Nothing has changed. If you need a fresh link, ask the person who sent you this one.", { exact: true })).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
  })

  test("FIRST-27 'Check your email': the address, 'Send me a new link' says it was sent, 'Use a different email' goes back -- and nobody is signed in", async ({ page }) => {
    // The clock is frozen so the mock's inbox timer never fires: the
    // email click stays with the human (agent-by-role.spec.ts).
    await page.clock.install()
    await page.goto("/app/")
    await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
    await page.clock.pauseAt(Date.now() + 60_000)
    await page.getByLabel("Your email", { exact: true }).fill(OWNER)
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
    await expect(page.getByText(`We sent a sign-in link to ${OWNER}. Open it on this device and you’ll land straight on your page.`, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Send me a new link", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText("Sent — check your email again.")
    await expect(page.getByText("Signed in as")).toHaveCount(0)
    await page.getByRole("button", { name: "Use a different email", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
    await expect(page.getByLabel("Your email", { exact: true })).toHaveValue("")
  })

  test("FIRST-28 an expired link: 'That sign-in link has stopped working' -- one press sends a fresh one to the remembered address, and the URL is cleaned", async ({ page }) => {
    await page.clock.install()
    await page.goto("/app/?email=owner%40example.test#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
    await expect(page.getByRole("heading", { level: 1, name: "That sign-in link has stopped working", exact: true })).toBeVisible()
    await expect(page.getByText(`Sign-in links stop working after a day. Press the button and we’ll send you a fresh one to ${OWNER}.`, { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/app\/$/) // no error in the hash, no address in the query
    await page.clock.pauseAt(Date.now() + 60_000)
    await page.getByRole("button", { name: "Send me a new link", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
    await expect(page.getByText(OWNER, { exact: true })).toBeVisible()
    await expect(page.getByText("Signed in as")).toHaveCount(0)
  })
})

// =====================================================================
// troles2 -- 24 checks on what each role sees and can do
// =====================================================================
test.describe("troles2 -- roles", () => {
  test("ROLES-01 owner: the full page -- seal, 'Do this now', parts track, chips, every job (theirs and others'), History, AI link", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(page.getByText("5 of 30", { exact: true })).toBeVisible()
    await expect(page.getByText("Do this now", { exact: true })).toBeVisible()
    await expect(page.getByText("1 job has nobody looking after it", { exact: true })).toBeVisible()
    await expect(page.getByText("Emails sent so far", { exact: true })).toBeVisible()
    await expect(page.getByTitle(/^\d+ of \d+ done$/)).toHaveCount(7)
    await expect(chip(page, "All", 31)).toBeVisible()
    await expect(page.getByRole("row")).toHaveCount(1 + 7 + 31) // header, 7 part headers, 31 jobs
    await expect(row(page, "Mask Aadhaar copies — keep only the last 4 digits visible").getByText("hr@example.test")).toBeVisible() // someone else's job, visible
    await expect(page.getByText("🕘 History", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "🤖 AI Link", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible()
  })

  test("ROLES-02 owner: 'Mark Yes' on their own job -- the stamp, the History line, and it is still there after a reload", async ({ page }) => {
    await seed(page, "owner-live")
    await markYes(page, OWNER_CONFIRMS)
    await expect(page.getByText(`Said Yes to "${OWNER_CONFIRMS}"`, { exact: true })).toBeVisible()
    await expect(page.getByText("6 of 30", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, OWNER_CONFIRMS).getByText("YES", { exact: true })).toBeVisible()
    await expect(page.getByText("6 of 30", { exact: true })).toBeVisible()
  })

  test("ROLES-03 staff: 'Narrow table for staff' -- only the jobs that are theirs, no seal, no track, no chips, no History", async ({ page }) => {
    await seed(page, "staff")
    await gotIt(page)
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(page.getByRole("row")).toHaveCount(1 + 4) // header + their 4 jobs, no part headers
    for (const what of [CUSTOMER_DATA_ROW, "Give a privacy notice when you collect their data — on the form, invoice or website", "Take consent before sending marketing messages — and make stopping as easy as starting", "Delete a customer’s data when they ask or when it is no longer needed — and tell anyone you shared it with"]) {
      await expect(row(page, what)).toBeVisible()
    }
    await expect(page.getByText(/% done/)).toHaveCount(0)
    await expect(page.getByTitle(/^\d+ of \d+ done$/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^All\s*\d+$/ })).toHaveCount(0)
    await expect(page.getByRole("cell", { name: /^Part \d · / })).toHaveCount(0)
    await expect(page.getByText("🕘 History", { exact: true })).toHaveCount(0)
  })

  test("ROLES-04 staff: other people's jobs and a group they are not in are not on their page at all", async ({ page }) => {
    await seed(page, "staff")
    await gotIt(page)
    await expect(page.getByText("Mask Aadhaar copies — keep only the last 4 digits visible")).toHaveCount(0) // hr's
    await expect(page.getByText(OWNER_CONFIRMS)).toHaveCount(0) // the owner's
    await expect(page.getByText(GROUP_JOB)).toHaveCount(0) // "All staff" -- they are not a member
    await expect(page.getByText("hr@example.test")).toHaveCount(0)
  })

  test("ROLES-05 staff: 'You have N jobs to do' -- 'When a job is done, press the green button. That is all.' and 'Show me my jobs'", async ({ page }) => {
    await seed(page, "staff")
    await gotIt(page)
    await expect(page.getByText("You have 4 jobs to do", { exact: true })).toBeVisible()
    await expect(page.getByText("When a job is done, press the green button. That is all.", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Show me my jobs", exact: true })).toBeVisible()
  })

  test("ROLES-06 staff: pressing the green button on one job stamps it, drops the count, and survives a reload", async ({ page }) => {
    await seed(page, "staff")
    await gotIt(page)
    await markYes(page, "Give a privacy notice when you collect their data — on the form, invoice or website")
    await expect(page.getByText("You have 3 jobs to do", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, "Give a privacy notice when you collect their data — on the form, invoice or website").getByText("YES", { exact: true })).toBeVisible()
    await expect(page.getByText("You have 3 jobs to do", { exact: true })).toBeVisible()
  })

  test("ROLES-07 group member ('Everyone'): the group's job, with the three answers 'Done', 'Doesn't apply to me', 'I can't' and 'N of M answered'", async ({ page }) => {
    await seed(page, "member")
    await gotIt(page)
    await expect(page.getByRole("row")).toHaveCount(1 + 1) // header + the one group job
    const group = row(page, GROUP_JOB)
    await expect(group.getByText("All staff")).toBeVisible()
    await expect(group.getByRole("button", { name: "Done", exact: true })).toBeVisible()
    await expect(group.getByRole("button", { name: "Doesn't apply to me", exact: true })).toBeVisible()
    await expect(group.getByRole("button", { name: "I can't", exact: true })).toBeVisible()
    await expect(group.getByText("0 of 3 answered", { exact: true })).toBeVisible()
  })

  test("ROLES-08 group member: 'your answer is in' -- '1 of 3 have answered', the job stays open, and the answer survives a reload", async ({ page }) => {
    await seed(page, "member")
    await gotIt(page)
    await row(page, GROUP_JOB).getByRole("button", { name: "Done", exact: true }).click()
    await expect(row(page, GROUP_JOB).getByText("1 of 3 answered", { exact: true })).toBeVisible()
    await expect(row(page, GROUP_JOB).getByText("YES", { exact: true })).toHaveCount(0) // two more to answer
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, GROUP_JOB).getByText("1 of 3 answered", { exact: true })).toBeVisible()
  })

  test("ROLES-09 group roll-up: once everyone has answered the job closes, and the owner's History shows each answer as 'n of 3'", async ({ page }) => {
    test.slow() // three group members and the owner, each a real sign-in
    await seed(page, "member")
    await gotIt(page)
    await row(page, GROUP_JOB).getByRole("button", { name: "Done", exact: true }).click()
    await expect(row(page, GROUP_JOB).getByText("1 of 3 answered", { exact: true })).toBeVisible()
    await signOut(page)

    await signIn(page, "member2@example.test")
    await gotIt(page)
    await expect(row(page, GROUP_JOB).getByText("1 of 3 answered", { exact: true })).toBeVisible()
    await row(page, GROUP_JOB).getByRole("button", { name: "Doesn't apply to me", exact: true }).click()
    await expect(row(page, GROUP_JOB).getByText("2 of 3 answered", { exact: true })).toBeVisible()
    await signOut(page)

    await signIn(page, "member3@example.test")
    await gotIt(page)
    await row(page, GROUP_JOB).getByRole("button", { name: "I can't", exact: true }).click()
    await expect(row(page, GROUP_JOB).getByText("YES", { exact: true })).toBeVisible() // closed: everyone has answered
    await signOut(page)

    await signIn(page, OWNER)
    await expect(row(page, GROUP_JOB).getByText("YES", { exact: true })).toBeVisible()
    await expect(page.getByText(`member@example.test answered "Done" for "${GROUP_JOB}" (1 of 3)`, { exact: true })).toBeVisible()
    await expect(page.getByText(`member2@example.test answered "Doesn't apply to me" for "${GROUP_JOB}" (2 of 3)`, { exact: true })).toBeVisible()
    await expect(page.getByText(`member3@example.test answered "I can't" for "${GROUP_JOB}" (3 of 3)`, { exact: true })).toBeVisible()
    await expect(page.getByText("6 of 30", { exact: true })).toBeVisible()
  })

  test("ROLES-10 Grievance Officer: detected and addressed as one -- 'You have N jobs of your own' / 'As Grievance Officer', with the full page", async ({ page }) => {
    await seed(page, "go")
    await expect(page.getByText(`${ORG} named you as their Grievance Officer — you have 4 jobs of your own.`, { exact: true })).toBeVisible()
    await gotIt(page)
    await expect(page.getByText("You have 4 jobs of your own", { exact: true })).toBeVisible()
    await expect(page.getByText("As Grievance Officer. Press Mark Yes on each when it is done.", { exact: true })).toBeVisible()
    await expect(page.getByText("5 of 30", { exact: true })).toBeVisible() // the seal: a GO sees the whole list
    await expect(page.getByText("🕘 History", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark Yes", exact: true })).toHaveCount(4)
  })

  test("ROLES-11 DPDP coordinator: detected as the one who keeps it moving -- the org-wide 'nobody looking after' nudge, the full page, their own job", async ({ page }) => {
    await seed(page, "coord")
    await expect(page.getByText(`${ORG} named you as their DPDP coordinator — you have 1 job of your own.`, { exact: true })).toBeVisible()
    await gotIt(page)
    await expect(page.getByText("1 job has nobody looking after it", { exact: true })).toBeVisible()
    await expect(page.getByText("5 of 30", { exact: true })).toBeVisible()
    await expect(page.getByText("🕘 History", { exact: true })).toBeVisible()
    await expect(row(page, "Write down how long each is kept — keep only what tax and labour law require, delete the rest").getByRole("button", { name: "Mark Yes", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Mark Yes", exact: true })).toHaveCount(1)
  })

  test("ROLES-12 CA partner: 'My clients (N)' -> 'Your clients' -- Client / As 'CA partner' / Done / 'Where it is', and 'Open'", async ({ page }) => {
    await seed(page, "partner")
    await partnerThreeSteps(page)
    const myClients = page.getByRole("button", { name: "🧾 My clients (1)", exact: true })
    await expect(myClients).toBeVisible()
    await myClients.click()
    await expect(page.getByRole("heading", { level: 1, name: "My CA clients", exact: true })).toBeVisible()
    await expect(page.getByText("Every organisation that named you as their CA manager or CA partner.", { exact: true })).toBeVisible()
    for (const h of ["Client", "As", "Done", "Where it is"]) await expect(page.getByRole("columnheader", { name: h, exact: true })).toBeVisible()
    const mehta = row(page, /Mehta Traders/)
    await expect(mehta.getByText("CA partner", { exact: true })).toBeVisible()
    await expect(mehta.getByText("4 of 31 done (13%)", { exact: true })).toBeVisible()
    await expect(mehta.getByText("In progress", { exact: true })).toBeVisible()
    await expect(mehta.getByRole("button", { name: "Open Mehta Traders", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "← Back to my page", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(myClients).toBeVisible()
  })

  test("ROLES-13 CA manager: the same 'My clients (N)' entry, labelled 'CA manager'", async ({ page }) => {
    await seed(page, "manager")
    await gotIt(page)
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "My CA clients", exact: true })).toBeVisible()
    await expect(row(page, /Mehta Traders/).getByText("CA manager", { exact: true })).toBeVisible()
    await expect(page.getByText("CA partner", { exact: true })).toHaveCount(0)
  })

  test("ROLES-14 '+ Add a client': a name, what kind, and 'Set it up for them — name the owner now'; a bad owner address is refused; nothing emailed", async ({ page }) => {
    await seed(page, "partner")
    await partnerThreeSteps(page)
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await page.getByRole("button", { name: "+ Add a client", exact: true }).click()
    await expect(page.getByLabel("Client name", { exact: true })).toBeVisible()
    await expect(page.getByRole("radio", { name: "A company, NGO or firm", exact: true })).toBeChecked()
    await expect(page.getByRole("radio", { name: "A school", exact: true })).not.toBeChecked()
    await expect(page.getByLabel("Owner’s email", { exact: true })).toHaveCount(0)
    await page.getByRole("checkbox", { name: "Set it up for them — name the owner now", exact: true }).check()
    await expect(page.getByLabel("Owner’s email", { exact: true })).toBeVisible()
    await expect(page.getByText("They get the list you set up and a “looks right — confirm” screen on their first visit.", { exact: true })).toBeVisible()
    await expect(page.getByText("The whole DPDP list is opened for them at once. Nothing is emailed to anybody yet.", { exact: true })).toBeVisible()
    await page.getByLabel("Client name", { exact: true }).fill("Joshi Motors")
    await page.getByLabel("Owner’s email", { exact: true }).fill("not-an-address")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveText("That does not look like an email address — fix it or untick “Set it up for them”.")
    await expect(page.getByText("Joshi Motors")).toHaveCount(0) // not added
    await page.getByRole("button", { name: "Never mind", exact: true }).click()
    await expect(page.getByLabel("Client name", { exact: true })).toHaveCount(0)
  })

  test("ROLES-15 'Add a client': the new client appears with 'you set it up', 'Where it is', and the creation is in History", async ({ page }) => {
    await seed(page, "partner")
    await partnerThreeSteps(page)
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await page.getByRole("button", { name: "+ Add a client", exact: true }).click()
    await page.getByLabel("Client name", { exact: true }).fill("Joshi Motors")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    const joshi = row(page, /Joshi Motors/)
    await expect(joshi).toBeVisible()
    await expect(joshi.getByText("Company or firm · you set it up", { exact: true })).toBeVisible()
    await expect(joshi.getByText("0 of 31 done (0%)", { exact: true })).toBeVisible()
    // drizzle/0612: a client created WITHOUT naming an owner has nobody who
    // could confirm, so its stage reads "No owner named yet" (ACCEPTANCE-70.md
    // finding 2, fixed); "Waiting for the owner to confirm" is ROLES-16's
    // case, where an owner is named.
    await expect(joshi.getByText("No owner named yet", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "← Back to my page", exact: true }).click()
    await expect(page.getByRole("button", { name: "🧾 My clients (2)", exact: true })).toBeVisible()
    await expect(page.getByText('Organisation "Joshi Motors" created', { exact: true })).toBeVisible()
  })

  test("ROLES-16 'Set it up for them': the owner is named, the file 'Waiting for the owner to confirm', 'Named … as owner' in History", async ({ page }) => {
    await seed(page, "partner")
    await partnerThreeSteps(page)
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await page.getByRole("button", { name: "+ Add a client", exact: true }).click()
    await page.getByLabel("Client name", { exact: true }).fill("Verma Textiles")
    await page.getByRole("checkbox", { name: "Set it up for them — name the owner now", exact: true }).check()
    await page.getByLabel("Owner’s email", { exact: true }).fill("suresh@vermatex.example")
    await page.getByRole("button", { name: "Add a client", exact: true }).click()
    await expect(row(page, /Verma Textiles/).getByText("Waiting for the owner to confirm", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "← Back to my page", exact: true }).click()
    await expect(page.getByText("Named suresh@vermatex.example as owner", { exact: true })).toBeVisible()
    await expect(page.getByText('Organisation "Verma Textiles" created', { exact: true })).toBeVisible()
  })

  test("ROLES-17 'Open' a client: the client's own page, still as its CA partner, with 'My clients' still one press away", async ({ page }) => {
    await seed(page, "partner")
    await partnerThreeSteps(page)
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await page.getByRole("button", { name: "Open Mehta Traders", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Mehta Traders", exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toHaveCount(0)
    await expect(page.getByText("4 of 31", { exact: true })).toBeVisible()
    await expect(row(page, PARTNER_SIGNS).getByText("Waiting", { exact: true })).toBeVisible()
    await expect(page.getByText("Signed in as partner@example.test", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "🧾 My clients (1)", exact: true })).toBeVisible()
  })

  // WO-DPDP-013 §4 item 6: AiWorkLink.tsx replaces AiLinkButton.tsx --
  // "Copy link" now creates a Level 0 link with the data warning shown
  // first (e2e/ai-work-link.spec.ts covers the warning/levels/list/revoke/
  // undo screen in full); these two checks keep ROLES-18/19's original
  // claims re-verified against the new screen (see ACCEPTANCE-70.md).
  test("ROLES-18 'Copy link': the link is shown once, on this host's /ai/, with 'Copy', and is recorded", async ({ page }) => {
    await seed(page, "owner-live")
    await expect(page.getByRole("heading", { name: "🤖 AI work link", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Copy link", exact: true }).click()
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\/[A-Za-z0-9_-]+$/)).toBeVisible()
    await expect(page.getByRole("button", { name: "📋 Copy", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0)
    await expect(page.getByText(/^Level 0 · Read, analyse, report · expires /)).toBeVisible()
    await expect(page.getByText("Made an AI link", { exact: true })).toBeVisible()
  })

  test("ROLES-19 the AI link is never shown again after reload; a second link does not revoke the first (WO-013 §1.1)", async ({ page }) => {
    await seed(page, "owner-live")
    await page.getByRole("button", { name: "Copy link", exact: true }).click()
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\//)).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\//)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Copy link", exact: true }).click()
    await expect(page.getByText(/^https:\/\/app\.veridian-aios\.com\/ai\//)).toBeVisible()
    // Both links now exist, neither auto-revoked -- "Your AI links" lists two.
    await expect(page.getByRole("heading", { name: "Your AI links", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Revoke/ })).toHaveCount(2)
  })

  test("ROLES-20 '#draft=': 'An AI drafted something for you to confirm' -- shown in full, 'Nothing has changed yet', and 'Not now' changes nothing", async ({ page }) => {
    await page.goto("/app/?mock=owner-live#draft=mock-draft.mock-confirm")
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/app\/\?mock=owner-live$/) // the confirm token is cleared from the address bar
    await expect(page.getByText("Add a note to a job", { exact: true })).toBeVisible()
    await expect(page.getByText("Write down where it is kept, why you need it, and who can open it", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Checked with the billing team — the list is in the shared drive.", { exact: true })).toBeVisible()
    await expect(page.getByText("Nothing has changed yet. It only happens if you press Confirm — under your name, not the AI’s.", { exact: true })).toBeVisible()
    await expect(page.getByText(/drafted by AI, confirmed by/)).toHaveCount(0)
    await page.getByRole("button", { name: "Not now", exact: true }).click()
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toHaveCount(0)
    await expect(page.getByText(/drafted by AI, confirmed by/)).toHaveCount(0)
  })

  test("ROLES-21 '#draft=' -> 'Confirm': recorded as 'drafted by AI, confirmed by you', under the person's own name, and only once", async ({ page }) => {
    await page.goto("/app/?mock=owner-live#draft=mock-draft.mock-confirm")
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: "Confirm", exact: true }).click()
    await expect(page.getByRole("status")).toHaveText("Confirmed — History records “drafted by AI, confirmed by you”.")
    await expect(page.getByText(`drafted by AI, confirmed by ${OWNER} -- added a note to "Write down where it is kept, why you need it, and who can open it"`, { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await expect(page.getByRole("heading", { name: "🤖 An AI drafted something for you to confirm", exact: true })).toHaveCount(0)
    // The same draft link again: already confirmed, nothing to press.
    await page.goto("/app/#draft=mock-draft.mock-confirm")
    await expect(page.getByRole("status")).toHaveText("Confirmed — History records “drafted by AI, confirmed by you”.", { timeout: 10_000 })
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0)
    await expect(page.getByText(new RegExp(`drafted by AI, confirmed by ${OWNER.replace(".", "\\.")}`))).toHaveCount(1) // recorded once, not twice
  })

  test("ROLES-22 /act/: 'Opening this page has changed nothing.' -- the preview says what the button would record; pressing it records exactly that", async ({ page }) => {
    await seed(page, "owner-live")
    await page.goto("/act/#mock-done")
    await expect(page.getByRole("heading", { level: 1, name: ORG, exact: true })).toBeVisible()
    await expect(page.getByText(`Pressing the button below records “Done” for ${OWNER_CONFIRMS}.`, { exact: true })).toBeVisible()
    await expect(page.getByText("Opening this page has changed nothing.", { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, OWNER_CONFIRMS).getByRole("button", { name: "Mark Yes", exact: true })).toBeVisible() // still open
    await expect(page.getByText(`Said Yes to "${OWNER_CONFIRMS}"`)).toHaveCount(0)
    await page.goto("/act/#mock-done")
    await page.getByRole("button", { name: 'Yes — record "Done"', exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Recorded, thank you", exact: true })).toBeVisible()
    await expect(page.getByText(`“Done” is now recorded for ${OWNER_CONFIRMS}. You can close this page.`, { exact: true })).toBeVisible()
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(row(page, OWNER_CONFIRMS).getByText("YES", { exact: true })).toBeVisible()
    await expect(page.getByText(`Said Yes to "${OWNER_CONFIRMS}"`, { exact: true })).toBeVisible()
  })

  test("ROLES-23 /act/: a link works once; 'I can't' is recorded as stuck; a bad link is refused with no button", async ({ page }) => {
    await seed(page, "owner-live")
    await page.goto("/act/#mock-done")
    await page.getByRole("button", { name: 'Yes — record "Done"', exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Recorded, thank you", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("alert")).toHaveText("This link has already been used. Nothing has changed.")
    await page.goto("/act/#mock-cannot")
    await page.getByRole("button", { name: `Yes — record "I can't"`, exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Recorded, thank you", exact: true })).toBeVisible()
    await page.goto("/act/#not-a-token")
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
    await page.goto("/app/")
    await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Said they are stuck", { exact: true })).toBeVisible()
  })

  test("ROLES-24 /unsubscribe/: nothing until the button; then 'Stopped' for that address -- 'Statutory notices … will still come'", async ({ page }) => {
    await page.goto("/unsubscribe/#mock-unsub")
    await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly email?", exact: true })).toBeVisible()
    await expect(page.getByText("Opening this page has changed nothing.", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Stop the weekly email", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Stopped", exact: true })).toBeVisible()
    await expect(page.getByText(`The weekly email to ${OWNER} has been stopped. Statutory notices — the ones the law requires — will still come.`, { exact: true })).toBeVisible()
    await page.goto("/unsubscribe/")
    await expect(page.getByRole("heading", { level: 1, name: "This link can't be used", exact: true })).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
  })
})
