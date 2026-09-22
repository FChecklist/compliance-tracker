/// <reference types="bun-types" />
// WO-DPDP-014 §1: one brand line, exact wording, owner-approved 22 Sep 2026,
// never retyped. This is the spelling test: the build fails if any variant
// spelling of "VERy INDIAN" or any "Made in India" appears anywhere in the
// sources (dist/ is covered by scripts/check-two-doors.mjs), or if the line
// appears on a public surface in a wording that is not byte-identical to
// data/veridian-facts.yaml. The three strings below are the ONE place the
// owner's wording is repeated outside the facts file -- as the pin that the
// facts file has not drifted.
//
// spelling-scan: fixtures -- this file carries planted variants on purpose
// and is listed in scripts/check-two-doors.mjs SPELLING_SCAN_EXEMPT.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { FACTS, HIDDEN_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"
import { CORRECT_SPELLING, SPELLING_SCAN_EXEMPT, findBrandLineDeviations, findSpellingVariants, sourceFiles } from "../../scripts/check-two-doors.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")

const FULL = "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India."
const SHORT = "VERIDIAN · VERy INDIAN · For India, by India"
const SHARE_ASK = "Know a firm that needs this? Share VERIDIAN"

describe("the line in the facts file (WO-014 §1, verbatim)", () => {
  test("full, short and share ask are exactly the owner's wording", () => {
    expect(FACTS.brand.full).toBe(FULL)
    expect(FACTS.brand.short).toBe(SHORT)
    expect(FACTS.brand.share_ask).toBe(SHARE_ASK)
    expect(FACTS.brand.title_prefix).toBe("VERIDIAN · VERy INDIAN")
    expect(FACTS.brand_line).toBe(FULL)
  })

  test("the share ask links to the public website only, with no referral code", () => {
    expect(FACTS.brand.share_url).toBe("https://veridian-aios.com/")
  })
})

describe("findSpellingVariants()", () => {
  test("catches every variant and Made in India; passes the exact spelling", () => {
    for (const v of ["Very Indian", "VERY INDIAN", "Very INDIAN", "VERy Indian", "very indian", "VeryIndian", "Made in India", "made in india", "MADE IN INDIA", "Made  in India"]) {
      expect(findSpellingVariants(`text ${v} text`).length, v).toBe(1)
    }
    expect(findSpellingVariants(`VERIDIAN · ${CORRECT_SPELLING} · For India, by India`)).toEqual([])
    expect(CORRECT_SPELLING).toBe("VERy INDIAN")
  })
})

describe("findBrandLineDeviations()", () => {
  test("the exact full line, short line, wordmark and share ask pass", () => {
    expect(findBrandLineDeviations(`<p>${FULL}</p><p>${SHORT}</p><b>VERIDIAN · VERy INDIAN</b><a>${SHARE_ASK}</a>`, FACTS.brand)).toEqual([])
    expect(findBrandLineDeviations(`✦ VERIDIAN &nbsp;·&nbsp; <b>VERy INDIAN</b> &nbsp;·&nbsp; an independent, third-party DPDP compliance record`, FACTS.brand)).toEqual([])
  })

  test("a retyped line is caught: wrong case, missing comma, changed words, changed share ask", () => {
    for (const bad of [
      "VERIDIAN · very indian — Built for India's DPDP Act. For India, by India.",
      "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India by India.",
      "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India",
      "VERIDIAN · VERy INDIAN — Built for India's DPDP act. For India, by India.",
      "VERIDIAN · VERy INDIAN · for India, by India",
      "Built for India by VERIDIAN.",
      "Know a firm that needs this? Share Veridian",
      "Know a firm that needs this? Share VERIDIAN today",
    ]) {
      expect(findBrandLineDeviations(bad, FACTS.brand).length, bad).toBeGreaterThan(0)
    }
  })
})

describe("the committed sources", () => {
  test("no variant spelling anywhere under dpdp-app/ (spec/ and the rule-defining files excepted, each with a reason)", () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith("Seal.tsx"))).toBe(true) // the seal ring is scanned
    for (const [rel, why] of SPELLING_SCAN_EXEMPT) expect(why.length, rel).toBeGreaterThan(0)
    for (const f of files) {
      const v = findSpellingVariants(readFileSync(f, "utf8"))
      expect(v, `${relative(APP, f)}: ${v.map((x) => JSON.stringify(x.variant)).join(", ")}`).toEqual([])
    }
  })

  test("every public and hidden page carries the full AND short line byte-identically, at the very top, in normal flow", () => {
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) {
      const html = read(p.source)
      expect(html, p.source).toContain(`<span class="brand-line-full">${FULL}</span>`)
      expect(html, p.source).toContain(`<span class="brand-line-short">${SHORT}</span>`)
      const body = html.indexOf("<body")
      const line = html.indexOf('<div class="brand-line">')
      expect(line, `${p.source}: brand line is not the first thing in <body>`).toBeGreaterThan(body)
      expect(html.slice(body, line)).not.toMatch(/<(?!body|!--|\/?div class="brand)[a-z]/)
      expect(findBrandLineDeviations(html, FACTS.brand), p.source).toEqual([])
    }
    // Not pinned: the line scrolls away.
    const css = read("src/site.css")
    const rule = /\.brand-line\s*\{([^}]*)\}/.exec(css)![1]
    expect(rule).not.toMatch(/position\s*:\s*(fixed|sticky)/)
    expect(rule).toMatch(/min-height:\s*28px/)
    expect(rule).toMatch(/font-size:\s*12px/)
  })

  test("the share ask is on the pages for people and on none of the AI-facing surfaces (WO-014 §4)", () => {
    const withShare = ["index.html", "dpdp-firm/index.html", "dpdp-institution/index.html", "about/index.html", "proof/index.html"]
    for (const rel of withShare) expect(read(rel), rel).toContain(`<a class="brand-line-share" href="${FACTS.brand.share_url}">${SHARE_ASK}</a>`)
    for (const rel of ["for-ai/index.html", "public/for-ai.md", "public/llms.txt", "public/llms-full.txt", "public/facts.json"]) expect(read(rel), rel).not.toMatch(/share veridian/i)
  })

  test("the AI-facing fact surfaces carry the full line as a fact (WO-014 §4)", () => {
    for (const rel of ["for-ai/index.html", "public/for-ai.md", "public/llms.txt", "public/facts.json"]) expect(read(rel), rel).toContain(FULL)
    expect(JSON.parse(read("public/facts.json")).brand_line).toBe(FULL)
  })

  test("tab titles on public pages are 'VERIDIAN · VERy INDIAN — <page>'", () => {
    for (const p of PUBLIC_PAGES) {
      expect(p.title.startsWith("VERIDIAN · VERy INDIAN — ")).toBe(true)
      expect(read(p.source)).toContain(`<title>${p.title}</title>`)
    }
  })
})
