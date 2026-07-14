// Wave 163 (Boss directive: "based on complexity given to the AI model" +
// a direct callout that tier-routing had been discussed but never actually
// enforced). Deterministic model-to-tier eligibility, no LLM call, matching
// every other gate in this codebase.
//
// Default posture: MOST RESTRICTIVE unless a model has earned broader
// eligibility. A new model added to roster.ts is mechanical-only until
// explicitly proven at a harder tier -- the same "earn trust, don't assume
// it" discipline this session applied to DeepSeek's and GPT-OSS-120B's
// first real dispatches. This is the opposite of an allowlist that grows
// stale silently; it requires a deliberate code change (and, per
// AGENTS.md Operating Rule 9, a real reason) to grant a model a higher tier.
import type { ComplexityTier } from "./task-tightening"

// Judgment tier: architecture, security, audit verdicts, anything
// governance-affecting. An auditor weaker than the work it checks isn't
// real assurance (VERIDIAN_AUDIT_ORGANIZATION.md's own rule) -- kept to
// exactly the models already trusted for judgment-critical Guardrail Team
// roles in roster.ts.
//
// "openai/gpt-5.5" was here too (escalation_second_opinion/
// security_threat_analyst's cross-vendor second opinion). Removed, founder
// directive 2026-07-14: real cost concern (gpt-5.5 is expensive) plus a
// real safety concern (an unbounded escalate-to-a-second-model pattern is
// not something to leave standing by default). GLM-5.2 is now the sole
// judgment-eligible model -- see roster.ts's GPT_55 constant comment for
// the full reasoning trail.
const JUDGMENT_ELIGIBLE = new Set<string>([
  "z-ai/glm-5.2",
])

// Integrative tier: multiple files, requires understanding an existing
// component before extending it. GPT-OSS-120B is deliberately NOT in this
// set -- confirmed twice this session (Wave 161/162) that it burns its
// full iteration budget on exactly this task shape without writing
// anything, even after a much-tightened second brief. DeepSeek V4 Pro IS
// included: its one real dispatch got the integrative-shaped design right
// (correct migration/RLS pattern, correct function signatures) even though
// it ran out of budget completing it -- a scope/budget problem, not a
// design-competence one, so it stays eligible here with mandatory audit
// (see model-tier-eligibility.test.ts for the reasoning trail).
const INTEGRATIVE_ELIGIBLE = new Set<string>([
  ...JUDGMENT_ELIGIBLE,
  "z-ai/glm-5v-turbo",
  "z-ai/glm-5-turbo",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-v4-pro",
])

// Mechanical tier: one file, one well-defined operation. Every real,
// registered model is eligible, including GPT-OSS-120B -- its one
// confirmed win (the 6-tool infra scaffolding wave) was this shape.

export function isModelEligibleForTier(model: string, tier: ComplexityTier): boolean {
  if (tier === "mechanical") return true
  if (tier === "integrative") return INTEGRATIVE_ELIGIBLE.has(model)
  return JUDGMENT_ELIGIBLE.has(model)
}

export type TierEligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string; guidance: string }

// AGENTS.md Operating Rule 7c (doer != auditor) has been a written norm,
// not an enforced gate -- confirmed by finding zero CI check anywhere that
// blocks a merge lacking a documented audit. Any model that hasn't earned
// judgment-tier trust gets mandatory audit, full stop, regardless of how
// small the individual task looked -- this is what actually closes that
// gap (see .github/workflows/mandatory-audit-check.yml, the CI job this
// flag feeds).
export function requiresMandatoryAudit(model: string): boolean {
  return !JUDGMENT_ELIGIBLE.has(model)
}

export function checkTierEligibility(model: string, tier: ComplexityTier): TierEligibilityResult {
  if (isModelEligibleForTier(model, tier)) return { eligible: true }
  return {
    eligible: false,
    reason: `Model "${model}" is not eligible for "${tier}" tier tasks.`,
    guidance: tier === "judgment"
      ? "Judgment-tier work (architecture/security/audit) requires z-ai/glm-5.2 -- route this to a judgment-eligible role instead."
      : "Integrative-tier work (multi-file, requires understanding existing code) excludes GPT-OSS-120B specifically -- confirmed twice this session it fails this task shape. Route to a role on z-ai/glm-5.2, deepseek/deepseek-v4-pro, or another integrative-eligible model, or re-scope this task down to 'mechanical' if it's genuinely single-file.",
  }
}
