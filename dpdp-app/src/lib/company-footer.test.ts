/// <reference types="bun-types" />
// 2026-10-02 (coordinator): the company ownership line is the LAST thing in the footer of every public page,
// in the exact wording given, built only from facts.company (data/veridian-facts.yaml) so check-claims and
// the facts tests stay the one source. The legal pages (hand-kept HTML) carry the same line.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { companyFooterHtml, companyFooterParts } from "./facts.mjs"
import { COMPANY_FOOTER_COPY, FACTS, HIDDEN_PAGES, LEGAL_PAGES, PUBLIC_PAGES, SITEMAP_PAGES } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

const EXPECTED =
  "VERIDIAN, this website and its software are owned and operated by SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED. © 2026 SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED. All rights reserved."

describe("the company line", () => {
  test("reads exactly as the coordinator worded it, from the facts file", () => {
    expect(textOf(companyFooterHtml(FACTS))).toBe(EXPECTED)
    // The company name in the first sentence is the link; the CIN, GSTIN and registered office are NOT in this line.
    expect(companyFooterHtml(FACTS)).toContain('owned and operated by <a href="https://shobhakamalsolutions.pages.dev/" rel="noopener">SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED</a>.')
    expect(companyFooterHtml(FACTS)).not.toMatch(/CIN|GSTIN|Registered office|U74999|09AAZ|Indirapuram/)
    expect(COMPANY_FOOTER_COPY).toEqual(Object.values(companyFooterParts(FACTS)))
  })

  test("every public and hidden page carries it, as the last thing in the footer, after the legal links", () => {
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) {
      const html = read(p.source)
      const footer = /<footer\b[\s\S]*?<\/footer>/.exec(html)?.[0]
      expect(footer, p.source).toBeDefined()
      const lines = footer!.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("<!--"))
      expect(lines[lines.length - 1], p.source).toBe("</footer>")
      expect(lines[lines.length - 2], p.source).toBe(companyFooterHtml(FACTS))
      expect(lines.findIndex((l) => l.includes('href="/terms/"')), p.source).toBeLessThan(lines.indexOf(companyFooterHtml(FACTS)))
      expect(textOf(footer!), p.source).toContain(EXPECTED)
    }
  })

  test("the eight legal pages carry it at the end of their footer too, with the same text", () => {
    expect(LEGAL_PAGES.length).toBe(8)
    for (const p of LEGAL_PAGES) {
      const footer = /<footer\b[\s\S]*?<\/footer>/.exec(read(p.source))![0]
      expect(textOf(footer), p.source).toContain(EXPECTED)
      expect(footer.trimEnd().endsWith(companyFooterHtml(FACTS).replace('class="footer-company"', 'class="company"') + "</footer>"), p.source).toBe(true)
    }
  })

  test("the line is built from the facts file: the company name, the company website (the link) and the copyright year", () => {
    expect(FACTS.company.legal_name).toBe("SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED")
    expect(FACTS.company.cin).toBe("U74999UP2017PTC098453")
    expect(FACTS.company.gstin).toBe("09AAZCS4477M1Z3")
    expect(FACTS.company.website).toBe("shobhakamalsolutions.pages.dev")
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
    expect(html).toContain("Version 1.4 · Effective 5 October 2026")
    expect(html).toContain("Website measurement (public pages only)")
    expect(html).toContain("No cookie, no browser storage")
    expect(html).toContain("Do Not Track")
    expect(html).toContain("does not run on the signed-in application")
    expect(html).toContain("Records are kept for 90 days")
  })
})
