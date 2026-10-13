/// <reference types="bun-types" />
// The seller of VERIDIAN DPDP is IT SERVICES BY RAJAT AGARWAL (a sole proprietorship, not registered for GST).
// No file that ships with this app -- public pages, generated pages, llms text, the app's own source -- may name
// any other legal entity, a CIN or a GSTIN. This walks the whole app folder and fails with the file name.
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { loadFacts } from "./facts.mjs"

const APP = join(import.meta.dir, "..", "..")

// Anything that names the previous entity, its CIN or its GSTIN, in any case.
const OLD_ENTITY = /shobha\s*kamal|shobhakamal|U74999UP2017PTC098453|09AAZCS4477M1Z3|\bCIN\b[\s:]*[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}/i

// Not shipped (notes, drafts, specs, tests, build output, dependencies) -- the audit notes keep their history.
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "docs", "drafts", "spec", "e2e"])
const TEXT_EXT = /\.(html|txt|xml|json|ya?ml|mjs|js|ts|tsx|css|md|toml|webmanifest)$/i

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (TEXT_EXT.test(name) && !/\.test\.(ts|tsx|mjs)$/.test(name)) out.push(p)
  }
  return out
}

describe("the seller is IT SERVICES BY RAJAT AGARWAL and nothing else", () => {
  test("no shipped file names the old entity, its CIN or its GSTIN", () => {
    const files = walk(APP)
    expect(files.length).toBeGreaterThan(50)
    const offenders: string[] = []
    for (const f of files) if (OLD_ENTITY.test(readFileSync(f, "utf8"))) offenders.push(relative(APP, f))
    expect(offenders).toEqual([])
  })

  test("every public legal page names the seller", () => {
    for (const page of ["terms", "privacy", "refund", "shipping", "pricing", "contact", "disclaimer"]) {
      const html = readFileSync(join(APP, "public", page, "index.html"), "utf8")
      expect(html, page).toContain("IT SERVICES BY RAJAT AGARWAL")
      expect(html, page).not.toMatch(/GSTIN/)
    }
  })

  test("the legal pages say: software company, no physical products, everything digital over the internet", () => {
    for (const page of ["terms", "privacy", "disclaimer", "shipping", "pricing", "refund", "contact"]) {
      const text = readFileSync(join(APP, "public", page, "index.html"), "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
      expect(text, page).toMatch(/software company/i)
      expect(text, page).toMatch(/no physical products/i)
      expect(text, page).toMatch(/digital(ly)?/i)
    }
  })

  test("refund and shipping link the seller's policy page for this product", () => {
    const url = loadFacts().company.policies_url
    expect(url).toBe("https://itservices-rajat-agarwal.pages.dev/policies/veridian-dpdp/")
    for (const page of ["refund", "shipping"]) expect(readFileSync(join(APP, "public", page, "index.html"), "utf8"), page).toContain(`href="${url}"`)
  })

  test("the terms say the software, code and concepts are owned by Rajat Agarwal alone", () => {
    expect(readFileSync(join(APP, "public", "terms", "index.html"), "utf8")).toContain("The software, code and concepts of the Service are owned by Rajat Agarwal alone.")
  })

  test("no page says GST is added to a price", () => {
    for (const page of ["terms", "pricing", "refund", "shipping"]) {
      const text = readFileSync(join(APP, "public", page, "index.html"), "utf8")
      expect(text, page).not.toMatch(/exclusive of GST|GST extra|plus GST|\+ GST|GST invoice/i)
    }
    for (const f of ["src/components/Screens.tsx", "src/components/PaymentDue.tsx", "src/components/EarningsCalculator.tsx"]) {
      expect(readFileSync(join(APP, f), "utf8"), f).not.toMatch(/plus GST|\+ GST/)
    }
  })
})
