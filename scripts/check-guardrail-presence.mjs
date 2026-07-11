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

  // Ambiguity / contradiction detection (Wave 166, tree4-unified/50-
  // completion-plan area 7): the completeness checks above (missing/
  // placeholder/too-short) don't catch a field that's present but still
  // vague ("handle edge cases as appropriate") or self-contradictory
  // (constraints says not to do the exact thing objective requires).
  { file: "src/lib/task-tightening.ts", mustContain: ["export function detectAmbiguousLanguage", "export function detectFieldContradiction"] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["TASK_FREE_TEXT_PLANNING_LEAF"] },

  // Generalized loop-prevention primitive (Wave 159, Guardrail #20).
  { file: "src/lib/loop-prevention.ts", mustContain: ["export function checkLoopBudget"] },
  { file: "scripts/ai-workforce-agent.mjs", mustContain: ["checkLoopBudget("] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["AI_WORKFORCE_LOOP_BUDGET_LEAF"] },

  // Self-Assessment / Peer Review closure gate (Wave 165, U-D12.B4.S3):
  // the dispatch route already flagged low-confidence AI Team output for
  // review (activity_log.lifecycle_stage='reviewing'), but nothing ever
  // required an independent reviewer to actually close it out. This is
  // the real gate -- reviewNotes/reviewDecision required, self-review
  // blocked, permanent record kept on the row.
  { file: "src/lib/db/schema.ts", mustContain: ["reviewedBy: text('reviewed_by')", "reviewDecision: text('review_decision')"] },
  { file: "src/lib/activity-log-service.ts", mustContain: ["export async function recordPeerReview", "self_review_not_allowed"] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["AI_TEAM_CLOSURE_REVIEW_LEAF"] },
  { file: "src/app/api/ai/team/review/route.ts", mustContain: ["evaluateGuardrails(", "recordPeerReview("] },
  { file: "src/app/api/ai/team/dispatch/route.ts", mustContain: ["reviewActivityId"] },

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

  // Added 2026-07-11 (tree4-unified/50-completion-plan PLAN-16 finding):
  // these 3 guardrails were real, wired code with zero CI presence
  // protection -- unlike policy-enforcement-engine.ts/floor-tier-
  // escalation.ts/loop-prevention.ts just above, which already had
  // manifest entries. Deliberately NOT wrapped as guardrail-engine.ts
  // registry leaves instead: that registry is an opt-in framework keyed by
  // capability-tree leaf that only 4 leaves in the whole system ever
  // query (see guardrail-registrations.ts) -- wrapping these 3 there
  // without a real evaluateGuardrails() caller at their actual call sites
  // would be a strictly weaker, redundant second layer. The manifest
  // entry is what makes "no task may bypass these guardrails" true today
  // for every other guardrail already in this file, so it's the
  // consistent, real fix here too.

  // AI Reply Gate (Phase 3) -- blocks hallucinated action-completion
  // claims and malformed replies from reaching the user.
  { file: "src/lib/ai-reply-gate.ts", mustContain: ["export function passesReplyGate"] },
  { file: "src/lib/services/chat-service.ts", mustContain: ["passesReplyGate("] },

  // PII Redaction (Wave 146) -- redact-at-write for LLM-call content
  // logging, so raw PII is never persisted to orchestra_executions.
  { file: "src/lib/pii-redaction.ts", mustContain: ["export function redactPii"] },
  { file: "src/lib/services/chat-service.ts", mustContain: ["redactPii("] },
  { file: "src/lib/services/fde-service.ts", mustContain: ["redactPii("] },

  // Audit/activity logging (audit.ts's logActivity) -- the single call
  // site every route uses so "every log of usage/change has a real
  // time/date/user-ID/device" lives in one place. Not enumerating all 89
  // real call sites (impractical, and not the point of this check) --
  // this anchors the definition plus one high-traffic call site so the
  // marker check still catches the function itself, or its use in the
  // core task-execution path, being silently gutted.
  { file: "src/lib/audit.ts", mustContain: ["export async function logActivity"] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["logActivity("] },

  // Mandatory Structured Handover Protocol (Wave 167,
  // ai-os/tree4-unified/10-merged-governance-layer.yaml U-D17.B1.S1,
  // confirmed_gap): "no AI Agent may simply say 'Done'" -- all 9 required
  // handover fields must be present/real before submitHandover() records
  // one, and ownership only transfers on a separate, explicit
  // acceptHandover() call (self-acceptance and re-acceptance both
  // rejected).
  { file: "src/lib/handover-protocol.ts", mustContain: ["export function validateHandoverFields", "export async function submitHandover", "export async function acceptHandover", "self_acceptance_not_allowed", "already_accepted"] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["HANDOVER_PROTOCOL_LEAF"] },
  { file: "src/lib/db/schema.ts", mustContain: ["handoverAcceptedBy: text('handover_accepted_by')", "handoverAcceptedAt: timestamp('handover_accepted_at')"] },

  // Added 2026-07-11 (tree4-unified/50-completion-plan area 3 "Guardrails",
  // PLAN-16 remainder): Authority/Delegation beyond role-rank -- a real,
  // confirmed gap (ROLE_RANK alone never checked whether the approver was
  // also the requester). Mirrors AGENTS.md Rule 7c / recordPeerReview's
  // self_review_not_allowed for human approval workflows.
  { file: "src/lib/services/approval-workflow-service.ts", mustContain: ["export function isSelfApproval", "isSelfApproval("] },

  // Knowledge-sufficiency gate (Guardrail 6) -- integrative/judgment-tier
  // dispatches must state what existing context they already have before
  // being accepted; mechanical tier is exempt by definition.
  { file: "src/lib/task-tightening.ts", mustContain: ["export function validateKnowledgeSufficiency"] },

  // Tool Usage as a distinct check (Guardrail 13, "if a tool fails: retry
  // per policy or escalate") -- executeStructuredDispatch's failure path
  // now escalates via the executive ladder, matching executeEngineDispatch's
  // existing (Wave 171) escalation wiring rather than leaving it as the one
  // real dispatch-failure path with no equivalent.
  { file: "src/lib/task-execution-engine.ts", mustContain: ["nextEscalationRung({ reason: \"worker_agent_unavailable\" })"] },

  // Risk Classification (Guardrail 10) + Confidence Banding (Guardrail 9,
  // D18/PLAN-20) -- additive to, not a replacement for, model-tier-
  // eligibility.ts's tiers (DEC-04). classifyRisk() feeds a second,
  // independent review trigger at dispatch time; bandConfidence() gates
  // the closure-review endpoint so a below-90% self-assessed confidence
  // can't be silently approved instead of escalated.
  { file: "src/lib/risk-classification.ts", mustContain: ["export function classifyRisk"] },
  { file: "src/lib/confidence-banding.ts", mustContain: ["export function bandConfidence"] },
  { file: "src/app/api/ai/team/dispatch/route.ts", mustContain: ["classifyRisk("] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["bandConfidence(", "confidence_below_escalation_threshold"] },

  // Added 2026-07-11 (tree4-unified/50-completion-plan area 6 "Monitoring",
  // remaining_work item 1): dynamicChains.monitoringRules (schema column
  // from PR #169) now has a real enforcement layer -- evaluateMonitoringRules()
  // reads a chain's configured rules and checks them against a task's real
  // completion data (elapsed duration, completed step count) at the one
  // real chain-scoped completion chokepoint, escalating via the executive
  // ladder on an "escalate"-action violation.
  { file: "src/lib/monitoring-engine.ts", mustContain: ["export function evaluateMonitoringRules", "export function parseMonitoringRules"] },
  { file: "src/lib/task-execution-engine.ts", mustContain: ["enforceChainMonitoringRules", "nextEscalationRung({ reason: \"monitoring_rule_violation\" })"] },
  { file: "src/lib/escalation-ladder.ts", mustContain: ["monitoring_rule_violation"] },

  // Added 2026-07-11 (tree4-unified/50-completion-plan area 3 "Guardrails",
  // PLAN-16 re-scoped item (b), narrower re-investigation of PR #179's
  // deferred "broader Scope enforcement"): a syntactic-only (no prose/LLM
  // parsing) check that files actually changed by an AI Workforce dispatch
  // are among the exact file-path tokens its own scope field named, when
  // scope named any at all. Surfaced as a non-blocking PR-body warning, not
  // a hard gate.
  { file: "src/lib/task-tightening.ts", mustContain: ["export function extractDeclaredScopeFiles", "export function checkFilesWithinDeclaredScope"] },
  { file: "scripts/ai-workforce-agent.mjs", mustContain: ["checkFilesWithinDeclaredScope("] },
  { file: ".github/workflows/ai-team-workforce.yml", mustContain: ["SCOPE_VIOLATIONS"] },

  // Audit Cadence (area 9 "Auditing" item 1, L1/L4 routing) + Re-Audit Flag
  // (U-D15.B3.S1, "no task is EVER permanently complete"). classifyAuditCadence()
  // enforces Guardrail 10's "risk level determines... escalation level" at
  // the one place a closure decision is actually made -- previously
  // riskLevel was persisted and never read back there. flagForReAudit is the
  // real, reachable (explicit-admin) trigger for re-opening a closed
  // dispatch; see that function's own header for why this isn't a
  // fabricated automatic detector.
  { file: "src/lib/audit-cadence.ts", mustContain: ["export function classifyAuditCadence"] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["classifyAuditCadence(", "critical_risk_requires_escalation"] },
  { file: "src/lib/activity-log-service.ts", mustContain: ["export async function flagForReAudit", "export function listReAuditFlagged"] },
  { file: "src/app/api/ai/team/re-audit/route.ts", mustContain: ["flagForReAudit("] },

  // Added 2026-07-12 (area 9 "Auditing", L2-L7 cron-wiring follow-up named
  // in audit-cadence.ts's own header): real scheduled scan for L2
  // (Continuous Monitoring) -- the one periodic level with an unambiguous
  // action (detect failures, flag for re-audit) -- wired to a real Vercel
  // cron, not just documented as a future task.
  { file: "src/lib/audit-cadence-scan.ts", mustContain: ["export async function scanForL2Violations"] },
  { file: "src/app/api/internal/audit-cadence/run/route.ts", mustContain: ["scanForL2Violations("] },

  // QA pre-completion gate (area 3 "Guardrails", PLAN-16 original item
  // (f), distinct from GOV-08 just above): two prior passes found
  // Handover Protocol had zero live callers -- this wires it into the AI
  // Team dispatch/review lifecycle for real and adds the actual
  // completion-blocking check GOV-08 never provided (field presence, not
  // the reported value).
  { file: "src/lib/qa-precompletion-gate.ts", mustContain: ["export function checkQaPreCompletionGate", "export function buildDispatchSelfAssessment"] },
  { file: "src/lib/guardrail-registrations.ts", mustContain: ["QA_PRECOMPLETION_GATE_LEAF"] },
  { file: "src/app/api/ai/team/dispatch/route.ts", mustContain: ["buildDispatchSelfAssessment(", "checkQaPreCompletionGate("] },
  { file: "src/app/api/ai/team/review/route.ts", mustContain: ["QA_PRECOMPLETION_GATE_LEAF", "getActivitySelfAssessment("] },
  { file: "src/lib/activity-log-service.ts", mustContain: ["decideAcceptance(", "handover_not_submitted"] },
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
