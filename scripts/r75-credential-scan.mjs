#!/usr/bin/env node
// R75 Part 2 Phase 1 (V1-04): recurrence check for a credential-shaped
// string landing in a tracked file OR in any local .git/config.
//
// CI already runs gitleaks/gitleaks-action@v3 on every push (see
// .github/workflows/sentinel.yml, fixed for real under R60 T9 -- it used
// to run with continue-on-error:true, which made a check that could never
// fail). That job scans this REPOSITORY's committed history/tracked files.
// It structurally cannot see a `.git/config` file, because that file is
// local machine metadata and is never part of any repo's own tracked
// content, in this repo or any other -- which is exactly why the same
// leaked-PAT class of incident (R75 Part 2 Phase 1) can happen even with
// CI gitleaks green the whole time. This script is the local complement:
// run before a commit (wired as a pre-commit hook) AND periodically over
// every known clone on this machine, so both halves are actually covered.
//
// Three modes:
//   --staged        scan currently git-staged file contents (pre-commit use)
//   --config <path>  scan one specific .git/config file (local-hygiene sweep use)
//   --range <a>..<b> scan every ADDED line across every commit in the range
//                    (git log -p, "+" lines only, "+++" file headers excluded)
//                    -- this is deliberately history-aware, not just a final-
//                    tree-state diff, so it catches a credential that was
//                    added and later removed within the same unpushed range;
//                    once pushed, that string is in the repo's history
//                    forever even if the final tree state is clean (V8-03,
//                    pre-push local-only-commit sweep).
// Prints PASS/FAIL per match, never the matched value itself (redacted).
// Exit 0 = clean. Exit 1 = at least one credential-shaped string found.
import { execSync } from "node:child_process"
import fs from "node:fs"

const PATTERNS = [
  { name: "github-pat-classic", rx: /ghp_[A-Za-z0-9]{20,}/g },
  { name: "github-oauth", rx: /gho_[A-Za-z0-9]{20,}/g },
  { name: "github-pat-finegrained", rx: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "generic-bearer-in-url", rx: /https:\/\/[A-Za-z0-9_.-]*:(ghp_|gho_|github_pat_)[A-Za-z0-9_]+@/g },
  { name: "aws-access-key", rx: /AKIA[0-9A-Z]{16}/g },
  { name: "supabase-service-role-jwt-shaped", rx: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
]

function redact(match) {
  if (match.length <= 10) return "*".repeat(match.length)
  return match.slice(0, 6) + "…[REDACTED " + (match.length - 10) + " chars]…" + match.slice(-4)
}

function scanText(label, text) {
  const findings = []
  for (const p of PATTERNS) {
    const hits = [...text.matchAll(p.rx)]
    for (const h of hits) findings.push({ label, rule: p.name, redacted: redact(h[0]) })
  }
  return findings
}

function scanStaged() {
  let files
  try {
    files = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" }).split("\n").filter(Boolean)
  } catch {
    files = []
  }
  const all = []
  for (const f of files) {
    if (!fs.existsSync(f)) continue
    const stat = fs.statSync(f)
    if (stat.size > 5_000_000) continue // skip huge binaries, not credential-bearing text
    let content
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    all.push(...scanText(f, content))
  }
  return all
}

function scanConfigFile(path) {
  if (!fs.existsSync(path)) {
    console.log(`(no such file: ${path})`)
    return []
  }
  const content = fs.readFileSync(path, "utf8")
  return scanText(path, content)
}

function scanRange(range) {
  // -U0: no context lines, so every returned line is either a real diff
  // line or a "diff --git"/"+++"/"---" header, never innocent surrounding
  // context that happens to contain something pattern-shaped from an
  // unrelated line.
  let out
  try {
    out = execSync(`git log -p -U0 --no-color ${range}`, { encoding: "utf8", maxBuffer: 1024 * 1024 * 200 })
  } catch (e) {
    console.error(`git log -p failed for range ${range}: ${e.message}`)
    process.exit(2)
  }
  const all = []
  let currentFile = "(unknown file)"
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = line.slice(4).replace(/^b\//, "")
      continue
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue
    const added = line.slice(1)
    all.push(...scanText(currentFile, added))
  }
  return all
}

const argv = process.argv.slice(2)
let findings = []
if (argv.includes("--staged")) {
  findings = scanStaged()
} else if (argv.includes("--config")) {
  const idx = argv.indexOf("--config")
  findings = scanConfigFile(argv[idx + 1])
} else if (argv.includes("--range")) {
  const idx = argv.indexOf("--range")
  findings = scanRange(argv[idx + 1])
} else {
  console.error("usage: node scripts/r75-credential-scan.mjs --staged | --config <path> | --range <a>..<b>")
  process.exit(2)
}

for (const f of findings) console.log(`FAIL | ${f.rule} | ${f.label} | ${f.redacted}`)
console.log(`--- ${findings.length} credential-shaped string(s) found ---`)
if (findings.length > 0) {
  console.log("REJECTED. Do not commit/push. Remove the credential and rotate/revoke it before proceeding.")
}
process.exit(findings.length > 0 ? 1 : 0)
