/// <reference types="bun-types" />
// WO-DPDP-013 v2 §0 rule 4 / §2.1 / §2.2 and WO-DPDP-014 §1: the facts file
// is the one source of truth, and every Part 2 surface is generated from it.
// Three things are pinned here rather than trusted by inspection:
//   1. data/veridian-facts.yaml carries the owner's §2.2 wording verbatim,
//      is owner-approved, versioned, and exposes exactly the public fields
//      it says it does (nothing Part-1-only, nothing null, no sources);
//   2. the committed surfaces (about/, for-ai/, proof/, public/for-ai.md,
//      llms*.txt, facts.json, the three landings' generated blocks,
//      public/_headers) are byte-for-byte what scripts/
//      generate-public-facts.mjs produces from the facts file today, and
//      the generator is byte-stable across runs;
//   3. /proof/ is hidden while facts.proof.enabled is false: built, but not
//      a public page, not in the sitemap renderer's list.
// Built-ins + the same loader the scripts use. Runs under `bun test` inside
// dpdp-app (bunfig root = src).
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadFacts, loadProof, publicFacts, pageTitle, getPath } from "./facts.mjs"
import { FACTS, HIDDEN_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"
import { buildOutputs } from "../../scripts/generate-public-facts.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8").replace(/\r\n/g, "\n")

describe("data/veridian-facts.yaml: the one source of truth", () => {
  const facts = loadFacts()

  test("is version 1, owner-approved on 2026-09-22 by the owner's WO text", () => {
    expect(facts.version).toBe(1)
    expect(facts.owner_approved).toBe(true)
    expect(facts.approved_on).toBe("2026-09-22")
    expect(facts.approved_by).toContain("owner")
    expect(facts.approved_by).toContain("WO-DPDP-013 v2")
  })

  test("carries WO-DPDP-013 v2 §2.2 verbatim (the four paragraphs)", () => {
    expect(facts.one_line).toBe(
      "VERIDIAN is Indian software for running DPDP compliance, purpose-built for the Digital Personal Data Protection Act 2023 and DPDP Rules 2025, for CA, CS, audit and legal firms, their clients, and schools and institutions.",
    )
    expect(facts.what_it_does).toBe(
      "It turns the law into a list of jobs, gives each job to the responsible person, and coordinates every stakeholder — owners, staff, vendors, group companies — through one email a week, with no accounts or passwords. Each answer is recorded with a date and cannot be edited, building the proof an organisation needs. Every job is mapped to its legal source, including the SPDI Rules 2011 that apply until 13 May 2027.",
    )
    expect(facts.deadline_line).toBe("Every CA firm whose clients hold personal data will need to show DPDP compliance by 13 May 2027 — VERIDIAN is built for exactly that work.")
    expect(facts.what_it_does_not_do).toBe("It is not a law firm, does not certify (no DPDP certification exists in India), does not guarantee compliance, and never stores documents.")
    // The three strongest facts are the three sentences of the second paragraph, in order.
    expect(facts.three_strongest_facts.join(" ")).toBe(facts.what_it_does)
    expect(facts.who_for).toEqual(["CA, CS, audit and legal firms", "their clients", "schools and institutions"])
    expect(facts.one_line.endsWith(facts.who_for_line + ".")).toBe(true)
  })

  test("carries the one sentence /for-ai may say about the AI work link, and nothing about its API", () => {
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
    expect(facts.public_fields).not.toContain("about_this_system")
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

  test("public_fields is exactly the list WO-013 §2.1 allows into facts.json", () => {
    expect(facts.public_fields).toEqual([
      "version",
      "approved_on",
      "product",
      "site",
      "one_line",
      "who_for",
      "what_it_does",
      "three_strongest_facts",
      "deadline_line",
      "what_it_does_not_do",
      "brand_line",
      "key_dates.items",
      "library.version",
      "library.job_count",
      "library.reviewer",
      "library.reviewed_on",
      "storage.database.sentence",
      "storage.email.sentence",
      "storage.website.sentence",
      "company.legal_name",
      "company.cin",
      "company.registered_office",
      "contact.grievance_officer_email",
      "contact.partners_email",
      "ai_work_link_public_sentence",
    ])
  })

  test("publicFacts() carries those paths and nothing else -- no nulls, no sources, no Part 1 text, no share URL", () => {
    const pub = publicFacts(facts)
    const flat = JSON.stringify(pub)
    expect(flat).not.toContain("about_this_system")
    expect(flat).not.toContain("Rely on it")
    expect(flat).not.toContain('"source"')
    expect(flat).not.toContain("owner_approved")
    expect(flat).not.toContain("owner_required")
    expect(flat).not.toContain("gstin")
    expect(flat).not.toContain("share_url")
    expect(flat).not.toContain("null")
    for (const path of facts.public_fields) {
      const v = getPath(facts, path)
      if (v === null) expect(getPath(pub, path)).toBeUndefined()
      else expect(getPath(pub, path)).toEqual(v)
    }
    // Every leaf in the public view is reachable from a listed path.
    const leaves: string[] = []
    const walk = (o: unknown, p: string) => {
      if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k)
      else leaves.push(p)
    }
    walk(pub, "")
    for (const leaf of leaves) expect(facts.public_fields.some((f) => leaf === f || leaf.startsWith(f + ".")), `${leaf} is in facts.json but not in public_fields`).toBe(true)
    expect(pub.brand_line).toBe(facts.brand.full)
  })

  test("tab titles are '<prefix> — <page>' (WO-014 §4) and every public page has one", () => {
    expect(pageTitle(facts, "/")).toBe("VERIDIAN · VERy INDIAN — Digital Personal Data Protection Act Compliance")
    for (const p of PUBLIC_PAGES) expect(p.title).toBe(pageTitle(facts, p.path))
    expect(() => pageTitle(facts, "/nope/")).toThrow(/no pages entry/)
  })
})

describe("the generator (scripts/generate-public-facts.mjs)", () => {
  test("is byte-stable across two runs", () => {
    const a = buildOutputs().files
    const b = buildOutputs().files
    expect([...a.keys()]).toEqual([...b.keys()])
    for (const [k, v] of a) expect(b.get(k), k).toBe(v)
  })

  test("writes every public and hidden page plus the seven fact files, and nothing under private prefixes", () => {
    const files = [...buildOutputs().files.keys()]
    for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) expect(files).toContain(p.source)
    for (const f of ["public/for-ai.md", "public/llms.txt", "public/llms-full.txt", "public/facts.json", "public/_headers"]) expect(files).toContain(f)
    expect(files.some((f) => /^(app|act|unsubscribe|p|ai)\//.test(f))).toBe(false)
  })

  test("--check passes on the committed tree (the surfaces on disk are what the facts file says)", () => {
    const r = spawnSync(process.execPath, [join(APP, "scripts", "generate-public-facts.mjs"), "--check"], { cwd: APP, encoding: "utf8" })
    expect(r.stderr, r.stderr).toBe("")
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/OK -- \d+ surfaces match/)
  })

  test("public/facts.json on disk is exactly publicFacts()", () => {
    expect(JSON.parse(read("public/facts.json"))).toEqual(publicFacts(loadFacts()))
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
      for (const name of ["brand-line", "facts"]) {
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
