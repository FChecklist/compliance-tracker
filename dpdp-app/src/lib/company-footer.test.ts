/// <reference types="bun-types" />
// 2026-10-02: the seller ownership line is the LAST thing in the footer of every public page,
// in the exact wording, built only from facts.company (data/veridian-facts.yaml) so check-claims and
// the facts tests stay the one source. The legal pages (hand-kept HTML) carry the same line.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { companyFooterHtml, companyFooterParts } from "./facts.mjs"
import { COMPANY_FOOTER_COPY, FACTS, FAMILY_BLOCK, FAMILY_LINKS, HIDDEN_PAGES, LEGAL_PAGES, PAYTEST_URL, PUBLIC_PAGES, SITEMAP_PAGES } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

const EXPECTED =
  "VERIDIAN, this website and its software are owned and operated by IT SERVICES BY RAJAT AGARWAL. © 2026 IT SERVICES BY RAJAT AGARWAL. All rights reserved."

describe("the seller line", () => {
  test("reads exactly as the coordinator worded it, from the facts file", () => {
    expect(textOf(companyFooterHtml(FACTS))).toBe(EXPECTED)
    // The seller name in the first sentence is the link; no address, e-mail or phone is in this line.
    expect(companyFooterHtml(FACTS)).toContain('owned and operated by <a href="https://itservices-rajat-agarwal.pages.dev/" rel="noopener">IT SERVICES BY RAJAT AGARWAL</a>.')
    expect(companyFooterHtml(FACTS)).not.toMatch(/CIN|GSTIN|Registered office|Indirapuram|@|\+91/)
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

  test("the line is built from the facts file: the seller name, the seller website (the link) and the copyright year", () => {
    expect(FACTS.company.legal_name).toBe("IT SERVICES BY RAJAT AGARWAL")
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
    expect(html).toContain("Version 1.8 · Effective 6 October 2026")
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

// 2026-10-18 (owner order, family web-quality checks C07/C08/C14): every public footer is `<footer class="... uf">`, holds working Terms / Privacy / Refund / Contact links
// and ONE shared family block (the Rs 1 payment test + the other things we make), and still ends with the company line.
describe("the uniform footer (class uf) and the shared family block", () => {
  const trimLines = (h: string) => h.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
  const footerOf = (rel: string) => /<footer\b[\s\S]*?<\/footer>/.exec(read(rel))![0]
  const everyPage = [...PUBLIC_PAGES, ...HIDDEN_PAGES, ...LEGAL_PAGES]

  test("each public, hidden and legal page has exactly one <footer>, and it has class uf", () => {
    expect(everyPage.length).toBeGreaterThanOrEqual(15)
    for (const p of everyPage) {
      const html = read(p.source)
      expect(html.match(/<footer\b/g)?.length, p.source).toBe(1)
      expect(/<footer\b[^>]*\sclass="[^"]*\buf\b[^"]*"/.test(html), p.source).toBe(true)
    }
  })

  test("the family block is byte-identical on every page (apart from indentation) and equals the one function's output", () => {
    for (const p of everyPage) {
      const block = /<div class="uf-family">[\s\S]*?<\/ul>\s*<\/div>/.exec(footerOf(p.source))?.[0]
      expect(block, p.source).toBeDefined()
      expect(trimLines(block!), p.source).toBe(trimLines(FAMILY_BLOCK))
    }
  })

  test("the block says what the owner ordered: Payments, Razorpay, Test a payment (Rs 1) -> the pay-test page with ?from=DPD, and the eight 'More from us' links", () => {
    const text = textOf(FAMILY_BLOCK)
    expect(text).toContain("Payments Safe online payment through Razorpay.")
    expect(FAMILY_BLOCK).toContain(`<a class="uf-pay-link" href="https://itservices-rajat-agarwal.pages.dev/paytest/?from=DPD" rel="noopener">Test a payment (Rs 1)</a>`)
    expect(PAYTEST_URL).toBe("https://itservices-rajat-agarwal.pages.dev/paytest/?from=DPD")
    expect(FAMILY_LINKS).toEqual([
      ["All games", "https://corporate-games.pages.dev"],
      ["Tambola", "https://corporate-tambola.pages.dev"],
      ["Bingo", "https://corporate-bingo.pages.dev"],
      ["Tic Tac Toe", "https://corporate-tic-tac-toe.pages.dev"],
      ["Snakes and Ladders", "https://corporate-snakes-and-ladders.pages.dev"],
      ["Luck by Chance", "https://corporate-luck-by-chance.pages.dev"],
      ["Startup Coach", "https://rajat-agarwal-startup-coach.pages.dev"],
      ["IT Services by Rajat Agarwal", "https://itservices-rajat-agarwal.pages.dev"],
    ])
    expect(text).toContain("More from us")
    // the only seller named is IT Services by Rajat Agarwal; nothing internal or unfinished
    expect(FAMILY_BLOCK).not.toMatch(/shobha|kamal|pending|draft|TODO|lorem/i)
  })

  test("every footer links Terms, Privacy, Refund and Contact (each a page that exists), and the family block sits before the company line, which stays last", () => {
    for (const p of everyPage) {
      const footer = footerOf(p.source)
      for (const [word, href] of [["Terms", "/terms/"], ["Privacy", "/privacy/"], ["Refund", "/refund/"], ["Contact", "/contact/"]] as const) {
        expect(new RegExp(`<a href="${href}">[^<]*${word}[^<]*</a>`).test(footer), `${p.source} ${word}`).toBe(true)
        expect(existsSync(join(root, "public", href, "index.html")), href).toBe(true)
      }
      const lines = footer.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("<!--") && l !== "</footer>")
      expect(footer.trimEnd().endsWith("</footer>"), p.source).toBe(true)
      // the last line of content before </footer> (on its own line, or on the same line for the hand-kept legal pages) is the company line
      expect(lines[lines.length - 1]!.replace(/<\/footer>$/, ""), p.source).toContain("owned and operated by")
      expect(lines[lines.length - 1]!.replace(/<\/footer>$/, "").startsWith("<p"), p.source).toBe(true)
      expect(footer.indexOf("uf-family"), p.source).toBeLessThan(footer.indexOf("owned and operated by"))
      expect(footer.indexOf('href="/terms/"'), p.source).toBeLessThan(footer.indexOf("uf-family"))
    }
  })

  test("the footer TEXT is the same on the home page, both edition landings and every generated page (the family check compares them)", () => {
    const want = textOf(footerOf("index.html"))
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) expect(textOf(footerOf(p.source)), p.source).toBe(want)
  })

  test("the family block's CSS is the same in site.css (public pages) and legal.css (legal pages); text is >= 14px, links >= 40px, a light card", () => {
    const rules = (file: string) =>
      [...read(file).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?:footer\s+)?(\.uf-family[^{]*)\{([^}]*)\}/g)].map((m) => `${m[1]!.trim()}{${m[2]!.trim()}}`)
    const site = rules("src/site.css")
    const legal = rules("public/legal/legal.css")
    expect(site.length).toBeGreaterThanOrEqual(8)
    expect(legal).toEqual(site)
    const all = site.join("\n")
    expect(all).toMatch(/\.uf-family\{[^}]*background:#fffdf9/)
    for (const m of all.matchAll(/font-size:(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14)
    expect(all).toMatch(/\.uf-pay-link\{[^}]*min-height:44px/)
    expect(all).toMatch(/\.uf-links a\{[^}]*min-height:40px/)
  })
})
