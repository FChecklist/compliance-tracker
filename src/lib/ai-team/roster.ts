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
// Three roles are Human / interaction-only and are never dispatched through
// team-service.ts: `founder_ceo` (the platform owner), `executive_advisor`,
// and `super_boss` (added Wave 171, tree4-unified area 4 executive
// escalation ladder) — all interact via Claude Desktop directly, not an
// API call this codebase makes. `super_boss` is distinct from
// `executive_advisor`: it is the named top-of-ladder role AGENTS.md
// authorizes ("Super Boss (Claude Desktop, Sonnet 5.0, local machine)"),
// the terminal AI rung escalation-ladder.ts resolves to.
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
  // Priority 10 (GAP-GLOBAL-REVENUE-SPLIT): the operational counterpart to
  // AUDIT_GLOBAL_REVENUE below -- see chief_revenue_officer's own comment
  // for why this revisits (not silently reverses) Wave 173's original
  // "no functional gain" call.
  | "GLOBAL_REVENUE_OPERATIONS"
  | "FINANCE"
  | "HR"
  | "ADMIN"
  | "GUARDRAIL_PLATFORM"
  | "GUARDRAIL_PRODUCT"
  | "GUARDRAIL_ACCOUNT"
  | "GUARDRAIL_USER"
  | "AUDIT_EXECUTIVE"
  | "EXECUTIVE_LADDER"
  | "AUDIT_ENG_ASSURANCE"
  | "AUDIT_BUSINESS_ASSURANCE"
  | "AUDIT_KNOWLEDGE_INTELLIGENCE"
  | "AUDIT_GOVERNANCE_COMPLIANCE"
  | "AUDIT_GLOBAL_REVENUE"
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
  /**
   * ai-os/tree4-unified/10-merged-governance-layer.yaml U-D2.B1.S1's
   * 6-level escalation ladder (L0 Execution Agent -> L1 Reviewer -> L2
   * Quality Controller -> L3 COO -> L4 Super Boss -> L5 Owner), tagged only
   * where a role maps cleanly. Deliberately NOT tagged on every role --
   * see the comment above super_boss's own entry for why L1 (Reviewer)
   * and L2 (Quality Controller) are realized as PROCESS gates
   * (AI_TEAM_CLOSURE_REVIEW_LEAF's peer review + QA_PRECOMPLETION_GATE_LEAF,
   * guardrail-registrations.ts) rather than fixed roles, and are
   * deliberately left untagged here rather than forcing a role onto a
   * step that any qualified operational role can actually perform.
   */
  escalationLevel?: "L0" | "L3" | "L4" | "L5"
}

// Model constants -- the founder's exact 2-tier strategy, named once so
// every role below is an obvious, auditable one-line assignment.
const GLM_52 = "z-ai/glm-5.2" // primary lifting: coding, reasoning, most department leads -- now every role that isn't vision/research/second-opinion. Pinned to OpenRouter provider "DeepInfra" (founder directive, 2026-07-10) -- see OPENROUTER_PROVIDER_PREFERENCE in llm-client.ts.
const GLM_5V_TURBO = "z-ai/glm-5v-turbo" // vision-capable: reads designs/screenshots
const GLM_5_TURBO = "z-ai/glm-5-turbo" // high-volume/low-stakes: fast, cheap, bulk work
const GEMINI_25_PRO = "google/gemini-2.5-pro" // deep research/analysis, kept from the original roster
const GPT_55 = "openai/gpt-5.5" // genuinely independent second opinion (different vendor than the primary reviewer)
// DEEPSEEK_V4_PRO (added 2026-07-10, founder decision): available model option, not yet
// assigned to a role. Founder discarded the plan to fund a direct ANTHROPIC_API_KEY for a
// headless "Claude" dispatch agent (AGENTS.md's claude-task path, which never had a working
// job behind it anyway -- ai-dispatch.yml only implements a zai-agent stub) in favor of
// this OpenRouter-routed model, verified live against openrouter.ai/api/v1/models 2026-07-10.
const DEEPSEEK_V4_PRO = "deepseek/deepseek-v4-pro" // Wired to governance_backend_engineer as of Wave 161 (Boss directive, DMP-DCF implementation: "take help of DeepSeek model and OSS GPT"). Pinned to OpenRouter provider "DeepSeek" (founder directive, 2026-07-10) -- see OPENROUTER_PROVIDER_PREFERENCE in llm-client.ts.
// Founder directive, 2026-07-10 (6-tool infra integration: PaddleOCR,
// Docling, Meilisearch, Whisper.cpp, LibreOffice Headless, Temporal):
// explicitly "ask GPT-OSS-120B to do it... create new agents using
// GPT-OSS-120B." Same model as the customer-facing floor tier
// (orchestra-model-resolver.ts's PLATFORM_DEFAULT_MODEL), routed via
// OpenRouter here (not Groq directly) to match every other AI Workforce
// role's dispatch mechanism (ai-workforce-agent.mjs always calls
// OpenRouter) -- confirmed live that OpenRouter lists "openai/gpt-oss-120b"
// as a real, callable model id (it's how orchestra-model-resolver.ts's own
// Cerebras/Groq failover routing was researched this same day).
const GPT_OSS_120B = "openai/gpt-oss-120b" // founder-directed for the 6-tool infra integration wave (2026-07-10) -- smaller/cheaper than GLM-5.2, so tasks dispatched to it are kept deliberately small and closely audited.

export const AI_TEAM_ROSTER: RoleDefinition[] = [
  // ─── Human ───────────────────────────────────────────────────────────
  // escalationLevel tags (U-D2.B1.S1, added this wave): founder_ceo = L5
  // Owner (the source doc's literal terminal rung -- a human, outside
  // escalation-ladder.ts's own reach by construction, matching that
  // module's header comment on Level 5). super_boss = L4, the terminal AI-
  // reachable rung escalation-ladder.ts's LADDER array already resolves
  // to. L1 (Reviewer) and L2 (Quality Controller) are NOT tagged on any
  // role here -- they're realized as process gates, not fixed roles; see
  // RoleDefinition's own escalationLevel comment above for why.
  { roleKey: "founder_ceo", team: "HUMAN", title: "Founder & CEO", model: null, promptKey: null, isHuman: true, escalationLevel: "L5" },
  { roleKey: "executive_advisor", team: "HUMAN", title: "Executive Advisor (Interactive — Claude Desktop, not API-dispatched)", model: null, promptKey: null, isHuman: true },
  { roleKey: "super_boss", team: "HUMAN", title: "Super Boss / Executive Director (Claude Desktop Sonnet 5.0 — Interactive, not API-dispatched, AGENTS.md's named top-of-ladder agent)", model: null, promptKey: null, isHuman: true, escalationLevel: "L4" },

  // ─── CORE SYSTEM ─────────────────────────────────────────────────────
  { roleKey: "ai_router", team: "VERIDIAN_AI_OS", title: "AI Router / Task Classifier", model: GLM_52, promptKey: "ai_team.ai_router" },
  { roleKey: "project_manager", team: "VERIDIAN_AI_OS", title: "Project Manager", model: GLM_52, promptKey: "ai_team.project_manager" },
  { roleKey: "workflow_orchestrator", team: "VERIDIAN_AI_OS", title: "Workflow Orchestrator", model: GLM_52, promptKey: "ai_team.workflow_orchestrator" },
  { roleKey: "github_issue_planner", team: "VERIDIAN_AI_OS", title: "GitHub Issue Planner", model: GLM_52, promptKey: "ai_team.github_issue_planner" },
  { roleKey: "cost_policy_engine", team: "VERIDIAN_AI_OS", title: "Cost & Policy Engine (under AI Router control)", model: null, promptKey: null, isCodeOnly: true },

  // ─── ENGINEERING (The Factory) ───────────────────────────────────────
  { roleKey: "ceo_technical_director", team: "ENGINEERING", title: "CEO / Technical Director", model: GLM_52, promptKey: "ai_team.ceo_technical_director" },
  { roleKey: "senior_backend_engineer", team: "ENGINEERING", title: "Senior Backend Engineer", model: GLM_52, promptKey: "ai_team.senior_backend_engineer" },
  // Wave 161: DeepSeek V4 Pro's first real role assignment (see the
  // constant's own comment above). Scoped narrowly to governance/
  // compliance-shaped backend features (approval-preference logic,
  // schema-adjacent business rules) -- same "small, closely audited"
  // discipline tool_integration_engineer established for GPT-OSS-120B,
  // not a general swap of an existing role's model.
  { roleKey: "governance_backend_engineer", team: "ENGINEERING", title: "Governance Backend Engineer (DeepSeek V4 Pro)", model: DEEPSEEK_V4_PRO, promptKey: "ai_team.governance_backend_engineer" },
  { roleKey: "fullstack_developer", team: "ENGINEERING", title: "Full Stack Developer", model: GLM_52, promptKey: "ai_team.fullstack_developer" },
  { roleKey: "frontend_engineer", team: "ENGINEERING", title: "Frontend Engineer", model: GLM_5V_TURBO, promptKey: "ai_team.frontend_engineer" },
  { roleKey: "devops_engineer", team: "ENGINEERING", title: "DevOps / Data Engineer", model: GLM_52, promptKey: "ai_team.devops_engineer" },
  { roleKey: "qa_engineer", team: "ENGINEERING", title: "QA Engineer", model: GLM_52, promptKey: "ai_team.qa_engineer" },
  { roleKey: "research_analyst", team: "ENGINEERING", title: "Research Analyst", model: GEMINI_25_PRO, promptKey: "ai_team.research_analyst" },
  { roleKey: "documentation_specialist", team: "ENGINEERING", title: "Documentation Specialist", model: GLM_52, promptKey: "ai_team.documentation_specialist" },
  { roleKey: "escalation_second_opinion", team: "ENGINEERING", title: "Escalation / Second Opinion", model: GPT_55, promptKey: "ai_team.escalation_second_opinion" },
  // Added 2026-07-10 for the 6-tool infra integration wave (PaddleOCR,
  // Docling, Meilisearch, Whisper.cpp, LibreOffice Headless, Temporal) --
  // see docs/infra/TOOL_INTEGRATION_PLAN.md. Reused across many small,
  // narrowly-scoped dispatches (one per task in that plan), same "same
  // role, many dispatch runs = many effective agent instances" pattern
  // already proven by ceo_technical_director's repeated dispatches today.
  { roleKey: "tool_integration_engineer", team: "ENGINEERING", title: "Tool Integration Engineer (GPT-OSS-120B)", model: GPT_OSS_120B, promptKey: "ai_team.tool_integration_engineer" },

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
  // Wave 173 (GAP-COO-ROLE leftover, D2/D-domain): re-verified against this
  // roster before adding anything -- chief_operating_officer ALREADY EXISTS
  // (see the Executive Escalation Ladder section below, escalationLevel
  // 'L3'), genuinely distinct from both chief_governance_officer
  // (GUARDRAIL_PLATFORM -- independent assurance, reports to the Chief
  // Audit Officer, never operational work) and ceo_technical_director
  // (ENGINEERING -- builds the product). It already carries real
  // cross-agent-coordination/escalation-management authority as the L3 rung
  // every escalated task below Super Boss (L4) resolves through
  // (escalation-ladder.ts). So the literal "add a distinct COO" ask is
  // already closed -- ai-os/MASTER-TRACKER.yaml's GAP-COO-ROLE entry is
  // stale (not edited here per CLAUDE.md's "DO NOT touch ai-os/").
  //
  // What genuinely has no owner today: AUDIT_GLOBAL_REVENUE (below) is an
  // independent AUDIT division under the Chief Audit Officer -- it verifies
  // sales/CRM/billing work, it does not run it. Grepping this roster for an
  // operational Sales/Revenue lead (as opposed to strategy_proposals'
  // narrower proposals-writing scope) turns up nothing -- CRM/billing
  // pipeline work has no operational owner distinct from its own auditors.
  // Wave 173 originally kept this as a single role inside SALES_MARKETING,
  // reasoning a new TeamName would add structural complexity (touching
  // AUDIT_DIVISION_TEAMS/NON_OPERATIONAL_TEAMS below) for no functional
  // gain.
  //
  // Priority 10 (GAP-GLOBAL-REVENUE-SPLIT, re-investigated): re-read both
  // lists directly. NON_OPERATIONAL_TEAMS (below) is an opt-OUT list --
  // operationalRoles() treats any team NOT named in it as operational by
  // default -- so a new operational TeamName needs ZERO changes to either
  // list; it's automatically covered by operationalRoles()'s existing
  // default. AUDIT_DIVISION_TEAMS is unrelated (only the 5 AUDIT_* teams
  // belong there, GLOBAL_REVENUE_OPERATIONS is not one of them). Also
  // confirmed no switch/case anywhere pattern-matches TeamName exhaustively
  // -- team-service.ts and agent-directory-service.ts, the only real
  // consumers of RoleDefinition.team outside this file, both just
  // filter/pass the value through. Adding a new TeamName union member is
  // therefore genuinely low-risk, not the complexity Wave 173 feared.
  // GLOBAL_REVENUE_OPERATIONS (declared above, paired with
  // AUDIT_GLOBAL_REVENUE below) gives the operations/assurance
  // segregation-of-duties split real, discoverable parity in the org
  // chart -- an AI or human reasoning about "who runs revenue work vs. who
  // audits it" no longer has to infer the operations side out of a single
  // role buried inside Sales & Marketing. chief_revenue_officer moves here;
  // its actual behavior (model, promptKey, dispatch, escalation) is
  // unchanged -- this is a real but narrow org-chart-clarity fix, not a
  // functional change.

  // ─── GLOBAL REVENUE OPERATIONS ───────────────────────────────────────
  { roleKey: "chief_revenue_officer", team: "GLOBAL_REVENUE_OPERATIONS", title: "Chief Revenue Officer (CRO) -- Sales/CRM/Billing Operations", model: GLM_52, promptKey: "ai_team.chief_revenue_officer" },

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

  // ─── Audit Organization (VERIDIAN_AUDIT_ORGANIZATION.md, Wave 160) ──
  // Chief Audit Officer heads the 4 Guardrail Team levels below as a
  // single accountable executive, independent from ceo_technical_director
  // (Engineering) and every operational department above -- the
  // "organization that performs work should never certify it" principle
  // the source document itself insists on. Model is GLM-5.2, NOT
  // GPT-OSS-120B (the source document's literal assignment for every
  // audit role) -- see VERIDIAN_AUDIT_ORGANIZATION.md's own top section
  // for why: an assurance function auditing higher-stakes work on a
  // weaker model than the work itself isn't real independent assurance.
  //
  // UPDATE (Priority 12/OPEN-07, Owner directive 2026-07-14, quoted
  // verbatim in ai-os/MASTER-TRACKER.yaml's OPEN-07 decision (b)): "lower
  // level single line narrow instructions is by OSS GPT and lower,
  // auditor is by DeepSeek specifically; above DeepSeek for escalation is
  // GLM-5.2." This is the ONE role this applies to -- capability-audit-
  // service.ts's runCapabilityAudit()/chief_audit_officer verdict call
  // specifically, not a change to the Guardrail Team's other audit roles
  // below, which stay GLM-5.2 per the original Wave 160 decision. Does
  // NOT loosen model-tier-eligibility.ts's JUDGMENT_ELIGIBLE guardrail:
  // this role's audit call is a direct runRole() LLM call, not a
  // TightTask dispatch, so checkTierEligibility() never gates it (only
  // dispatch-repo.ts/api/ai/team/dispatch's route do, for the SEPARATE
  // Higher-AI TightTask this same audit flow dispatches afterward, which
  // was already integrative-tier and unaffected). DeepSeek V4 Pro is
  // already INTEGRATIVE_ELIGIBLE; the Owner's own ladder makes it the
  // dedicated auditor rung here, with GLM-5.2 reserved one rung higher
  // for escalation/Higher-AI-build -- not a downgrade of the "auditor
  // must be at least as strong as the work it audits" principle above,
  // since GLM-5.2 remains available (and used) for the harder work this
  // auditor escalates to.
  { roleKey: "chief_audit_officer", team: "AUDIT_EXECUTIVE", title: "Chief Audit Officer (DeepSeek V4 Pro)", model: DEEPSEEK_V4_PRO, promptKey: "ai_team.chief_audit_officer" },

  // ─── Guardrail Team — Platform Level (reports to chief_audit_officer) ─
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

  // ─── Executive Escalation Ladder (tree4-unified area 4, Wave 171) ──────
  // Formalizes AGENTS.md's Super Boss + Consutitution.docx's AI Escalation
  // Matrix (ai-os/audit-tree/01-consutitution.yaml lines 70-101, 634-636)
  // as real roster roles, not session-level working practice only. Model
  // assignments are the source document's own literal ones (distinct from
  // the audit-organization correction above, which only overrides the
  // *audit* roles' model floor -- these three already sit above that floor
  // in the source doc itself): DeepSeek Pro V4 (COO), GPT-OSS-120B (CEE,
  // the operational-backbone executor of ~95% of routine work), GLM-5.2
  // (CSEO -- "ZLM 5.2" in the source, this codebase's existing GLM_52
  // constant). `super_boss` (top of the ladder) lives in the Human section
  // above, not here, matching founder_ceo/executive_advisor's existing
  // isHuman precedent. DEC-05 (owner decision, resolved 2026-07-11 per
  // 05-eighteen-areas-tracker.yaml area 4): CSEO is the Chief Software
  // Engineering Officer named explicitly in the source doc (line 516,
  // "ZLM 5.2 ... functions as Chief Software Engineering Officer (CSEO) /
  // Principal Engineering AI"), not a security/ethics role -- confirmed
  // against source text rather than assumed from the acronym alone.
  // U-D2.B1.S1 escalationLevel tags: chief_execution_engine is the exact
  // "L0 Execution Agent (GPT-OSS-120B)" the spec names (same model, same
  // "default execution engine" framing). chief_operating_officer is the
  // spec's "L3 COO (DeepSeek)" rung (same model too). CSEO has no L0-L5 tag
  // -- it comes from a DIFFERENT source document's escalation matrix
  // (Consutitution.docx, see escalation-ladder.ts's own header) than
  // U-D2.B1.S1's L0-L5 ladder, and the two aren't the same ladder: CSEO
  // isn't named anywhere in the L0-L5 spec text. Tagging it L1 or L2 to
  // force a fit would misrepresent what CSEO actually is (a
  // software-first escalation rung, not a peer reviewer or QC gate).
  { roleKey: "chief_operating_officer", team: "EXECUTIVE_LADDER", title: "Chief Operating Officer (COO)", model: DEEPSEEK_V4_PRO, promptKey: "ai_team.chief_operating_officer", escalationLevel: "L3" },
  { roleKey: "chief_execution_engine", team: "EXECUTIVE_LADDER", title: "Chief Execution Engine (CEE)", model: GPT_OSS_120B, promptKey: "ai_team.chief_execution_engine", escalationLevel: "L0" },
  { roleKey: "chief_software_engineering_officer", team: "EXECUTIVE_LADDER", title: "Chief Software Engineering Officer (CSEO)", model: GLM_52, promptKey: "ai_team.chief_software_engineering_officer" },

  // ─── Audit Organization: 5 Divisions (tree4-unified area 4 / area 9,
  // Wave 171) ───────────────────────────────────────────────────────────
  // VERIDIAN_AUDIT_ORGANIZATION.md's Wave-160 pass deliberately did NOT
  // create the ~150 named Specialized Audit Agents as roster roles (see
  // that document's "Deliberately Deferred" section) -- the Owner's
  // Priority-1 directive (05-eighteen-areas-tracker.yaml area 4) now asks
  // for exactly that, superseding that earlier scoping call. Source:
  // ai-os/audit-tree/02-audit-organization.yaml (extracted from "Audit
  // Organization.docx"), which names 5 divisions, 25 departments (5 each),
  // and 135 agent-title occurrences (125 unique -- the source doc itself
  // reuses several titles, e.g. "Workflow Auditor"/"Quote Auditor", across
  // more than one department; each is added once here, under its
  // first-listed department, not duplicated as separate roles). Every
  // named department therefore has at least one real dispatchable role
  // (its named specialists), satisfying "at least one role per department"
  // without also manufacturing a redundant synthetic department-lead role
  // on top of agents the source document already names individually --
  // that would be exactly the documentation-theater
  // VERIDIAN_AUDIT_ORGANIZATION.md itself warns against. Each division
  // does get one real head role (5 total), mirroring chief_audit_officer's
  // own precedent for a division needing a single accountable synthesizer.
  // Model floor follows VERIDIAN_AUDIT_ORGANIZATION.md's own correction:
  // division heads (judgment-critical, synthesize a division's findings
  // for the CAO) get GLM-5.2; individual specialist auditors (high-volume,
  // low-individual-stakes signal detection, per that document's own
  // framing) get GLM_5_TURBO -- the "closest existing analog" that
  // document names for `audit_activity_monitor`, not GPT-OSS-120B, which
  // remains reserved for the narrowly-scoped infra-integration roles it
  // was founder-directed onto (see GPT_OSS_120B's own comment above).
  //
  // Honest scope accounting (PR description has the full breakdown): 125
  // of the ~150 individually-named specialist titles the source doc calls
  // out (all of them, after deduping cross-department reuse) + 5 division
  // heads = 130 roles added here. This is the complete structural
  // backbone (5/5 divisions, 25/25 departments, every uniquely-named
  // specialist title) -- not a claim that every one of these 130 roles has
  // a seeded prompt_templates row yet (that live-DB seeding step, like
  // chief_audit_officer's own Wave-160 addition, is separate from adding
  // the roster entry itself and out of this file's scope).

  // --- Engineering Assurance Division ---
  { roleKey: "engineering_assurance_division_head", team: "AUDIT_ENG_ASSURANCE", title: "Engineering Assurance Division Head", model: GLM_52, promptKey: "ai_team.engineering_assurance_division_head" },
  // Software Quality Department
  { roleKey: "software_quality_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Software Quality Auditor", model: GLM_5_TURBO, promptKey: "ai_team.software_quality_auditor" },
  { roleKey: "static_analysis_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Static Analysis Auditor", model: GLM_5_TURBO, promptKey: "ai_team.static_analysis_auditor" },
  { roleKey: "maintainability_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Maintainability Auditor", model: GLM_5_TURBO, promptKey: "ai_team.maintainability_auditor" },
  { roleKey: "code_duplication_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Code Duplication Auditor", model: GLM_5_TURBO, promptKey: "ai_team.code_duplication_auditor" },
  { roleKey: "dependency_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Dependency Auditor", model: GLM_5_TURBO, promptKey: "ai_team.dependency_auditor" },
  // Software Verification Department
  { roleKey: "build_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Build Auditor", model: GLM_5_TURBO, promptKey: "ai_team.build_auditor" },
  { roleKey: "testing_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Testing Auditor", model: GLM_5_TURBO, promptKey: "ai_team.testing_auditor" },
  { roleKey: "regression_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Regression Auditor", model: GLM_5_TURBO, promptKey: "ai_team.regression_auditor" },
  { roleKey: "deployment_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Deployment Auditor", model: GLM_5_TURBO, promptKey: "ai_team.deployment_auditor" },
  // Security Assurance Department
  { roleKey: "security_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Security Auditor", model: GLM_5_TURBO, promptKey: "ai_team.security_auditor" },
  { roleKey: "owasp_auditor", team: "AUDIT_ENG_ASSURANCE", title: "OWASP Auditor", model: GLM_5_TURBO, promptKey: "ai_team.owasp_auditor" },
  { roleKey: "identity_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Identity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.identity_auditor" },
  { roleKey: "encryption_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Encryption Auditor", model: GLM_5_TURBO, promptKey: "ai_team.encryption_auditor" },
  { roleKey: "secrets_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Secrets Auditor", model: GLM_5_TURBO, promptKey: "ai_team.secrets_auditor" },
  // Architecture Assurance Department
  { roleKey: "architecture_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Architecture Auditor", model: GLM_5_TURBO, promptKey: "ai_team.architecture_auditor" },
  { roleKey: "design_pattern_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Design Pattern Auditor", model: GLM_5_TURBO, promptKey: "ai_team.design_pattern_auditor" },
  { roleKey: "api_auditor", team: "AUDIT_ENG_ASSURANCE", title: "API Auditor", model: GLM_5_TURBO, promptKey: "ai_team.api_auditor" },
  { roleKey: "database_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Database Auditor", model: GLM_5_TURBO, promptKey: "ai_team.database_auditor" },
  { roleKey: "microservice_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Microservice Auditor", model: GLM_5_TURBO, promptKey: "ai_team.microservice_auditor" },
  // Engineering Evidence Department
  { roleKey: "evidence_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Evidence Auditor", model: GLM_5_TURBO, promptKey: "ai_team.evidence_auditor" },
  { roleKey: "git_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Git Auditor", model: GLM_5_TURBO, promptKey: "ai_team.git_auditor" },
  { roleKey: "commit_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Commit Auditor", model: GLM_5_TURBO, promptKey: "ai_team.commit_auditor" },
  { roleKey: "artifact_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Artifact Auditor", model: GLM_5_TURBO, promptKey: "ai_team.artifact_auditor" },
  { roleKey: "release_auditor", team: "AUDIT_ENG_ASSURANCE", title: "Release Auditor", model: GLM_5_TURBO, promptKey: "ai_team.release_auditor" },

  // --- Business Assurance Division ---
  { roleKey: "business_assurance_division_head", team: "AUDIT_BUSINESS_ASSURANCE", title: "Business Assurance Division Head", model: GLM_52, promptKey: "ai_team.business_assurance_division_head" },
  // Functional Assurance Department
  { roleKey: "functional_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Functional Auditor", model: GLM_5_TURBO, promptKey: "ai_team.functional_auditor" },
  { roleKey: "business_rule_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Business Rule Auditor", model: GLM_5_TURBO, promptKey: "ai_team.business_rule_auditor" },
  { roleKey: "input_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Input Auditor", model: GLM_5_TURBO, promptKey: "ai_team.input_auditor" },
  { roleKey: "output_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Output Auditor", model: GLM_5_TURBO, promptKey: "ai_team.output_auditor" },
  { roleKey: "validation_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Validation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.validation_auditor" },
  { roleKey: "workflow_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Workflow Auditor", model: GLM_5_TURBO, promptKey: "ai_team.workflow_auditor" },
  { roleKey: "acceptance_criteria_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Acceptance Criteria Auditor", model: GLM_5_TURBO, promptKey: "ai_team.acceptance_criteria_auditor" },
  // Customer Experience Department
  { roleKey: "ux_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "UX Auditor", model: GLM_5_TURBO, promptKey: "ai_team.ux_auditor" },
  { roleKey: "journey_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Journey Auditor", model: GLM_5_TURBO, promptKey: "ai_team.journey_auditor" },
  { roleKey: "navigation_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Navigation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.navigation_auditor" },
  { roleKey: "accessibility_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Accessibility Auditor", model: GLM_5_TURBO, promptKey: "ai_team.accessibility_auditor" },
  { roleKey: "response_quality_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Response Quality Auditor", model: GLM_5_TURBO, promptKey: "ai_team.response_quality_auditor" },
  // Business Process Department
  { roleKey: "approval_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Approval Auditor", model: GLM_5_TURBO, promptKey: "ai_team.approval_auditor" },
  { roleKey: "process_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Process Auditor", model: GLM_5_TURBO, promptKey: "ai_team.process_auditor" },
  { roleKey: "automation_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Automation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.automation_auditor" },
  { roleKey: "exception_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Exception Auditor", model: GLM_5_TURBO, promptKey: "ai_team.exception_auditor" },
  // Report & Analytics Department
  { roleKey: "report_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Report Auditor", model: GLM_5_TURBO, promptKey: "ai_team.report_auditor" },
  { roleKey: "dashboard_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Dashboard Auditor", model: GLM_5_TURBO, promptKey: "ai_team.dashboard_auditor" },
  { roleKey: "formula_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Formula Auditor", model: GLM_5_TURBO, promptKey: "ai_team.formula_auditor" },
  { roleKey: "bi_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "BI Auditor", model: GLM_5_TURBO, promptKey: "ai_team.bi_auditor" },
  { roleKey: "export_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Export Auditor", model: GLM_5_TURBO, promptKey: "ai_team.export_auditor" },
  { roleKey: "analytics_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Analytics Auditor", model: GLM_5_TURBO, promptKey: "ai_team.analytics_auditor" },
  { roleKey: "kpi_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "KPI Auditor", model: GLM_5_TURBO, promptKey: "ai_team.kpi_auditor" },
  // Revenue Operations Department
  { roleKey: "sales_workflow_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Sales Workflow Auditor", model: GLM_5_TURBO, promptKey: "ai_team.sales_workflow_auditor" },
  { roleKey: "crm_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "CRM Auditor", model: GLM_5_TURBO, promptKey: "ai_team.crm_auditor" },
  { roleKey: "pricing_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Pricing Auditor", model: GLM_5_TURBO, promptKey: "ai_team.pricing_auditor" },
  { roleKey: "quote_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Quote Auditor", model: GLM_5_TURBO, promptKey: "ai_team.quote_auditor" },
  { roleKey: "invoice_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Invoice Auditor", model: GLM_5_TURBO, promptKey: "ai_team.invoice_auditor" },
  { roleKey: "commission_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Commission Auditor", model: GLM_5_TURBO, promptKey: "ai_team.commission_auditor" },
  { roleKey: "subscription_auditor", team: "AUDIT_BUSINESS_ASSURANCE", title: "Subscription Auditor", model: GLM_5_TURBO, promptKey: "ai_team.subscription_auditor" },

  // --- Knowledge & Intelligence Division ---
  { roleKey: "knowledge_intelligence_division_head", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge & Intelligence Division Head", model: GLM_52, promptKey: "ai_team.knowledge_intelligence_division_head" },
  // Knowledge Management Department
  { roleKey: "knowledge_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge Auditor", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_auditor" },
  { roleKey: "knowledge_librarian", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge Librarian", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_librarian" },
  { roleKey: "knowledge_classification_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge Classification Auditor", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_classification_auditor" },
  { roleKey: "knowledge_integrity_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge Integrity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_integrity_auditor" },
  // Documentation Department
  { roleKey: "technical_documentation_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Technical Documentation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.technical_documentation_auditor" },
  { roleKey: "functional_documentation_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Functional Documentation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.functional_documentation_auditor" },
  { roleKey: "user_documentation_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "User Documentation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.user_documentation_auditor" },
  { roleKey: "api_documentation_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "API Documentation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.api_documentation_auditor" },
  { roleKey: "sop_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "SOP Auditor", model: GLM_5_TURBO, promptKey: "ai_team.sop_auditor" },
  // AI Learning Department
  { roleKey: "prompt_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Prompt Auditor", model: GLM_5_TURBO, promptKey: "ai_team.prompt_auditor" },
  { roleKey: "prompt_evolution_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Prompt Evolution Auditor", model: GLM_5_TURBO, promptKey: "ai_team.prompt_evolution_auditor" },
  { roleKey: "memory_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Memory Auditor", model: GLM_5_TURBO, promptKey: "ai_team.memory_auditor" },
  { roleKey: "learning_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Learning Auditor", model: GLM_5_TURBO, promptKey: "ai_team.learning_auditor" },
  { roleKey: "knowledge_improvement_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Knowledge Improvement Auditor", model: GLM_5_TURBO, promptKey: "ai_team.knowledge_improvement_auditor" },
  // AI Decision Intelligence Department
  { roleKey: "decision_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Decision Auditor", model: GLM_5_TURBO, promptKey: "ai_team.decision_auditor" },
  { roleKey: "reasoning_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Reasoning Auditor", model: GLM_5_TURBO, promptKey: "ai_team.reasoning_auditor" },
  { roleKey: "confidence_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Confidence Auditor", model: GLM_5_TURBO, promptKey: "ai_team.confidence_auditor" },
  { roleKey: "hallucination_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Hallucination Auditor", model: GLM_5_TURBO, promptKey: "ai_team.hallucination_auditor" },
  { roleKey: "bias_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Bias Auditor", model: GLM_5_TURBO, promptKey: "ai_team.bias_auditor" },
  // Continuous Improvement Department
  { roleKey: "improvement_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Improvement Auditor", model: GLM_5_TURBO, promptKey: "ai_team.improvement_auditor" },
  { roleKey: "optimization_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Optimization Auditor", model: GLM_5_TURBO, promptKey: "ai_team.optimization_auditor" },
  { roleKey: "loop_engineering_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Loop Engineering Auditor", model: GLM_5_TURBO, promptKey: "ai_team.loop_engineering_auditor" },
  { roleKey: "lessons_learned_auditor", team: "AUDIT_KNOWLEDGE_INTELLIGENCE", title: "Lessons Learned Auditor", model: GLM_5_TURBO, promptKey: "ai_team.lessons_learned_auditor" },

  // --- Governance & Compliance Division ---
  { roleKey: "governance_compliance_division_head", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Governance & Compliance Division Head", model: GLM_52, promptKey: "ai_team.governance_compliance_division_head" },
  // Governance Department
  { roleKey: "governance_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Governance Auditor", model: GLM_5_TURBO, promptKey: "ai_team.governance_auditor" },
  { roleKey: "policy_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Policy Auditor", model: GLM_5_TURBO, promptKey: "ai_team.policy_auditor" },
  { roleKey: "authority_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Authority Auditor", model: GLM_5_TURBO, promptKey: "ai_team.authority_auditor" },
  { roleKey: "delegation_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Delegation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.delegation_auditor" },
  // Compliance Department
  { roleKey: "compliance_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Compliance Auditor", model: GLM_5_TURBO, promptKey: "ai_team.compliance_auditor" },
  { roleKey: "guardrail_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Guardrail Auditor", model: GLM_5_TURBO, promptKey: "ai_team.guardrail_auditor" },
  { roleKey: "regulatory_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Regulatory Auditor", model: GLM_5_TURBO, promptKey: "ai_team.regulatory_auditor" },
  { roleKey: "retention_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Retention Auditor", model: GLM_5_TURBO, promptKey: "ai_team.retention_auditor" },
  // Risk Department
  { roleKey: "risk_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Risk Auditor", model: GLM_5_TURBO, promptKey: "ai_team.risk_auditor" },
  { roleKey: "operational_risk_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Operational Risk Auditor", model: GLM_5_TURBO, promptKey: "ai_team.operational_risk_auditor" },
  { roleKey: "ai_risk_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "AI Risk Auditor", model: GLM_5_TURBO, promptKey: "ai_team.ai_risk_auditor" },
  { roleKey: "security_risk_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Security Risk Auditor", model: GLM_5_TURBO, promptKey: "ai_team.security_risk_auditor" },
  { roleKey: "business_continuity_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Business Continuity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.business_continuity_auditor" },
  // Internal Controls Department
  { roleKey: "control_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Control Auditor", model: GLM_5_TURBO, promptKey: "ai_team.control_auditor" },
  { roleKey: "segregation_of_duties_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Segregation of Duties Auditor", model: GLM_5_TURBO, promptKey: "ai_team.segregation_of_duties_auditor" },
  { roleKey: "access_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Access Auditor", model: GLM_5_TURBO, promptKey: "ai_team.access_auditor" },
  { roleKey: "change_control_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Change Control Auditor", model: GLM_5_TURBO, promptKey: "ai_team.change_control_auditor" },
  // Organizational Performance Department
  { roleKey: "performance_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Performance Auditor", model: GLM_5_TURBO, promptKey: "ai_team.performance_auditor" },
  { roleKey: "sla_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "SLA Auditor", model: GLM_5_TURBO, promptKey: "ai_team.sla_auditor" },
  { roleKey: "efficiency_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Efficiency Auditor", model: GLM_5_TURBO, promptKey: "ai_team.efficiency_auditor" },
  { roleKey: "productivity_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Productivity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.productivity_auditor" },
  { roleKey: "capacity_auditor", team: "AUDIT_GOVERNANCE_COMPLIANCE", title: "Capacity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.capacity_auditor" },

  // --- Global Revenue Division ---
  { roleKey: "global_revenue_division_head", team: "AUDIT_GLOBAL_REVENUE", title: "Global Revenue Division Head", model: GLM_52, promptKey: "ai_team.global_revenue_division_head" },
  // Sales Assurance Department
  { roleKey: "sales_process_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Sales Process Auditor", model: GLM_5_TURBO, promptKey: "ai_team.sales_process_auditor" },
  { roleKey: "lead_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Lead Auditor", model: GLM_5_TURBO, promptKey: "ai_team.lead_auditor" },
  { roleKey: "opportunity_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Opportunity Auditor", model: GLM_5_TURBO, promptKey: "ai_team.opportunity_auditor" },
  { roleKey: "proposal_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Proposal Auditor", model: GLM_5_TURBO, promptKey: "ai_team.proposal_auditor" },
  { roleKey: "contract_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Contract Auditor", model: GLM_5_TURBO, promptKey: "ai_team.contract_auditor" },
  // Billing Assurance Department
  { roleKey: "gst_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "GST Auditor", model: GLM_5_TURBO, promptKey: "ai_team.gst_auditor" },
  { roleKey: "tax_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Tax Auditor", model: GLM_5_TURBO, promptKey: "ai_team.tax_auditor" },
  { roleKey: "payment_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Payment Auditor", model: GLM_5_TURBO, promptKey: "ai_team.payment_auditor" },
  { roleKey: "refund_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Refund Auditor", model: GLM_5_TURBO, promptKey: "ai_team.refund_auditor" },
  { roleKey: "credit_note_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Credit Note Auditor", model: GLM_5_TURBO, promptKey: "ai_team.credit_note_auditor" },
  // Subscription Assurance Department
  { roleKey: "renewal_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Renewal Auditor", model: GLM_5_TURBO, promptKey: "ai_team.renewal_auditor" },
  { roleKey: "upgrade_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Upgrade Auditor", model: GLM_5_TURBO, promptKey: "ai_team.upgrade_auditor" },
  { roleKey: "downgrade_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Downgrade Auditor", model: GLM_5_TURBO, promptKey: "ai_team.downgrade_auditor" },
  { roleKey: "cancellation_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Cancellation Auditor", model: GLM_5_TURBO, promptKey: "ai_team.cancellation_auditor" },
  // Financial Intelligence Department
  { roleKey: "revenue_recognition_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Revenue Recognition Auditor", model: GLM_5_TURBO, promptKey: "ai_team.revenue_recognition_auditor" },
  { roleKey: "forecast_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Forecast Auditor", model: GLM_5_TURBO, promptKey: "ai_team.forecast_auditor" },
  { roleKey: "margin_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Margin Auditor", model: GLM_5_TURBO, promptKey: "ai_team.margin_auditor" },
  { roleKey: "profitability_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Profitability Auditor", model: GLM_5_TURBO, promptKey: "ai_team.profitability_auditor" },
  { roleKey: "cash_flow_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Cash Flow Auditor", model: GLM_5_TURBO, promptKey: "ai_team.cash_flow_auditor" },
  { roleKey: "variance_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Variance Auditor", model: GLM_5_TURBO, promptKey: "ai_team.variance_auditor" },
  // Customer Revenue Success Department
  { roleKey: "customer_health_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Customer Health Auditor", model: GLM_5_TURBO, promptKey: "ai_team.customer_health_auditor" },
  { roleKey: "renewal_risk_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Renewal Risk Auditor", model: GLM_5_TURBO, promptKey: "ai_team.renewal_risk_auditor" },
  { roleKey: "churn_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Churn Auditor", model: GLM_5_TURBO, promptKey: "ai_team.churn_auditor" },
  { roleKey: "upsell_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Upsell Auditor", model: GLM_5_TURBO, promptKey: "ai_team.upsell_auditor" },
  { roleKey: "cross_sell_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Cross-sell Auditor", model: GLM_5_TURBO, promptKey: "ai_team.cross_sell_auditor" },
  { roleKey: "customer_lifetime_value_auditor", team: "AUDIT_GLOBAL_REVENUE", title: "Customer Lifetime Value Auditor", model: GLM_5_TURBO, promptKey: "ai_team.customer_lifetime_value_auditor" },
]

export function getRole(roleKey: string): RoleDefinition | undefined {
  return AI_TEAM_ROSTER.find((r) => r.roleKey === roleKey)
}

export function rolesForTeam(team: TeamName): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => r.team === team)
}

const GUARDRAIL_TEAMS: TeamName[] = ["GUARDRAIL_PLATFORM", "GUARDRAIL_PRODUCT", "GUARDRAIL_ACCOUNT", "GUARDRAIL_USER"]
// Wave 171: the 5 audit divisions + AUDIT_EXECUTIVE (chief_audit_officer,
// pre-existing since Wave 160 but not previously added here -- an
// oversight this wave also closes, not just for the new divisions) are
// assurance roles, never the operational department a free-text customer
// task should be routed to -- same reasoning as excluding GUARDRAIL_*.
// EXECUTIVE_LADDER (COO/CEE/CSEO) is excluded for the same reason: these
// are escalation targets, not a department that plans/executes routine
// customer work.
const AUDIT_DIVISION_TEAMS: TeamName[] = ["AUDIT_ENG_ASSURANCE", "AUDIT_BUSINESS_ASSURANCE", "AUDIT_KNOWLEDGE_INTELLIGENCE", "AUDIT_GOVERNANCE_COMPLIANCE", "AUDIT_GLOBAL_REVENUE"]
const NON_OPERATIONAL_TEAMS: TeamName[] = ["HUMAN", ...GUARDRAIL_TEAMS, "AUDIT_EXECUTIVE", "EXECUTIVE_LADDER", ...AUDIT_DIVISION_TEAMS]

/** Every guardrail role across all 4 levels, in enforcement order (platform → product → account → user). */
export function allGuardrailRoles(): RoleDefinition[] {
  return GUARDRAIL_TEAMS.flatMap((team) => rolesForTeam(team))
}

/** Every named audit-organization specialist/division-head role across all 5 divisions (tree4-unified area 4/9). */
export function allAuditOrganizationRoles(): RoleDefinition[] {
  return AUDIT_DIVISION_TEAMS.flatMap((team) => rolesForTeam(team))
}

// U-D2.B4.S1 (partial -> closing this wave): "[CAO] cannot modify
// production code/business rules/governance." Verified by direct code
// read (dispatch-repo.ts, ai-workforce-agent.mjs) that no restriction
// existed anywhere stopping chief_audit_officer OR any of the 130
// individually-named audit specialist/division-head roles from being
// dispatched through the repo-write path -- the doer!=certifier
// independence principle AGENTS.md Rule 7c and this session's own audit-
// organization docs insist on was, for the repo-write surface specifically,
// only a documented expectation, not an enforced one. chief_audit_officer
// itself lives in AUDIT_EXECUTIVE, not one of the 5 AUDIT_DIVISION_TEAMS,
// so it needs its own explicit inclusion here, not just a spread of
// AUDIT_DIVISION_TEAMS.
const AUDIT_ORGANIZATION_TEAMS: TeamName[] = ["AUDIT_EXECUTIVE", ...AUDIT_DIVISION_TEAMS]

/**
 * True for chief_audit_officer and every audit-organization specialist/
 * division-head role (all 5 divisions + the CAO itself) -- the set of
 * roles whose entire purpose is independent assurance OVER operational
 * work, and which must therefore never BE the operational work. Used by
 * the repo-write dispatch surfaces (dispatch-repo.ts,
 * scripts/ai-workforce-agent.mjs) to fail closed on an audit role being
 * asked to modify production code.
 */
export function isAuditOrganizationRole(roleKey: string): boolean {
  const role = getRole(roleKey)
  if (!role) return false
  return AUDIT_ORGANIZATION_TEAMS.includes(role.team)
}

/** Every role tagged with a given U-D2.B1.S1 escalation-ladder level (L0/L3/L4/L5 only -- see RoleDefinition's own comment for why L1/L2 are untagged). */
export function rolesByEscalationLevel(level: NonNullable<RoleDefinition["escalationLevel"]>): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => r.escalationLevel === level)
}

/** Every operational department role the AI Router may assign a task to -- everything except Human, Guardrail, Audit, and the Executive Ladder. */
export function operationalRoles(): RoleDefinition[] {
  return AI_TEAM_ROSTER.filter((r) => !NON_OPERATIONAL_TEAMS.includes(r.team) && r.team !== "VERIDIAN_AI_OS")
}
