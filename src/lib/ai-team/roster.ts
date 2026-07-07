// VERIDIAN Cognitive AI OS — Development Team + Guardrail Team roster.
//
// This is the platform's OWN internal engineering organization: the set of
// AI roles that build and govern VERIDIAN itself, distinct from
// orchestra-model-resolver.ts's customer-facing Orchestra Layers (which
// route a customer ORG's product features to a model). Every model here is
// called via OpenRouter (`process.env.OPENROUTER_API_KEY`), following the
// same "platform's own internal orchestration work, never a customer org's
// workflow" posture as resolvePlatformModelConfig() in
// orchestra-model-resolver.ts.
//
// Two roles are Human / interaction-only and are never dispatched through
// team-service.ts: `founder_ceo` (the platform owner) and
// `executive_advisor`, who interacts via Claude Desktop directly — not an
// API call this codebase makes. They're listed here only so the roster is
// a complete, accurate org chart.
//
// Two roles are `isCodeOnly: true` — deterministic code, not an LLM call:
// `cost_policy_engine` (implemented in cost-policy.ts) and
// `user_permission_manager` (the existing RBAC/ABAC checks in
// auth-guard.ts). Listing them here documents their place in the org chart
// without inventing an LLM call that shouldn't exist.
//
// All OpenRouter model slugs below were verified live against
// https://openrouter.ai/api/v1/models on 2026-07-07 — every one of them
// exists in OpenRouter's current catalog under this exact id.

export type TeamName = "VERIDIAN_AI_OS" | "AI_WORKFORCE" | "GUARDRAIL_PLATFORM" | "GUARDRAIL_PRODUCT" | "GUARDRAIL_ACCOUNT" | "GUARDRAIL_USER" | "HUMAN"

export type RoleDefinition = {
  roleKey: string
  team: TeamName
  title: string
  /** OpenRouter model slug, or null for isCodeOnly / isHuman roles. */
  model: string | null
  /** Prompt-OS template key (prompt_templates.template_key) for LLM-backed roles. */
  promptKey: string | null
  isCodeOnly?: boolean
  isHuman?: boolean
}

export const AI_TEAM_ROSTER: RoleDefinition[] = [
  // ─── Human ───────────────────────────────────────────────────────────
  { roleKey: "founder_ceo", team: "HUMAN", title: "Founder & CEO", model: null, promptKey: null, isHuman: true },
  { roleKey: "executive_advisor", team: "HUMAN", title: "Executive Advisor (Interactive — Claude Desktop, not API-dispatched)", model: null, promptKey: null, isHuman: true },

  // ─── VERIDIAN AI OS (routing / management layer) ────────────────────
  { roleKey: "ai_router", team: "VERIDIAN_AI_OS", title: "AI Router / Task Classifier", model: "z-ai/glm-5.2", promptKey: "ai_team.ai_router" },
  { roleKey: "project_manager", team: "VERIDIAN_AI_OS", title: "Project Manager", model: "z-ai/glm-5.2", promptKey: "ai_team.project_manager" },
  { roleKey: "workflow_orchestrator", team: "VERIDIAN_AI_OS", title: "Workflow Orchestrator", model: "z-ai/glm-5.2", promptKey: "ai_team.workflow_orchestrator" },
  { roleKey: "github_issue_planner", team: "VERIDIAN_AI_OS", title: "GitHub Issue Planner", model: "z-ai/glm-5.2", promptKey: "ai_team.github_issue_planner" },
  { roleKey: "cost_policy_engine", team: "VERIDIAN_AI_OS", title: "Cost & Policy Engine (under AI Router control)", model: null, promptKey: null, isCodeOnly: true },

  // ─── AI Workforce (execution layer) ─────────────────────────────────
  { roleKey: "ceo_technical_director", team: "AI_WORKFORCE", title: "CEO / Technical Director", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.ceo_technical_director" },
  { roleKey: "senior_backend_engineer", team: "AI_WORKFORCE", title: "Senior Backend Engineer", model: "deepseek/deepseek-v4-pro", promptKey: "ai_team.senior_backend_engineer" },
  { roleKey: "fullstack_developer", team: "AI_WORKFORCE", title: "Full Stack Developer", model: "deepseek/deepseek-v4-flash", promptKey: "ai_team.fullstack_developer" },
  { roleKey: "frontend_engineer", team: "AI_WORKFORCE", title: "Frontend Engineer", model: "qwen/qwen3.6-27b", promptKey: "ai_team.frontend_engineer" },
  { roleKey: "qa_engineer", team: "AI_WORKFORCE", title: "QA Engineer", model: "deepseek/deepseek-r1-0528", promptKey: "ai_team.qa_engineer" },
  { roleKey: "research_analyst", team: "AI_WORKFORCE", title: "Research Analyst", model: "google/gemini-2.5-pro", promptKey: "ai_team.research_analyst" },
  { roleKey: "documentation_specialist", team: "AI_WORKFORCE", title: "Documentation Specialist", model: "z-ai/glm-5.2", promptKey: "ai_team.documentation_specialist" },
  { roleKey: "devops_engineer", team: "AI_WORKFORCE", title: "DevOps Engineer", model: "deepseek/deepseek-v4-pro", promptKey: "ai_team.devops_engineer" },
  { roleKey: "security_code_reviewer", team: "AI_WORKFORCE", title: "Security & Code Reviewer", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.security_code_reviewer" },
  { roleKey: "escalation_second_opinion", team: "AI_WORKFORCE", title: "Escalation / Second Opinion", model: "openai/gpt-5.5", promptKey: "ai_team.escalation_second_opinion" },

  // ─── Guardrail Team — Platform Level ────────────────────────────────
  { roleKey: "chief_governance_officer", team: "GUARDRAIL_PLATFORM", title: "Chief Governance Officer", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.chief_governance_officer" },
  { roleKey: "security_threat_analyst", team: "GUARDRAIL_PLATFORM", title: "Security & Threat Analyst", model: "openai/gpt-5.5", promptKey: "ai_team.security_threat_analyst" },
  { roleKey: "ai_safety_auditor", team: "GUARDRAIL_PLATFORM", title: "AI Safety Auditor", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.ai_safety_auditor" },
  { roleKey: "cost_governance_officer", team: "GUARDRAIL_PLATFORM", title: "Cost Governance Officer", model: "z-ai/glm-5.2", promptKey: "ai_team.cost_governance_officer" },

  // ─── Guardrail Team — Product Level ──────────────────────────────────
  { roleKey: "product_policy_manager", team: "GUARDRAIL_PRODUCT", title: "Product Policy Manager", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.product_policy_manager" },
  { roleKey: "architecture_compliance_reviewer", team: "GUARDRAIL_PRODUCT", title: "Architecture Compliance Reviewer", model: "deepseek/deepseek-v4-pro", promptKey: "ai_team.architecture_compliance_reviewer" },
  { roleKey: "quality_gate_manager", team: "GUARDRAIL_PRODUCT", title: "Quality Gate Manager", model: "deepseek/deepseek-r1-0528", promptKey: "ai_team.quality_gate_manager" },
  { roleKey: "documentation_compliance", team: "GUARDRAIL_PRODUCT", title: "Documentation Compliance", model: "z-ai/glm-5.2", promptKey: "ai_team.documentation_compliance" },

  // ─── Guardrail Team — Customer Account Level ────────────────────────
  { roleKey: "account_compliance_manager", team: "GUARDRAIL_ACCOUNT", title: "Account Compliance Manager", model: "google/gemini-2.5-pro", promptKey: "ai_team.account_compliance_manager" },
  { roleKey: "data_privacy_officer", team: "GUARDRAIL_ACCOUNT", title: "Data Privacy Officer", model: "anthropic/claude-sonnet-4.6", promptKey: "ai_team.data_privacy_officer" },
  { roleKey: "ai_budget_controller", team: "GUARDRAIL_ACCOUNT", title: "AI Budget Controller", model: "z-ai/glm-5.2", promptKey: "ai_team.ai_budget_controller" },

  // ─── Guardrail Team — Customer User Level ───────────────────────────
  { roleKey: "user_permission_manager", team: "GUARDRAIL_USER", title: "User Permission Manager (VERIDIAN Policy Engine)", model: null, promptKey: null, isCodeOnly: true },
  { roleKey: "ai_response_validator", team: "GUARDRAIL_USER", title: "AI Response Validator", model: "deepseek/deepseek-r1-0528", promptKey: "ai_team.ai_response_validator" },
  { roleKey: "audit_activity_monitor", team: "GUARDRAIL_USER", title: "Audit & Activity Monitor", model: "z-ai/glm-5.2", promptKey: "ai_team.audit_activity_monitor" },
]

export function getRole(roleKey: string): RoleDefinition | undefined {
  return AI_TEAM_ROSTER.find((r) => r.roleKey === roleKey)
}

export function rolesForTeam(team: TeamName): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => r.team === team)
}

/** Every guardrail role across all 4 levels, in enforcement order (platform → product → account → user). */
export function allGuardrailRoles(): RoleDefinition[] {
  return [
    ...rolesForTeam("GUARDRAIL_PLATFORM"),
    ...rolesForTeam("GUARDRAIL_PRODUCT"),
    ...rolesForTeam("GUARDRAIL_ACCOUNT"),
    ...rolesForTeam("GUARDRAIL_USER"),
  ]
}
