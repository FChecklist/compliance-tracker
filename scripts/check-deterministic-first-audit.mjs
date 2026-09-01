#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (task-20260718-115004-retry-1--
// ai-engineering-quality--logic), [Low] Deterministic Logic Coverage:
// "Deterministic-first discipline is not universally applied." Recommended
// approach (the finding's own words): "Periodically audit new LLM-call
// sites to check whether a deterministic alternative was considered
// first."
//
// CI guard: fails if a NEW or MODIFIED source file calls one of
// llm-client.ts's 3 LLM entrypoints (callLLM/callLLMJson/callLLMVision)
// and does not appear in ai-os/registry/deterministic-first-audit-log.yaml
// (either the `sites` list, with a real audit note, or `exempted`, with a
// real reason auditing doesn't apply). Same enforcement class as
// check-asset-registry-coverage.mjs and check-guardrail-presence.mjs -- a
// reviewable-diff guarantee via PR/CI, not a runtime-unbypassable lock.
//
// Same "don't retroactively fail CI on pre-existing debt" posture as
// check-route-error-handling.mjs / check-migration-collision.mjs: only
// evaluates files that are new or changed relative to the base branch.
// Every LLM-call-site file that existed at manifest-introduction time
// (2026-08-15) was individually read and grandfathered into the manifest
// with a real note -- see that file's own header for detail.
//
// Honest limitation, same class as this repo's other check-*.mjs scripts:
// detection is text-level (does the file contain `callLLM(` /
// `callLLMJson(` / `callLLMVision(` anywhere, including inside a comment)
// -- it cannot mechanically verify a deterministic alternative was
// *actually* considered, only that someone wrote a real, reviewable answer
// down for this file rather than staying silent. A comment merely
// *mentioning* one of these functions (e.g. explaining why a nearby call
// was refactored away) will also trigger this check -- several manifest
// entries are exactly that case, documented as such in their own note
// rather than silently misclassified as a real call.
//
// Usage: node scripts/check-deterministic-first-audit.mjs [--base <ref>]
//        BASE_REF=origin/main node scripts/check-deterministic-first-audit.mjs
// Exit code 0 = no new unaudited LLM-call sites, 1 = new unaudited site found.

import { execSync } from "child_process"
import { readFileSync } from "fs"
import yaml from "js-yaml"

const MANIFEST_FILE = "ai-os/registry/deterministic-first-audit-log.yaml"
export const CALL_RE = /\bcallLLM\(|\bcallLLMJson\(|\bcallLLMVision\(/

// Pure function (no I/O) so this is unit-testable without a real git repo
// or filesystem -- same shape as check-reviewer-not-author.mjs's evaluate().
// `contents` maps file path -> source text (mirrors readFileSync output);
// a file with no entry is treated as unreadable/deleted and skipped, same
// as main()'s try/catch around readFileSync.
export function findUnauditedSites(files, contents, knownFiles) {
  const violations = []
  for (const file of files) {
    if (file === "src/lib/llm-client.ts") continue
    const source = contents[file]
    if (source === undefined) continue
    if (!CALL_RE.test(source)) continue
    if (!knownFiles.has(file)) violations.push(file)
  }
  return violations
}

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim()
}

function resolveBaseRef() {
  const argIdx = process.argv.indexOf("--base")
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]

  if (process.env.BASE_REF && process.env.BASE_REF.trim()) return process.env.BASE_REF.trim()

  try {
    execSync("git fetch origin main --quiet", { stdio: "ignore" })
  } catch {
    // ignore -- use whatever origin/main we already have, if anything
  }
  try {
    execSync("git rev-parse --verify origin/main", { stdio: "ignore" })
    return "origin/main"
  } catch {
    // origin/main not available locally at all, fall through
  }

  try {
    execSync("git rev-parse --verify main", { stdio: "ignore" })
    return "main"
  } catch {
    // no local main either, fall through
  }

  return "HEAD~1"
}

function getMergeBase(baseRef) {
  try {
    return run(`git merge-base HEAD ${baseRef} 2>/dev/null`) || "HEAD~1"
  } catch {
    return "HEAD~1"
  }
}

function getChangedSourceFiles(baseRef) {
  const mergeBase = getMergeBase(baseRef)
  let changedOut = ""
  let untrackedOut = ""
  try {
    changedOut = run(`git diff --name-only --diff-filter=d ${mergeBase} HEAD 2>/dev/null`)
  } catch {
    changedOut = ""
  }
  try {
    untrackedOut = run("git ls-files --others --exclude-standard 2>/dev/null")
  } catch {
    untrackedOut = ""
  }
  const all = [...changedOut.split("\n"), ...untrackedOut.split("\n")].filter(Boolean)
  return [...new Set(all)].filter(
    (f) => f.startsWith("src/") && (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")
  )
}

function loadManifest() {
  const raw = readFileSync(MANIFEST_FILE, "utf8")
  const parsed = yaml.load(raw) || {}
  const known = new Set()
  for (const entry of parsed.sites ?? []) known.add(entry.file)
  for (const entry of parsed.exempted ?? []) known.add(entry.file)
  return known
}

function main() {
  const baseRef = resolveBaseRef()
  const files = getChangedSourceFiles(baseRef)
  if (files.length === 0) {
    console.log(`No new/changed source files -- nothing to check (base: ${baseRef}).`)
    process.exit(0)
  }

  const known = loadManifest()
  const contents = {}
  for (const file of files) {
    try {
      contents[file] = readFileSync(file, "utf8")
    } catch {
      // deleted file -- leave out of `contents`, findUnauditedSites skips it
    }
  }
  const violations = findUnauditedSites(files, contents, known)

  if (violations.length > 0) {
    console.error("ERROR: new/modified file(s) reference an LLM call entrypoint (callLLM/callLLMJson/callLLMVision) but are not audited in " + MANIFEST_FILE + ":")
    for (const f of violations) console.error(`  - ${f}`)
    console.error("")
    console.error("Add a `sites` entry (what deterministic alternative was considered, and why AI is still the right call)")
    console.error("or an `exempted` entry (a real, specific reason auditing doesn't apply) to " + MANIFEST_FILE + ".")
    console.error("See ai-os/AI_ENGINEERING_POLICY.yaml's engineering_priority_order and ai-os/CONSTITUTION.yaml's")
    console.error("software_first (SF-01) for the standing policy this check operationalizes.")
    process.exit(1)
  }

  console.log(`OK: ${files.length} new/changed source file(s) checked, no unaudited LLM-call sites found (base: ${baseRef}).`)
  process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
