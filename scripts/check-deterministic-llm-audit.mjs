#!/usr/bin/env node
// VERIDIAN Review Framework gap-closure, 2026-08-15 (task-20260718-120004-
// retry-2--ai-engineering-quality--logic): "Deterministic Logic Coverage"
// finding -- "Deterministic-first discipline is not universally applied."
// Recommended approach: "Periodically audit new LLM-call sites to check
// whether a deterministic alternative was considered first."
//
// Investigation at close time found the deterministic-first discipline
// itself genuinely real and consistently followed (every existing call
// site below carries an inline rationale comment; see
// src/lib/llm-routing-gate.ts's own header for the clearest example of a
// deterministic handler being tried FIRST, with callLLM() only as
// fallback) -- but there was no mechanism making that discipline durable.
// A brand-new callLLM()/callLLMJson()/callLLMVision() call site could be
// added anywhere in src/ with zero rationale and nothing would notice.
//
// This script is the mechanical half of "periodically audit": every CI
// run IS the periodic audit. It fails the build the moment a call site
// appears in a file not listed in KNOWN_LLM_CALL_SITES below, forcing that
// PR to make a visible, reviewable choice -- either add the file to this
// manifest (with a one-line reason a deterministic alternative wasn't
// used, matching this repo's existing per-site comment convention: see
// src/lib/services/hr-attendance-service.ts-style "deliberately hardcoded,
// not X" comments for the same documentation pattern applied to config
// instead of AI logic), or refactor to the existing deterministic path
// instead of adding a new LLM dependency.
//
// Honest limitation, same class as scripts/check-guardrail-presence.mjs's
// own: this is a deterministic text-presence/absence check, not a runtime
// lock. A FULL_ACCESS agent could still silently add both the call site
// AND a manifest entry with a hollow rationale in the same PR -- what this
// guarantees is that the call site becomes a VISIBLE, REVIEWABLE diff to
// this file, not a silent one buried in an unrelated service. That is the
// same guarantee class every check in this directory relies on.
//
// Gate files (src/lib/*-gate.ts) are deliberately NOT expected to appear
// here even though several reference callLLM() in comments -- that's the
// "no LLM call in gates" discipline (the separate "Separation of AI
// Logic" finding from the same review, re-confirmed still true at close
// time) documenting what a caller does, not calling it themselves. This
// script only flags a REAL call expression, not a comment mentioning one.

import { readFile } from "node:fs/promises"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REPO_ROOT = process.cwd()

// Every file with a real callLLM()/callLLMJson()/callLLMVision() call
// expression, confirmed by direct code read 2026-08-15. Each one already
// carries its own deterministic-first rationale inline at the call site
// (or, for the AI Dev Team dispatcher and chat/report/extraction services,
// the rationale is structural: the whole file's job IS to be the LLM call
// -- see e.g. document-extraction-service.ts's own header on why OCR-via-
// vision was chosen over a deterministic parser for scanned documents).
const KNOWN_LLM_CALL_SITES = [
  "src/app/api/documents/extract/route.ts",
  "src/app/api/help/ask/route.ts",
  "src/lib/ai-team/team-service.ts",
  "src/lib/gst/ai-review-report.ts",
  "src/lib/ingest/extractor.ts",
  "src/lib/llm-response-cache.ts",
  "src/lib/loops/instruction-mismatch-audit.ts",
  "src/lib/loops/loop-engineering-audit.ts",
  "src/lib/monitors/dispatch-completion-monitor.ts",
  "src/lib/orchestra-model-resolver.ts",
  "src/lib/services/ai-report-builder-service.ts",
  "src/lib/services/asset-routing-engine.ts",
  "src/lib/services/chat-service.ts",
  "src/lib/services/communication-drafting-service.ts",
  "src/lib/services/construction-ai-service.ts",
  "src/lib/services/crm-service.ts",
  "src/lib/services/dialogue-script-executor.ts",
  "src/lib/services/document-extraction-service.ts",
  "src/lib/services/email-intelligence-service.ts",
  "src/lib/services/fm-register-digitization-service.ts",
  "src/lib/services/prompt-eval-service.ts",
  "src/lib/services/report-engine-service.ts",
  "src/lib/services/ticket-intelligence-service.ts",
  "src/lib/services/veri-meeting-service.ts",
  "src/lib/services/visitor-intelligence-service.ts",
  "src/lib/services/voice-ticket-service.ts",
  "src/lib/task-execution-engine.ts",
  // llm-client.ts itself is the chokepoint these all call THROUGH, not a
  // call site of itself -- excluded below by name, not listed here.
]

const CALL_PATTERN = /\bcallLLM(Json|Vision)?\s*[<(]/
const EXCLUDED_SELF = "src/lib/llm-client.ts"

function listTrackedSourceFiles() {
  const out = execFileSync("git", ["ls-files", "--", "src/**/*.ts", "src/**/*.tsx"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
    .filter((f) => f !== EXCLUDED_SELF)
}

function fileHasRealCallSite(content) {
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim()
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue
    if (CALL_PATTERN.test(line)) return true
  }
  return false
}

const files = listTrackedSourceFiles()
const realCallSiteFiles = []

for (const file of files) {
  const fullPath = path.resolve(REPO_ROOT, file)
  let content
  try {
    content = await readFile(fullPath, "utf8")
  } catch {
    continue
  }
  if (fileHasRealCallSite(content)) realCallSiteFiles.push(file)
}

const known = new Set(KNOWN_LLM_CALL_SITES)
const unaudited = realCallSiteFiles.filter((f) => !known.has(f))
const stale = KNOWN_LLM_CALL_SITES.filter((f) => !realCallSiteFiles.includes(f))

if (unaudited.length > 0) {
  console.error("=== Deterministic LLM-Call-Site Audit FAILED ===")
  console.error("New callLLM()/callLLMJson()/callLLMVision() call site(s) found that")
  console.error("are not yet in scripts/check-deterministic-llm-audit.mjs's")
  console.error("KNOWN_LLM_CALL_SITES manifest:\n")
  for (const f of unaudited) console.error(`  - ${f}`)
  console.error("\nBefore adding this file to the manifest, confirm a deterministic")
  console.error("alternative was genuinely considered first (per this repo's")
  console.error("deterministic-first discipline -- see src/lib/llm-routing-gate.ts for")
  console.error("the reference pattern). Then add the file path to KNOWN_LLM_CALL_SITES")
  console.error("with a one-line comment explaining why an LLM call was needed.")
  process.exit(1)
}

if (stale.length > 0) {
  console.log("Notice: the following manifest entries no longer have a real call site")
  console.log("(not a failure -- likely refactored to a deterministic path, which is")
  console.log("the goal; feel free to remove them from KNOWN_LLM_CALL_SITES):")
  for (const f of stale) console.log(`  - ${f}`)
}

console.log(
  `Deterministic LLM-Call-Site Audit passed -- ${realCallSiteFiles.length} known call site(s), 0 unaudited.`,
)
