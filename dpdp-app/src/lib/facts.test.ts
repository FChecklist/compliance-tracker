/// <reference types="bun-types" />
// WO-DPDP-013 v2 §0 rule 4 / §2.1 / §2.2 and WO-DPDP-014 §1: the facts file
// is the one source of truth, and every Part 2 surface is generated from it.
// Three things are pinned here rather than trusted by inspection:
//   1. data/veridian-facts.yaml carries the owner's §2.2 wording verbatim,
//      is owner-approved, versioned, and exposes exactly the public fields
//      it says it does (nothing Part-1-only, nothing null, no sources);
//   2. the committed surfaces (about/, proof/,
//      llms*.txt, the three landings' generated blocks,
//      public/_headers) are byte-for-byte what scripts/
//      generate-public-facts.mjs produces from the facts file today, and
//      the generator is byte-stable across runs;
//   3. /proof/ is hidden while facts.proof.enabled is false: built, but not
//      a public page, not in the sitemap renderer's list.
// Built-ins + the same loader the scripts use. Runs under `bun test` inside
// dpdp-app (bunfig root = src).
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { contactSentence, grievanceOfficerLine, loadFacts, loadProof, pageDescription, pageTitle, subjectTopicsClause } from "./facts.mjs"
import { FACTS, HIDDEN_PAGES, PUBLIC_ORIGIN, PUBLIC_PAGES } from "./public-surface.mjs"
import { buildOutputs } from "../../scripts/generate-public-facts.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8").replace(/\r\n/g, "\n")

describe("data/veridian-facts.yaml: the one source of truth", () => {
  const facts = loadFacts()

  test("is version 2, owner-approved on 2026-10-01 (the home-page block) on top of the owner's WO text", () => {
    expect(facts.version).toBe(2)
    expect(facts.owner_approved).toBe(true)
    expect(facts.approved_on).toBe("2026-10-01")
    expect(facts.approved_by).toContain("owner")
    expect(facts.approved_by).toContain("WO-DPDP-013 v2")
  })

  test("carries WO-DPDP-013 v2 §2.2 verbatim (the four paragraphs)", () => {
    // 2026-10-01 (owner): the first sentence names the app host; the audience adds companies and NGOs.
    expect(facts.one_line).toBe(
      "dpdp.veridian-aios.com is Indian software for running DPDP compliance, purpose-built for the Digital Personal Data Protection Act 2023 and DPDP Rules 2025, for CA, CS, audit and legal firms, their clients, and companies, institutions, schools and NGOs.",
    )
    expect(facts.fact_block_title).toBe("What VERIDIAN (VERy Indian) is")
    expect(facts.what_it_does).toBe(
      "It turns the law into a list of jobs, gives each job to the responsible person, and coordinates every stakeholder — owners, staff, vendors, group companies — through one email a week, with no accounts or passwords. Each answer is recorded with a date and cannot be edited, building the proof an organisation needs. Every job is mapped to its legal source, including the SPDI Rules 2011 that apply until 13 May 2027.",
    )
    expect(facts.deadline_line).toBe("Every CA firm whose clients hold personal data will need to show DPDP compliance by 13 May 2027 — VERIDIAN is built for exactly that work.")
    expect(facts.what_it_does_not_do).toBe("It is not a law firm, does not certify (no DPDP certification exists in India), does not guarantee compliance, and never stores documents.")
    // The three strongest facts are the three sentences of the second paragraph, in order.
    expect(facts.three_strongest_facts.join(" ")).toBe(facts.what_it_does)
    expect(facts.who_for).toEqual(["CA, CS, audit and legal firms", "their clients", "companies, institutions, schools and NGOs"])
    expect(facts.one_line.endsWith(facts.who_for_line + ".")).toBe(true)
  })

  test("carries the one sentence a public page may say about the AI work link, and nothing about its API", () => {
    expect(facts.ai_work_link_public_sentence).toBe("Users can give their own AI assistant a private, time-limited AI work link from inside VERIDIAN.")
    const yaml = read("data/veridian-facts.yaml")
    for (const leak of ["/ai/", "manual.md", "manual.json", "/context", "/jobs", "/law/", "/report/", "/history", "/actions", "/drafts", "functions/v1", "supabase.co", "#token", "?format="]) {
      expect(yaml, `facts file mentions ${leak}`).not.toContain(leak)
    }
  })

  test("§1.3-A (About this system) is present for Part 1 and is NOT a public field", () => {
    expect(facts.about_this_system).toHaveLength(5)
    expect(facts.about_this_system[0]).toStartWith("VERIDIAN is purpose-built for India's Digital Personal Data Protection Act 2023")
    expect(facts.about_this_system[3]).toStartWith("Rely on it.")
  })

  test("key dates: SPDI Rules 2011 until 13 May 2027; DPDP Act 2023 + Rules 2025 from 13 May 2027", () => {
    const items = facts.key_dates.items
    expect(items.every((d) => d.date === "2027-05-13")).toBe(true)
    expect(items.find((d) => d.label.startsWith("until"))?.what).toContain("SPDI Rules 2011")
    expect(items.find((d) => d.label.startsWith("from"))?.what).toContain("Digital Personal Data Protection Act 2023")
    expect(items.find((d) => d.label.startsWith("from"))?.what).toContain("DPDP Rules 2025")
  })

  test("the library block matches the library export it names; job_count is counted, never typed", () => {
    const lib = JSON.parse(read(`data/${facts.library.file}`)) as { version: string; templates: unknown[] }
    expect(facts.library.version).toBe(lib.version)
    expect(facts.library.job_count).toBe(lib.templates.length)
    // listed as a public field, never written as a value
    expect(read("data/veridian-facts.yaml")).not.toMatch(/^\s*job_count\s*:/m)
    // Not lawyer-reviewed yet: null + owner_required, so the pages say "not yet recorded".
    expect(facts.library.reviewer).toBeNull()
    expect(facts.library.reviewed_on).toBeNull()
    expect(facts.library.owner_required).toBe(true)
  })

  test('"Stored in India" is stated as verified: database Mumbai (Supabase, ap-south-1); email via Resend (US)', () => {
    expect(facts.storage.database.country).toBe("India")
    expect(facts.storage.database.city).toBe("Mumbai")
    expect(facts.storage.database.region).toBe("AWS ap-south-1")
    expect(facts.storage.database.sentence).toContain("Mumbai, India")
    expect(facts.storage.email.provider).toBe("Resend")
    expect(facts.storage.email.provider_country).toBe("United States")
    expect(facts.storage.email.sentence).toContain("US company")
    expect(facts.storage.stored_in_india_wording).toContain("Resend, a US company")
  })

  test("company: legal name + CIN + registered office from the published disclaimer; GSTIN null and owner_required", () => {
    expect(facts.company.legal_name).toBe("SHOBHA KAMAL SOLUTIONS PRIVATE LIMITED")
    expect(facts.company.cin).toBe("U74999UP2017PTC098453")
    expect(facts.company.registered_office).toContain("Ghaziabad")
    expect(facts.company.gstin).toBeNull()
    expect(facts.company.owner_required).toBe(true)
    expect(facts.company.source).toContain("src/app/disclaimer/page.tsx")
  })

  // Owner, 2026-10-01: /facts.json (and the public_fields list that fed it) is withdrawn.
  test("there is no public_fields list and no facts.json any more", () => {
    expect(facts).not.toHaveProperty("public_fields")
    expect(read("data/veridian-facts.yaml")).not.toMatch(/public_fields|facts\.json/)
    expect(existsSync(join(APP, "public", "facts.json"))).toBe(false)
  })

  test("tab titles are '<prefix> — <page>' (WO-014 §4) and every public page has one", () => {
    expect(pageTitle(facts, "/")).toBe("VERIDIAN · VERy INDIAN — DPDP Compliance Management Software for India")
    for (const p of PUBLIC_PAGES) expect(p.title).toBe(pageTitle(facts, p.path))
    expect(() => pageTitle(facts, "/nope/")).toThrow(/no pages entry/)
  })

  // SEO (2026-10-01): the titles and descriptions are what a search for these
  // phrases matches. Pinned so a later edit cannot quietly drop the keyword --
  // and so no superlative sneaks in (the claims register also scans them).
  test("SEO: each landing's title and description carry the words people search for, with no superlative and no price", () => {
    const title = (p: string) => pageTitle(facts, p).toLowerCase()
    const desc = (p: string) => pageDescription(facts, p).toLowerCase()
    expect(title("/")).toContain("dpdp compliance management software")
    expect(title("/")).toContain("india")
    expect(desc("/")).toContain("dpdp compliance management software for india")
    expect(title("/dpdp-firm/")).toContain("ca, cs, audit and legal firms")
    expect(desc("/dpdp-firm/")).toContain("ca, cs, audit and legal firms")
    expect(desc("/dpdp-firm/")).toContain("13 may 2027")
    expect(title("/dpdp-institution/")).toContain("companies, institutions, schools and ngos")
    expect(desc("/dpdp-institution/")).toContain("schools")
    expect(desc("/dpdp-institution/")).toContain("13 may 2027")
    expect(desc("/about/")).toContain("13 may 2027")
    expect(desc("/about/")).toContain("dpdp rules 2025")
    for (const p of PUBLIC_PAGES) {
      const text = `${pageTitle(facts, p.path)} ${pageDescription(facts, p.path)}`
      expect(text, p.path).not.toMatch(/\b(best|leading|fastest|only|number one|world[- ]class|guarantee[ds]?|certified|unmatched)\b|#1|100%/i)
      expect(text, p.path).not.toMatch(/₹|\brs\.?\s?\d|\bprice\b|\bfree\b/i)
      expect(pageDescription(facts, p.path).length, p.path).toBeGreaterThanOrEqual(60)
      expect(pageDescription(facts, p.path).length, p.path).toBeLessThanOrEqual(200)
    }
  })

  test("one public host: facts.site is the apex; the app host is never an address in the facts", () => {
    expect(facts.site).toBe("https://veridian-aios.com")
    expect(PUBLIC_ORIGIN).toBe(facts.site)
    expect(facts.company_site).toBe(`${facts.site}/`)
    // The owner-approved sentence names dpdp.veridian-aios.com as a plain word; no URL anywhere.
    expect(JSON.stringify(facts)).not.toContain("https://dpdp.veridian-aios.com")
    expect(JSON.stringify(facts)).not.toContain("app.veridian-aios.com")
  })
})

describe("the generator (scripts/generate-public-facts.mjs)", () => {
  test("is byte-stable across two runs", () => {
    const a = buildOutputs().files
    const b = buildOutputs().files
    expect([...a.keys()]).toEqual([...b.keys()])
    for (const [k, v] of a) expect(b.get(k), k).toBe(v)
  })

  test("writes every public and hidden page plus the fact files, and nothing under private prefixes or the withdrawn AI-only surfaces", () => {
    const files = [...buildOutputs().files.keys()]
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) expect(files).toContain(p.source)
    for (const f of ["public/llms.txt", "public/llms-full.txt", "public/_headers"]) expect(files).toContain(f)
    for (const gone of ["for-ai/index.html", "public/for-ai.md", "public/facts.json"]) expect(files, gone).not.toContain(gone)
    expect(files.some((f) => /^(app|act|unsubscribe|p|copy|ai)\//.test(f))).toBe(false)
  })

  test("--check passes on the committed tree (the surfaces on disk are what the facts file says)", () => {
    const r = spawnSync(process.execPath, [join(APP, "scripts", "generate-public-facts.mjs"), "--check"], { cwd: APP, encoding: "utf8" })
    expect(r.stderr, r.stderr).toBe("")
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/OK -- \d+ surfaces match/)
  })

  test("Part 1's §1.3-A text never reaches a Part 2 surface", () => {
    for (const [rel, body] of buildOutputs().files) {
      expect(body, rel).not.toContain("Rely on it")
      expect(body, rel).not.toContain("add a NOTE")
    }
  })

  test("every landing's generated blocks sit between their markers and the owner's copy around them is untouched", () => {
    for (const path of ["/", "/dpdp-firm/", "/dpdp-institution/"]) {
      const page = PUBLIC_PAGES.find((p) => p.path === path)!
      const html = read(page.source)
      for (const name of ["brand-line", "facts", "footer-links"]) {
        const i = html.indexOf(`<!-- BEGIN generated: ${name} -->`)
        const j = html.indexOf(`<!-- END generated: ${name} -->`)
        expect(i, `${page.source}: ${name} BEGIN`).toBeGreaterThan(-1)
        expect(j, `${page.source}: ${name} END`).toBeGreaterThan(i)
      }
      expect(html).toContain(`<h1`) // the owner's h1 is still the page's h1
      expect(html.match(/<h1\b/g)).toHaveLength(1)
    }
  })
})

describe("the single published address (owner decision, 2026-09-29): dpdp@veridian-aios.com and nothing else", () => {
  const facts = loadFacts()
  const ADDRESS = "dpdp@veridian-aios.com"
  const RETIRED = [/grievance@veridian-aios\.com/i, /partners@veridian-aios\.com/i]

  // Everything a visitor, a crawler or an assistant can be shown: the public
  // and hidden page sources, the llms files, and the Next.js edition
  // landing's footer (the same copy on veridian-aios.com/dpdp). The Hindi
  // landing drafts are unpublished and are checked in drafts.test.ts, the
  // one test file the "nothing in src/ references the drafts" wall exempts.
  const PUBLISHED = [
    ...[...PUBLIC_PAGES, ...HIDDEN_PAGES].map((p) => p.source),
    "public/llms.txt",
    "public/llms-full.txt",
    "../src/app/dpdp/_components/DpdpMarketingPage.tsx",
  ]

  test("contact block: one address, the four subject topics, the owner's approval date recorded, the two old fields gone", () => {
    expect(facts.contact.contact_email).toBe(ADDRESS)
    expect(facts.contact.subject_topics).toEqual(["Grievance", "Data request", "Sales", "Partner"])
    expect(facts.contact.address_approved_on).toBe("2026-09-29")
    expect(facts.contact).not.toHaveProperty("grievance_officer_email")
    expect(facts.contact).not.toHaveProperty("partners_email")
    // The block's wording is still not owner-signed-off word for word; the approval is of the ADDRESS.
    expect(facts.contact.owner_approved).toBe(false)
  })

  test("the sentence every surface carries is built from the facts file, in the owner's words", () => {
    expect(subjectTopicsClause(facts)).toBe("and put the topic in the subject: Grievance, Data request, Sales or Partner")
    expect(contactSentence(facts)).toBe(`Write to ${ADDRESS} and put the topic in the subject: Grievance, Data request, Sales or Partner`)
    expect(grievanceOfficerLine(facts)).toBe(`Grievance Officer: ${ADDRESS} (subject: Grievance)`)
  })

  test("no published surface names grievance@ or partners@ any more, and every one names dpdp@", () => {
    for (const rel of PUBLISHED) {
      const body = read(rel)
      for (const re of RETIRED) expect(body, `${rel} still names a retired address (${re})`).not.toMatch(re)
      // The root chooser and /proof/ carry the address in their JSON-LD Organization node.
      expect(body, `${rel} does not name ${ADDRESS}`).toContain(ADDRESS)
    }
  })

  test("the facts file itself never spells out a retired address (its comment names them without the domain)", () => {
    const yaml = read("data/veridian-facts.yaml")
    for (const re of RETIRED) expect(yaml).not.toMatch(re)
  })

  test("every page's JSON-LD Organization has one ContactPoint per topic, all at the single address, Grievance Officer first", () => {
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) {
      const source = p.source
      const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read(source))
      const graph = JSON.parse(m![1])["@graph"] as Array<{ "@type": string; contactPoint?: Array<{ contactType: string; email: string }> }>
      const org = graph.find((n) => n["@type"] === "Organization")!
      expect(org.contactPoint!.map((c) => c.contactType), source).toEqual(["Grievance Officer", "Data request", "Sales", "Partner"])
      for (const c of org.contactPoint!) expect(c.email, source).toBe(ADDRESS)
    }
  })

  test("the two hand-kept landing footers say what the generated footers say (same sentence, same Grievance Officer line)", () => {
    for (const path of ["/dpdp-firm/", "/dpdp-institution/"]) {
      const page = PUBLIC_PAGES.find((p) => p.path === path)!
      const html = read(page.source)
      expect(html, page.source).toContain(`Write to <b class="white">${ADDRESS}</b> ${subjectTopicsClause(facts)}`)
      expect(html, page.source).toContain(`Grievance Officer: <b class="white">${ADDRESS}</b> (subject: Grievance)`)
    }
    // ...and the generated footer on /about/ is the same two lines.
    const about = read("about/index.html")
    expect(about).toContain(`Write to <b class="white">${ADDRESS}</b> ${subjectTopicsClause(facts)}`)
    expect(about).toContain(`Grievance Officer: <b class="white">${ADDRESS}</b> (subject: Grievance)`)
  })

  test("the Next.js edition landing (veridian-aios.com/dpdp) carries the same footer copy as this app's landings", () => {
    const tsx = read("../src/app/dpdp/_components/DpdpMarketingPage.tsx")
    expect(tsx).toContain(`Write to <b className="text-white">${ADDRESS}</b> ${subjectTopicsClause(facts)}`)
    expect(tsx).toContain(`Grievance Officer: <b className="text-white">${ADDRESS}</b> (subject: Grievance)`)
  })
})

// Owner, 2026-10-01: the public pages must not publish how the site is made.
describe("no internal-process wording on any public surface", () => {
  const INTERNAL: Array<[string, RegExp]> = [
    ["a facts-file version or approval date", /facts version|approved by the owner|owner-approved|owner approved|facts file/i],
    ["the library version or reviewer", /version 0\.2|wo010|reviewer: not yet recorded|reviewed on: not yet recorded/i],
    ["a crawl-policy or llms.txt essay", /no major search engine|honesty note|plain note first/i],
    ["a how-to-describe-us instruction", /how to describe it accurately|for any ai system, crawler or agent/i],
    ["a withdrawn surface", /for-ai|facts\.json|fact sheet for ai/i],
  ]
  const surfaces = (): Array<[string, string]> => [
    ...PUBLIC_PAGES.map((p) => [p.source, read(p.source)] as [string, string]),
    ["public/llms.txt", read("public/llms.txt")],
    ["public/llms-full.txt", read("public/llms-full.txt")],
  ]

  test("the committed public pages and llms files carry none of it", () => {
    for (const [rel, body] of surfaces()) for (const [what, re] of INTERNAL) expect(body, `${rel}: ${what}`).not.toMatch(re)
  })

  // View-source is public too: no descriptive HTML comment (work-order numbers, file paths, "generated from ...") on a public or hidden page.
  // Only the BEGIN/END generated markers and the Cloudflare email_off markers may remain.
  const strayComments = (html: string) => (html.match(/<!--[\s\S]*?-->/g) ?? []).filter((c) => !/^<!--\s*(?:(?:BEGIN|END) generated: [a-z-]+|\/?email_off)\s*-->$/.test(c))

  test("public and hidden pages carry no descriptive HTML comment", () => {
    for (const p of [...PUBLIC_PAGES.map((x) => x.source), "proof/index.html"]) expect(strayComments(read(p)), p).toEqual([])
  })

  test("the comment check catches a planted one", () => {
    expect(strayComments("<p>x</p><!-- WO-DPDP-012 §1: generated from data/veridian-facts.yaml -->")).toHaveLength(1)
    expect(strayComments("<!-- BEGIN generated: facts --><!--email_off-->a<!--/email_off--><!-- END generated: facts -->")).toEqual([])
  })

  test("the checker catches each kind (a planted sentence is found)", () => {
    for (const [what, re] of INTERNAL) {
      const planted = { 0: "Facts version 2, approved by the owner on 2026-10-01.", 1: "Version 0.2-wo010: 50 jobs.", 2: "A plain note first: no major search engine has confirmed it.", 3: "How to describe it accurately", 4: "See /for-ai/ and /facts.json." }[INTERNAL.findIndex(([w]) => w === what)]!
      expect(planted, what).toMatch(re)
    }
  })

  test("the heading and copy of the fact block are the owner's, on every public page", () => {
    for (const p of PUBLIC_PAGES) {
      const html = read(p.source)
      expect(html, p.source).toContain('<h2 class="facts-title" id="facts-title">What VERIDIAN (VERy Indian) is</h2>')
      expect(html, p.source).toContain("<b>Who it is for:</b> CA, CS, audit and legal firms · their clients · companies, institutions, schools and NGOs")
      expect(html, p.source).toContain('<p class="facts-links"><a href="/about/">About VERIDIAN</a></p>')
    }
  })
})

describe("/proof/ (WO-013 §2.1): built and hidden until the owner switches it on", () => {
  test("is exactly one of: a public page, or a hidden page -- never both, never neither", () => {
    const isPublic = PUBLIC_PAGES.some((p) => p.path === "/proof/")
    const isHidden = HIDDEN_PAGES.some((p) => p.prefix === "/proof/")
    expect(Number(isPublic) + Number(isHidden)).toBe(1)
    expect(isPublic).toBe(FACTS.proof.enabled)
  })

  test("while hidden: noindex, no canonical, no Open Graph, X-Robots-Tag noindex in _headers", () => {
    if (FACTS.proof.enabled) return
    const html = read("proof/index.html")
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:url"')
    const headers = read("public/_headers")
    expect(headers).toMatch(/# BEGIN generated: proof\n[^\n]*\n\/proof\/\*\n {2}X-Robots-Tag: noindex, nofollow\n# END generated: proof/)
  })

  test("renders null figures as 'not yet published', never as a number", () => {
    const proof = loadProof()
    const html = read("proof/index.html")
    for (const a of proof.aggregates.items) {
      if (a.value === null) expect(html).toContain(`${a.label}: not yet published`)
    }
    expect(html).toContain("Reviewer: not yet recorded")
  })
})
