// VERIDIAN Cognitive AI OS — full company AI Team roster.
//
// This is the platform's OWN internal organization: every AI role that
// builds and runs VERIDIAN itself (the whole company, not just
// engineering), distinct from orchestra-model-resolver.ts's customer-
// facing Orchestra Layers (which route a customer ORG's product features
// to a model). Every model here is called via OpenRouter
// (`process.env.OPENROUTER_API_KEY`), following the same "platform's own
// internal orchestration work, never a customer org's workflow" posture
// as resolvePlatformModelConfig() in orchestra-model-resolver.ts.
//
// Wave: expanded 2026-07-07 from the original 10-role Engineering-only
// AI Workforce to the founder's full ~30-role company org chart, per his
// explicit 2-tier model strategy: GLM-5.2 does the primary lifting
// everywhere (proven in production this session -- it's what fixed the
// deepseek-v4-flash failures documented in
// veridian_ai_workforce_autonomous_run_2026-07-07.md), GLM-5V-Turbo for
// anything needing vision (reading designs/screenshots), GLM-5-Turbo for
// high-volume/low-stakes work.
//
// UPDATE (same day): the 9 roles originally reserved for Claude Sonnet 5
// ("judgment-critical" tier) were moved to GLM-5.2 by explicit founder
// decision, after real OpenRouter billing data showed Claude Sonnet 5
// accounted for $11.44 of $12.34 total spend (93%) from just 3 real
// dispatches -- a conversation-history-growth cost bug in
// scripts/ai-workforce-agent.mjs (full tool-call history, including large
// file reads, resent on every iteration) hit hardest on exactly these
// long, multi-file-read tasks. Every operational role in this roster now
// runs on GLM-5.2 except the roles that were never Claude to begin with
// (vision roles stay GLM-5V-Turbo, Research Analyst stays Gemini 2.5 Pro,
// the two "independent second opinion" roles stay GPT-5.5 specifically
// because they need to be a genuinely different vendor from the primary
// reviewer, not because they're expensive).
//
// Two roles are Human / interaction-only and are never dispatched through
// team-service.ts: `founder_ceo` (the platform owner) and
// `executive_advisor`, who interacts via Claude Desktop directly — not an
// API call this codebase makes.
//
// Two roles are `isCodeOnly: true` — deterministic code, not an LLM call:
// `cost_policy_engine` (implemented in cost-policy.ts) and
// `user_permission_manager` (the existing RBAC/ABAC checks in
// auth-guard.ts).
//
// The 4-level Guardrail Team (GUARDRAIL_PLATFORM/PRODUCT/ACCOUNT/USER) is
// a separate, pre-existing governance layer -- it validates actions
// against policy, it doesn't do the operational work. This roster's new
// departments are the company actually doing the work; Guardrail still
// checks it.
//
// All OpenRouter model slugs below were verified live against
// https://openrouter.ai/api/v1/models on 2026-07-07 — every one of them
// exists in OpenRouter's current catalog under this exact id, including
// the 2026-07-07 additions (z-ai/glm-5v-turbo, z-ai/glm-5-turbo,
// anthropic/claude-sonnet-5).

export type TeamName =
  | "VERIDIAN_AI_OS"
  | "ENGINEERING"
  | "QUALITY_SAFETY"
  | "LEGAL_COMPLIANCE"
  | "DATA_TEAM"
  | "CUSTOMER_SETUP"
  | "CUSTOMER_SUPPORT"
  | "SALES_MARKETING"
  | "FINANCE"
  | "HR"
  | "ADMIN"
  | "GUARDRAIL_PLATFORM"
  | "GUARDRAIL_PRODUCT"
  | "GUARDRAIL_ACCOUNT"
  | "GUARDRAIL_USER"
  | "HUMAN"

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

// Model constants -- the founder's exact 2-tier strategy, named once so
// every role below is an obvious, auditable one-line assignment.
const GLM_52 = "z-ai/glm-5.2" // primary lifting: coding, reasoning, most department leads -- now every role that isn't vision/research/second-opinion
const GLM_5V_TURBO = "z-ai/glm-5v-turbo" // vision-capable: reads designs/screenshots
const GLM_5_TURBO = "z-ai/glm-5-turbo" // high-volume/low-stakes: fast, cheap, bulk work
const GEMINI_25_PRO = "google/gemini-2.5-pro" // deep research/analysis, kept from the original roster
const GPT_55 = "openai/gpt-5.5" // genuinely independent second opinion (different vendor than the primary reviewer)
// DEEPSEEK_V4_PRO (added 2026-07-10, founder decision): available model option, not yet
// assigned to a role. Founder discarded the plan to fund a direct ANTHROPIC_API_KEY for a
// headless "Claude" dispatch agent (AGENTS.md's claude-task path, which never had a working
// job behind it anyway -- ai-dispatch.yml only implements a zai-agent stub) in favor of
// this OpenRouter-routed model, verified live against openrouter.ai/api/v1/models 2026-07-10.
const DEEPSEEK_V4_PRO = "deepseek/deepseek-v4-pro" // reserved for future role assignment, not wired to any role yet

export const AI_TEAM_ROSTER: RoleDefinition[] = [
  // ─── Human ───────────────────────────────────────────────────────────
  { roleKey: "founder_ceo", team: "HUMAN", title: "Founder & CEO", model: null, promptKey: null, isHuman: true },
  { roleKey: "executive_advisor", team: "HUMAN", title: "Executive Advisor (Interactive — Claude Desktop, not API-dispatched)", model: null, promptKey: null, isHuman: true },

  // ─── CORE SYSTEM ─────────────────────────────────────────────────────
  { roleKey: "ai_router", team: "VERIDIAN_AI_OS", title: "AI Router / Task Classifier", model: GLM_52, promptKey: "ai_team.ai_router" },
  { roleKey: "project_manager", team: "VERIDIAN_AI_OS", title: "Project Manager", model: GLM_52, promptKey: "ai_team.project_manager" },
  { roleKey: "workflow_orchestrator", team: "VERIDIAN_AI_OS", title: "Workflow Orchestrator", model: GLM_52, promptKey: "ai_team.workflow_orchestrator" },
  { roleKey: "github_issue_planner", team: "VERIDIAN_AI_OS", title: "GitHub Issue Planner", model: GLM_52, promptKey: "ai_team.github_issue_planner" },
  { roleKey: "cost_policy_engine", team: "VERIDIAN_AI_OS", title: "Cost & Policy Engine (under AI Router control)", model: null, promptKey: null, isCodeOnly: true },

  // ─── ENGINEERING (The Factory) ───────────────────────────────────────
  { roleKey: "ceo_technical_director", team: "ENGINEERING", title: "CEO / Technical Director", model: GLM_52, promptKey: "ai_team.ceo_technical_director" },
  { roleKey: "senior_backend_engineer", team: "ENGINEERING", title: "Senior Backend Engineer", model: GLM_52, promptKey: "ai_team.senior_backend_engineer" },
  { roleKey: "fullstack_developer", team: "ENGINEERING", title: "Full Stack Developer", model: GLM_52, promptKey: "ai_team.fullstack_developer" },
  { roleKey: "frontend_engineer", team: "ENGINEERING", title: "Frontend Engineer", model: GLM_5V_TURBO, promptKey: "ai_team.frontend_engineer" },
  { roleKey: "devops_engineer", team: "ENGINEERING", title: "DevOps / Data Engineer", model: GLM_52, promptKey: "ai_team.devops_engineer" },
  { roleKey: "qa_engineer", team: "ENGINEERING", title: "QA Engineer", model: GLM_52, promptKey: "ai_team.qa_engineer" },
  { roleKey: "research_analyst", team: "ENGINEERING", title: "Research Analyst", model: GEMINI_25_PRO, promptKey: "ai_team.research_analyst" },
  { roleKey: "documentation_specialist", team: "ENGINEERING", title: "Documentation Specialist", model: GLM_52, promptKey: "ai_team.documentation_specialist" },
  { roleKey: "escalation_second_opinion", team: "ENGINEERING", title: "Escalation / Second Opinion", model: GPT_55, promptKey: "ai_team.escalation_second_opinion" },

  // ─── QUALITY & SAFETY (The Specialists) ─────────────────────────────
  { roleKey: "security_code_reviewer", team: "QUALITY_SAFETY", title: "Security & Code Reviewer", model: GLM_52, promptKey: "ai_team.security_code_reviewer" },
  { roleKey: "quality_gate_manager", team: "QUALITY_SAFETY", title: "Quality Gate Manager", model: GLM_52, promptKey: "ai_team.quality_gate_manager" },

  // ─── LEGAL & COMPLIANCE ──────────────────────────────────────────────
  { roleKey: "legal_counsel_privacy", team: "LEGAL_COMPLIANCE", title: "Legal Counsel / Privacy", model: GLM_52, promptKey: "ai_team.legal_counsel_privacy" },

  // ─── DATA TEAM ───────────────────────────────────────────────────────
  { roleKey: "data_architect_scientist", team: "DATA_TEAM", title: "Data Architect / Scientist", model: GLM_52, promptKey: "ai_team.data_architect_scientist" },
  { roleKey: "data_quality_checker", team: "DATA_TEAM", title: "Data Quality Checker", model: GLM_5_TURBO, promptKey: "ai_team.data_quality_checker" },

  // ─── CUSTOMER SETUP ──────────────────────────────────────────────────
  { roleKey: "implementation_pm", team: "CUSTOMER_SETUP", title: "Implementation PM", model: GLM_52, promptKey: "ai_team.implementation_pm" },
  { roleKey: "integration_migration", team: "CUSTOMER_SETUP", title: "Integration / Migration", model: GLM_52, promptKey: "ai_team.integration_migration" },
  { roleKey: "uat_qa_engineer", team: "CUSTOMER_SETUP", title: "UAT & QA Engineer", model: GLM_5V_TURBO, promptKey: "ai_team.uat_qa_engineer" },
  { roleKey: "training_documentation", team: "CUSTOMER_SETUP", title: "Training & Documentation", model: GLM_5_TURBO, promptKey: "ai_team.training_documentation" },

  // ─── CUSTOMER SUPPORT ────────────────────────────────────────────────
  { roleKey: "l2_technical_support", team: "CUSTOMER_SUPPORT", title: "L2 Technical Support", model: GLM_52, promptKey: "ai_team.l2_technical_support" },
  { roleKey: "l1_support_faq_bot", team: "CUSTOMER_SUPPORT", title: "L1 Support / FAQ Bot", model: GLM_5_TURBO, promptKey: "ai_team.l1_support_faq_bot" },
  { roleKey: "knowledge_manager", team: "CUSTOMER_SUPPORT", title: "Knowledge Manager", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_manager" },

  // ─── SALES & MARKETING ───────────────────────────────────────────────
  { roleKey: "strategy_proposals", team: "SALES_MARKETING", title: "Strategy & Proposals", model: GLM_52, promptKey: "ai_team.strategy_proposals" },
  { roleKey: "content_director", team: "SALES_MARKETING", title: "Content Director", model: GLM_52, promptKey: "ai_team.content_director" },
  { roleKey: "analytics_seo", team: "SALES_MARKETING", title: "Analytics & SEO", model: GLM_52, promptKey: "ai_team.analytics_seo" },
  { roleKey: "creative_social_media", team: "SALES_MARKETING", title: "Creative / Social Media", model: GLM_5_TURBO, promptKey: "ai_team.creative_social_media" },
  { roleKey: "sdr_email_marketer", team: "SALES_MARKETING", title: "SDR / Email Marketer", model: GLM_5_TURBO, promptKey: "ai_team.sdr_email_marketer" },

  // ─── FINANCE ─────────────────────────────────────────────────────────
  { roleKey: "cfo_financial_planning", team: "FINANCE", title: "CFO / Financial Planning", model: GLM_52, promptKey: "ai_team.cfo_financial_planning" },
  { roleKey: "billing_sub_manager", team: "FINANCE", title: "Billing & Subscription Manager", model: GLM_52, promptKey: "ai_team.billing_sub_manager" },
  { roleKey: "internal_auditor", team: "FINANCE", title: "Internal Auditor", model: GLM_5_TURBO, promptKey: "ai_team.internal_auditor" },
  { roleKey: "accounts_payable_receivable", team: "FINANCE", title: "Accounts Payable / Receivable", model: GLM_5_TURBO, promptKey: "ai_team.accounts_payable_receivable" },
  // Token Usage Analyst (2026-07-08): owns the Token Usage Ledger
  // (compliance.token_usage_ledger, src/lib/services/token-usage-service.ts)
  // -- analyzes AI spend, both internal (AI Team dispatches) and product
  // (per customer account, per end user). Built after a real gap: today's
  // spend could only be answered by querying OpenRouter's own billing API
  // directly, with zero internal record. This role has no live DB query
  // tool of its own (same file-read/write-only constraint as every AI
  // Workforce role) -- its real usage is receiving a GET
  // /api/ai/team/token-usage report (veridian_admin-only) as task input
  // and analyzing it, not querying the ledger live itself.
  { roleKey: "token_usage_analyst", team: "FINANCE", title: "Token Usage Analyst", model: GLM_52, promptKey: "ai_team.token_usage_analyst" },

  // ─── HR ──────────────────────────────────────────────────────────────
  { roleKey: "chro_performance", team: "HR", title: "CHRO / Performance", model: GLM_52, promptKey: "ai_team.chro_performance" },
  { roleKey: "recruitment", team: "HR", title: "Recruitment", model: GLM_52, promptKey: "ai_team.recruitment" },
  { roleKey: "onboarding_payroll", team: "HR", title: "Onboarding / Payroll", model: GLM_5_TURBO, promptKey: "ai_team.onboarding_payroll" },

  // ─── ADMIN ───────────────────────────────────────────────────────────
  { roleKey: "administration_manager", team: "ADMIN", title: "Administration Manager", model: GLM_52, promptKey: "ai_team.administration_manager" },
  { roleKey: "procurement_vendor_mgmt", team: "ADMIN", title: "Procurement / Vendor Management", model: GLM_5_TURBO, promptKey: "ai_team.procurement_vendor_mgmt" },

  // ─── Guardrail Team — Platform Level ────────────────────────────────
  { roleKey: "chief_governance_officer", team: "GUARDRAIL_PLATFORM", title: "Chief Governance Officer", model: GLM_52, promptKey: "ai_team.chief_governance_officer" },
  { roleKey: "security_threat_analyst", team: "GUARDRAIL_PLATFORM", title: "Security & Threat Analyst", model: GPT_55, promptKey: "ai_team.security_threat_analyst" },
  { roleKey: "ai_safety_auditor", team: "GUARDRAIL_PLATFORM", title: "AI Safety Auditor", model: GLM_52, promptKey: "ai_team.ai_safety_auditor" },
  { roleKey: "cost_governance_officer", team: "GUARDRAIL_PLATFORM", title: "Cost Governance Officer", model: GLM_52, promptKey: "ai_team.cost_governance_officer" },

  // ─── Guardrail Team — Product Level ──────────────────────────────────
  { roleKey: "product_policy_manager", team: "GUARDRAIL_PRODUCT", title: "Product Policy Manager", model: GLM_52, promptKey: "ai_team.product_policy_manager" },
  { roleKey: "architecture_compliance_reviewer", team: "GUARDRAIL_PRODUCT", title: "Architecture Compliance Reviewer", model: GLM_52, promptKey: "ai_team.architecture_compliance_reviewer" },
  { roleKey: "quality_gate_manager_guardrail", team: "GUARDRAIL_PRODUCT", title: "Quality Gate Manager (Guardrail)", model: GLM_52, promptKey: "ai_team.quality_gate_manager_guardrail" },
  { roleKey: "documentation_compliance", team: "GUARDRAIL_PRODUCT", title: "Documentation Compliance", model: GLM_52, promptKey: "ai_team.documentation_compliance" },

  // ─── Guardrail Team — Customer Account Level ────────────────────────
  { roleKey: "account_compliance_manager", team: "GUARDRAIL_ACCOUNT", title: "Account Compliance Manager", model: GEMINI_25_PRO, promptKey: "ai_team.account_compliance_manager" },
  { roleKey: "data_privacy_officer", team: "GUARDRAIL_ACCOUNT", title: "Data Privacy Officer", model: GLM_52, promptKey: "ai_team.data_privacy_officer" },
  { roleKey: "ai_budget_controller", team: "GUARDRAIL_ACCOUNT", title: "AI Budget Controller", model: GLM_52, promptKey: "ai_team.ai_budget_controller" },

  // ─── Guardrail Team — Customer User Level ───────────────────────────
  { roleKey: "user_permission_manager", team: "GUARDRAIL_USER", title: "User Permission Manager (VERIDIAN Policy Engine)", model: null, promptKey: null, isCodeOnly: true },
  { roleKey: "ai_response_validator", team: "GUARDRAIL_USER", title: "AI Response Validator", model: GLM_52, promptKey: "ai_team.ai_response_validator" },
  { roleKey: "audit_activity_monitor", team: "GUARDRAIL_USER", title: "Audit & Activity Monitor", model: GLM_5_TURBO, promptKey: "ai_team.audit_activity_monitor" },
]

export function getRole(roleKey: string): RoleDefinition | undefined {
  return AI_TEAM_ROSTER.find((r) => r.roleKey === roleKey)
}

export function rolesForTeam(team: TeamName): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => r.team === team)
}

const GUARDRAIL_TEAMS: TeamName[] = ["GUARDRAIL_PLATFORM", "GUARDRAIL_PRODUCT", "GUARDRAIL_ACCOUNT", "GUARDRAIL_USER"]
const NON_OPERATIONAL_TEAMS: TeamName[] = ["HUMAN", ...GUARDRAIL_TEAMS]

/** Every guardrail role across all 4 levels, in enforcement order (platform → product → account → user). */
export function allGuardrailRoles(): RoleDefinition[] {
  return GUARDRAIL_TEAMS.flatMap((team) => rolesForTeam(team))
}

/** Every operational department role the AI Router may assign a task to -- everything except Human and Guardrail. */
export function operationalRoles(): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => !NON_OPERATIONAL_TEAMS.includes(r.team) && r.team !== "VERIDIAN_AI_OS")
}
