/// <reference types="bun-types" />
// WO-DPDP-013 v2 §0 rule 3, the banned-word test, against fixtures AND the
// committed sources: "a build test fails on any banned word outside an
// approved claim." scripts/check-claims.mjs runs the same functions on
// dist/ inside `bun run build`; this file proves the verdict logic (each
// banned word caught; an approved claim passes only with legal_approved;
// a fact exception passes; "Made in India" never passes) and that today's
// sources carry 0 violations.
//
// spelling-scan: fixtures -- this file names banned spellings on purpose and
// is listed in scripts/check-two-doors.mjs SPELLING_SCAN_EXEMPT.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadClaims } from "./facts.mjs"
import type { ClaimsRegister } from "./facts.mjs"
import { HIDDEN_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"
import { bannedWordRegex, fileTexts, findViolations, htmlTexts, normalise, splitSentences, surfaceFiles } from "../../scripts/check-claims.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")

const register = loadClaims()

describe("data/claims-register.yaml", () => {
  test("bans every word the work order names, plus Made in India (WO-014 §1)", () => {
    for (const w of ["best", "only", "world class", "world-class", "guarantee", "guarantees", "guaranteed", "certified", "certification", "#1", "leading", "unmatched", "fastest", "100%", "Made in India"]) {
      expect(register.banned_words).toContain(w)
    }
  })

  test("every fact exception really contains the banned word(s) it declares, and no other banned word", () => {
    for (const e of register.fact_exceptions) {
      for (const w of e.words) expect(bannedWordRegex(w).test(e.sentence), `${JSON.stringify(e.sentence)} lacks "${w}"`).toBe(true)
      const undeclared = register.banned_words.filter((w) => !e.words.includes(w) && bannedWordRegex(w).test(e.sentence))
      expect(undeclared, `${JSON.stringify(e.sentence)} also contains ${undeclared.join(", ")}`).toEqual([])
    }
  })

  test('the phrase "no DPDP certification exists in India" is a fact exception, verbatim', () => {
    expect(register.fact_exceptions.map((e) => e.sentence)).toContain("no DPDP certification exists in India")
  })

  test('CLM-001 "For India, by India": owner-approved, evidence = Indian founder and company, legal_approved false until a lawyer signs', () => {
    const c = register.claims.find((k) => k.id === "CLM-001")!
    expect(c.sentence).toBe("For India, by India")
    expect(c.owner_approved).toBe(true)
    expect(c.legal_approved).toBe(false)
    expect(c.evidence.toLowerCase()).toContain("indian founder and company")
  })

  test("no claim is legally approved yet (a lawyer has not signed)", () => {
    expect(register.claims.filter((c) => c.legal_approved)).toEqual([])
  })
})

describe("banned-word matching", () => {
  test("whole words, case-insensitive; the three literal entries", () => {
    expect(bannedWordRegex("best").test("We are the BEST.")).toBe(true)
    expect(bannedWordRegex("best").test("asbestos")).toBe(false)
    expect(bannedWordRegex("only").test("the only tool")).toBe(true)
    expect(bannedWordRegex("only").test("onlyfans-style")).toBe(false)
    expect(bannedWordRegex("world class").test("a world  class product")).toBe(true)
    expect(bannedWordRegex("#1").test("#1 in India")).toBe(true)
    expect(bannedWordRegex("#1").test("#10 in India")).toBe(false)
    expect(bannedWordRegex("100%").test("100% compliant")).toBe(true)
    expect(bannedWordRegex("100%").test("2100% growth")).toBe(false)
    expect(bannedWordRegex("Made in India").test("proudly made in india")).toBe(true)
  })

  test("sentences split after . ! ? and drop list/heading markers", () => {
    expect(splitSentences("- Free. Your clients attach you.")).toEqual(["Free.", "Your clients attach you."])
    expect(splitSentences("## No. Most Indian companies do. S.8(5) security")).toEqual(["No.", "Most Indian companies do.", "S.8(5) security"])
    expect(normalise("  a   b ")).toBe("a b")
  })
})

describe("findViolations() verdicts", () => {
  const reg = (over: Partial<ClaimsRegister> = {}): ClaimsRegister => ({ version: 1, banned_words: register.banned_words, fact_exceptions: [], claims: [], ...over })
  const one = (text: string) => [{ file: "x.html", texts: [text] }]

  test("each banned word in an unregistered sentence is a violation", () => {
    for (const s of ["We are the best DPDP tool.", "The only DPDP record in India.", "World-class compliance.", "We guarantee compliance.", "Certified compliant.", "#1 for CA firms.", "The leading DPDP software.", "Unmatched proof.", "The fastest sign-up.", "100% compliant.", "Made in India."]) {
      const v = findViolations(one(s), reg())
      expect(v.length, s).toBeGreaterThan(0)
      expect(v[0].sentence).toBe(s)
    }
  })

  test("a clean sentence is not a violation", () => {
    expect(findViolations(one("VERIDIAN is Indian software for running DPDP compliance."), reg())).toEqual([])
  })

  test("an approved claim passes ONLY with owner_approved AND legal_approved true", () => {
    const sentence = "The best DPDP record in India."
    const claim = { id: "T-1", sentence, words: ["best"], evidence: "fixture", owner_approved: true, legal_approved: true }
    expect(findViolations(one(sentence), reg({ claims: [claim] }))).toEqual([])
    expect(findViolations(one(sentence), reg({ claims: [{ ...claim, legal_approved: false }] })).length).toBe(1)
    expect(findViolations(one(sentence), reg({ claims: [{ ...claim, owner_approved: false, legal_approved: true }] })).length).toBe(1)
    // A near-identical sentence is a different sentence.
    expect(findViolations(one("The best DPDP record in India"), reg({ claims: [claim] })).length).toBe(1)
  })

  test("a fact exception passes; the same words in another sentence do not", () => {
    const exceptions = [{ sentence: "There is no government DPDP certification in India.", words: ["certification"], kind: "disclaimer", why: "fixture" }]
    expect(findViolations(one("There is no government DPDP certification in India."), reg({ fact_exceptions: exceptions }))).toEqual([])
    expect(findViolations(one("There is a government DPDP certification in India."), reg({ fact_exceptions: exceptions })).length).toBe(1)
    expect(findViolations(one("- There is no government DPDP certification in India."), reg({ fact_exceptions: exceptions }))).toEqual([])
  })

  test('"Made in India" never passes, even as a registered claim or exception', () => {
    const s = "Made in India, for India."
    const claim = { id: "T-2", sentence: s, words: ["Made in India"], evidence: "fixture", owner_approved: true, legal_approved: true }
    expect(findViolations(one(s), reg({ claims: [claim] })).length).toBe(1)
    expect(findViolations(one(s), reg({ fact_exceptions: [{ sentence: s, words: ["Made in India"], kind: "x", why: "x" }] })).length).toBe(1)
  })

  test("HTML surfaces contribute visible text, title, meta, Open Graph and JSON-LD strings", () => {
    const html = `<html><head><title>T best</title><meta name="description" content="D only" /><meta property="og:title" content="O leading" /><script type="application/ld+json">{"x":"J fastest"}</script></head><body><p>B unmatched</p></body></html>`
    const words = findViolations([{ file: "f.html", texts: htmlTexts(html) }], reg()).map((v) => v.word).sort()
    expect(words).toEqual(["best", "fastest", "leading", "only", "unmatched"])
    expect(findViolations([{ file: "f.json", texts: fileTexts("f.json", '{"a":{"b":["the best"]}}') }], reg()).length).toBe(1)
  })
})

describe("the committed sources carry 0 banned words outside approved claims", () => {
  test("every public page, the hidden page, for-ai.md, llms.txt, llms-full.txt, facts.json", () => {
    const surfaces = surfaceFiles().map((rel: string) => {
      const isPage = [...PUBLIC_PAGES, ...HIDDEN_PAGES].some((p) => p.source === rel)
      const body = read(isPage ? rel : `public/${rel}`)
      return { file: rel, texts: isPage ? htmlTexts(body) : fileTexts(rel, body) }
    })
    expect(surfaces.length).toBeGreaterThanOrEqual(10)
    const violations = findViolations(surfaces, register)
    expect(violations, violations.map((v) => `${v.file}: "${v.word}" in: ${v.sentence}`).join("\n")).toEqual([])
  })
})
