/// <reference types="bun-types" />
// 2026-10-14 (owner order 15): every public page carries the UNIFORM footer, the same text on every site of the group (data/uniform-footer.html, made by the shared footer
// generator, site key DPD). It names the seller (IT Services by Rajat Agarwal), links every legal page, lists the group's other sites and the Rs 1 test payment, and
// ends with the copyright. This file checks that every page's <footer> is exactly that text, that every link in it resolves to a real page of this site, and that the
// facts file (data/veridian-facts.yaml) still agrees with the seller line.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { uniformFooterHtml } from "./facts.mjs"
import { COMPANY_FOOTER_COPY, FACTS, HIDDEN_PAGES, LEGAL_PAGES, PUBLIC_PAGES, SITEMAP_PAGES } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&copy;/g, "\u00a9").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
const footerOf = (rel: string) => /<footer\b[\s\S]*?<\/footer>/.exec(read(rel))?.[0]

describe("the uniform footer", () => {
  test("is the checked-in text, one footer element, and names the seller and the copyright", () => {
    const f = uniformFooterHtml()
    expect(f.startsWith('<footer class="uf"')).toBe(true)
    expect(f.endsWith("</footer>")).toBe(true)
    expect(f.match(/<footer\b/g)).toHaveLength(1)
    const text = textOf(f)
    expect(text).toContain("A product of IT Services by Rajat Agarwal.")
    expect(text).toContain("\u00a9 2026 Rajat Agarwal. All rights reserved.")
    for (const s of COMPANY_FOOTER_COPY) expect(f, s).toContain(s)
    expect(text).toContain("GST is not charged")
    // nothing about a pending review or decision, and no retired company name
    expect(text).not.toMatch(/pending|awaiting|lawyer|legal review|shobha/i)
  })

  test("every public, hidden and legal page's <footer> is exactly that text", () => {
    const f = uniformFooterHtml()
    const pages = [...PUBLIC_PAGES, ...HIDDEN_PAGES, ...LEGAL_PAGES].map((p) => p.source).filter((s): s is string => typeof s === "string")
    const extra = ["public/404.html", "public/original/index.html", "partner/terms/index.html"]
    expect(pages.length).toBeGreaterThanOrEqual(15)
    for (const rel of [...new Set([...pages, ...extra])]) expect(footerOf(rel), rel).toBe(f)
  })

  test("it is the last thing in the page body (nothing, not even a script, after it but the closing tags)", () => {
    for (const p of LEGAL_PAGES) {
      const html = read(p.source)
      const after = html.slice(html.indexOf("</footer>") + "</footer>".length)
      expect(after.replace(/<script\b[^>]*><\/script>/g, "").replace(/<!--\/email_off-->/g, "").replace(/\s+/g, ""), p.source).toBe("</body></html>")
    }
  })

  test("every link in it that stays on this site is a real page (a built page, or a file that exists)", () => {
    const hrefs = [...uniformFooterHtml().matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    const local = hrefs.filter((h) => h.startsWith("/"))
    expect(local).toEqual(expect.arrayContaining(["/", "/pricing/", "/terms/", "/privacy/", "/subprocessors/", "/refund/", "/shipping/", "/disclaimer/", "/about/", "/contact/", "/partner/"]))
    for (const h of local) {
      const rel = h === "/" ? "index.html" : `${h.replace(/^\//, "")}index.html`
      expect(existsSync(join(root, rel)) || existsSync(join(root, "public", rel)), `${h} -> ${rel}`).toBe(true)
    }
    // the outside links are the group's own sites, the seller's Rs 1 test payment page, a mailto and a phone number
    for (const h of hrefs.filter((x) => !x.startsWith("/"))) expect(h, h).toMatch(/^(https:\/\/[a-z0-9.-]+\.(pages\.dev|veridian-aios\.com)(\/|$)|mailto:rajatsiroffice@gmail\.com$|tel:\+919650397480$)/)
  })

  test("the colours are bright and the text is readable: no dark background, every text/background pair is at least AA (4.5:1)", () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(uniformFooterHtml())![1]
    const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
    const bg = /\.uf\{background:(#[0-9A-Fa-f]{6})/.exec(css)![1]
    expect(lum(bg)).toBeGreaterThan(0.8)
    const pairs: Array<[string, string, string]> = [
      ["body text", /\.uf\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(css)![1], bg],
      ["headings", /\.uf h4\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(css)![1], bg],
      ["links", /\.uf a\{color:(#[0-9A-Fa-f]{6})/.exec(css)![1], bg],
      ["brand name", /\.uf \.ufb\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(css)![1], bg],
      ["small print", /\.uf \.ufl\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(css)![1], bg],
      ["payment button", /\.uf \.ufpay a\{background:#[0-9A-Fa-f]{6};color:(#[0-9A-Fa-f]{6})/.exec(css)![1], /\.uf \.ufpay a\{background:(#[0-9A-Fa-f]{6})/.exec(css)![1]],
    ]
    for (const [what, fg, back] of pairs) expect(ratio(fg, back), `${what} ${fg} on ${back}`).toBeGreaterThanOrEqual(4.5)
  })

  test("the seller line agrees with the facts file", () => {
    expect(FACTS.company.legal_name).toBe("IT SERVICES BY RAJAT AGARWAL")
    expect(FACTS.company.proprietor).toContain("Rajat Agarwal")
    expect("cin" in FACTS.company).toBe(false)
    expect("gstin" in FACTS.company).toBe(false)
    expect(FACTS.company.website).toBe("itservices-rajat-agarwal.pages.dev")
    expect(FACTS.company.copyright_year).toBe(2026)
  })
})

describe("legal pages: search and sharing basics", () => {
  test("each has a title <= 70 chars, a 60-200 char description, canonical = the apex URL, Open Graph + Twitter card, an icon", () => {
    for (const p of LEGAL_PAGES) {
      const html = read(p.source)
      const title = /<title>([^<]*)<\/title>/.exec(html)![1]!
      const description = /<meta name="description" content="([^"]*)">/.exec(html)![1]!
      expect(title.length, p.source).toBeLessThanOrEqual(70)
      expect(description.length, p.source).toBeGreaterThanOrEqual(60)
      expect(description.length, p.source).toBeLessThanOrEqual(200)
      expect(html, p.source).toContain(`<link rel="canonical" href="https://veridian-aios.com${p.path}">`)
      expect(html, p.source).toContain(`<meta property="og:url" content="https://veridian-aios.com${p.path}">`)
      expect(html, p.source).toContain('<meta property="og:image" content="https://veridian-aios.com/og-image.png">')
      expect(html, p.source).toContain('<meta name="twitter:card" content="summary_large_image">')
      expect(html, p.source).toContain('<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">')
      expect(html, p.source).not.toMatch(/<meta\s+name="robots"/i)
    }
  })

  test("all eight are in the sitemap list, after the public pages", () => {
    expect(SITEMAP_PAGES.slice(-8).map((p) => p.path)).toEqual(["/terms/", "/privacy/", "/disclaimer/", "/pricing/", "/refund/", "/shipping/", "/contact/", "/subprocessors/"])
  })

  test("the privacy notice says the public pages measure speed and errors, without cookies, and is dated", () => {
    const html = read("public/privacy/index.html")
    expect(html).toContain("Version 1.9 · Effective 14 October 2026")
    expect(html).toContain("Visit journey (public pages only)")
    expect(html).toContain("one random visitor-id cookie for a year")
    expect(html).toContain("gets no cookie and is only counted")
    expect(html).toContain("Kept for 365 days, then only anonymous totals remain")
    expect(html).toContain("Website measurement (public pages only)")
    expect(html).toContain("No cookie, no browser storage")
    expect(html).toContain("Do Not Track")
    expect(html).toContain("does not run on the signed-in application")
    expect(html).toContain("Records are kept for 90 days")
    // the audit-trail disclosure (owner spec 2026-10-06, item 7): what is logged, why, the retention, and what erasure does and does not remove
    expect(html).toContain("Audit log of activity in the application")
    expect(html).toContain("Rules 6 and 8(3)")
    expect(html).toContain("365 days, then deleted")
    expect(html).toContain("entries about you in the audit log")
    expect(html).toContain("We never e-mail the log itself")
  })
})
