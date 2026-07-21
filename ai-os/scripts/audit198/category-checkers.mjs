// ai-os/scripts/audit198/category-checkers.mjs
//
// One entry per taxonomy category (see rules-taxonomy.mjs). Each entry's
// `infraChecks` is a small, HAND-VERIFIED (via live grep against the real
// repo, 2026-07-21, before this file was written -- see this PR's body for
// the exact commands) list of concrete files/markers that are the
// category's general-purpose mechanism evidence, independent of which
// specific item within the category is being scored. run-audit.mjs runs
// these live (not cached booleans) every execution, then combines the
// result with per-item keyword grep + the CONSTITUTION.yaml cross-
// reference to reach a verdict for each individual item. This is the
// "generic, parameterized evidence-gathering engine per category" the
// framework is built around -- 33 category definitions driving all 198
// item verdicts, not 198 bespoke checks.

export const CATEGORY_INFRA = {
  SOFTWARE_FIRST_AI_SECOND: {
    infraChecks: [
      { file: "src/lib/task-execution-engine.ts", markers: ["executePackageDispatch", "\"novel_capability\""] },
      { file: "src/lib/model-tier-eligibility.ts", markers: ["export function checkTierEligibility"] },
      { file: "src/lib/task-tightening.ts", markers: ["export function validateTightTask"] },
    ],
  },
  CONFIDENCE_ROUTING: {
    infraChecks: [
      { file: "src/lib/task-execution-engine.ts", markers: ["executePackageDispatch", "\"novel_capability\""] },
      { file: "src/lib/model-tier-eligibility.ts", markers: ["export function checkTierEligibility"] },
    ],
  },
  MONITORING_INFRA: {
    infraChecks: [
      { file: "src/lib/monitor-protocol.ts", markers: [] },
    ],
    note: "RULE-019 names GitHub/server/Supabase/Vercel monitoring together. GitHub+server+Supabase have static evidence checkable from this repo; live Vercel deployment status does not (Vercel CLI unauthenticated server-side per this session's confirmed tool state) -- see EVIDENCE_UNAVAILABLE sub-note in that item's gap text.",
  },
  ORCHESTRATOR_GOVERNANCE: {
    infraChecks: [
      { file: "src/lib/ai-team/roster.ts", markers: [] },
      { file: "src/lib/policy-enforcement-engine.ts", markers: ["export function enforcePolicy"] },
    ],
  },
  AI_MODEL_AGNOSTIC: {
    infraChecks: [
      { file: "src/lib/orchestra-model-resolver.ts", markers: ["export function platformApiKeyFor"] },
    ],
  },
  TRACEABILITY_AUDIT_LOGGING: {
    infraChecks: [
      { file: "src/lib/activity-log-service.ts", markers: ["export function recordActivity"] },
    ],
  },
  ESCALATION_HIERARCHY: {
    infraChecks: [
      { file: "src/lib/escalation-ladder.ts", markers: ["export function nextEscalationRung"] },
    ],
  },
  GUARDRAILS_LEARNING_LOOPS: {
    infraChecks: [
      { file: "src/lib/loop-prevention.ts", markers: ["export function checkLoopBudget"] },
    ],
  },
  NO_ASSUMPTIONS_GUESSWORK: {
    infraChecks: [
      { file: "src/lib/services/package-variable-resolver.ts", markers: ["export function resolvePackageVariablesOrThrow", "export class MissingInformationError"] },
    ],
  },
  SECURITY_RLS_ACCESS: {
    infraChecks: [
      { grepDirs: ["drizzle"], grepTerm: "CREATE POLICY", minFileCount: 5 },
    ],
  },
  CACHING: {
    infraChecks: [
      { file: "src/lib/llm-response-cache.ts", markers: [] },
      { file: "src/lib/services/asset-registry-cache.ts", markers: [] },
    ],
  },
  COST_TOKEN_GOVERNANCE: {
    infraChecks: [
      { file: "src/lib/services/token-usage-service.ts", markers: [] },
    ],
  },
  CI_CD_TESTING: {
    infraChecks: [
      { file: ".github/workflows/ci.yml", markers: ["name: Lint", "name: Type Check", "name: Build", "name: Unit Tests"] },
    ],
  },
  THIN_CLIENT_DEV_ENV: {
    infraChecks: [
      // Deliberately expected to find NOTHING -- confirmed by live grep
      // 2026-07-21 that "GLM 5.2" / SSH-only-dev-environment language
      // does not appear in CLAUDE.md or AGENTS.md. Kept as an explicit
      // infra check (not silently omitted) so the absence is itself the
      // evidence, not an assumption.
      { file: "CLAUDE.md", markers: ["GLM 5.2"] },
      { file: "AGENTS.md", markers: ["GLM 5.2"] },
    ],
  },
  IDENTITY_SCOPE: {
    infraChecks: [
      { file: "src/lib/policy-enforcement-engine.ts", markers: ["PERSONAL_USE_PATTERNS"] },
    ],
  },
  INTEGRATIONS_API_GOVERNANCE: {
    infraChecks: [
      { grepDirs: ["src/app/api/v1"], grepTerm: "export", minFileCount: 1 },
    ],
  },
}

/**
 * Categories with no hand-verified infraChecks entry above still get a
 * full, real verdict -- run-audit.mjs falls back to per-item keyword grep
 * (evidence-engine.js:extractKeywords + grepRepo) and the CONSTITUTION.yaml
 * cross-reference for those. This object only holds the categories where a
 * SPECIFIC, general-purpose mechanism file was independently confirmed to
 * exist ahead of time, so the "strong infra evidence" branch of the
 * verdict-derivation decision table has something concrete to cite.
 */
export function infraForCategory(categoryId) {
  return CATEGORY_INFRA[categoryId] ?? null
}
