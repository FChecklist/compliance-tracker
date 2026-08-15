// ai-os/scripts/audit198/rules-taxonomy.mjs
//
// Owner directive 2026-07-21: audit the 198-item RULES_ARTICLES_198.json
// checklist "through software scripts... so software does complete audit,
// gap analysis" -- not 198 hand-written one-off checkers. This file is the
// ONE place the 198 items are grouped into a small number of thematic
// categories; run-audit.mjs then invokes ONE generic, parameterized
// evidence-gathering routine per category (see category-checkers.mjs),
// once per item in that category, rather than 198 bespoke checks.
//
// The category assignment below was produced by reading all 198 item
// texts in ai-os/RULES_ARTICLES_198.json in full (not guessed from
// summaries) and grouping by dominant theme. It is a data table, same
// as CONSTITUTION.yaml's own section grouping -- re-running the audit
// re-derives evidence and verdicts live against this fixed, reviewable
// taxonomy; the taxonomy itself is the part a human should review in PR,
// same as any other classification rule in this codebase.
//
// Two cross-cutting flags per category:
//   qualitative       -- true if the category is inherently architectural/
//                         aspirational (vision, strategy, tone, UX feel)
//                         such that NO mechanical check can produce a
//                         confident ENFORCED/NOT_YET_BUILT verdict even
//                         with perfect evidence -- these land on
//                         NEEDS_HUMAN_JUDGMENT unless a strong, literal
//                         mechanism match is found.
//   vercelSensitive    -- true if this category's items can partially
//                         depend on live Vercel state that this audit
//                         cannot reach (see AUDIT SCOPE NOTE in run-audit.mjs).
//                         Only CATEGORY_MONITORING_INFRA has this, and
//                         only RULE-019 within it names Vercel explicitly.

export const CATEGORIES = {
  IDENTITY_SCOPE: {
    label: "Identity, business-only scope, confidentiality",
    qualitative: false,
    items: ["RULE-001", "RULE-051", "RULE-052", "RULE-058"],
  },
  SOFTWARE_FIRST_AI_SECOND: {
    label: "Software-First / AI-Second core doctrine",
    qualitative: false,
    items: [
      "RULE-002", "RULE-003", "RULE-004", "RULE-005", "RULE-006", "RULE-007",
      "RULE-008", "RULE-009", "RULE-020", "RULE-029", "RULE-031", "RULE-057",
      "RULE-094", "RULE-098", "ARTICLE-003", "ARTICLE-038", "ARTICLE-098",
    ],
  },
  VISION_STRATEGIC: {
    label: "Aspirational vision / long-term strategic objectives",
    qualitative: true,
    items: [
      "RULE-010", "RULE-011", "RULE-014", "RULE-055", "RULE-066", "RULE-070",
      "RULE-071", "RULE-074", "RULE-082", "RULE-083", "RULE-084", "RULE-097",
      "ARTICLE-087", "ARTICLE-088", "ARTICLE-096", "ARTICLE-097", "ARTICLE-099",
    ],
  },
  PERSONALIZATION: {
    label: "Per-user/per-org personalization",
    qualitative: false,
    items: ["RULE-012", "RULE-056"],
  },
  REUSE_COMPONENTIZATION: {
    label: "Converting AI solutions into reusable software components",
    qualitative: false,
    items: [
      "RULE-013", "RULE-018", "RULE-059", "RULE-060", "RULE-081", "RULE-095",
      "ARTICLE-032", "ARTICLE-033", "ARTICLE-049", "ARTICLE-050", "ARTICLE-052",
      "ARTICLE-090",
    ],
  },
  CONFIDENCE_ROUTING: {
    label: "Confidence-threshold based software-vs-AI routing",
    qualitative: false,
    items: [
      "RULE-015", "RULE-016", "RULE-017", "RULE-030", "RULE-040", "RULE-045",
      "ARTICLE-004",
    ],
  },
  MONITORING_INFRA: {
    label: "Continuous system/infra monitoring",
    qualitative: false,
    vercelSensitive: true,
    items: [
      "RULE-019", "RULE-089", "ARTICLE-056", "ARTICLE-057", "ARTICLE-058",
      "ARTICLE-059", "ARTICLE-082", "ARTICLE-084", "ARTICLE-085",
    ],
  },
  ORCHESTRATOR_GOVERNANCE: {
    label: "Central AI orchestrator, agent roles/authority/routing",
    qualitative: false,
    items: ["RULE-021", "ARTICLE-034", "ARTICLE-035", "ARTICLE-036"],
  },
  TASK_GUARDRAILS_ZERO_AMBIGUITY: {
    label: "Zero-ambiguity task definition, pre/post-execution validation",
    qualitative: false,
    items: [
      "RULE-022", "RULE-099", "ARTICLE-007", "ARTICLE-008", "ARTICLE-039",
      "ARTICLE-040",
    ],
  },
  NO_ASSUMPTIONS_GUESSWORK: {
    label: "No assumptions / no guesswork",
    qualitative: false,
    items: ["RULE-023"],
  },
  ESCALATION_HIERARCHY: {
    label: "Software -> Worker AI -> Supervisor -> Senior -> Master escalation",
    qualitative: false,
    items: ["RULE-024"],
  },
  AI_MODEL_AGNOSTIC: {
    label: "AI model/provider agnosticism",
    qualitative: false,
    items: ["RULE-025", "RULE-065"],
  },
  TRACEABILITY_AUDIT_LOGGING: {
    label: "IDs, audit logging, history, structured event metadata",
    qualitative: false,
    items: [
      "RULE-026", "RULE-061", "RULE-063", "RULE-078", "RULE-079", "RULE-080",
      "ARTICLE-005", "ARTICLE-006", "ARTICLE-024", "ARTICLE-025",
      "ARTICLE-026", "ARTICLE-047", "ARTICLE-048", "ARTICLE-063",
    ],
  },
  UI_UX_ARCHITECTURE: {
    label: "Core 5-part UI, rich interactive output",
    qualitative: false,
    items: ["RULE-027", "RULE-028", "RULE-038", "RULE-039", "RULE-041"],
  },
  VERI_CHAT_ASSISTANT: {
    label: "VERI Chat / VERI Assistant product surfaces",
    qualitative: false,
    items: [
      "RULE-032", "RULE-033", "RULE-034", "RULE-035", "RULE-036", "RULE-037",
      "RULE-047",
    ],
  },
  NOTIFICATIONS_PRODUCTIVITY: {
    label: "Proactive notifications, productivity-value display",
    qualitative: false,
    items: ["RULE-042", "RULE-043", "RULE-044"],
  },
  GUARDRAILS_LEARNING_LOOPS: {
    label: "Bounded learning, no uncontrolled/recursive loops",
    qualitative: false,
    items: ["RULE-046"],
  },
  GOVERNANCE_OWNERSHIP: {
    label: "Ownership, responsibility, authorized-scope governance",
    qualitative: false,
    items: ["RULE-048", "RULE-049", "RULE-050"],
  },
  SHARING_SECURITY: {
    label: "Controlled external sharing",
    qualitative: false,
    items: ["RULE-053", "RULE-054"],
  },
  DEDUPLICATION_SSOT: {
    label: "Single source of truth / zero duplication",
    qualitative: false,
    items: [
      "RULE-062", "RULE-087", "ARTICLE-002", "ARTICLE-020", "ARTICLE-021",
      "ARTICLE-022", "ARTICLE-023",
    ],
  },
  RCA_ERROR_HANDLING: {
    label: "Root-cause analysis, incident ownership, defect closure",
    qualitative: false,
    items: [
      "RULE-064", "RULE-090", "ARTICLE-027", "ARTICLE-028", "ARTICLE-029",
      "ARTICLE-030", "ARTICLE-031",
    ],
  },
  THIN_CLIENT_DEV_ENV: {
    label: "Server-only dev environment (GLM/Claude Code CLI via SSH)",
    qualitative: false,
    items: ["RULE-067"],
  },
  COST_TOKEN_GOVERNANCE: {
    label: "AI cost/token monitoring, zero-waste, lowest-cost routing",
    qualitative: false,
    items: ["RULE-068", "RULE-069", "ARTICLE-037"],
  },
  OPEN_SOURCE_REUSE: {
    label: "Studying industry solutions, preferring OSS",
    qualitative: true,
    items: ["RULE-072", "RULE-073"],
  },
  INTEGRATIONS_API_GOVERNANCE: {
    label: "External integrations, API versioning/deprecation/dependency hygiene",
    qualitative: false,
    items: [
      "RULE-075", "ARTICLE-010", "ARTICLE-078", "ARTICLE-079", "ARTICLE-080",
    ],
  },
  CACHING: {
    label: "Cache layers: use, invalidation, logging",
    qualitative: false,
    items: [
      "RULE-076", "RULE-077", "ARTICLE-051", "ARTICLE-053", "ARTICLE-054",
      "ARTICLE-055",
    ],
  },
  RECOVERY_RESILIENCE: {
    label: "Checkpointing, rollback, graceful failure, resumability",
    qualitative: false,
    items: [
      "RULE-085", "RULE-086", "ARTICLE-018", "ARTICLE-019", "ARTICLE-044",
      "ARTICLE-045", "ARTICLE-046", "ARTICLE-065", "ARTICLE-081", "ARTICLE-083",
    ],
  },
  COMPLETION_RATE_KPI: {
    label: "100% completion target, measurable KPIs",
    qualitative: false,
    items: [
      "RULE-088", "ARTICLE-041", "ARTICLE-086", "ARTICLE-095",
    ],
  },
  DOCUMENTATION: {
    label: "Module/workflow/decision documentation",
    qualitative: false,
    items: ["RULE-091", "ARTICLE-076", "ARTICLE-077"],
  },
  SECURITY_RLS_ACCESS: {
    label: "Security, RBAC, RLS, secrets management, AI write-guardrails",
    qualitative: false,
    items: [
      "RULE-092", "ARTICLE-017", "ARTICLE-060", "ARTICLE-061", "ARTICLE-062",
      "ARTICLE-064",
    ],
  },
  EXPLAINABILITY: {
    label: "Explainability, reproducibility, business-rule precedence",
    qualitative: false,
    items: [
      "RULE-093", "ARTICLE-014", "ARTICLE-015", "ARTICLE-016", "ARTICLE-042",
      "ARTICLE-043", "ARTICLE-089",
    ],
  },
  SOLID_ENGINEERING_DISCIPLINE: {
    label: "SRP, externalized config, scalability, maintainability discipline",
    qualitative: true,
    items: [
      "RULE-096", "ARTICLE-001", "ARTICLE-009", "ARTICLE-011", "ARTICLE-012",
      "ARTICLE-013", "ARTICLE-066", "ARTICLE-091", "ARTICLE-092",
      "ARTICLE-093", "ARTICLE-094",
    ],
  },
  CI_CD_TESTING: {
    label: "Version control, PR review, CI validation, testing discipline",
    qualitative: false,
    items: [
      "ARTICLE-067", "ARTICLE-068", "ARTICLE-069", "ARTICLE-070",
      "ARTICLE-071", "ARTICLE-072", "ARTICLE-073", "ARTICLE-074",
      "ARTICLE-075",
    ],
  },
}

/** Flat item-id -> category-id lookup, built once. */
export const ITEM_TO_CATEGORY = (() => {
  const map = {}
  for (const [categoryId, def] of Object.entries(CATEGORIES)) {
    for (const itemId of def.items) {
      if (map[itemId]) {
        throw new Error(`Taxonomy error: ${itemId} assigned to both ${map[itemId]} and ${categoryId}`)
      }
      map[itemId] = categoryId
    }
  }
  return map
})()

export function categoryForItem(itemId) {
  return ITEM_TO_CATEGORY[itemId] ?? null
}

export function assertFullCoverage(allItemIds) {
  const missing = allItemIds.filter((id) => !ITEM_TO_CATEGORY[id])
  const extra = Object.keys(ITEM_TO_CATEGORY).filter((id) => !allItemIds.includes(id))
  return { missing, extra, complete: missing.length === 0 && extra.length === 0 }
}
