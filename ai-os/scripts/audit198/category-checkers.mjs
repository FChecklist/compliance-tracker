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
  // Audit198 gap-closure wave 4 (2026-07-21), EXPLAINABILITY/RCA_ERROR_
  // HANDLING/TASK_GUARDRAILS_ZERO_AMBIGUITY/DEDUPLICATION_SSOT: these 4
  // categories had NO infraChecks entry before this pass -- every item in
  // them fell all the way through to per-item keyword grep, which missed
  // real, live, wired mechanisms confirmed by direct code read (not
  // assumed) because the item text's own extracted keywords never happened
  // to co-occur, verbatim, with these files' actual naming (e.g. ARTICLE-
  // 015's "decision"/"explainable" keywords vs. this file's own
  // `explainCrmLeadDecision`/`AiDecisionExplanation` identifiers -- real
  // hits on ai-decision-explanation.ts's OWN keywords, zero overlap with
  // the grep-extracted ones). Each entry below was hand-verified 2026-07-21
  // by reading the file, confirming its exported symbol, and grepping its
  // real callers (not just that the file exists) before being added here.
  EXPLAINABILITY: {
    infraChecks: [
      { file: "src/lib/explainability/ai-decision-explanation.ts", markers: ["export type AiDecisionExplanation", "export function explainCrmLeadDecision"] },
      { file: "src/components/ai/AiDecisionExplanationCard.tsx", markers: [] },
      { file: "src/lib/policy-enforcement-engine.ts", markers: ["export function hasGroundingData"] },
    ],
    note: "ai-decision-explanation.ts (live callers confirmed: src/app/api/tasks/[id]/prediction/route.ts, src/lib/services/crm-service.ts, src/app/(app)/crm/page.tsx, rendered via AiDecisionExplanationCard.tsx) gives crm_leads/crm_opportunities/task-prediction AI decisions a real, structured why/confidence/rejected-alternatives/assumptions explanation. hasGroundingData() is the narrower pre-call proof that a report-generation AI call had real data to reason from at all. Neither is a complete, universal 'every AI decision anywhere is explainable' mechanism (still real gaps -- see individual item verdicts), but both are genuine, live, wired code, not aspirational.",
  },
  RCA_ERROR_HANDLING: {
    infraChecks: [
      { file: "src/lib/db/schema.ts", markers: ["export const incidents = complianceSchemaDB.table('incidents'", "export const problemRecords = complianceSchemaDB.table('problem_records'"] },
      { file: "src/lib/services/ticket-service.ts", markers: ["export async function updateProblemRecord", "export async function createProblemRecord"] },
      { file: "src/lib/rca-closure-gate.ts", markers: ["export function checkProblemRecordClosure", "export function checkIncidentClosure"] },
    ],
    note: "incidents/problemRecords (ITIL-style RCA grouping) + their real API routes (src/app/api/incidents/[id]/route.ts, src/app/api/problem-records/[id]/route.ts) give ARTICLE-027 (incident record) and the RCA-grouping half of ARTICLE-029/030 real, live evidence. rca-closure-gate.ts (added this pass, 2026-07-21) is the ARTICLE-029/031 documented-verification-before-closure enforcement that was confirmed genuinely missing before this fix -- see that module's own header and this PR's body for the before/after.",
  },
  TASK_GUARDRAILS_ZERO_AMBIGUITY: {
    infraChecks: [
      { file: "src/lib/task-tightening.ts", markers: ["export function validateTightTask", "export function validateTaskBrief"] },
      { file: "src/lib/qa-precompletion-gate.ts", markers: ["export function checkQaPreCompletionGate"] },
      { file: "src/app/api/ai/team/dispatch/route.ts", markers: ["evaluateGuardrails(AI_TEAM_DISPATCH_LEAF", "checkQaPreCompletionGate("] },
      { file: "src/lib/task-execution-engine.ts", markers: ["evaluateGuardrails(TASK_FREE_TEXT_PLANNING_LEAF", "detectKnowledgeGap(summaryWithData)"] },
    ],
    note: "validateTightTask()/validateTaskBrief() are wired as PRE-execution blocking gates (422) on both real dispatch surfaces: /api/ai/team/dispatch (TightTask schema, AI_TEAM_DISPATCH_LEAF) and task-execution-engine.ts's free-text customer-task planning path (TASK_FREE_TEXT_PLANNING_LEAF, validateTaskBrief). checkQaPreCompletionGate() is the dispatch route's POST-execution verification gate; task-execution-engine.ts's own post-execution verification pass (detectLowConfidenceResponse/detectKnowledgeGap over the recorded plan, documented via a taskChatMessages system row) was added this pass, 2026-07-21, closing the gap where that second real call site had pre- but no post-execution verification -- see this PR's body.",
  },
  DEDUPLICATION_SSOT: {
    infraChecks: [
      { file: "src/lib/services/task-dedup-service.ts", markers: ["export async function scanForDuplicateTasks", "export async function indexTaskForDedup"] },
      { file: "src/lib/services/capability-registry-service.ts", markers: ["export async function auditDuplicateCapabilities"] },
    ],
    note: "task-dedup-service.ts (live callers: src/app/api/tasks/duplicates/route.ts, src/lib/services/task-service.ts) and capability-registry-service.ts's auditDuplicateCapabilities() are both embedding-similarity-based duplicate-detection mechanisms, entity-agnostic over the same underlying src/lib/embeddings.ts infra (deliberate SSOT: one embeddings table/search primitive, two typed callers, not two parallel implementations) -- real evidence for RULE-062/RULE-087/ARTICLE-002's 'one authoritative implementation' framing, though narrower than a codebase-wide dedup guarantee (still real gaps -- see individual item verdicts).",
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
