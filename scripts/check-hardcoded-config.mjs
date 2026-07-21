#!/usr/bin/env node
// audit198 gap-closure wave 2, 2026-07-21 (ARTICLE-012, SOLID_ENGINEERING_
// DISCIPLINE: "Every configuration value shall be externalized and never
// hardcoded"). Same enforcement class and honest-limitation posture as
// this repo's other scripts/check-*.mjs CI gates (check-guardrail-
// presence.mjs, check-asset-registry-coverage.mjs, check-metadata-index-
// coverage.mjs, check-doc-quarantine-banner.mjs, check-doc-cross-
// references.mjs): a reviewable-diff guarantee enforced via PR/CI, not a
// runtime-unbypassable lock, and not a claim of catching every possible
// hardcoded value.
//
// Scope, stated honestly: this does NOT attempt to detect every hardcoded
// configuration value in the repo (magic numbers, UI copy, feature-flag
// literals) -- that would require either an unreliable AST-level "is this
// a config value" classifier or a prohibitive false-positive rate. It
// scans src/ for the two hardcoded-config shapes that are both mechanically
// detectable AND unambiguously wrong wherever they appear:
//   1. Secret-shaped literals: provider API-key/token formats with enough
//      structure to be real signal (sk-, ghp_/gho_/ghu_/ghs_/ghr_, AKIA,
//      xox[baprs]-, AIza, glpat-) assigned as a string literal.
//   2. Hardcoded external base URLs (http(s)://<host>) in application
//      code, EXCLUDING well-known non-secret constants (localhost,
//      schema.org/w3.org markup namespaces, this repo's own public
//      domains used in already-public marketing copy, GitHub Actions
//      action refs) which are legitimate to hardcode.
//
// A real match fails the build unless the exact file:line is listed with
// a reason in ai-os/registry/hardcoded-config-exemptions.yaml -- same
// registry+exemption convention as check-asset-registry-coverage.mjs /
// check-metadata-index-coverage.mjs, not a new mechanism.

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import yaml from "js-yaml"

const REPO_ROOT = process.cwd()
const SCAN_DIRS = ["src"]
const EXEMPTIONS_FILE = "ai-os/registry/hardcoded-config-exemptions.yaml"
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "__snapshots__"])
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"])
const TEST_FILE_RE = /\.(test|spec)\.tsx?$/

// Secret-shaped literal patterns. Each requires enough structure (fixed
// prefix + minimum length) to avoid matching ordinary identifiers/prose.
const SECRET_PATTERNS = [
  { name: "OpenAI-style secret key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitLab PAT", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
]

// Hardcoded external URL detection: any http(s):// literal whose host is
// not in this allowlist of legitimately-constant hosts.
const URL_RE = /https?:\/\/([a-zA-Z0-9.-]+)/g
const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "schema.org",
  "www.w3.org",
  "creativecommons.org",
  "github.com",
  "raw.githubusercontent.com",
  "veridian.ai",
  "vedaadvisors.com",
  "vedaadvisors.graphy.com",
])

function isAllowedHost(host) {
  if (ALLOWED_HOSTS.has(host)) return true
  // Placeholder/example hosts used deliberately in fixtures, CI env
  // defaults, and docs -- not a real hardcoded secret/endpoint.
  if (/example\.(com|org)$/.test(host)) return true
  if (/\.supabase\.co$/.test(host) && host.startsWith("placeholder")) return true
  return false
}

async function walk(dir, files = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, files)
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name)) && !TEST_FILE_RE.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

async function loadExemptions() {
  try {
    const raw = await readFile(path.resolve(REPO_ROOT, EXEMPTIONS_FILE), "utf8")
    const doc = yaml.load(raw) ?? {}
    const set = new Set()
    for (const entry of doc.exemptions ?? []) {
      if (!entry.file || !entry.line || !entry.reason || entry.reason.trim().length < 10) {
        console.error(`${EXEMPTIONS_FILE}: entry missing file/line/reason(>=10 chars): ${JSON.stringify(entry)}`)
        process.exit(1)
      }
      set.add(`${entry.file}:${entry.line}`)
    }
    return set
  } catch (err) {
    if (err.code === "ENOENT") return new Set()
    throw err
  }
}

async function main() {
  const exemptions = await loadExemptions()
  const files = await walk(path.resolve(REPO_ROOT, SCAN_DIRS[0]))

  const findings = []

  for (const absFile of files) {
    const relFile = path.relative(REPO_ROOT, absFile).split(path.sep).join("/")
    const content = await readFile(absFile, "utf8")
    const lines = content.split("\n")

    lines.forEach((line, idx) => {
      const lineNum = idx + 1
      const key = `${relFile}:${lineNum}`
      if (exemptions.has(key)) return
      // Skip comment-only lines -- this is a scan for literals shipped in
      // real code paths, not prose in a header comment explaining one.
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return

      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(line)) {
          findings.push({ file: relFile, line: lineNum, kind: `secret-shaped literal (${name})`, snippet: trimmed.slice(0, 120) })
        }
      }

      let m
      URL_RE.lastIndex = 0
      while ((m = URL_RE.exec(line))) {
        const host = m[1]
        if (!isAllowedHost(host)) {
          findings.push({ file: relFile, line: lineNum, kind: `hardcoded external URL (${host})`, snippet: trimmed.slice(0, 120) })
        }
      }
    })
  }

  if (findings.length > 0) {
    console.error(`=== Hardcoded Config Check FAILED: ${findings.length} unexempted finding(s) ===\n`)
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line} -- ${f.kind}\n    ${f.snippet}`)
    }
    console.error(
      `\nEach finding above must either be fixed (source the value from process.env / a config module) ` +
      `or, if it is a genuine, deliberate constant (a public brand domain, a documented placeholder, a ` +
      `provider's own well-known public endpoint), listed with a reason (>=10 chars) in ${EXEMPTIONS_FILE}.`
    )
    process.exit(1)
  }

  console.log(`Hardcoded Config Check passed -- scanned ${files.length} file(s) under src/, 0 unexempted findings (${exemptions.size} exemption(s) on file).`)
}

main().catch((err) => {
  console.error("Hardcoded Config Check crashed:", err)
  process.exit(1)
})
