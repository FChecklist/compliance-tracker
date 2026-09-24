import { test, expect, type Page } from "@playwright/test"
import { BRAND_LINE_FULL, BRAND_LINE_SHORT, PUBLIC_SITE, SHARE_ASK } from "../src/lib/brand"

// WO-DPDP-014 §3 "The share action -- must never share a private page",
// and §2/§3's look-and-roles rules, proven in a real browser against the
// BUILT site in mock mode (VITE_MOCK=1, dpdp-app/playwright.config.ts, the
// same rig as step5-by-role.spec.ts / acceptance-70.spec.ts). Locators are
// by accessible name; the one exception is getComputedStyle on the bar's
// own landmark, which is what "not pinned" means in a browser.
//
// The WO's own test, verbatim: "on every private page, press Share and
// confirm the shared text contains veridian-aios.com/ plus at most a
// referral code -- never a token, a # fragment, or a private path."
// navigator.share and navigator.clipboard.writeText are replaced before
// the app loads (page.addInitScript) with functions that only RECORD their
// arguments; every recorded string is then checked here. Two rigs per
// role: a phone-like one where navigator.share exists (the share sheet
// path), and a laptop-like one where it does not (the Copy link / WhatsApp
// / Email panel), so both code paths are inspected.
//
// The private pages (src/lib/public-surface.mjs PRIVATE_PAGES with an HTML
// entry): /app/, /act/, /unsubscribe/, /p/. (/ai/ is a Pages Function that
// proxies the Edge Function's text page and renders no React bar.)

const SHARE_URL = /^https:\/\/veridian-aios\.com\/(\?ref=[A-Za-z0-9]{4,16})?$/
const MOCK_CODE = "MOCK1234" // src/lib/mock-client.ts MOCK_REFERRAL_CODE

// Roles that see the share ask (WO-014 §3): owner/principal, CA partner,
// CA manager -- as the mock scenarios that sign each one in.
const DECISION_MAKERS: Array<{ scenario: string; role: string }> = [
  { scenario: "owner", role: "owner (first visit, wizard)" },
  { scenario: "owner-live", role: "owner (set-up org)" },
  { scenario: "client-owner", role: "owner whose CA set the org up (review screen)" },
  { scenario: "partner", role: "CA partner" },
  { scenario: "manager", role: "CA manager" },
]
// Roles that must NOT: coordinator, Grievance Officer, staff (incl. HR,
// vendor-ish "web@vendor.test" is a staff persona too), group members.
const NEVER: Array<{ scenario: string; role: string }> = [
  { scenario: "coord", role: "DPDP coordinator" },
  { scenario: "go", role: "Grievance Officer" },
  { scenario: "staff", role: "staff" },
  { scenario: "hr", role: "staff (HR)" },
  { scenario: "member", role: "group member" },
]
// The token pages: no session, no share ask, brand line present.
const TOKEN_PAGES: Array<{ url: string; heading: string }> = [
  { url: "/act/#mock-done", heading: "Sharma & Associates" },
  { url: "/unsubscribe/#mock-unsub", heading: "Stop the weekly email?" },
  { url: "/p/#mock-parent", heading: "What we hold about you" },
]

type Captured = { share: Array<{ title?: string; text?: string; url?: string }>; clipboard: string[] }

/** Stub the two exits before any app code runs; `withShareSheet` decides which rig. */
async function arm(page: Page, withShareSheet: boolean) {
  await page.addInitScript((withShareSheet: boolean) => {
    const w = window as unknown as { __captured: Captured }
    w.__captured = { share: [], clipboard: [] }
    if (withShareSheet) {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: { title?: string; text?: string; url?: string }) => { w.__captured.share.push({ ...data }) },
      })
    } else {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined })
    }
    const clip = { writeText: async (s: string) => { w.__captured.clipboard.push(String(s)) } }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clip })
  }, withShareSheet)
}

async function captured(page: Page): Promise<Captured> {
  return page.evaluate(() => (window as unknown as { __captured: Captured }).__captured)
}

// The mock mirrors dpdp.event into localStorage (mock-client.ts STORAGE_KEY);
// dpdp_record_share_press appends one share_press entry there, exactly as
// drizzle/0611 appends one row. History on the page is not re-read after a
// share (nothing on the page changed), so the store is where to look.
async function sharePressEvents(page: Page, orgId: string): Promise<Array<{ kind: string; summary: string; detail: string | null; actorLabel: string }>> {
  return page.evaluate((orgId) => {
    const raw = localStorage.getItem("dpdp-mock-state-v4")
    if (!raw) return []
    const state = JSON.parse(raw) as { orgs: Record<string, { history: Array<{ kind: string; summary: string; detail: string | null; actorLabel: string }> }> }
    return (state.orgs[orgId]?.history ?? []).filter((h) => h.kind === "share_press")
  }, orgId)
}

/** Exactly one press recorded, "<Role> pressed Share", and no email anywhere in it. */
async function assertPressRecorded(page: Page, orgId: string) {
  const events = await sharePressEvents(page, orgId)
  expect(events).toHaveLength(1)
  expect(events[0].summary).toMatch(/^(Owner|CA partner|CA manager) pressed Share$/)
  expect(JSON.stringify(events[0])).not.toContain("@")
}

async function seed(page: Page, scenario: string) {
  await page.goto(`/app/?mock=${scenario}`)
  await expect(page.getByText("Signed in as")).toBeVisible({ timeout: 10_000 })
}

const bar = (page: Page) => page.getByRole("region", { name: "VERIDIAN brand line", exact: true })
const shareButton = (page: Page) => page.getByRole("button", { name: SHARE_ASK, exact: true })

/** Every string that left through a share exit must be the public site alone, or carry nothing but a referral code. */
function assertClean(label: string, s: string) {
  expect(s, `${label}: contains a # fragment`).not.toContain("#")
  expect(s, `${label}: contains a private path`).not.toMatch(/\/app\b|\/act\b|\/ai\/|\/unsubscribe\b|\/p\/|\/draft\b/)
  expect(s, `${label}: contains a mock token`).not.toContain("mock-")
  expect(s, `${label}: contains a token-like string`).not.toMatch(/[A-Za-z0-9_-]{24,}/)
  expect(s, `${label}: mentions the app host`).not.toContain("app.veridian-aios.com")
  expect(s, `${label}: mentions localhost`).not.toMatch(/127\.0\.0\.1|localhost|4173/)
  // Any URL in it is the public site, possibly with the referral code.
  for (const m of s.matchAll(/https?:\/\/\S+/g)) expect(m[0], `${label}: URL`).toMatch(SHARE_URL)
}

/** The bar itself: the full line at desktop width, in flow, ~28 px, not pinned. */
async function assertBar(page: Page) {
  const region = bar(page)
  await expect(region).toBeVisible()
  await expect(region.getByText(BRAND_LINE_FULL, { exact: true })).toBeVisible()
  // The short line is in the DOM (from the same constants) but hidden at this width.
  await expect(region.getByText(BRAND_LINE_SHORT, { exact: true })).toBeHidden()
  const style = await region.evaluate((el) => {
    const s = getComputedStyle(el)
    // Walk up too: a fixed ancestor would pin the bar just the same.
    const chain: string[] = []
    for (let n: Element | null = el; n; n = n.parentElement) chain.push(getComputedStyle(n).position)
    return { position: s.position, chain, height: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top, fontSize: parseFloat(s.fontSize) }
  })
  expect(style.position).toBe("static")
  expect(style.chain.every((p) => p !== "fixed" && p !== "sticky")).toBe(true)
  expect(style.height).toBeGreaterThanOrEqual(28)
  expect(style.height).toBeLessThanOrEqual(56) // may wrap once when the share ask is on the bar
  expect(style.top).toBe(0) // the very top of the page
  expect(style.fontSize).toBeGreaterThanOrEqual(12)
}

test.describe("WO-DPDP-014 §2 -- the line: same words, same place, everyone", () => {
  test("the brand line is the first thing on /app/ signed out, and it scrolls away", async ({ page }) => {
    await page.goto("/app/")
    await expect(page.getByRole("heading", { level: 1, name: "VERIDIAN DPDP", exact: true })).toBeVisible()
    await assertBar(page)
    await expect(shareButton(page)).toHaveCount(0)
  })

  test("it scrolls away above the pinned section links on a long page", async ({ page }) => {
    await seed(page, "owner-live")
    await assertBar(page)
    await page.evaluate(() => window.scrollTo(0, 600))
    const top = await bar(page).evaluate((el) => el.getBoundingClientRect().top)
    expect(top).toBeLessThan(0)
  })

  test("under 480 px the short line shows and the full line is hidden", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await page.goto("/app/")
    const region = bar(page)
    await expect(region.getByText(BRAND_LINE_SHORT, { exact: true })).toBeVisible()
    await expect(region.getByText(BRAND_LINE_FULL, { exact: true })).toBeHidden()
  })

  for (const t of TOKEN_PAGES) {
    test(`${t.url.split("#")[0]}: brand line present, no share ask`, async ({ page }) => {
      await page.goto(t.url)
      await expect(page.getByRole("heading", { level: 1, name: t.heading, exact: true })).toBeVisible()
      await assertBar(page)
      await expect(shareButton(page)).toHaveCount(0)
      await expect(page.getByText("Share VERIDIAN")).toHaveCount(0)
    })
  }
})

test.describe("WO-DPDP-014 §3 -- who sees the share ask", () => {
  for (const r of NEVER) {
    test(`${r.role} (${r.scenario}): brand line yes, share ask absent`, async ({ page }) => {
      await seed(page, r.scenario)
      await assertBar(page)
      await expect(shareButton(page)).toHaveCount(0)
      await expect(page.getByText("Share VERIDIAN")).toHaveCount(0)
    })
  }
})

test.describe("WO-DPDP-014 §3 -- the private-page leak test", () => {
  for (const r of DECISION_MAKERS) {
    test(`${r.role} (${r.scenario}), share sheet: only ${PUBLIC_SITE}?ref=<code> leaves the browser`, async ({ page }) => {
      await arm(page, true)
      await seed(page, r.scenario)
      await assertBar(page)
      const button = shareButton(page)
      await expect(button).toBeVisible()
      await button.click()
      await expect.poll(async () => (await captured(page)).share.length, { timeout: 5_000 }).toBe(1)
      const c = await captured(page)
      const [payload] = c.share
      expect(payload.url).toMatch(SHARE_URL)
      expect(payload.url).toBe(`${PUBLIC_SITE}?ref=${MOCK_CODE}`)
      for (const [k, v] of Object.entries(payload)) assertClean(`share.${k}`, String(v))
      expect(c.clipboard).toEqual([])
      // No panel opened: the sheet took it.
      await expect(page.getByRole("dialog", { name: "Share VERIDIAN", exact: true })).toHaveCount(0)
      // The press was recorded, once, with no email in it (WO-014 §7).
      await assertPressRecorded(page, "org-mock")
    })

    test(`${r.role} (${r.scenario}), no share sheet: Copy link / WhatsApp / Email carry only the public site`, async ({ page }) => {
      await arm(page, false)
      await seed(page, r.scenario)
      await shareButton(page).click()
      const panel = page.getByRole("dialog", { name: "Share VERIDIAN", exact: true })
      await expect(panel).toBeVisible()
      await expect(panel.getByText(`${PUBLIC_SITE}?ref=${MOCK_CODE}`, { exact: true })).toBeVisible()

      await panel.getByRole("button", { name: "Copy link", exact: true }).click()
      await expect(panel.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
      const c = await captured(page)
      expect(c.share).toEqual([])
      expect(c.clipboard).toHaveLength(1)
      expect(c.clipboard[0]).toMatch(SHARE_URL)
      assertClean("clipboard", c.clipboard[0])

      const wa = await panel.getByRole("link", { name: "WhatsApp", exact: true }).getAttribute("href")
      expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/)
      const waText = decodeURIComponent(wa!.replace(/^https:\/\/wa\.me\/\?text=/, ""))
      expect(waText).toContain(BRAND_LINE_FULL)
      expect(waText).toContain(`${PUBLIC_SITE}?ref=${MOCK_CODE}`)
      assertClean("whatsapp", waText)

      const mail = await panel.getByRole("link", { name: "Email", exact: true }).getAttribute("href")
      expect(mail).toMatch(/^mailto:\?subject=/)
      const body = decodeURIComponent(mail!.replace(/^mailto:\?subject=[^&]*&body=/, ""))
      expect(body).toContain(`${PUBLIC_SITE}?ref=${MOCK_CODE}`)
      assertClean("email body", body)
      assertClean("email subject", decodeURIComponent(/subject=([^&]*)/.exec(mail!)![1]))

      await panel.getByRole("button", { name: "Close", exact: true }).click()
      await expect(panel).toHaveCount(0)
      await assertPressRecorded(page, "org-mock")
    })
  }

  test("a CA partner on a client's page shares the same public site, never the client's page", async ({ page }) => {
    await arm(page, true)
    await seed(page, "partner")
    await page.getByRole("button", { name: "Next — my clients", exact: true }).click()
    await page.getByRole("button", { name: "Next — how it works", exact: true }).click()
    await page.getByRole("button", { name: "Got it — show me my jobs", exact: true }).click()
    await page.getByRole("button", { name: "🧾 My clients (1)", exact: true }).click()
    await page.getByRole("button", { name: "Open Mehta Traders", exact: true }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Mehta Traders", exact: true })).toBeVisible()
    await shareButton(page).click()
    await expect.poll(async () => (await captured(page)).share.length).toBe(1)
    const [payload] = (await captured(page)).share
    expect(payload.url).toBe(`${PUBLIC_SITE}?ref=${MOCK_CODE}`)
    for (const [k, v] of Object.entries(payload)) assertClean(`share.${k}`, String(v))
    // Recorded against the CLIENT org (the page they were on), not the CA's own.
    await assertPressRecorded(page, "org-mehta")
    expect(await sharePressEvents(page, "org-mock")).toEqual([])
  })
})
