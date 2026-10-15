// DPDP completion gates (2026-10-15): every public page fits a phone from 320 to 430 px wide with no sideways scroll, has a language,
// one top heading, named images, links and buttons, and the installable-app files (manifest, icons, offline worker) are served.
// Runs against the built site in mock mode, like the other specs here. Locators are by role and name only.
import { expect, test } from "@playwright/test"
import { SITEMAP_PAGES } from "../src/lib/public-surface.mjs"

const WIDTHS = [320, 375, 430]
const PATHS: string[] = [...new Set<string>([...SITEMAP_PAGES.map((p: { path: string }) => p.path), "/contact/", "/subprocessors/", "/refund/", "/shipping/"])]

for (const width of WIDTHS) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })
    for (const path of PATHS) {
      test(`${path} has no sideways scroll`, async ({ page }) => {
        const res = await page.goto(path)
        expect(res?.status(), path).toBe(200)
        const over = await page.evaluate(() => {
          const w = document.documentElement.clientWidth
          const wide = [...document.querySelectorAll("body *")]
            .filter((el) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== "fixed" })
            .slice(0, 3).map((el) => el.tagName + "." + (el as HTMLElement).className)
          return { scroll: document.documentElement.scrollWidth - w, wide }
        })
        // A wide element inside its own scrolling box (a table wrapper) is fine; the page itself must not scroll sideways.
        expect(over.scroll, `${path} at ${width}px scrolls sideways by ${over.scroll}px (${over.wide.join(", ")})`).toBeLessThanOrEqual(1)
      })
    }
  })
}

test.describe("accessibility basics on every public page", () => {
  for (const path of PATHS) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path)
      expect(await page.locator("html").getAttribute("lang"), `${path} lang`).toBeTruthy()
      await expect(page.getByRole("heading", { level: 1 }), `${path} needs exactly one top heading`).toHaveCount(1)
      const bad = await page.evaluate(() => {
        const out: string[] = []
        for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) out.push("img without alt: " + img.getAttribute("src"))
        for (const el of document.querySelectorAll("a[href], button")) {
          const name = (el.textContent || "").trim() || el.getAttribute("aria-label") || el.getAttribute("title") || el.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt")
          if (!name) out.push("unnamed " + el.tagName + " " + (el.getAttribute("href") || ""))
        }
        for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=submit]), textarea, select")) {
          const id = el.getAttribute("id")
          const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") || (id && document.querySelector(`label[for="${id}"]`))
          if (!labelled) out.push("unlabelled field " + el.tagName + " " + (el.getAttribute("name") || ""))
        }
        return out
      })
      expect(bad, path).toEqual([])
    })
  }
})

test.describe("installable app (PWA)", () => {
  test("manifest, icons and offline worker are served", async ({ request }) => {
    const m = await request.get("/app/manifest.webmanifest")
    expect(m.status()).toBe(200)
    const manifest = await m.json()
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/app/")
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2)
    for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200)
    const sw = await request.get("/app/sw.js")
    expect(sw.status()).toBe(200)
    expect(sw.headers()["content-type"]).toMatch(/javascript/)
  })

  test("the app page links the manifest", async ({ page }) => {
    await page.goto("/app/")
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/)
  })
})
