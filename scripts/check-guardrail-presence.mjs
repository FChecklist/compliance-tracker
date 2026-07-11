#!/usr/bin/env node
// VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md, Guardrail #30 (Constitutional
// Compliance) + Boss's explicit instruction (2026-07-11): "it will not be
// bypassed, until told by Rajat Agarwal through the specific instructions."
//
// Honest limitation, stated up front rather than oversold: this is a
// deterministic text-presence check, not a runtime-unbypassable lock. A
// FULL_ACCESS agent (Z.ai/Claude Code, per AGENTS.md) *could* still edit
// this manifest to silently drop an entry. What this check actually
// guarantees is that removing or weakening a named guardrail becomes a
// **visible, reviewable diff to THIS file** in a PR that Rajat Agarwal or
// the Super Boss can catch -- not a silent regression buried in an
// unrelated change. That is the same class of guarantee every other "no
// agent may X" rule in AGENTS.md/the constitutions relies on (branch
// protection + PR review + an explicit Operating Rule), not a stronger
// one -- named honestly, not oversold as tamper-proof.
//
// AGENTS.md Operating Rule 9 (added 2026-07-11): weakening, removing, or
// bypassing any guardrail named in this manifest requires Rajat Agarwal's
// explicit written instruction, quoted in the PR description. This script
// is the mechanical half of that rule -- it fails CI the moment a named
// marker disappears, forcing that PR (and its justification, or lack of
// one) to be seen rather than merged silently.
//
// Add a new entry here whenever a new guardrail/policy-gate call site is
// wired -- this manifest is meant to grow, not just enforce today's set.

import { readFile } from "node:fs/promises"
import path from "node:path"

const REPO_ROOT = process.cwd()

const REQUIRED_MARKERS = [
  // Objective/Scope/Instruction Validation Guardrails (Wave 158)
  { file: "src/lib/task-tightening.ts", mustContain: ["export function validateTightTask", "export function assembleTightTaskPrompt"] },
  { file: "src/lib/guardrail-engine.ts", mustContain: ["export function registerGuardrail", "export function evaluateGuardrails"] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["AI_TEAM_DISPATCH_LEAF", "AI_WORKFORCE_DISPATCH_LEAF", "registerGuardrail("] },
  { file: "src/app/api/ai/team/dispatch/route.ts", mustContain: ["registerAllGuardrails()", "evaluateGuardrails(", "detectLowConfidenceResponse("] },
  { file: "scripts/ai-workforce-agent.mjs", mustContain: ["validateTightTask(", "MAX_ITERATIONS"] },
  // Wave 159: the customer-task analog -- task-execution-engine.ts's
  // free-text LLM-planning branch, gated by a lighter check (see
  // task-tightening.ts's validateTaskBrief()) than the AI Dev Team's
  // TightTask schema, since this gates a live product's real task titles.
  { file: "src/lib/task-tightening.ts", mustContain: ["export function validateTaskBrief"] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["TASK_FREE_TEXT_PLANNING_LEAF"] },

  // Generalized loop-prevention primitive (Wave 159, Guardrail #20).
  { file: "src/lib/loop-prevention.ts", mustContain: ["export function checkLoopBudget"] },
  { file: "scripts/ai-workforce-agent.mjs", mustContain: ["checkLoopBudget("] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["AI_WORKFORCE_LOOP_BUDGET_LEAF"] },

  // Model-tier eligibility + mandatory audit (Wave 163, Boss directive:
  // "based on complexity given to the AI model" + gap-analysis callout
  // that tier routing had been discussed but never enforced).
  { file: "src/lib/model-tier-eligibility.ts", mustContain: ["export function checkTierEligibility", "export function requiresMandatoryAudit"] },
  { file: "src/app/api/ai/team/dispatch/route.ts", mustContain: ["checkTierEligibility("] },
  { file: "src/lib/ai-team/dispatch-repo.ts", mustContain: ["checkTierEligibility("] },
  { file: "scripts/ai-workforce-agent.mjs", mustContain: ["checkTierEligibility(", "requiresMandatoryAudit("] },
  { file: ".github/workflows/mandatory-audit-check.yml", mustContain: ["AUDIT: PASS"] },

  // High-Impact Action Confirmation Gate (Wave 146)
  { file: "src/lib/high-impact-action-detector.ts", mustContain: ["export function detectHighImpactAction"] },
  { file: "src/lib/services/task-service.ts", mustContain: ["detectHighImpactAction("] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["detectHighImpactAction("] },

  // Policy Enforcement Engine -- Constitution §22 (Wave 46), the
  // hallucination/prompt-injection/business-purpose gate. Every
  // currently-wired call site (VERIDIAN_AI_CONSTITUTION.md's own list,
  // re-verified 2026-07-11 -- construction-ai-service.ts and
  // veri-meeting-service.ts were added to the wired set since that
  // document was last written, not yet reflected there).
  { file: "src/lib/policy-enforcement-engine.ts", mustContain: ["export function enforcePolicy"] },
  { file: "src/lib/services/chat-service.ts", mustContain: ["enforcePolicy("] },
  { file: "src/lib/services/fde-service.ts", mustContain: ["enforcePolicy("] },
  { file: "src/app/api/page-agent/proxy/route.ts", mustContain: ["enforcePolicy("] },
  { file: "src/app/api/ai/orchestrate/route.ts", mustContain: ["enforcePolicy("] },
  { file: "src/app/api/help/ask/route.ts", mustContain: ["enforcePolicy("] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["enforcePolicy("] },
  { file: "src/lib/services/construction-ai-service.ts", mustContain: ["enforcePolicy("] },
  { file: "src/lib/services/veri-meeting-service.ts", mustContain: ["enforcePolicy("] },
  // Wave 159: crm-service.ts's scoreLead()/analyzeOpportunity() check
  // lead.name/opp.name specifically (the one genuinely user-authored field
  // in each call), not the whole system-constructed prompt.
  { file: "src/lib/services/crm-service.ts", mustContain: ["enforcePolicy("] },
  // Deliberately NOT in this manifest, and not a gap: src/lib/gst/ai-review-report.ts
  // and src/lib/services/visitor-intelligence-service.ts send the model
  // ONLY system-constructed JSON (validation findings / DB aggregates) --
  // zero free-text user input reaches either call site, confirmed by
  // direct code review 2026-07-11. Wiring enforcePolicy() there would mean
  // feeding it a synthetic string just to satisfy the signature, which
  // isn't real enforcement of anything -- matching
  // VERIDIAN_AI_CONSTITUTION.md's own "NOT APPLICABLE YET" discipline
  // (don't restrict a surface that doesn't have the risk in question).

  // Floor-tier escalation (Wave 114 / PR #114 / PR #116) -- deterministic
  // pre/post-call escalation signals, no LLM self-grading.
  { file: "src/lib/floor-tier-escalation.ts", mustContain: ["checkPreCallEscalation", "detectLowConfidenceResponse"] },
  { file: "src/lib/services/chat-service.ts", mustContain: ["checkPreCallEscalation", "floor-tier-escalation"] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["checkTaskEscalationContext"] },

  // Multi-tenant isolation -- Constitution §8, PRODUCTION_PROVEN.
  { file: "src/lib/db/tenant-scoped.ts", mustContain: ["withTenantContext"] },
]

let failed = false
const missing = []

for (const { file, mustContain } of REQUIRED_MARKERS) {
  const fullPath = path.resolve(REPO_ROOT, file)
  let content
  try {
    content = await readFile(fullPath, "utf8")
  } catch {
    failed = true
    missing.push(`${file}: FILE DELETED`)
    continue
  }
  for (const marker of mustContain) {
    if (!content.includes(marker)) {
      failed = true
      missing.push(`${file}: missing "${marker}"`)
    }
  }
}

if (failed) {
  console.error("=== Guardrail Presence Check FAILED ===")
  console.error("One or more guardrails required by VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md")
  console.error("and AGENTS.md Operating Rule 9 appear to have been removed or weakened:\n")
  for (const line of missing) console.error(`  - ${line}`)
  console.error("\nPer Operating Rule 9: removing or weakening a guardrail requires Rajat")
  console.error("Agarwal's explicit written instruction, quoted in this PR's description,")
  console.error("AND an accompanying update to scripts/check-guardrail-presence.mjs's own")
  console.error("manifest explaining why. If that's not this PR, restore the guardrail.")
  process.exit(1)
}

console.log(`Guardrail Presence Check passed -- all ${REQUIRED_MARKERS.length} markers present.`)
