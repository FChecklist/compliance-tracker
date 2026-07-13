// PLATFORM_STRATEGY.md section 29 ("Narrow Monitor Agents + mandatory
// escalation hierarchy + three-tier model routing"), 29.3 Phase 0.
//
// A Narrow Monitor Agent is deliberately small: "one instruction, one
// YES/NO decision, no business reasoning, silent by default, escalate only
// on rule-failure/timeout/conflict/ambiguity" (29 intro). This module is
// the structured-report contract every monitor's output must satisfy --
// same shape/rigor as audit-protocol.ts's AuditProtocolFields/
// validateAuditProtocolFields (a small set of required structured fields,
// validated deterministically, no LLM call), but intentionally narrower:
// audit-protocol.ts's 8 fields mirror a 3-phase Before/During/After audit
// methodology; a monitor's report is not an audit -- it is a single
// verdict about a single rule, so it gets exactly the 5 fields 29.3 itself
// names (status/worker/protocol/confidence/action), not a stretched
// reimplementation of the audit shape.
//
// Per 29.2's Tier-1 finding ("~28 of 30 events are pure DB-state changes...
// every one of these needs a rule engine, never a model call"), Phase 0
// wires exactly one Tier-1 (rule-engine) monitor -- see
// src/lib/monitors/approval-decision-monitor.ts for the real call site.
// This file has no LLM call anywhere and never will for Tier 1; a Tier
// 2/3 monitor (Phase 2, not built here) would still produce this same
// MonitorReportFields shape, just computed by a model call instead of a
// pure comparison.

import { detectAmbiguousLanguage, type TightTaskValidation } from "./task-tightening"

/**
 * The minimal structured report every monitor -- Tier 1 today, Tier 2/3 in
 * a later phase -- must produce. Deliberately NOT a reimplementation of
 * AuditProtocolFields' 8-field Before/During/After shape: a monitor makes
 * one narrow YES/NO call, not a multi-phase audit.
 */
export type MonitorReportFields = {
  /** 'ok' | 'escalate' -- see VALID_STATUS. The one YES/NO decision. */
  status: string
  /** Which worker/agent/role this report is about -- e.g. a roster.ts roleKey, or the entity's own actor identifier. */
  worker: string
  /** Which rule/protocol was evaluated -- traceable back to a MONITOR_REGISTRY-style definition, not a vague "checked stuff." */
  protocol: string
  /** 0-100, same convention as confidence-banding.ts's bandConfidence(). A deterministic Tier-1 rule reports 100 (fully certain, it's a data comparison) or 0 (rule failed, also fully certain) -- never a fuzzy in-between; fuzziness is a Tier 2/3 concept. */
  confidence: number
  /** 'none' | 'escalate' | 'retry' | 'log_only' -- see VALID_ACTION. What the monitor actually did as a result of status. */
  action: string
}

export type MonitorReportValidation = TightTaskValidation

export const VALID_STATUS = ["ok", "escalate"] as const
export const VALID_ACTION = ["none", "escalate", "retry", "log_only"] as const

const MIN_FIELD_LENGTH = 3

// Mirrors audit-protocol.ts's JUNK_PATTERNS exactly -- same reasoning: a
// monitor report field with genuine placeholder text ("tbd", blank, etc.)
// is not a real report and must fail closed the same way an audit
// submission does.
const JUNK_PATTERNS = [
  /^(tbd|todo|xxx+|\.\.\.|fill.?in|same as (above|status|output))$/i,
  /^\s*$/,
]

function isJunk(value: string): boolean {
  const trimmed = value.trim()
  return JUNK_PATTERNS.some((p) => p.test(trimmed))
}

function checkNarrativeField(value: string | undefined, label: string, guidanceExample: string): MonitorReportValidation | null {
  const trimmed = (value ?? "").trim()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Add a ${label} field. Example: "${guidanceExample}"` }
  }
  if (isJunk(trimmed)) {
    return { valid: false, reason: `${label} is a placeholder, not a real value ("${trimmed}").`, guidance: `Replace it with the actual ${label.toLowerCase()}. Example: "${guidanceExample}"` }
  }
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return { valid: false, reason: `${label} is too short to be actionable ("${trimmed}").`, guidance: `Be specific -- name the concrete worker/protocol, not just a category. Example: "${guidanceExample}"` }
  }
  const ambiguity = detectAmbiguousLanguage(trimmed)
  if (ambiguity.detected) {
    return {
      valid: false,
      reason: `${label} contains vague, unresolved language ("${ambiguity.matchedPhrase}").`,
      guidance: `A Narrow Monitor Agent makes one deterministic YES/NO call -- replace "${ambiguity.matchedPhrase}" with the actual rule outcome, not a hedge.`,
    }
  }
  return null
}

function checkEnumField(value: string | undefined, label: string, validValues: readonly string[]): MonitorReportValidation | null {
  const trimmed = (value ?? "").trim().toLowerCase()
  if (!trimmed) {
    return { valid: false, reason: `${label} is missing.`, guidance: `Set ${label} to one of: ${validValues.join(", ")}.` }
  }
  if (!validValues.includes(trimmed)) {
    return { valid: false, reason: `${label} ("${trimmed}") is not one of the recognized values.`, guidance: `Must be one of: ${validValues.join(", ")}.` }
  }
  return null
}

function checkConfidenceField(value: number | undefined): MonitorReportValidation | null {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return { valid: false, reason: "Confidence is missing.", guidance: "Set confidence to a number 0-100 (see confidence-banding.ts's bandConfidence() convention)." }
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return { valid: false, reason: `Confidence (${value}) is out of range.`, guidance: "Confidence must be a finite number between 0 and 100 inclusive." }
  }
  return null
}

/**
 * Validates all 5 required MonitorReportFields are present, non-placeholder,
 * and well-formed before a monitor's report may be treated as valid.
 * Deterministic only, no LLM call -- matches validateAuditProtocolFields()'s
 * exact posture and every other gate in this codebase.
 */
export function validateMonitorReportFields(fields: Partial<MonitorReportFields>): MonitorReportValidation {
  const checks: Array<MonitorReportValidation | null> = [
    checkEnumField(fields.status, "Status", VALID_STATUS),
    checkNarrativeField(fields.worker, "Worker", "approval_decision_timeliness_monitor's subject: ApprovalRequest cm3x...9f"),
    checkNarrativeField(fields.protocol, "Protocol", "approval-decision-timeliness: resolvedAt - createdAt <= maxExecutionTimeMs"),
    checkConfidenceField(fields.confidence),
    checkEnumField(fields.action, "Action", VALID_ACTION),
  ]
  for (const failure of checks) {
    if (failure) return failure
  }
  return { valid: true }
}
