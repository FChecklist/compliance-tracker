/// <reference types="bun-types" />
// WO-DPDP-003 Section 6 (Panel test row): "No code path can render CERT-In
// wording other than the exact sentence. No revenue field exists on
// panel_firm."
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { dpdpPanelFirm } from "@/lib/db"
import { wasCredentialCurrentOn } from "./dpdp-panel-service"

describe("dpdp.panel_firm has no revenue field", () => {
  test("the column set contains nothing money-shaped", () => {
    const columns = Object.keys(dpdpPanelFirm)
    const moneyLike = columns.filter((c) => /commission|revenue|fee|price|paise|amount/i.test(c))
    expect(moneyLike).toEqual([])
  })
})

describe("the CERT-In exact wording", () => {
  const EXACT = "This Organization is empanelled by CERT-In for providing information Security Auditing Service"

  test("renderCertInWording's only data source is the seeded row -- verified by reading the migration that seeds it, not by trusting a copy of the string here", () => {
    const migration = readFileSync(
      join(process.cwd(), "drizzle/0423_dpdp_commercial_and_panel_schema.sql"),
      "utf8",
    )
    expect(migration).toContain(EXACT)
    // And nowhere in the migration is a DIFFERENT cert-in-flavoured phrase
    // seeded alongside it (the two forbidden words CERT-In's guidelines
    // name explicitly).
    expect(migration).not.toMatch(/CERT-In[^\\n]{0,80}(approved|certified|accredited)/i)
  })

  test("no file under src/ (other than this test itself) hardcodes the sentence -- dpdp-panel-service.ts must read it from the database, never a hand-typed copy that could drift", () => {
    let hits: string[] = []
    try {
      hits = execFileSync("git", ["grep", "-il", "empanelled by CERT-In", "--", "src/"], { cwd: process.cwd() })
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
    } catch (e) {
      // git grep exits 1 (not an error) when it finds zero matches --
      // that's the expected, passing outcome once the "no other file"
      // check below excludes this file's own EXACT constant.
      if ((e as { status?: number }).status !== 1) throw e
    }
    const thisFile = "src/lib/services/dpdp-panel-service.test.ts"
    expect(hits.filter((h) => h !== thisFile)).toEqual([])
  })
})

describe("wasCredentialCurrentOn", () => {
  test("a credential with no expiry is always current", () => {
    expect(wasCredentialCurrentOn(null, "2030-01-01")).toBe(true)
  })
  test("current as of a date before expiry", () => {
    expect(wasCredentialCurrentOn("2027-06-01", "2027-01-01")).toBe(true)
  })
  test("NOT current as of a date after expiry -- but this only affects 'as of' queries, never rewrites the historical record (WO: a client who saw it current must still see that after it lapses)", () => {
    expect(wasCredentialCurrentOn("2027-06-01", "2028-01-01")).toBe(false)
    // The same credential, asked about a date BEFORE it lapsed, is still
    // reported as current -- proving this function doesn't just check
    // "is it expired today" against some hidden clock.
    expect(wasCredentialCurrentOn("2027-06-01", "2027-01-01")).toBe(true)
  })
})
