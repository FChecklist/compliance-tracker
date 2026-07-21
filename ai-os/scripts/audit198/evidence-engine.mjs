// ai-os/scripts/audit198/evidence-engine.mjs
//
// Generic, reusable evidence-gathering primitives shared by every category
// checker in category-checkers.mjs. Nothing in here is item-specific --
// item-specific behavior comes only from the search terms/targets each
// category checker passes in. This is the part of the framework that
// actually touches the filesystem / gh CLI / grep, so every verdict this
// audit produces is backed by a real command result, never an assertion.

import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

export const REPO_ROOTS = {
  "compliance-tracker": process.env.AUDIT198_REPO_ROOT || process.cwd(),
}

// Stopwords deliberately include the RULES_ARTICLES_198.json's own
// boilerplate modal/legal vocabulary ("shall", "every", "whenever") so
// keyword extraction surfaces the DOMAIN nouns/verbs of each item, not
// the recurring scaffolding words every one of the 198 items shares.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "shall", "every", "whenever", "wherever", "within", "without", "through",
  "before", "after", "is", "are", "be", "been", "being", "that", "this",
  "these", "those", "shall", "not", "no", "only", "always", "never", "all",
  "each", "any", "so", "as", "by", "from", "into", "such", "than", "then",
  "their", "its", "it", "at", "if", "when", "whether", "which", "who",
  "whose", "will", "would", "should", "must", "can", "could", "same",
  "also", "primary", "system", "platform", "os", "veridian", "ai",
])

/**
 * Extracts the significant domain words/phrases from a rule/article's text
 * for use as grep search terms. Deterministic, no LLM call -- capitalized
 * multi-word phrases (e.g. "Root Cause Analysis") are kept whole; single
 * words are lower-cased and stopword-filtered.
 */
export function extractKeywords(text, max = 8) {
  const phrases = []
  const phraseRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,4})\b/g
  let m
  while ((m = phraseRe.exec(text))) {
    const p = m[1].trim()
    if (p.split(/\s+/).length >= 2) phrases.push(p)
  }

  const words = text
    .replace(/[.,;:()"']/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w))

  const seen = new Set()
  const out = []
  for (const p of phrases) {
    const key = p.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  return out.slice(0, max)
}

function runQuiet(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 })
  } catch (err) {
    // grep/gh exit non-zero on "no match" -- that's a real, meaningful
    // result (zero hits), not a tool failure. Surface stdout either way.
    return err.stdout ?? ""
  }
}

/**
 * Greps a set of directories (relative to repoRoot) for a term, case
 * insensitive, word-ish boundary where the term is alnum. Returns up to
 * `limit` "path:line:content" hits, real ripgrep/grep output -- never
 * fabricated.
 */
export function grepRepo(term, { repoRoot = REPO_ROOTS["compliance-tracker"], dirs = ["src", "ai-os", "scripts", ".github", "drizzle"], limit = 5 } = {}) {
  const existingDirs = dirs.filter((d) => existsSync(path.join(repoRoot, d)))
  if (existingDirs.length === 0) return { term, hits: [], fileCount: 0 }
  const args = [
    "-rIn", "-i",
    // Excludes the audit framework's OWN directory -- without this, a
    // run's grep can match its own previously-generated results JSON/MD
    // (which literally contains every item's text and keyword list) or
    // this taxonomy file's own category labels, self-contaminating the
    // "evidence" with the audit tool talking about itself instead of
    // real product code. Confirmed as a real false-positive source in
    // RULE-067's first full run (sampleHits included this framework's
    // own audit198-summary.md and rules-taxonomy.mjs).
    // GNU grep's --exclude-dir only matches a bare directory-name/glob
    // per path component (nested "a/b/c" patterns do NOT work as one
    // might expect) -- confirmed by direct testing on the server before
    // shipping this. "audit198" as a basename is unambiguous: it is not
    // used as a directory name anywhere else in this repo.
    "--exclude-dir=audit198",
    "--exclude-dir=node_modules",
    "--exclude-dir=.next",
    "--include=*.ts", "--include=*.tsx", "--include=*.mjs", "--include=*.js",
    "--include=*.yaml", "--include=*.yml", "--include=*.md", "--include=*.sql",
    "-e", term,
    ...existingDirs,
  ]
  const out = runQuiet("grep", args, repoRoot)
  const lines = out.split("\n").filter(Boolean)
  const files = new Set(lines.map((l) => l.split(":")[0]))
  return { term, hits: lines.slice(0, limit), fileCount: files.size, totalHits: lines.length }
}

export function fileExists(relPath, repoRoot = REPO_ROOTS["compliance-tracker"]) {
  return existsSync(path.join(repoRoot, relPath))
}

/**
 * Checks that a file contains every marker string, citing the real line
 * number for each one found (via grep -n, not string.indexOf on a value
 * we then discard -- the line number is what makes this a citable
 * file:line, not just a boolean).
 */
export function fileContainsMarkers(relPath, markers, repoRoot = REPO_ROOTS["compliance-tracker"]) {
  const full = path.join(repoRoot, relPath)
  if (!existsSync(full)) {
    return { file: relPath, exists: false, markers: markers.map((m) => ({ marker: m, found: false })) }
  }
  const content = readFileSync(full, "utf8")
  const lines = content.split("\n")
  const results = markers.map((marker) => {
    const idx = lines.findIndex((l) => l.includes(marker))
    return { marker, found: idx !== -1, line: idx !== -1 ? idx + 1 : null }
  })
  return { file: relPath, exists: true, markers: results }
}

export function ghApi(args, { silent = true } = {}) {
  try {
    const out = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", silent ? "pipe" : "inherit"], maxBuffer: 16 * 1024 * 1024 })
    return { ok: true, out }
  } catch (err) {
    return { ok: false, out: err.stdout ?? "", err: err.stderr ?? String(err) }
  }
}
