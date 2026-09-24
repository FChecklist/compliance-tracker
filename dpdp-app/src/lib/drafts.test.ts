/// <reference types="bun-types" />
// WO-DPDP-012 §5 drift guard for dpdp-app/drafts/ (same pattern as
// dpdp-public-surface.test.ts): the drafts are UNPUBLISHED legal content, so
// three things are pinned here rather than trusted by inspection --
//   1. the committed drafts are exactly what scripts/generate-job-pages.mjs
//      produces from data/dpdp-library-*.json (nothing hand-edited, nothing
//      stale when the library changes);
//   2. every draft honours the §4/§5 page contract (one <h1>, title,
//      canonical, Article + BreadcrumbList JSON-LD, the review placeholder,
//      the disclaimer, one link, no scripts, no fonts, no price, noindex
//      while unpublished, hreflang on the Hindi pages);
//   3. NOTHING under drafts/ has leaked into public/, sitemap.xml,
//      robots.txt, llms.txt or the Vite inputs -- published count must be 0
//      until the owner confirms lawyer review.
// Built-ins only: bun:test + node:fs/path/child_process. Runs under
// `bun test` inside dpdp-app (bunfig root = src) with no install.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { AREA_HELP, LAWS, PARTS } from "./dpdp-onepage/view-model"

const APP = resolve(import.meta.dir, "../..") // dpdp-app/
const DRAFTS = join(APP, "drafts")
const GENERATOR = join(APP, "scripts", "generate-job-pages.mjs")
const LIBRARY = JSON.parse(readFileSync(join(APP, "data", "dpdp-library-0.2-wo010.json"), "utf8")) as {
  version: string
  exportedAt: string
  templates: Array<{ key: string; product: string; law_codes: string[] | null }>
}

const REVIEW_PLACEHOLDER_EN = "Last reviewed by [REVIEWING LAWYER — not yet reviewed], [DATE — not yet reviewed]"
const REVIEW_PLACEHOLDER_HI = "अंतिम समीक्षा: [समीक्षक वकील — अभी समीक्षा नहीं हुई], [तारीख — अभी समीक्षा नहीं हुई]"
const DISCLAIMER_EN = "This page is general information, not legal advice. VERIDIAN is not a law firm."
const DISCLAIMER_HI = "यह पृष्ठ सामान्य जानकारी है, कानूनी सलाह नहीं। VERIDIAN कोई लॉ फ़र्म नहीं है।"
const TRACK_URL = "https://app.veridian-aios.com/"

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const rel = (p: string) => relative(DRAFTS, p).split("\\").join("/")
const allFiles = walk(DRAFTS)
const htmlFiles = allFiles.filter((p) => p.endsWith("index.html"))
const jobHtml = htmlFiles.filter((p) => /^jobs\/(firm|institution)\/[a-z]+-\d+\/index\.html$/.test(rel(p)))
const guideHtml = htmlFiles.filter((p) => /^guides\/[a-z0-9-]+\/index\.html$/.test(rel(p)))
const hiHtml = htmlFiles.filter((p) => rel(p).startsWith("hi/"))
const read = (p: string) => readFileSync(p, "utf8")

function jsonLd(html: string): unknown[] {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error("no JSON-LD block")
  const parsed = JSON.parse(m[1])
  return Array.isArray(parsed) ? parsed : [parsed]
}

describe("WO-DPDP-012 §5 drafts: generator output is what is committed", () => {
  test("`generate-job-pages.mjs --check` passes (drafts match the library + content modules exactly)", () => {
    const r = spawnSync("node", [GENERATOR, "--check"], { cwd: APP, encoding: "utf8" })
    expect(r.stderr ?? "").toBe("")
    expect(r.status).toBe(0)
  })

  test("the generator's LAWS / PARTS / AREA_HELP tables equal view-model.ts's own (no drift in the one page's normative strings)", () => {
    const r = spawnSync("node", [GENERATOR, "--print-tables"], { cwd: APP, encoding: "utf8" })
    expect(r.status).toBe(0)
    const tables = JSON.parse(r.stdout) as { LAWS: Record<string, { label: string; title: string }>; PARTS: Array<{ n: number; name: string }>; AREA_HELP: Record<string, string> }
    for (const k of Object.keys(LAWS)) {
      expect(tables.LAWS[k]?.label).toBe(LAWS[k].label)
      expect(tables.LAWS[k]?.title).toBe(LAWS[k].title)
    }
    expect(Object.keys(tables.LAWS).sort()).toEqual(Object.keys(LAWS).sort())
    expect(tables.PARTS.map((p) => [p.n, p.name])).toEqual(PARTS.map((p) => [p.n, p.name]))
    expect(tables.AREA_HELP).toEqual(AREA_HELP)
  })

  test("exactly 59 job drafts, one per library template, plus 7 guides and 7 Hindi drafts", () => {
    expect(LIBRARY.templates.length).toBe(59)
    expect(jobHtml.length).toBe(59)
    const keys = jobHtml.map((p) => rel(p).split("/")[2]).sort()
    expect(keys).toEqual(LIBRARY.templates.map((t) => t.key).sort())
    for (const t of LIBRARY.templates) expect(existsSync(join(DRAFTS, "jobs", t.product, t.key, "index.html"))).toBe(true)
    expect(guideHtml.length).toBe(7)
    expect(hiHtml.length).toBe(7)
    expect(htmlFiles.length).toBe(59 + 7 + 7)
  })

  test("every HTML draft has a Markdown twin (§3)", () => {
    for (const p of htmlFiles) {
      const md = p.replace(/index\.html$/, "index.md")
      expect(existsSync(md)).toBe(true)
      const body = read(md)
      expect(body).toContain("# ")
      expect(body).toContain(TRACK_URL)
    }
  })
})

describe("WO-DPDP-012 §4/§5 page contract on every draft", () => {
  test("head: lang, one <title>, meta description, canonical, Open Graph, noindex while unpublished", () => {
    for (const p of htmlFiles) {
      const html = read(p)
      const isHi = rel(p).startsWith("hi/")
      expect(html).toContain(isHi ? '<html lang="hi">' : '<html lang="en-IN">')
      expect((html.match(/<title>/g) ?? []).length).toBe(1)
      expect(html).toMatch(/<meta name="description" content="[^"]{20,}" \/>/)
      const canon = /<link rel="canonical" href="(https:\/\/app\.veridian-aios\.com\/[^"]+\/)" \/>/.exec(html)
      expect(canon).not.toBeNull()
      expect(html).toContain(`<meta property="og:url" content="${canon![1]}" />`)
      expect(html).toContain('<meta property="og:type" content="article" />')
      // Published count must be 0: a draft that leaks is still not indexed.
      expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
      expect(html).toContain("UNPUBLISHED DRAFT")
    }
  })

  test("job-page canonicals are flat /jobs/<key>/ (the key already carries the product)", () => {
    for (const p of jobHtml) {
      const key = rel(p).split("/")[2]
      expect(read(p)).toContain(`<link rel="canonical" href="https://app.veridian-aios.com/jobs/${key}/" />`)
    }
  })

  test("body: exactly one <h1>, headings in order, review placeholder, disclaimer, exactly one link", () => {
    for (const p of htmlFiles) {
      const html = read(p)
      const isHi = rel(p).startsWith("hi/")
      expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1)
      // <h1> precedes every <h2>; no <h3> jumps without an <h2>.
      const h1At = html.indexOf("<h1")
      const firstH2 = html.indexOf("<h2")
      expect(firstH2).toBeGreaterThan(h1At)
      expect(html).not.toContain("<h3")
      expect(html).toContain(isHi ? REVIEW_PLACEHOLDER_HI : REVIEW_PLACEHOLDER_EN)
      expect(html).toContain(isHi ? DISCLAIMER_HI : DISCLAIMER_EN)
      const anchors = html.match(/<a [^>]*href="[^"]*"/g) ?? []
      expect(anchors.length).toBe(1)
      expect(anchors[0]).toContain(`href="${TRACK_URL}"`)
    }
  })

  test("no scripts (JSON-LD is data), no font links, no stylesheet links, no price", () => {
    for (const p of htmlFiles) {
      const html = read(p)
      const scripts = html.match(/<script[^>]*>/g) ?? []
      expect(scripts).toEqual(['<script type="application/ld+json">'])
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/)
      expect(html).not.toContain("fonts.googleapis")
      expect(html).not.toContain("fonts.gstatic")
      expect(html).not.toContain("₹")
      expect(html.toLowerCase()).not.toContain("price")
      expect(html.toLowerCase()).not.toContain("per month")
    }
  })

  test("JSON-LD: parseable Article + BreadcrumbList, author VERIDIAN AI, dates, no reviewedBy until review exists", () => {
    for (const p of htmlFiles) {
      const html = read(p)
      const ld = jsonLd(html) as Array<Record<string, unknown>>
      const article = ld.find((x) => x["@type"] === "Article") as Record<string, unknown>
      const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList") as Record<string, unknown>
      expect(article).toBeDefined()
      expect(crumbs).toBeDefined()
      expect((article.author as { name: string }).name).toBe("VERIDIAN AI")
      expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(article.headline).toBeTruthy()
      expect("reviewedBy" in article).toBe(false)
      const items = crumbs.itemListElement as Array<{ position: number; item: string }>
      expect(items.length).toBeGreaterThanOrEqual(3)
      expect(items[0].item).toBe(TRACK_URL)
      expect(items[items.length - 1].item).toBe(/<link rel="canonical" href="([^"]+)"/.exec(html)![1])
      // No placeholder ever leaks into structured data an AI crawler reads.
      expect(JSON.stringify(ld)).not.toContain("[VERIFY")
      expect(JSON.stringify(ld)).not.toContain("not yet reviewed")
    }
  })

  test("job pages: dated from the library export, every law family on the page carries the one page's own in-force label", () => {
    const exported = LIBRARY.exportedAt.slice(0, 10)
    for (const t of LIBRARY.templates) {
      const html = read(join(DRAFTS, "jobs", t.product, t.key, "index.html"))
      expect(html).toContain(`"datePublished": "${exported}"`)
      const families = new Set((t.law_codes ?? []).map((c) => c[0]))
      for (const f of families) expect(html).toContain(LAWS[f].title)
      for (const f of Object.keys(LAWS)) if (!families.has(f)) expect(html).not.toContain(`<li>${LAWS[f].title}</li>`)
      if (families.has("s")) expect(html).toContain("in force TODAY, until 13 May 2027")
      if (families.has("d")) expect(html).toContain("in force from 13 May 2027")
      expect(html).toContain("<h2>The law, by section and rule</h2>")
      expect(html).toContain("<h2>What done looks like</h2>")
    }
  })

  test("guides: the seven WO §5 questions exist, answer-first, each with a law section", () => {
    const slugs = guideHtml.map((p) => rel(p).split("/")[1]).sort()
    expect(slugs).toEqual([
      "72-hour-leak-rule-and-90-day-request-rule",
      "dpdp-for-ca-firms-your-own-file-and-your-clients",
      "dpdp-for-schools-section-9-exemption",
      "grievance-officer-what-the-law-requires",
      "privacy-policy-spdi-rule-4-vs-dpdp-notice-section-5",
      "what-applies-today-spdi-rules-2011",
      "what-the-dpdp-act-asks",
    ])
    for (const p of guideHtml) {
      const html = read(p)
      expect(html).toMatch(/<p class="answer"><strong>/)
      expect(html).toMatch(/<h2>The law, by section and rule/)
      expect(html).toContain("<h2>In force today, or from 13 May 2027?</h2>")
    }
  })
})

describe("Hindi drafts: lang, reciprocal hreflang, machine-draft marking", () => {
  test("every Hindi file has lang=\"hi\", an hreflang pair, and its English counterpart exists", () => {
    expect(hiHtml.map(rel).sort()).toEqual([
      "hi/dpdp-firm/index.html",
      "hi/dpdp-institution/index.html",
      "hi/guides/dpdp-for-schools-section-9-exemption/index.html",
      "hi/guides/grievance-officer-what-the-law-requires/index.html",
      "hi/guides/privacy-policy-spdi-rule-4-vs-dpdp-notice-section-5/index.html",
      "hi/guides/what-applies-today-spdi-rules-2011/index.html",
      "hi/guides/what-the-dpdp-act-asks/index.html",
    ])
    for (const p of hiHtml) {
      const html = read(p)
      const path = rel(p).replace(/index\.html$/, "")
      expect(html).toContain('<html lang="hi">')
      expect(html).toContain("MACHINE DRAFT -- needs human review before publishing")
      expect(html).toContain(`<link rel="alternate" hreflang="hi" href="https://app.veridian-aios.com/${path}" />`)
      const en = /<link rel="alternate" hreflang="en-IN" href="https:\/\/app\.veridian-aios\.com\/([^"]+)" \/>/.exec(html)
      expect(en).not.toBeNull()
      expect(en![1]).toBe(path.replace(/^hi\//, ""))
      if (path.startsWith("hi/guides/")) {
        // The English guide draft exists and points back (reciprocal).
        const enHtml = read(join(DRAFTS, en![1], "index.html"))
        expect(enHtml).toContain(`<link rel="alternate" hreflang="hi" href="https://app.veridian-aios.com/${path}" />`)
      }
    }
  })

  test("Hindi guides translate exactly the first five English guides", () => {
    const hiSlugs = hiHtml.map(rel).filter((r) => r.startsWith("hi/guides/")).map((r) => r.split("/")[2])
    for (const s of hiSlugs) expect(existsSync(join(DRAFTS, "guides", s, "index.html"))).toBe(true)
    expect(hiSlugs.length).toBe(5)
  })
})

describe("published count is 0: nothing under drafts/ is reachable from the site", () => {
  const draftPaths = htmlFiles.map((p) => rel(p).replace(/index\.html$/, "")) // "jobs/firm/firm-01/" etc.

  test("no draft page exists under public/", () => {
    const pub = join(APP, "public")
    for (const d of draftPaths) {
      expect(existsSync(join(pub, d))).toBe(false)
      // Also the published (flat) layout for job pages.
      const m = /^jobs\/[a-z]+\/([a-z]+-\d+)\/$/.exec(d)
      if (m) expect(existsSync(join(pub, "jobs", m[1]))).toBe(false)
    }
    // And the whole tree, in case a copy landed under a different name.
    for (const f of walk(pub)) expect(read(f)).not.toContain("UNPUBLISHED DRAFT")
  })

  test("sitemap.xml, robots.txt, llms.txt, _headers (if they exist) do not mention /jobs/, /guides/ or /hi/", () => {
    for (const name of ["sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt", "_headers", "_redirects"]) {
      const f = join(APP, "public", name)
      if (!existsSync(f)) continue
      const body = read(f)
      for (const needle of ["/jobs/", "/guides/", "/hi/", "drafts/"]) expect(body).not.toContain(needle)
    }
  })

  test("drafts/ is not a Vite input: index.html, vite.config.ts and src/ never reference it", () => {
    for (const f of ["index.html", "vite.config.ts", "package.json", "wrangler.toml"]) {
      const p = join(APP, f)
      if (existsSync(p)) expect(read(p)).not.toContain("drafts/")
    }
    for (const f of walk(join(APP, "src"))) {
      if (f.endsWith("drafts.test.ts")) continue
      expect(read(f)).not.toMatch(/["'`]\.?\.?\/?drafts\//)
    }
    // .github deploy workflow (if present) publishes dist/ only.
    const deploy = join(APP, "..", ".github", "workflows", "dpdp-app-deploy.yml")
    if (existsSync(deploy)) expect(read(deploy)).not.toContain("drafts")
  })

  test("the generator is not part of the build", () => {
    const pkg = JSON.parse(read(join(APP, "package.json"))) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).not.toContain("generate-job-pages")
  })
})
