# VERIDIAN AI Orchestra Hierarchy

**Status:** Formal specification, synced with `ai-os/CONSTITUTION.yaml`'s `ai_orchestra_tiers` section and the real AI Router implementation (`src/lib/ai-router/mother-router.ts`, `platform.ai_model_registry`, `platform.ai_routing_policies`, `src/lib/ai-team/roster-overrides.ts`).

**Core principle (Owner directive, 2026-07-19): every AI Router is model-agnostic.** No level's model is a permanent commitment. The "Model" column below names today's real, currently-assigned model per level — it is a live snapshot, not a hardcoded contract. Every model name in this document is swappable without a code deploy via:
- `platform.ai_model_registry` — the catalog of every model this platform knows how to call, price, and health-check. Adding a genuinely new model is a registry row, not a PR.
- `platform.ai_routing_policies` (Mother Router) / `compliance.ai_team_role_overrides` (AI Dev Team roster) — the live override layer. Changing which model a role/tier/scope actually uses is a policy row or an override row, picked up on the next resolution call (60s cache TTL, or immediate via `invalidateMotherRouterCache()`), never a redeploy.
- The one deliberate exception, by design: **which models are *trusted* for judgment/integrative-tier work** (`src/lib/model-tier-eligibility.ts`'s `JUDGMENT_ELIGIBLE`/`INTEGRATIVE_ELIGIBLE` sets) stays a hardcoded, code-reviewed allowlist. This is a safety guardrail (AGENTS.md Operating Rule 9), not an oversight — granting a model authority over judgment-critical work is a governance decision, not a live config flip. See that file's own header for the full reasoning.

**Current real model roster** (as of 2026-07-19, `platform.ai_model_registry`): `openai/gpt-oss-20b` and `openai/gpt-oss-120b` (Groq, mechanical-tier floor — 20B added as the cheaper of the pair, 120B as the existing default), `deepseek/deepseek-v4-pro` (integrative-tier), `z-ai/glm-5.2` (the sole judgment-tier-eligible model, run via `Claude Code CLI` for server-side agentic execution or OpenRouter for API dispatch depending on the call site), plus `z-ai/glm-5v-turbo`, `z-ai/glm-5-turbo`, `google/gemini-2.5-pro` (integrative-tier), `anthropic/claude-sonnet-5` (Super Boss / Claude Desktop interactive seat), and platform-fallback/failover entries. Query `platform.ai_model_registry` for the authoritative live list — do not treat this paragraph as the source of truth after today.

**Column definitions** (apply to all 4 tables below):

| Column | Meaning |
|---|---|
| Level | Position in the escalation chain, L0 (no AI / deterministic) through L5 (highest authority for that domain) |
| Role | The named function this level performs |
| Model | Today's real, currently-assigned model(s) — swappable per the principle above, never hardcoded in the sense of requiring code to change |
| Primary Objective | The one-sentence purpose of this level |
| Exact Kind of Work | Concrete, representative task examples — not exhaustive |
| Instruction Style | How narrow/tight the brief given to this level must be (mirrors `src/lib/task-tightening.ts`'s `ComplexityTier`: narrow briefs for mechanical/integrative work, structured/strategic briefs for judgment work) |
| Input | What this level is given to act on |
| Process | The real steps this level performs |
| Output | What this level produces |
| Validation | How this level's own output is checked before being trusted |
| Retry | How many automatic re-attempts on failure before escalating |
| Failure Handling | What happens when this level cannot complete the work |
| Escalation | What condition sends work to the next level up |
| Authority | What this level is allowed to decide unilaterally |
| Not Allowed | What this level must never do, regardless of confidence |

Every level below maps to a real `AiRouterScope` value in `mother-router.ts` (`software_team`, `end_user_org`, `sales_marketing`, and the newly-added `customer_success`) or to `src/lib/ai-team/roster.ts`'s real role roster — this document does not invent a parallel structure, it names the real one.

---

## Table 1 — Software Development (`ai_router_scope = "software_team"`)

| Level | Role | Model | Primary Objective | Exact Kind of Work | Instruction Style | Input | Process | Output | Validation | Retry | Failure Handling | Escalation | Authority | Not Allowed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L0 | Software Engine | No AI | Execute deterministic software | Compile, build, CI/CD, test, migrate, automate | N/A | Structured data | Fixed workflow | Software result | Automatic | Automatic | Log error | Unsupported case | None | Reasoning |
| L1 | Code Worker | Mechanical-tier model (currently `openai/gpt-oss-20b` / `gpt-oss-120b`) | Execute one coding task | One API, one SQL change, one UI component, one test | Very narrow & tight | Complete specification | Fixed SOP | One deliverable | Self-check | 1 retry | Failure report | Missing input / confidence below threshold | Execute only | Architecture decisions |
| L2 | Sequential Worker | Mechanical-tier model | Execute a predefined workflow | API + SQL + tests + docs, in sequence | Very narrow & tight | Approved workflow | Sequential SOP | Completed workflow | Validate every step | 1 retry | Rollback current step | Failed step | Execute only | Design decisions |
| L3 | Feature Worker | Integrative-tier model (currently `deepseek/deepseek-v4-pro`, mandatory audit) | Implement an approved feature | Multi-file coding, refactoring, bug fix | Very narrow & tight | Approved design | Defined process | Working feature | Compile + test | 1 retry | Failure report | Dependency issue | Implementation only | Architecture changes |
| L4 | Coding Supervisor | Judgment-tier model (currently `z-ai/glm-5.2`, or Claude Code CLI for server-side execution) | Technical leadership | Architecture, code review, debugging, optimization | Structured planning | Business requirement | Analyze → plan → review | Architecture / reviewed code | Engineering review | As needed | Re-plan | Business conflict | Technical decisions | Company-level decisions |
| L5 | Mother Router / Super Boss | Judgment-tier model + human (Claude Desktop, interactive) | Project management & routing governance | Planning, task allocation, monitoring, audit, model/policy routing | Strategic planning | Business goal | Decompose → assign → monitor | Project plan | KPI review | Continuous | Reallocate | None (highest authority) | Full authority | Routine coding |

---

## Table 2 — End User Work Management (`ai_router_scope = "end_user_org"`)

| Level | Role | Model | Primary Objective | Exact Kind of Work | Instruction Style | Input | Process | Output | Validation | Retry | Failure Handling | Escalation | Authority | Not Allowed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L0 | Software Engine | No AI | Complete deterministic office work automatically | Workflow automation, reminders, approvals, calculations, dashboards, report generation, document routing | N/A | Structured business data, rules, workflows | Fixed workflow execution | Completed transaction / report | Automatic | Automatic | Log error & notify | Missing business rule / software limitation | None | Interpretation, assumptions, decisions |
| L1 | Office Execution Worker | Platform-default floor model (`platform.ai_model_registry`, org's resolved tier) | Execute one office task exactly as instructed | Draft one email, summarize one document, prepare one MOM, update one CRM record, classify one document | Very narrow & tight | Complete request, templates, SOP | Execute predefined SOP only | One completed deliverable | Self-check | 1 retry | Failure report | Missing input, ambiguity, confidence below threshold | Execute only | Advice, planning, policy decisions |
| L2 | Office Workflow Worker | Platform-default floor model | Execute a predefined office workflow | Meeting prep → MOM → tasks → email → calendar, leave/expense/compliance workflows | Very narrow & tight | Approved workflow, SOP, master data | Execute each step sequentially | Completed workflow | Validate each step | 1 retry | Stop failed step & report | Failed step, missing dependency, conflicting data | Workflow execution only | Business decisions, workflow redesign |
| L3 | Department Execution Coordinator | Platform-default / org-configured model | Execute departmental operations | HR, Finance, Compliance, Admin execution; cross-module workflow | Very narrow & tight | Approved departmental SOP, policies, master data | Execute approved process | Completed activity + status report | Cross-check outputs | 1 retry | Exception report | Cross-department conflict, policy mismatch | Department execution only | Change policies, approve exceptions |
| L4 | Department Manager AI | Judgment/integrative-tier model per org's Mother Router policy | Department intelligence & decision support | Bottleneck/workload/productivity/compliance/risk analysis, recommendations, approvals | Structured analytical | Business data, KPIs, reports, objectives | Analyze → evaluate → recommend → review | Recommendations, action plan, approvals | Managerial review | As required | Re-analyze & recommend | Business conflict, executive decision required | Department-level decisions | Company strategy, CEO-level decisions |
| L5 | Executive Business Assistant (Mother Router, `end_user_org` scope) | Judgment-tier model, org's own BYO config takes priority if configured | Executive work management & organizational governance | Business planning, org-wide workload allocation, executive dashboards, strategic review, resource allocation | Strategic planning | Business goals, org KPIs, department status, priorities | Analyze → prioritize → allocate → monitor → review | Executive decisions, business plans, org dashboard | Executive KPI review | Continuous | Re-plan & reallocate | None (highest authority) | Organization-wide authority | Routine office work, repetitive execution |

---

## Table 3 — Sales & Marketing Management (`ai_router_scope = "sales_marketing"`)

| Level | Role | Model | Primary Objective | Exact Kind of Work | Instruction Style | Input | Process | Output | Validation | Retry | Failure Handling | Escalation | Authority | Not Allowed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L0 | Sales & Marketing Automation Engine | No AI | Automate repetitive sales/marketing activity | Lead capture, CRM updates, campaign scheduling, follow-up reminders, dashboard/KPI updates | N/A | CRM data, campaign rules, automation workflows | Execute predefined automation | Updated CRM, completed automation | Automatic | Automatic | Log error & notify admin | Missing rule, integration failure | None | Customer interaction, pricing decisions |
| L1 | Sales & Marketing Execution Worker | Mechanical-tier model | Execute one sales/marketing task | Draft one email/proposal/quotation/social post, summarize one meeting, update one CRM record | Very narrow & tight | Customer details, templates, product info, pricing, branding | Execute predefined SOP only | One completed deliverable | Self-check | 1 retry | Failure report | Missing customer data, ambiguity | Execute only | Negotiation, pricing changes, commitments |
| L2 | Sales Workflow Worker | Mechanical-tier model | Execute a predefined sales/marketing workflow | Lead qualification → proposal → follow-up → CRM update → meeting summary; campaign/event execution | Very narrow & tight | Approved workflow, SOP, customer info, campaign plan | Execute each step sequentially | Completed workflow | Validate each step | 1 retry | Stop failed step & report | Failed step, missing info, conflicting data | Workflow execution only | Sales strategy, pricing approval |
| L3 | Account & Campaign Coordinator | Integrative-tier model | Execute customer account & campaign operations | Manage opportunities, coordinate proposal revisions, campaign/partner coordination, RFP response | Very narrow & tight | Approved sales process, opportunity details, campaign plan | Execute approved process, coordinate activities | Updated opportunity, completed campaign, status report | Cross-check deliverables | 1 retry | Exception report | Objection requiring commercial decision | Execution & coordination only | Commercial approval, contract negotiation |
| L4 | Sales & Marketing Manager AI | Judgment/integrative-tier model | Sales intelligence & marketing strategy | Sales planning, proposal strategy, competitive analysis, pricing recommendations, campaign planning | Structured analytical | Customer profile, competitor/market data, pipeline, KPIs | Analyze → plan → review → recommend | Sales strategy, campaign plan, reviewed proposal | Managerial review | As required | Re-analyze & recommend | Commercial conflict, strategic/executive decision | Sales & marketing decisions | Company strategy, financial approvals |
| L5 | Chief Revenue Officer AI (Mother Router, `sales_marketing` scope) | Judgment-tier model | Revenue growth, GTM strategy & executive governance | GTM strategy, pricing policy, sales forecasting, territory/partner planning, org-wide sales monitoring | Strategic planning | Business goals, revenue targets, market intelligence, pipeline, org KPIs | Analyze → prioritize → allocate → monitor → review | Revenue strategy, GTM plan, executive dashboard | Executive KPI review | Continuous | Re-plan & reallocate | None (highest authority) | Organization-wide authority | Routine proposals, CRM updates |

---

## Table 4 — Customer Success, Help & Implementation Management (`ai_router_scope = "customer_success"`, new scope added 2026-07-19)

| Level | Role | Model | Primary Objective | Exact Kind of Work | Instruction Style | Input | Process | Output | Validation | Retry | Failure Handling | Escalation | Authority | Not Allowed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L0 | Customer Success Automation Engine | No AI | Automate repetitive support/CS/implementation activity | User provisioning, workspace creation, ticket routing, SLA monitoring, health-score calculation, renewal reminders | N/A | Customer master data, subscription data, workflows, support rules | Execute predefined automation | Completed automation, updated records | Automatic | Automatic | Log error & notify admin | Missing config, integration failure | None | Customer consultation, implementation decisions |
| L1 | Customer Success Execution Worker | Mechanical-tier model | Execute one CS/support task | Answer one query, draft one email, create one help article, summarize/update one ticket | Very narrow & tight | Customer query, docs, SOP, knowledge base | Execute predefined SOP only | One completed deliverable | Self-check | 1 retry | Failure report | Missing info, ambiguity | Execute only | Product customization, commercial commitments |
| L2 | Customer Onboarding & Support Workflow Worker | Mechanical-tier model | Execute a predefined onboarding/support workflow | Onboarding, workspace setup, data import, issue triage, ticket resolution workflow | Very narrow & tight | Approved checklist, customer info, implementation SOP | Execute each step sequentially | Completed onboarding/workflow | Validate each step | 1 retry | Stop failed step & report | Failed step, missing info, config mismatch | Workflow execution only | Solution design, product decisions |
| L3 | Implementation & Customer Success Coordinator | Integrative-tier model | Execute customer implementation & adoption activities | Data migration, configuration, workflow setup, training, adoption monitoring | Very narrow & tight | Approved implementation plan, requirements, project docs | Execute approved plan | Working implementation, adoption/status report | Cross-check deliverables | 1 retry | Exception report | Integration failure, customer-specific requirement | Implementation & coordination only | Architecture changes, commercial decisions |
| L4 | Solution Consultant / Customer Success Manager AI | Judgment/integrative-tier model | Solution design, implementation leadership & success planning | Discovery, implementation planning, workflow/solution design, adoption strategy, root-cause analysis | Structured analytical | Customer business process, implementation scope, product capabilities, KPIs | Analyze → design → plan → review → recommend | Solution blueprint, implementation plan, adoption strategy | Managerial review | As required | Re-analyze & recommend | Scope/architecture conflict, executive approval required | Customer solution & implementation decisions | Company strategy, pricing decisions |
| L5 | Customer Success Director AI (Mother Router, `customer_success` scope) | Judgment-tier model | Executive customer governance, retention & long-term success strategy | CS strategy, implementation governance, QBRs, health monitoring, expansion/renewal strategy | Strategic planning | Customer portfolio, health scores, business objectives, executive KPIs, renewal pipeline | Analyze → prioritize → allocate → monitor → review | CS strategy, executive dashboard, retention/expansion plan | Executive KPI review | Continuous | Re-plan & reallocate | None (highest authority) | Organization-wide authority | Routine tickets, repetitive implementation tasks |

---

## What this document does not do

- It does not invent a new dispatch mechanism. L4/L5 in each table map to Mother Router's `resolveModel()` for that scope; L0–L3 map to the existing `roster.ts`/`checkTierEligibility()`/`task-tightening.ts` pipeline. No new abstraction layer was created to produce this document.
- It does not pin any model permanently. Every "Model" cell is a live snapshot of `platform.ai_model_registry` + the active override/policy layer as of 2026-07-19 — expect it to change without this document being wrong, since the document describes *roles and tiers*, not fixed model bindings.
- `customer_success` (Table 4) is a newly-added `AiRouterScope` value with its resolution function (`computeCustomerSuccessResolution()`, mirroring `computeSalesMarketingResolution()`) but, honestly, no real dispatch call site wired to it yet — same "registry exists, adoption is incremental" posture Mother Router's own header already documents for its other 3 scopes. Wiring a real L1–L3 dispatch surface for Customer Success work is a separate, future task, not claimed as done here.
