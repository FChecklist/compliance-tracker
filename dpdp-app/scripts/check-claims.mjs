#!/usr/bin/env node
// WO-DPDP-013 v2 §0 rule 3, the banned-word test: "a build test fails on any
// banned word outside an approved claim." Runs inside `bun run build` after
// scripts/check-public-surface.mjs; src/lib/claims-register.test.ts runs the
// same functions against the committed sources and against fixtures.
//
//   node scripts/check-claims.mjs [dist-dir]     exit 1 with every violation
//                                                named; exit 2 if dist/ is
//                                                missing
//
// What is scanned (every public surface in dist/, plus the hidden /proof/):
// each public page's visible text, <title>, meta description, Open Graph
// content and every string inside its JSON-LD; /for-ai.md; /llms.txt;
// /llms-full.txt; /facts.json (every string value).
//
// The rule: a sentence containing a banned word (data/claims-register.yaml
// `banned_words`, whole-word, case-insensitive; "#1", "100%" and "Made in
// India" literally) passes ONLY if the whole sentence, whitespace-collapsed,
// is (a) a `claims` entry with owner_approved AND legal_approved true, or
// (b) a `fact_exceptions` entry. Anything else fails the build.
import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadClaims } from "../src/lib/facts.mjs"
import { HIDDEN_PAGES, PUBLIC_PAGES } from "../src/lib/public-surface.mjs"
import { decodeEntities, visibleLines } from "./generate-public-facts.mjs"

const SELF = fileURLToPath(import.meta.url)

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The regex for one banned word: whole word, case-insensitive; the three
 * non-word entries literally. */
export function bannedWordRegex(word) {
  if (word === "#1") return /(^|[^\w#])#1(?![\d\w])/
  if (word === "100%") return /(^|[^\d.])100\s?%/
  return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRe(word).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}_-])`, "iu")
}

/** One text line into sentences: split after . ! ? when a capital, quote or
 * bracket follows. Leading list/heading markers ("- ", "## ", "> ") are
 * dropped so the same sentence matches from a page, a .md and a .txt. */
export function splitSentences(line) {
  return line
    .replace(/^\s*(?:[-#>*]+\s+)+/, "")
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
}

export const normalise = (s) => s.replace(/\s+/g, " ").trim()

function attrValues(html, re) {
  return [...html.matchAll(re)].map((m) => decodeEntities(m[1]))
}

function jsonStrings(value, out = []) {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, out))
  else if (value && typeof value === "object") Object.values(value).forEach((v) => jsonStrings(v, out))
  return out
}

/** Every piece of text on an HTML surface a person or a bot can read:
 * visible lines (brand line and nav included), title, meta description,
 * Open Graph content, JSON-LD strings. */
export function htmlTexts(html) {
  const out = visibleLines(html, { keepBrandLine: true, keepNav: true })
  const title = /<title>([^<]*)<\/title>/i.exec(html)
  if (title) out.push(decodeEntities(title[1]))
  out.push(...attrValues(html, /<meta\s+name="description"\s+content="([^"]*)"/gi))
  out.push(...attrValues(html, /<meta\s+property="og:[a-z_]+"\s+content="([^"]*)"/gi))
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) out.push(...jsonStrings(JSON.parse(m[1])))
  return out
}

/** Text of a non-HTML surface: .md and .txt by line, .json by string value. */
export function fileTexts(name, body) {
  if (name.endsWith(".json")) return jsonStrings(JSON.parse(body))
  return body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

/** The surfaces to scan, relative to dist/: every public page, every hidden
 * page, and the four non-HTML fact files. */
export function surfaceFiles() {
  return [...PUBLIC_PAGES.map((p) => p.source), ...HIDDEN_PAGES.map((p) => p.source), "for-ai.md", "llms.txt", "llms-full.txt", "facts.json"]
}

/**
 * Check a set of surfaces against the register. `surfaces` is
 * [{ file, texts: string[] }]. Returns every violation as
 * { file, word, sentence }. Pure: no filesystem.
 */
export function findViolations(surfaces, register) {
  const approved = new Set(register.claims.filter((c) => c.owner_approved && c.legal_approved).map((c) => normalise(c.sentence)))
  const exceptions = new Set(register.fact_exceptions.map((e) => normalise(e.sentence)))
  const words = register.banned_words.map((w) => ({ word: w, re: bannedWordRegex(w) }))
  const out = []
  for (const { file, texts } of surfaces) {
    for (const text of texts) {
      for (const sentence of splitSentences(text)) {
        const key = normalise(sentence)
        for (const { word, re } of words) {
          if (!re.test(sentence)) continue
          if (word !== "Made in India" && (approved.has(key) || exceptions.has(key))) continue
          out.push({ file, word, sentence })
        }
      }
    }
  }
  return out
}

/** Read every surface from a dist directory. */
export function readSurfaces(dist) {
  const out = []
  for (const rel of surfaceFiles()) {
    const abs = join(dist, rel)
    if (!existsSync(abs)) {
      out.push({ file: rel, texts: [], missing: true })
      continue
    }
    const body = readFileSync(abs, "utf8")
    out.push({ file: rel, texts: rel.endsWith(".html") ? htmlTexts(body) : fileTexts(rel, body) })
  }
  return out
}

function main() {
  const dist = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../dist/", import.meta.url))
  if (!existsSync(dist)) {
    console.error("check-claims: dist/ not found -- run `vite build` first")
    return 2
  }
  const register = loadClaims()
  const surfaces = readSurfaces(dist)
  const missing = surfaces.filter((s) => s.missing).map((s) => s.file)
  const violations = findViolations(surfaces, register)
  const sentences = surfaces.reduce((n, s) => n + s.texts.reduce((m, t) => m + splitSentences(t).length, 0), 0)
  if (missing.length || violations.length) {
    console.error(`check-claims: FAIL -- ${violations.length} banned-word sentence(s) outside an approved claim, ${missing.length} surface(s) missing`)
    for (const f of missing) console.error(`  - missing: ${f}`)
    for (const v of violations) console.error(`  - ${v.file}: "${v.word}" in: ${v.sentence}`)
    console.error(`  (register: ${register.claims.filter((c) => c.legal_approved).length} legally approved claim(s), ${register.fact_exceptions.length} fact exception(s); data/claims-register.yaml)`)
    return 1
  }
  console.log(`check-claims: OK -- 0 banned words outside approved claims across ${sentences} sentences on ${surfaces.length} surfaces in ${relative(process.cwd(), dist) || "."}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main()
