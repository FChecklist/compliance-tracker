#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure (2026-08-15): "AI Engineering
// Quality" finding, "Deterministic Logic Coverage" -- [Low] "Deterministic-
// first discipline is not universally applied." Recommended approach (the
// finding's own text): "Periodically audit new LLM-call sites to check
// whether a deterministic alternative was considered first."
//
// What this checks: every file that imports callLLM/callLLMJson/
// callLLMVision from src/lib/llm-client.ts (the one real funnel every LLM
// call in this repo goes through -- confirmed by grep, ~40 importers as of
// 2026-08-15) is scanned for a nearby "why this needs an LLM, not a
// deterministic check" justification comment. The repo already has a
// strong INFORMAL convention of this (see src/lib/llm-routing-gate.ts,
// src/lib/policy-enforcement-engine.ts, etc. -- 50+ files use the word
// "deterministic" in exactly this reasoning pattern) but, before this
// script, nothing actually audited new call sites for it; this makes that
// convention checkable instead of just hoped-for.
//
// Honest limitation, stated up front rather than oversold (same class as
// scripts/check-guardrail-presence.mjs's own header): this is a keyword
// heuristic (does the file mention "deterministic" anywhere?), not a
// semantic check that the justification is actually good, or that it sits
// physically next to the call site rather than elsewhere in the file. A
// file can trivially "pass" by adding the word "deterministic" without
// real reasoning behind it. What this script actually guarantees is that
// a genuinely undocumented new LLM-call site becomes visible in a report a
// human can act on -- it does not and cannot verify the judgment call was
// sound.
//
// Deliberately NOT wired into CI as a blocking gate: this finding is
// [Low] severity and its own recommended approach says "periodically
// audit", not "block every PR that adds an LLM call". Run this by hand
// (or from a periodic/cron review pass) when reviewing new LLM-call sites:
//   node scripts/audit-deterministic-first-coverage.mjs
// Pass --strict to exit 1 when unjustified sites are found, for a future
// opt-in CI wiring if the Owner ever wants to promote this from advisory
// to blocking (not done here -- that decision belongs to whoever owns
// that trade-off, not to this script).

import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

const REPO_ROOT = process.cwd()
const STRICT = process.argv.includes("--strict")

// The three real call-site entry points into src/lib/llm-client.ts.
const LLM_CALL_IMPORT_RE = /\bimport\s*\{[^}]*\b(callLLM|callLLMJson|callLLMVision)\b[^}]*\}\s*from\s*["'][^"']*llm-client["']/

// Heuristic for "a deterministic-vs-LLM justification exists somewhere in
// this file" -- matches the vocabulary the repo's own existing
// justification comments already use (see llm-routing-gate.ts,
// policy-enforcement-engine.ts, capability-audit-service.ts).
const JUSTIFICATION_RE = /deterministic|no\s+deterministic\s+alternative|requires\s+(natural[- ]language|judgment|reasoning)|llm[- ]based\s+classifier/i

// llm-client.ts itself and its own tests are the implementation, not a
// call site -- excluding them avoids a trivial false-positive/negative on
// the funnel file itself.
const EXCLUDE_RE = /(^|\/)src\/lib\/llm-client(\.test)?\.ts$/

function listTrackedFiles() {
  // git ls-files, not a recursive fs walk -- see repo convention (avoids
  // the environment's known find/grep result-count caps on this box).
  const out = execSync("git ls-files -- 'src/**/*.ts' 'src/**/*.tsx'", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  })
  return out.split("\n").filter(Boolean)
}

function main() {
  const files = listTrackedFiles().filter((f) => !EXCLUDE_RE.test(f))

  const callSites = []
  for (const file of files) {
    let content
    try {
      content = readFileSync(`${REPO_ROOT}/${file}`, "utf8")
    } catch {
      continue // deleted-but-still-tracked-in-index edge case; skip
    }
    if (!LLM_CALL_IMPORT_RE.test(content)) continue
    callSites.push({ file, justified: JUSTIFICATION_RE.test(content) })
  }

  const justified = callSites.filter((c) => c.justified)
  const unjustified = callSites.filter((c) => !c.justified)

  console.log(`Deterministic-first coverage audit -- ${callSites.length} file(s) import an LLM-call function from src/lib/llm-client.ts\n`)
  console.log(`  Justified (contains a "why LLM / why not deterministic" comment): ${justified.length}`)
  console.log(`  Flagged for review (no such comment found): ${unjustified.length}\n`)

  if (unjustified.length > 0) {
    console.log("Flagged files -- review whether a deterministic alternative was considered, then either:")
    console.log("  (a) add a short comment explaining why an LLM call is genuinely needed here, or")
    console.log("  (b) replace the call with a deterministic check if one exists.\n")
    for (const c of unjustified) console.log(`  - ${c.file}`)
    console.log("")
  }

  if (STRICT && unjustified.length > 0) {
    console.error(`--strict: failing, ${unjustified.length} unjustified LLM-call site(s) found.`)
    process.exit(1)
  }
}

main()
