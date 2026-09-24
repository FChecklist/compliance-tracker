import { test, expect, type Locator, type Page } from "@playwright/test"

// WO-DPDP-012 §6, verbatim: "Semantic HTML: real <button>, <a>, <label>,
// <form>. Every control has a clear accessible name. Nothing works only on
// hover. An assistant can complete the public sign-up up to the email step
// -- the email click stays with the human. No CAPTCHA on public pages;
// rate-limit instead. Test with an automated browser driving the site by
// accessible names only (Playwright getByRole). If a step cannot be found by
// role and name, it is a bug."
//
// This file is that test. Every locator in it is getByRole / getByLabel /
// getByText with the control's exact accessible name -- no CSS selector, no
// test id, no XPath, nowhere. That restriction is the whole proof: an
// assistant driving a browser sees the accessibility tree and nothing else,
// so if this spec can reach a step, so can it; if this spec cannot, the site
// has a bug (the WO's own words), and the fix belongs in the HTML, never in
// this file's locators.
//
// Runs against the BUILT site (dist/, `vite preview` -- see
// playwright.config.ts) in mock mode (VITE_MOCK=1): no Supabase, no
// credentials, no email is ever sent. The public pages carry no script at
// all; /app/ is the React sign-in.

// The four surfaces an anonymous visitor can reach. The three public pages
// are in src/lib/public-surface.mjs (the one list of what is public);
// /app/ is private to crawlers but is where the sign-in lives, so it is the
// last step of the public journey and is audited the same way.
const PUBLIC_PAGES = [
  { path: "/", h1: "The DPDP Act asks every organisation for four things" },
  { path: "/dpdp-firm/", h1: "Your DPDP proof — not just your DPDP policy." },
  { path: "/dpdp-institution/", h1: "Your DPDP proof — not just a policy nobody reads." },
] as const

const SIGN_IN = { path: "/app/", h1: "VERIDIAN DPDP" } as const

const ALL_SURFACES = [...PUBLIC_PAGES, SIGN_IN] as const

// A fake address on the reserved .test TLD (RFC 2606): even outside mock
// mode nothing could ever be delivered to it.
const AGENT_EMAIL = "agent@example.test"

// Open a surface and wait until its own <h1> is on screen, so "the page is
// there" is itself asserted by role and name, not by a load event.
async function open(page: Page, surface: { path: string; h1: string }) {
  await page.goto(surface.path)
  await expect(page.getByRole("heading", { level: 1, name: surface.h1, exact: true })).toBeVisible()
}

// Every control of the kinds the WO names (real <button>, <a href>, <input>),
// as exposed to assistive technology. includeHidden decides whether an
// element hidden from the accessibility tree (display:none, aria-hidden)
// is returned too -- the hover check needs those, the name audit does not.
async function controls(page: Page, includeHidden: boolean): Promise<Array<{ kind: string; locator: Locator }>> {
  const out: Array<{ kind: string; locator: Locator }> = []
  for (const kind of ["button", "link", "textbox"] as const) {
    for (const locator of await page.getByRole(kind, { includeHidden }).all()) out.push({ kind, locator })
  }
  return out
}

test.describe("WO-DPDP-012 §6 -- an assistant can use the public site by accessible names alone", () => {
  // (a) + (b) + (c): the one journey, root chooser -> firm landing -> sign-in
  // up to the email step, and not one step further.
  test("root chooser -> firm landing -> sign-in, stopping at 'check your email'", async ({ page }) => {
    // (a) The root chooser offers two editions, each a real link with a
    // name that starts with its own label. The full name is the link's
    // whole text (title + one-line body), which is what an assistant
    // reads; \s+ between the two parts because the accessible-name
    // algorithm joins the block-level <b> and <span> with whitespace.
    await open(page, PUBLIC_PAGES[0])
    const forClients = page.getByRole("link", { name: /^I do this for clients\s+A CA, CS, audit or legal firm\. Your own file is free, always\.$/ })
    const forUs = page.getByRole("link", { name: /^I do this for us\s+A company, NGO or firm of our own\.$/ })
    await expect(forClients).toBeVisible()
    await expect(forUs).toBeVisible()
    await expect(page.getByRole("link", { name: "Running a school instead? →", exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: "Already have an account? Sign in", exact: true })).toBeVisible()
    await forClients.click()

    // (b) The firm landing: one h1 with the expected name, the primary
    // call-to-action reachable by role + name, nothing hover-only.
    await expect(page).toHaveURL(/\/dpdp-firm\/\?for=clients$/)
    const firm = PUBLIC_PAGES[1]
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1, name: firm.h1, exact: true })).toBeVisible()
    await expectPrimaryCallToAction(page)
    await expectNothingHoverOnly(page, firm.path)

    // (c) Sign-in. The landing's "Start free →" points at the Next.js
    // login host for now (dpdp-firm/index.html's own nav comment: "switch
    // to /app/ once [onboarding] is [on this static host]"), so the journey
    // goes to /app/ directly; when that link is switched, follow it here
    // instead of navigating.
    //
    // The clock is frozen for this step. In mock mode the fake client signs
    // the visitor in 1.5 s after the form is sent (src/lib/mock-client.ts:
    // "a real magic link is an inbox round trip") -- that timer stands in
    // for the human opening the email, which is exactly the step this test
    // must never take. Pausing the page's clock leaves the timer pending
    // forever, so what the spec sees is what an assistant would be left
    // with: the check-your-email screen, and a human to hand over to.
    // (Playwright's own actions and assertions run on a real clock.)
    await page.clock.install()
    await open(page, SIGN_IN)
    await page.clock.pauseAt(Date.now() + 60_000)

    await page.getByLabel("Your email", { exact: true }).fill(AGENT_EMAIL)
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click()

    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
    await expect(page.getByText(AGENT_EMAIL, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Send me a new link", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Use a different email", exact: true })).toBeVisible()

    // STOP. The email click stays with the human. The assistant is not
    // signed in and must not be: no page, no "Signed in as", no sign-out.
    await expect(page.getByText("Signed in as")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1, name: "Check your email", exact: true })).toBeVisible()
  })

  // (b) again for the other landing, and the chooser: one h1, the primary
  // call-to-action by role + name, nothing hover-only, on every public page.
  for (const surface of PUBLIC_PAGES) {
    test(`${surface.path}: one h1 with its name, primary call-to-action by role + name, nothing hover-only`, async ({ page }) => {
      await open(page, surface)
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
      if (surface.path === "/") {
        // The chooser's primary actions are the two edition links (tested
        // by full name in the journey above); here, that both exist by role.
        await expect(page.getByRole("link", { name: /^I do this for clients\b/ })).toBeVisible()
        await expect(page.getByRole("link", { name: /^I do this for us\b/ })).toBeVisible()
      } else {
        await expectPrimaryCallToAction(page)
      }
      await expectNothingHoverOnly(page, surface.path)
    })
  }

  // The sign-in screen too: the form's controls are all reachable without
  // hover, and the one text field has a real <label>.
  test(`${SIGN_IN.path}: sign-in form is a labelled field and a named button, nothing hover-only`, async ({ page }) => {
    await open(page, SIGN_IN)
    await expect(page.getByLabel("Your email", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Your email", { exact: true })).toBeEditable()
    await expect(page.getByRole("button", { name: "Email me a sign-in link", exact: true })).toBeEnabled()
    await expectNothingHoverOnly(page, SIGN_IN.path)
  })

  // (d) Negative guard: no CAPTCHA anywhere an anonymous visitor goes. The
  // WO's alternative is rate limiting, which lives server-side (Supabase
  // Auth's own OTP rate limit), not in this HTML.
  for (const surface of ALL_SURFACES) {
    test(`${surface.path}: no CAPTCHA`, async ({ page }) => {
      await open(page, surface)
      await expectNoCaptcha(page, surface.path)
    })
  }

  // (e) Accessible-name audit: every button, link and text field exposed
  // to assistive technology has a non-empty accessible name. The name is
  // computed by Playwright's own accessible-name algorithm (the same one
  // getByRole matches against), so "has a name here" and "can be found by
  // getByRole" are one fact. A failure names the element by its outerHTML.
  for (const surface of ALL_SURFACES) {
    test(`${surface.path}: every button, link and textbox has a non-empty accessible name`, async ({ page }) => {
      await open(page, surface)
      const found = await controls(page, false)
      expect(found.length, `${surface.path} exposes no button, link or textbox at all -- nothing for an assistant to drive`).toBeGreaterThan(0)
      for (const { kind, locator } of found) {
        const html = await locator.evaluate((el) => el.outerHTML)
        await expect(locator, `${kind} on ${surface.path} has no accessible name -- an assistant cannot find it by role and name (WO-DPDP-012 §6: that is a bug):\n${html}`).toHaveAccessibleName(/\S/)
      }
    })
  }
})

// The landings' primary call-to-action, by role + exact name. It appears
// more than once (nav, hero, closing section) -- every one must be a real,
// visible link.
async function expectPrimaryCallToAction(page: Page) {
  const cta = page.getByRole("link", { name: "Start free →", exact: true })
  const n = await cta.count()
  expect(n, 'no link named "Start free →" -- the primary call-to-action cannot be found by role + name').toBeGreaterThan(0)
  for (let i = 0; i < n; i++) await expect(cta.nth(i)).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible()
}

// "Nothing works only on hover": every <a> and <button> in the document --
// including any hidden from the accessibility tree, which is where a
// hover-revealed control would sit -- is visible with the pointer parked in
// the corner and nothing hovered.
async function expectNothingHoverOnly(page: Page, path: string) {
  await page.mouse.move(0, 0)
  const found = await controls(page, true)
  for (const { kind, locator } of found) {
    const html = await locator.evaluate((el) => el.outerHTML)
    await expect(locator, `${kind} on ${path} is not visible without hover:\n${html}`).toBeVisible()
  }
}

const CAPTCHA = /captcha|turnstile/i

// No CAPTCHA widget, script, frame or text. Frames are checked by URL
// (every CAPTCHA vendor renders in one); the document by its accessible
// names and by a whole-markup scan, which also catches a vendor <script>
// that has not rendered anything yet.
async function expectNoCaptcha(page: Page, path: string) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    expect(frame.url(), `${path} embeds a frame that looks like a CAPTCHA: ${frame.url()}`).not.toMatch(CAPTCHA)
  }
  await expect(page.getByText(CAPTCHA), `${path} shows CAPTCHA text`).toHaveCount(0)
  await expect(page.getByTitle(CAPTCHA), `${path} has an element titled like a CAPTCHA`).toHaveCount(0)
  await expect(page.getByLabel(CAPTCHA), `${path} has a control labelled like a CAPTCHA`).toHaveCount(0)
  await expect(page.getByRole("img", { name: CAPTCHA }), `${path} has a CAPTCHA image`).toHaveCount(0)
  const markup = await page.content()
  expect(markup, `${path}'s markup mentions a CAPTCHA (script, iframe or attribute)`).not.toMatch(CAPTCHA)
}
