# Business Rules Registry


**Generated, not hand-maintained** -- extracted directly from `ai-os/system-tree/50-merged-tree.yaml`'s
own `rules:`/`objects:` fields (the same real, code-grounded facts already captured there), reorganized
rule-first instead of domain-first so a rule can be looked up without knowing which of the 94 tree
domains it lives under. This is the consolidated business-rules registry closing the VERIDIAN Review
Framework's "AI-Readable Business Rules Documentation" finding (2026-08-07) -- source of truth
remains the system tree; regenerate this file whenever that tree is refreshed, don't hand-edit the
two out of sync.

**Coverage:** 83 of 94 domains have documented rules
(163 rule statements total). Domains with no rules
(pure schema/plumbing/reusable-component domains where no business rule applies) are listed at the
end for completeness, not omitted silently.

Every runtime rule check that spans multiple domains (rather than being owned by one) additionally
goes through `src/lib/business-rule-validator.ts` -- see its own header for the generic cross-domain
validation layer this registry's per-domain rules sit on top of.

---

## compliance-tracker -- Governance / AI-OS Platform Core

### GOV-01 -- Guardrail Engine -- the pluggable pre/process/output/logic check framework
*Enforced in:* `src/lib/guardrail-engine.ts`, `src/lib/guardrail-registrations.ts`

- REGISTRY is a Map<leafKey, GuardrailRule[]>, starts EMPTY by design -- silence means no constraint registered for that leaf, not an implicit pass/fail.
- registerGuardrail(leafKey, rule) is purely additive -- no leaf's guardrail list is ever cleared except via the test-only _clearAllGuardrailsForTests().
- A failed check is recorded via recordGuardrailViolation() into the CLEE loop-improvement pipeline as improvementType:'guardrail_violation', always isDeployed:false (human-gated, never auto-applied).

### GOV-02 -- Registered guardrail leaves (exhaustive, as of this session)
*Enforced in:* `ai_team.dispatch (phase: input) -> tightTaskCheck`, `ai_workforce.dispatch (phase: input) -> tightTaskCheck (same check, second independent dispatch surface)`, `task_execution.free_text_planning (phase: input) -> taskBriefCheck`, `ai_workforce.loop_budget (phase: logic) -> loopBudgetCheck`

- tightTaskCheck wraps validateTightTask -- checks objective/scope/successCriteria/complexityTier/expectedOutput are present, non-placeholder, and long enough (see GOV-03).
- taskBriefCheck wraps validateTaskBrief -- a deliberately LIGHTER gate for customer-created tasks (title/description only, MIN_PLANNABLE_LENGTH=4 chars, not the full TightTask shape).
- loopBudgetCheck wraps checkLoopBudget -- Guardrail #20 (Infinite Loop Prevention) applied generically, not just to the .mjs CI runner's original MAX_ITERATIONS pattern.

### GOV-03 -- TightTask -- the structured task envelope
*Enforced in:* `src/lib/task-tightening.ts`

- Shape: {objective, scope, successCriteria, complexityTier: 'mechanical'|'integrative'|'judgment', expectedOutput, constraints?}.
- validateTightTask rejects if objective/scope/successCriteria/expectedOutput is missing, matches a placeholder regex (tbd|todo|n/a|none|null|xxx+|...|fill.?in|same as above), or is under MIN_FIELD_LENGTH=10 chars.
- validateTightTask rejects if complexityTier is missing or not one of the 3 valid values.
- TaskBrief = {title, description?} is the lighter customer-facing shape, validated separately by validateTaskBrief (MIN_PLANNABLE_LENGTH=4).

### GOV-04 -- Model-tier eligibility -- complexity-tier-based model routing
*Enforced in:* `src/lib/model-tier-eligibility.ts`

- JUDGMENT_ELIGIBLE = {z-ai/glm-5.2, openai/gpt-5.5} -- only these two may take judgment-tier (architecture/security/audit-verdict) work.
- INTEGRATIVE_ELIGIBLE = JUDGMENT_ELIGIBLE plus {z-ai/glm-5v-turbo, z-ai/glm-5-turbo, google/gemini-2.5-pro, deepseek/deepseek-v4-pro} -- multi-file work.
- Mechanical tier: every model eligible, including openai/gpt-oss-120b.
- openai/gpt-oss-120b is explicitly excluded from integrative/judgment tiers -- confirmed twice in this session's history to burn its full iteration budget on that shape of task.
- Default posture is most-restrictive-unless-proven-otherwise: an unrecognized model is not eligible for anything above mechanical.

### GOV-05 -- AI Dev Team roster -- 57 defined roles across 16 teams
*Enforced in:* `src/lib/ai-team/roster.ts`

- Teams: HUMAN, VERIDIAN_AI_OS, ENGINEERING, QUALITY_SAFETY, LEGAL_COMPLIANCE, DATA_TEAM, CUSTOMER_SETUP, CUSTOMER_SUPPORT, SALES_MARKETING, FINANCE, HR, ADMIN, AUDIT_EXECUTIVE, GUARDRAIL_PLATFORM, GUARDRAIL_PRODUCT, GUARDRAIL_ACCOUNT, GUARDRAIL_USER.
- Model assignment by workload class: GLM_52 (primary lifting, most roles), GLM_5V_TURBO (vision), GLM_5_TURBO (high-volume/low-stakes), GEMINI_25_PRO (research), GPT_55 (independent second opinion), DEEPSEEK_V4_PRO (governance_backend_engineer only), GPT_OSS_120B (tool_integration_engineer only).
- HUMAN team (founder_ceo, executive_advisor) is never API-dispatched -- present in the roster for completeness of the org chart, not as a callable role.
- isCodeOnly roles (e.g. cost_policy_engine, user_permission_manager) are deterministic code, not LLM calls, despite being modeled as 'roles' in the same roster.
- 4 GUARDRAIL_* teams (PLATFORM/PRODUCT/ACCOUNT/USER) exist specifically as the independent-assurance layer distinct from the operational teams they audit.
- chief_audit_officer is deliberately GLM-5.2, not GPT-OSS-120B, since audit work is judgment-tier.

### GOV-06 -- AI Team execution layer (beyond the roster itself)
*Enforced in:* `src/lib/ai-team/team-service.ts`, `src/lib/ai-team/dispatch-repo.ts`, `src/lib/ai-team/cost-policy.ts`

- runRole(roleKey, input): resolves the prompt-OS template, pre/post-flight cost-checks via cost-policy.ts, calls OpenRouter, logs to the Token Usage Ledger fire-and-forget.
- classifyTask(taskDescription): the AI Router, restricted to operationalRoles() only (never routes to HUMAN/GUARDRAIL_* roles directly).
- runGuardrailLevel(level, proposedAction): runs every LLM-backed role in one Guardrail team level, collects each verdict.
- RoleNotCallableError is thrown for human/code-only/unknown roles -- a caller cannot accidentally dispatch to founder_ceo.
- checkCostPolicy(model, usage) blocks if estimated cost exceeds MAX_COST_PER_CALL_USD = 0.50.

### GOV-07 -- VCEL Computation Engine registry -- 25 files, ~247 functions, all deterministic
*Enforced in:* `mathematical-engine.ts (22 fns)`, `gst-engine.ts (14 fns, all 14/14 wired to dispatch)`, `accounting-engine.ts (11 fns)`, `income-tax-engine.ts (9 fns)`, `tds-engine.ts (5 fns + TDS_SECTION_RATES table)`, `payroll-engine.ts (14 fns)`, +19 more

- Every engine function is pure and deterministic by design -- this is the concrete instantiation of the 'software executes first, AI only where software cannot' principle (see audit-tree D3.B2/D25).
- task-execution-engine.ts's dispatchEngine() is the ONLY live consumer, via an explicit reviewed allowlist switch -- deliberately NOT a dynamic-import-by-DB-value pattern, to avoid a code-execution surface.

### GOV-08 -- Task execution engine -- the 3-way dispatch branch
*Enforced in:* `src/lib/task-execution-engine.ts`

- executeTask() branches: engineKey set -> executeEngineDispatch (GOV-07, zero-LLM); resolvedWorkerAgentId set -> executeStructuredDispatch (zero-LLM, a pre-approved Worker Agent's fixed logic); neither -> free-text LLM planning path.
- The free-text path is gated by the TASK_FREE_TEXT_PLANNING_LEAF guardrail (GOV-02) + enforcePolicy() (GOV-10) + escalation logic (GOV-11) -- the most-constrained of the 3 paths, by design, since it's the one with the least structure to validate against.

### GOV-09 -- Dynamic Chain resolution + task creation (the 'Dynamic Mode Pills / Chain Selector' system object)
*Enforced in:* `src/lib/services/task-service.ts`, `src/lib/services/capability-tree-service.ts`, `dynamicChains table`

- resolveDynamicChainId(): find-or-create, deduplicated on (orgId, modePill, pathKeys) via jsonb equality -- repeated identical chain selections do not grow the table unboundedly.
- createTask() also runs the High-Impact Action Confirmation Gate (detectHighImpactAction, checked against checkApprovalPreference/saveApprovalPreference for always-approve/reject shortcuts -- see GOV-14) and re-verifies any client-supplied workerAgentId server-side (never trusted from the client).
- buildCapabilityTree() assembles the Chain Selector's actual option tree from REAL registered capabilities (org's enabled product branches -> active modules -> real Worker Agents -> generic Product/Project/Customer/Vendor leaves) -- not a hardcoded taxonomy, confirmed by direct code comment.
- A leaf carries codeReference/engineKey/inputFields/fixedInputs and a computed 'deterministic' flag, which is what lets task-execution-engine.ts (GOV-08) decide its dispatch branch.

### GOV-10 -- Policy & purpose-bound AI enforcement
*Enforced in:* `src/lib/policy-enforcement-engine.ts`, `src/lib/purpose-bound-ai.ts`, `src/lib/intent-engine.ts`

- classifyBusinessPurpose / checkPromptInjection / checkDomainValidity feed enforcePolicy(ctx, userMessage), which returns the final decision.
- DOMAIN_ALLOWED_TOOLS is an allowlist map per domain (default domain: 'compliance') -- isToolAllowedForDomain() checks a tool's codeReference against it before it can be offered to a model.
- refusalMessageFor(decision) / policyDecisionDisplayLabel produce the user-facing text -- predefined, not generated (consistent with the Response Engine principle, GOV-13).

### GOV-11 -- Floor-tier escalation & loop prevention
*Enforced in:* `src/lib/floor-tier-escalation.ts`, `src/lib/loop-prevention.ts`, `src/lib/llm-routing-gate.ts`

- detectReaskOrCorrection / detectLowConfidenceResponse are deterministic pre/post-call signals -- e.g. the user immediately re-asking the same thing is treated as a signal the floor-tier model's answer was inadequate.
- checkLoopBudget (Guardrail #20) generalizes the original ai-workforce-agent.mjs MAX_ITERATIONS pattern into a reusable primitive usable by any loop, not just the CI runner.
- tryDeterministicRoute(ctx, text) is the central 'does this even need an LLM call' chokepoint -- checked before floor-tier escalation logic runs at all.

### GOV-12 -- Response integrity: reply gate, structured messages, hallucination controls
*Enforced in:* `src/lib/ai-reply-gate.ts`, `src/lib/structured-message.ts`, `src/lib/dispatch-output-validator.ts`, `src/lib/pii-redaction.ts`

- passesReplyGate(replyText) + detectFalseActionClaim(replyText) sit between raw LLM text and the UI -- a model claiming to have done something it didn't actually do is a specifically detected failure mode.
- structuredMessageSchema (zod discriminated union) + parseStructuredMessage(content) let chat messages carry machine-readable summary/confirmation payloads, not just prose.
- assertValidDispatchOutput() sanity-checks a deterministic (engine/worker-agent) dispatch's own output for NaN/undefined/empty-object -- catching bugs in GOV-07/08's supposedly-safe paths too.
- redactPii(text) runs before any LLM call content is logged.

### GOV-13 -- Response Engine -- predefined short replies
*Enforced in:* `src/lib/response-engine.ts`

- formatShortReply / renderShortReply / suggestResponseForTaskStatus implement the audit-tree's D24 requirement: max-4-word predefined responses, software suggests, AI only confirms/selects.

### GOV-14 -- Activity log & approval preferences (Universal Task Lifecycle Phase 1)
*Enforced in:* `src/lib/activity-log-service.ts`, `src/lib/approval-preference-service.ts`, `activityLog table`, `approvalPreferences table`

- ActivityType = 'ai_team_dispatch' -- the ONLY activity type wired so far. loop_run was deliberately NOT added here since loopExecutions is cross-org and has no org_id, incompatible with this table's tenant RLS.
- recordActivity() catches/warns on failure, never throws into the caller -- logging failure must never break the calling flow.
- ApprovalScopeType = 'communication_type'|'conversation'|'task'|'workflow'. checkApprovalPreference() does most-specific-scope-wins lookup (scopeId match beats scopeType-only beats null).
- saveApprovalPreference() uses find-then-insert-or-update, NOT a DB ON CONFLICT clause -- a nullable scopeId unique index wouldn't NULL-match correctly, so this was deliberately hand-rolled.

### GOV-15 -- LLM provider plumbing & model routing (4-layer resolution)
*Enforced in:* `src/lib/llm-client.ts`, `src/lib/llm-response-cache.ts`, `src/lib/prompt-os-resolver.ts`, `src/lib/prompt-normalizer.ts`, `src/lib/orchestra-model-resolver.ts`, `src/lib/personal-model-resolver.ts`, +3 more

- resolveModelConfig() implements 4-layer most-specific-scope-wins routing: personal -> client -> org -> platform. resolvePageAgentModelConfig() is the per-user counterpart.
- llm-client.ts is provider-agnostic across groq/openai/anthropic/google/openrouter/cerebras -- callLLM/callLLMVision/callLLMJson are the 3 call shapes.
- llm-response-cache.ts (Wave 110) caches identical calls (callLLMCached/callLLMJsonCached) with a purge job for expired entries.
- encryptApiKey/decryptApiKey use raw pgcrypto SQL, not application-layer crypto -- a deliberate choice to keep keys encrypted at the DB layer.

### GOV-16 -- Audit loops -- 11+ daily automated audits
*Enforced in:* `src/lib/loops/api-token-audit.ts (Loop 9)`, `src/lib/loops/automation-progress-audit.ts (Loop 11)`, `src/lib/loops/byo-model-audit.ts (Loop 14)`, `src/lib/loops/capability-index-freshness-audit.ts`, `src/lib/loops/data-separation-audit.ts (Loop 13-related)`, `src/lib/loops/input-quality-audit.ts (Loop 7)`, +7 more

- Each file exports exactly one run<Name>Audit() function, consistent naming/shape across all 13.
- This is the code-level implementation of audit-tree D15's continuous-audit-plus-periodic-review model (Owner's own recommendation from Audit Organization.docx).

### GOV-17 -- CI scripts -- the dispatch/audit/load-test tooling outside the app itself
*Enforced in:* `scripts/ai-workforce-agent.mjs`, `scripts/check-guardrail-presence.mjs`, `scripts/generate-protected-routes.mjs`, `scripts/veridian-browser-ux-test.mjs`, `scripts/gen-wave111-seed-sql.ts`, `scripts/projexa-load-test.ts`, +2 more

- ai-workforce-agent.mjs gives a roster.ts role real read/write repo access via OpenRouter tool-calling inside a fresh GitHub Actions checkout, then hands off to the workflow to commit/push/PR -- this IS the mechanism behind GOV-06's dispatch-repo.ts (currently unused in prod, but this script is what would run if it were).
- check-guardrail-presence.mjs is a deterministic text-presence check -- explicitly documented in its own header as a reviewable-diff guarantee, NOT a runtime-unbypassable lock.
- generate-protected-routes.mjs regenerates protected-routes.generated.ts from the real (app)/ directory listing -- fixes a route-protection drift bug that recurred 4 times before this script existed.
- veridian-browser-ux-test.mjs is confirmed CI-only -- cannot run locally due to a sandbox restriction on spawning Chromium.

### GOV-18 -- ai-os/ governance manifest files (not re-transcribed, indexed)
*Enforced in:* `ai-os/OS.yaml, ai-os/LIFECYCLE.yaml`, `ai-os/boss/BOSS.yaml, BOARD.yaml, COMPLETED.yaml (1210 lines), ROSTER.yaml`, `ai-os/sentinel/SENTINEL.yaml, HEALTH.yaml, VIOLATIONS.yaml`, `ai-os/audit-tree/** (the requirement-document tree -- separate effort, see ai-os/audit-tree/00-INDEX.md)`, `ai-os/engines/ENGINES.yaml (93 lines, DB-facing registry-level catalog, distinct from GOV-07's 25 code files)`, `ai-os/registry/ARTIFACTS.yaml (52 lines)`

- ai-os/boss/ROSTER.yaml is the RUNTIME AI-OS agent roster (VEDABOSS/ZAI/SENTINEL) -- explicitly distinct from src/lib/ai-team/roster.ts's 57-role build-time org chart (GOV-05). Two different things sharing the word 'roster' -- do not conflate.

---

## compliance-tracker -- API Domains

### API-01 -- Core compliance (8 routes)
*Enforced in:* `GET,POST /api/compliance -- requireAuthOrApiKey + requireRoleOrScope(member,write) on POST`, `GET,PATCH,DELETE /api/compliance/[id] -- requireAuth`, `POST /api/compliance/[id]/comments`, `GET,POST /api/compliance/[id]/costs`, `POST /api/compliance-costs/[id]/payments`, `POST /api/compliance/import`, +2 more

- compliance is one of the few internal-app domains ALSO exposed at API-key scope (both compliance/route.ts and v1/compliance/route.ts exist, independently).
- recurrenceType drives /recur's batch job -- generates the next instance of a recurring compliance obligation.

### API-02 -- v1/* -- external/API-key surface, 77 routes
*Enforced in:* `v1/compliance, v1/compliance/[id], v1/compliance/stats`, `v1/tasks, v1/tasks/[id], v1/tasks/[id]/status`, `v1/notices, v1/notices/[id], v1/notices/stats`, `v1/documents, v1/documents/expiring`, `v1/brain/capabilities, v1/brain/entity-relationships (read-only AI-agent introspection)`, `v1/erp/budgets(*), v1/erp/inventory/{issues,ledger,receipts}, v1/erp/procurement/requisitions`, +4 more

- requireAuthOrApiKey() + requireRoleOrScope() on writes -- this is THE external-integrator surface (third-party integrations, GPT Actions, MCP).
- 12 of the 47 v1/projexa/* routes are pure one-line re-export aliases onto v1/construction/*'s already-authenticated implementations -- not independently implemented.
- This is the API surface PROJEXA (the sibling repo) calls via its veridian-client.ts (see 20-projexa.yaml GOV cross-reference).
- This is the API surface PROJEXA (the sibling repo) calls via its veridian-client.ts -- see PRX-06 for the client-side consumer of this exact route family.

### API-03 -- erp/* -- accounting/ops ERP, 138 routes
*Enforced in:* `buying/ (20): suppliers + bank-accounts/qualifications/sanction-checks/scorecards/portal-links/tax-withholding, purchase-orders + submit/three-way-match, goods-receipts + submit/putaway/landed-costs`, `payroll/ (11): employees/[id]/{income-tax-slab,tax-exemptions}, income-tax-slabs, payslips/[id]/{finalize,tds}, runs/[id]/{payslips,process}, salary-components, salary-structures, statutory-rules`, `inventory/ (11): abc-classification, cycle-count-lines/[id]/{adjust,count}, cycle-count-plans, issues, ledger, receipts, reorder-levels, reorder-suggestions, valuation`, `returns/ (10): purchase/[id]/{approve,credit-note,dispatch,reject}, sales/[id]/{approve,credit-note,receive,reject}`, `contracts/ (9): [id]/{amendments,billing-schedules,generate-from-template,negotiation-rounds,obligations,revenue-schedules}`, `periods/ (7): [id]/{checklist,close,reopen,sign-off}, checklist/[itemId]/complete, generate -- month-end close workflow`, +5 more

- Uniform CRUD-plus-submit pattern: collection route (GET list/POST create) + [id] route (GET/PATCH/DELETE) + a /submit or workflow-action sub-route that transitions the document's status enum.
- periods/ implements the actual month-end close checklist workflow, mapping directly to erpAccountingPeriods/erpPeriodClosingChecklistItems.

### API-04 -- pms/* -- internal project-management suite, 31 routes
*Enforced in:* `issues, issues/[id], issues/[id]/relations, issue-statuses, issue-types, workflow-transitions, labels`, `milestones, sprints, sprints/[id], sprints/[id]/issues, estimate-schemes`, `saved-views, saved-views/[id]`, `budgets, budgets/[id], budgets/[id]/line-items, billable-rates, time-entries, time-entries/[id]`, `meetings, meetings/[id], meetings/[id]/outcomes`, `wiki, wiki/[id], wiki/by-slug`, +2 more

- requireAuth uniformly.
- enablement is opt-in per org -- the PMS module doesn't appear at all for orgs that haven't enabled it (pmsEnabled flag).

### API-05 -- the-firm/* -- professional-services practice management, 29 routes
*Enforced in:* `clients/[clientId]/{engagements,invoices,portal-links,service-lines,staff-assignments,tax-cases}`, `engagements/[engagementId], engagements/[engagementId]/deliverables, deliverables, deliverables/[deliverableId]/complete`, `invoices/[invoiceId]/{fixed-fee-line,paid,send,void}, billable-rates, time-entries, time-entries/start, time-entries/[timeEntryId], time-entries/[timeEntryId]/stop`, `staff/[userId]/{assignments,utilization}, staff-assignments/[assignmentId]/end`, `tax-cases/[caseId]/stage, tax-cases/limitations`, `dashboard/{deadlines,realization,utilization}`, +1 more

- requireAuth uniformly; opt-in per org (firmEnabled flag), same pattern as PMS's enablement.

### API-06 -- construction/* + v1/construction + v1/projexa -- construction/interior-design domain, 32 direct routes (+ 47 aliased, see API-02)
*Enforced in:* `boq + 5 sub-actions (approve, compare, revisions, submit, [id])`, `ai/{diff-drawings,estimate-progress,progress-summary,risk-detection} -- AI-assisted site analysis`, `dashboard, dashboard/[projectId], kpi-entries, kpi-entries/[id]/approve, site-diary, reports/[reportName], progress, predictions/[activityId], labour-roster, kpi-definitions, expenses, categories, attendance, activities`

- This is the domain PROJEXA (the sibling repo) proxies almost entirely -- see 20-projexa.yaml for the client side -- see PRX-06 for the client-side implementation.
- boq has a full approve/revise/compare workflow, not just CRUD.

### API-07 -- AI / orchestration platform routes, 17 routes
*Enforced in:* `POST,GET /api/ai/team/dispatch -- requireAuth + veridian_admin role required (platform-internal, not customer-facing)`, `POST /api/ai/team/log-usage -- AI_TEAM_LOG_SECRET header (called by ai-workforce-agent.mjs from GitHub Actions, no session)`, `GET /api/ai/team/token-usage`, `POST /api/ai/orchestrate`, `GET /api/orchestra/analytics`, `GET,POST /api/worker-agents, PATCH /api/worker-agents/[id], PATCH /api/worker-agents/[id]/publish`, +3 more

- ai/team/dispatch is the ONE route in the entire API surface gated to veridian_admin specifically -- it builds/governs the AI Dev Team itself, per its own header comment, not a customer-facing feature.
- worker-agents has an explicit publish lifecycle (draft -> published) distinct from plain CRUD.

### API-08 -- Chat / meetings / conversations, 31 routes
*Enforced in:* `conversations, conversations/[id]/{messages,read,regenerate}, conversations/workflow-thread`, `veri-meetings, veri-meetings/[id]/{action-items,audit-log,export,generate-intelligence,minutes,publish,share-links}`, `guest-chat/[token]/*, veri-chat/share-target, veri-chat/guest-access/[id], veri-chat/conversations/[id]/{guest-access,share-links}, veri-meetings/share/[token], veri-meetings/share-links/[linkId], shared/conversation/[token]`

- generate-intelligence is the AI meeting-intelligence pipeline: transcription -> minutes -> action items, matching audit-tree D21.B2's Minutes of Meeting Intelligence requirement almost exactly.
- Guest/share-token routes are public-by-design (token-resolved), not an auth gap -- documented pattern reused across 5+ route families.

### API-09 -- HR / recruitment / performance, 30 routes
*Enforced in:* `hr/employees, hr/employees/[userId], hr/leave-requests(+[id]), hr/leave-balances, hr/org-chart`, `recruitment/job-openings(+[id]), recruitment/candidates, recruitment/applications(+[id]), applications/[id]/{hire,interviews,stage}, interviews/[id]/feedback`, `performance-reviews/cycles(+[id]/{activate,close}), reviews(+[id]/{acknowledge,submit})`, `hr-compliance (labour-law compliance items, distinct from core compliance)`

- applications/[id]/hire is the terminal action converting a candidate into an employee -- a real state-machine step, not just a status flag flip.

### API-10 -- CRM / Sales-HQ, 18 routes
*Enforced in:* `crm/leads(+[id]), leads/[id]/{convert,follow-up-task,score}`, `crm/opportunities(+[id]), opportunities/[id]/{analyze,follow-up-task}`, `sales-hq/overview, partners(+[id]), commission-plans, commission-accruals/[id]/{mark-paid,void}, referral-links, visitors(+/analyze)`

- leads/[id]/score and opportunities/[id]/analyze are AI-assisted endpoints (lead scoring, opportunity analysis) -- not plain CRUD.
- sales-hq is the internal partner/commission engine, admin-scoped, distinct from customer-facing CRM.

### API-11 -- GST reconciliation, 10 routes
*Enforced in:* `import (+[batchId], confirm, findings, mapping)`, `reconcile (+[runId])`, `returns (+[returnPeriodId], ai-review)`

- This is a staged pipeline, not single-call CRUD: import (stage/map/confirm) -> reconcile (match) -> returns (track period, AI-review).
- ai-review is the ONE AI-touched step in the whole GST engine per the services inventory (GOV cross-reference: src/lib/gst/ai-review-report.ts) -- it explains/prioritizes but never recomputes numbers.

### API-12 -- Documents & knowledge base, 17 routes
*Enforced in:* `documents (+[id]/{dispose,retention,versions}, expiring, extract, pending-disposal, search)`, `knowledge-base/pages(+[id], by-slug, search)`, `ingest (+[batchId], confirm, items/[itemId]) -- generic staged ingestion, same pattern as GST import`

- documents/[id]/retention + dispose implements a real records-retention lifecycle, not just soft-delete.

### API-13 -- Governance / risk / legal / board, ~95 routes
*Enforced in:* `board, board-evaluation, committees, directors, doa, rpt, policies, risks, litigation, legal-matters, legal-opinions, legal-vendors, ip-portfolio, whistleblower, posh, bcm, fraud-cases, it-dr, incidents, contract-compliance, secretarial-audit, mca-filings, access-review, frameworks, audit, audit-engagements, audit-findings, audit-points, esg, cap-table, charges, sebi, rbi, irdai, vendor-risk, clm`, `Notable AI-assisted sub-routes: legal-opinions/[id]/generate, mca-filings/[id]/generate, vendor-risk/[id]/assess`

- Almost entirely GET(list)/POST(create) + GET/PATCH(+DELETE) per governance domain object -- one CRUD family per audit-tree D2's Audit Organization concept made concrete in code (board, risk, legal, whistleblower, POSH, BCM, fraud, IT-DR, incidents, secretarial, MCA, access-review, frameworks, audit engagements/findings/points, ESG, cap-table, sector regulators SEBI/RBI/IRDAI, vendor-risk, CLM).
- sebi/rbi/irdai are sector-gated in the UI (SectorGateNotice) even though the API routes themselves are plain CRUD -- gating happens at the entity-type check, not the route.

### API-14 -- Facilities / tickets / ops, 15 routes
*Enforced in:* `tickets (+[id]/{dispatches,guest-access,installed-product,surveys})`, `problem-records (+[id]/tickets)`, `field-service-dispatches/[dispatchId]`, `installed-products`

- problem-records groups related tickets ITIL-style (one problem, many linked incidents/tickets) -- a real grouping relationship, not just a tag.

### API-15 -- Settings / platform admin, 30 routes
*Enforced in:* `settings/{ai-config, api-keys(+[id],usage), model-config(+[id],pool-usage), modules, module-rules, page-agent-config, prompts, sso, webhooks(+[id])}`, `automation-rules(+[id],[id]/runs), metric-alert-rules(+[id])`, `connectors(+[toolkit]/sync)`, `mdm/duplicates(+scan,[id]/merge,[id]/review), quality-scores`, `capability-registry/{backfill,duplicates}, capability-tree`

- automation-rules implements deterministic (no-AI) trigger->condition->action rules -- the explicit software-first counterpart to AI dispatch.
- mdm (Master Data Management) runs duplicate-detection scans over Customers/Suppliers and tracks merge/review decisions -- a real dedup workflow, not just a report.

### API-16 -- Miscellaneous / small utility domains, ~40 routes
*Enforced in:* `me, me/onboarding-stage, users, departments(+[id]), clients(+[id]/{access,entities})`, `notifications(+[id]/read), home/{analytics,assigned-by-me,todos}`, `search/semantic (embeddings-backed), reports/saved(+[id],[id]/run), kpi-hub`, `veri-reward/{leaderboard,referral,route,streak} (gamification)`, `veri-todo, instruction-mismatches(+[id]) (AI-instruction-drift detector, tied to instructionMismatchDetections table)`, `code-change-requests, products(+[id]/projects), projects(+[id]), tds-returns/{24q,26q}, challans(+[id]), notices(+[id],[id]/dispatches,stats)`

- instruction-mismatches is the API surface for GOV cross-reference: the instruction-mismatch-audit loop's findings (an AI-drift detector flagging when an AI's stated action diverges from what a human actually instructed).
- search/semantic is the one route backed by the embeddings/embedding_cache tables rather than plain SQL filtering.

### API-17 -- Cron/service-secret-gated internal jobs (7 routes)
*Enforced in:* `internal/metric-alerts/run, internal/loops/run, internal/instruction-audit/run, internal/secrets-audit/run`, `internal/the-firm/deadline-digest/run, internal/the-firm/recur-engagements/run, internal/fm-ppm/generate-occurrences/run`, `ai/team/log-usage (AI_TEAM_LOG_SECRET, not CRON_SECRET, but same category)`

- These are the only routes gated by a shared service secret rather than a per-user session/API-key -- correctly excluded from the requireAuth() count, not a gap.

---

## compliance-tracker -- Database Domains

### DB-01 -- Core tenancy / identity (9 tables)
*Enforced in:* `organisations`, `branches`, `clients`, `client_entities`, `user_client_access`, `subscription_plans`, +3 more

- organisations verified in full: id, name, slug, logo, plan, entityType, accountType, address, cinNumber, gstin, panNumber, regulatoryEntityType, isActive, trialStartsAt/EndsAt, isReadOnly, subscriptionPlanId, pageAgentEnabled, createdAt, updatedAt. No FK constraint on subscriptionPlanId.
- users verified in full: id, name, email(unique), passwordHash, role(userRoleEnum), avatarUrl, isActive, lastLoginAt, orgId, departmentId, onboardingCompleted, onboardingStage, authUserId (links to Supabase auth.users.id, cross-schema, unenforced), reportingToId (self-referential, unenforced).
- user_role enum: admin, manager, member, viewer, veridian_admin, branch_manager, senior_professional, team_member, client_viewer, external_auditor.

### DB-02 -- Compliance core (9 tables)
*Enforced in:* `compliance_items`, `challans`, `notices`, `notice_dispatches`, `audit_points`, `compliance_costs`, +3 more

- compliance_items verified in full: id, title, description, complianceType(enum), status(enum), priority(enum), dueDate, completedAt, filedDate, paidDate, departmentId, assignedToId, orgId, clientId, period, financialYear, acknowledgementNumber, registrationNumber, recurrenceType(enum), recurrenceParentId (self-ref), isTemplateSuggested, amount.
- compliance_type enum: GST, TDS, MCA, PF, ESIC, INCOME_TAX, ROC, LABOUR, ENVIRONMENTAL, OTHER.
- compliance_status enum: pending, in_progress, completed, overdue, not_applicable, draft.

### DB-03 -- Comments / notifications / audit / API infra (9 tables)
*Enforced in:* `comments`, `notifications`, `audit_logs`, `api_keys`, `api_key_request_log`, `webhooks`, +3 more

- audit_action enum drives audit_logs -- the DB-level record behind the /audit page's viewer.
- entity_relationships is the knowledge-graph table introspected read-only by v1/brain/entity-relationships (API-02).

### DB-04 -- AI platform (~30 tables) -- the DB side of the governance core
*Enforced in:* `mcp_access_codes, onboarding_steps`, `ai_assistants, assistant_memories, assistant_sessions, assistant_metrics_daily`, `worker_agents, worker_agent_versions, worker_agent_usage_log, worker_agent_learnings, worker_agent_domain_index`, `tasks, task_execution_plan, task_agent_executions, task_chat_messages`, `orchestra_layers, orchestra_executions`, `activity_log, dynamic_chains, approval_preferences`, +6 more

- tasks is the Universal Work Object -- dynamic_chains, activity_log, approval_preferences directly implement audit-tree domains D4, D5, D9, D14, D16.
- loop_executions is explicitly cross-org (no org_id) -- see GOV-16's guardrail note.
- computation_engines is the DB-facing registry of ~185 engines, distinct from the 25 code files in src/lib/engines/ (GOV-07) -- see GOV-07 for the exact wired-vs-registered count, not restated here.

### DB-05 -- Access review, ingestion (4 tables)
*Enforced in:* `access_review_cycles`, `access_review_certifications`, `ingestion_batches`, `ingestion_items`

- ingestion_batch_status / ingestion_item_status enums drive the shared staged-import pattern reused by both compliance/import (API-01) and gst-reconciliation/import (API-11) and documents/ingest (API-12).

### DB-06 -- Board / governance (13 tables)
*Enforced in:* `board_meetings`, `board_action_items`, `committees`, `related_party_transactions`, `delegation_of_authority`, `directors_kmp`, +8 more

- policy_status enum drives the draft -> publish -> attestation lifecycle (audit-tree-adjacent: 'publish requires approval').
- rpt_approval_status enum separately gates related-party transaction disclosures.

### DB-07 -- Legal (7 tables)
*Enforced in:* `legal_vendors`, `litigation_matters`, `ip_portfolio`, `legal_opinions`, `legal_matters`, `legal_arbitration_cases`, +1 more

- litigation_stage enum tracks case progression; legal_opinions/[id]/generate (API-13) drafts against this table using AI, human-reviewed before finalization.

### DB-08 -- HR compliance / risk / frameworks (14 tables)
*Enforced in:* `hr_compliance_items`, `leave_policy_entries`, `holiday_list_filings`, `posh_committee`, `posh_complaints`, `posh_annual_reports`, +8 more

- posh_complaints is classified Confidential per the UI's own classification system (DB-09's classification concept).

### DB-09 -- Risk / resilience (9 tables)
*Enforced in:* `vendor_risk_profiles`, `esg_metrics`, `whistleblower_cases`, `bcm_plans`, `bcm_business_impact_analyses`, `bcm_recovery_procedures`, +5 more

- vendor_risk_profiles/[id]/assess (API-13) is AI-assisted; bcm exercises/it-dr failover-tests model real business-continuity testing cadence, not just static plans.

### DB-10 -- MDM, incidents, conversations, code-change requests (~13 tables)
*Enforced in:* `mdm_duplicate_candidates`, `mdm_merge_log`, `incidents`, `conversations`, `conversation_participants`, `messages`, +3 more

- instruction_commitments + instruction_mismatch_detections is the DB side of the chat-service.ts commitment-tracking feature (feeds instruction-mismatch-audit, GOV-16) -- when a human commits to something in chat and the AI's later action diverges, that's captured here.
- code_change_requests is the VAIOS code-change-request workflow (distinct from actual GitHub PRs) -- an internal request-tracking layer.

### DB-12 -- PMS suite (~26 tables)
*Enforced in:* `pms_issue_types`, `pms_issue_statuses`, `pms_workflow_transitions`, `pms_issues`, `pms_issue_assignees`, `pms_issue_relations`, +20 more

- pms_issues verified in full: id, orgId, clientId, projectId, typeId, statusId, priority(enum), number (per-project sequence), title, description, assigneeId (DENORMALIZED CACHE, kept in sync by the service layer per an explicit code comment, NOT a DB trigger -- a real consistency risk worth knowing, not asserted as a bug here, just noted), parentIssueId (self-FK), milestoneId, estimatePointId, position (lexicographic rank for manual Kanban ordering), isArchived, completionPercentage.
- pms_schedule_baselines + pms_baseline_issue_snapshots implement audit-tree-adjacent baseline-vs-actual schedule tracking, same pattern PROJEXA's construction domain independently reimplements (see 20-projexa.yaml).

### DB-13 -- Knowledge / automation / reporting / CRM / HR-ticketing (~20 tables)
*Enforced in:* `knowledge_base_pages`, `automation_rules`, `automation_rule_runs`, `saved_reports`, `metric_alert_rules`, `fde_requests`, +11 more

- fde_requests is the DB side of the /fde 'Do It For Me' feature -- a plain-language need is matched to an existing capability or drafts a new Worker Agent proposal for human approval.

### DB-14 -- Chat/meetings sharing, e-signature (8 tables)
*Enforced in:* `message_attachments`, `conversation_share_links`, `conversation_guest_access`, `veri_meetings`, `veri_meeting_share_links`, `veri_meeting_action_items`, +2 more

- This is the DB side of the token-resolved public routes in API-08's guardrails list -- the tokens themselves live in these tables, resolved server-side.

### DB-15 -- ERP -- by far the largest single block (~150 tables)
*Enforced in:* `General ledger: erp_accounts, erp_fiscal_years, erp_currencies, erp_exchange_rates, erp_bank_accounts, erp_tax_templates(+items), erp_journal_entries(+lines), erp_payment_entries`, `Sales: erp_sales_invoices(+items), erp_e_invoice_logs, erp_sales_orders(+items), erp_sales_credit_notes(+items), erp_sales_returns(+items), erp_customers, erp_quotations(+items), erp_delivery_notes(+items)`, `Purchasing: erp_purchase_invoices(+items), erp_purchase_credit_notes(+items), erp_purchase_returns(+items), erp_purchase_orders(+items), erp_purchase_receipts(+items), erp_purchase_requisitions(+items), erp_suppliers (+5 detail tables), erp_rfqs (+8 RFQ/scoring/auction tables), erp_landed_cost_vouchers(+charges,allocations)`, `Fixed assets: erp_asset_categories, erp_fixed_assets, erp_depreciation_schedules, erp_asset_movements, erp_asset_disposals`, `Inventory/stock: erp_warehouses, erp_item_groups, erp_items, erp_stock_ledger_entries, erp_stock_reconciliations(+items), erp_stock_valuation_layers, erp_reorder_levels, erp_abc_classifications, erp_cycle_count_plans(+lines), erp_item_uom_conversions, erp_item_batches, erp_item_serials`, `Periods/approvals: erp_accounting_periods, erp_period_closing_checklist_items, approval_workflow_definitions(+step_definitions,instances,step_instances,step_approvals)`, +6 more

- erp_journal_entries + erp_journal_entry_lines verified in full: entries carry entryNumber, postingDate, referenceType/referenceId (polymorphic source-document link, same pattern reused by conversations/veriMeetings), status(enum), totalDebit/totalCredit, companyId (nullable, multi-company). Lines carry accountId, partyType(enum)/partyId (polymorphic customer-or-supplier), debit/credit, costCenter (legacy free text) + costCenterId (a real FK added later, additive, alongside the legacy free-text field rather than replacing it).
- 10 of the platform's 11 total explicit FK constraints are in this ERP payroll/inventory block (e.g. erpSalaryStructureComponents.employeeId -> employeeProfiles.id, erpPayslipLines.payslipId -> erpPayslips.id ON DELETE CASCADE, erpItemBatches.itemId -> erpItems.id) -- this is the one area of the schema where referential integrity is DB-enforced rather than purely convention-based.
- ~40 ERP-specific enums exist (erp_account_root_type, erp_journal_entry_status, erp_invoice_status, erp_payment_type, erp_party_type, erp_asset_status, erp_depreciation_method, erp_period_status, approval_workflow_instance_status/step_status/condition_operator, and ~28 more listed in full in the enum inventory).

### DB-17 -- Facilities Management -- 'fm_' prefix, ~14 tables, SCHEMA-ONLY (no matching API routes found)
*Enforced in:* `fm_asset_categories`, `fm_assets`, `fm_checklist_templates`, `fm_checklist_template_items`, `fm_ppm_schedules`, `fm_ppm_occurrences`, +7 more

- This domain has real service-layer code (fm-amc-service.ts, fm-asset-service.ts, fm-asset-dedup-service.ts, fm-checklist-service.ts, fm-enablement-service.ts, fm-ppm-service.ts, fm-register-digitization-service.ts, fm-visitor-service.ts -- see the services inventory) but NO corresponding src/app/api/** routes were found in the 614-file sweep.
- internal/fm-ppm/generate-occurrences/run (API-17) IS a real cron route touching fm_ppm_occurrences -- so this domain is not entirely unwired, just missing the interactive CRUD surface a user would need to actually create/manage assets/checklists through the UI.

### DB-18 -- The-Firm, Sales-HQ, marketing/lead-capture, gamification, GST, construction -- see corresponding API domains (schema completeness listing)
*Enforced in:* `The-Firm (11): firm_client_service_lines, firm_engagements, firm_engagement_deliverables, firm_client_portal_links, firm_tax_cases, firm_staff_assignments, firm_time_entries, firm_billable_rates, firm_invoices, firm_invoice_line_items`, `Sales-HQ (5): sales_partners, sales_referral_links, sales_referrals, sales_commission_plans, sales_commission_accruals`, `Marketing/lead-capture (6): visitor_sessions, visitor_events, contact_submissions, forge_project_requests, connector_accounts`, `Gamification (5): veri_reward_points_ledger, veri_reward_achievement_definitions, veri_reward_achievement_unlocks, veri_reward_streaks, veri_reward_referrals`, `GST reconciliation (~12): gst_import_batches, gst_source_profiles, gst_import_staging_rows, gst_canonical_invoices(+items), gst_gstin_master, gst_hsn_master, gst_validation_findings, gst_reconciliation_runs(+matches), gst_return_periods, gst_ai_review_reports`, `Construction/Projexa (~22): construction_boqs(+line_items), construction_categories, construction_activities, construction_work_progress_entries, construction_site_diaries, construction_labour_roster, construction_attendance, construction_kpi_definitions(+entries), construction_expense_entries, construction_rfis, construction_submittals, construction_punch_list_items, construction_change_orders, interior_mood_boards(+items), interior_ffe_items, interior_floor_plans, interior_materials, interior_floor_plan_rooms, interior_furniture_placements`, +1 more

- This is the DB source-of-truth PROJEXA's own client (20-projexa.yaml) reads/writes exclusively through the v1/construction and v1/projexa API surface -- PROJEXA itself owns none of these tables.

---

## compliance-tracker -- UI Domains

### UI-01 -- Assistant / Home surfaces
*Enforced in:* `/home -- assistant-first landing: VERI AI chat (left/center) + VERI Chat people-panel (right), AchievementCard + VeriTreasureWidget teasers`, `/dashboard -- classic tabbed workspace: Analytics, To Do, Approval tabs`, `/chat -- VERI Chat human/guest conversations (AI thread excluded)`, `/veri-ai -- dedicated AI-thread page (legacy standalone, largely superseded by /home)`, `/veri-todo -- unified pending-items feed (Tasks + Chat Instructions + PMS Issues merged)`

- The Mode Pills + cascading Chain Selector (GOV-09) is mounted GLOBALLY in AppShell.tsx (org-gated by veriChatV2Enabled), so it appears above EVERY authenticated page, not just these 5 -- listed here because this is where it's most central to the page's purpose.
- VERI Chat is split across 3 surfaces (/chat, /veri-ai, /home) sharing the same underlying components -- a real fragmentation the platform has been consolidating toward /home as primary.

### UI-02 -- Compliance core pages
*Enforced in:* `/compliance, /compliance/[id] (tabs: Details, Audit Points, Documents, Activity, Challans, Comments), /compliance/new`, `/checklists, /checklists/[id]`, `/tasks, /reports (charts + DataTable + export + CustomReportsSection), /penalties (GST/TDS/PF/ESIC/MCA/Income-Tax interest & penalty calculator)`, `/notices, /notices/new, /notices/[id]`, `/ingest -- bulk import wizard (row-by-row review/approve/reject)`, `/frameworks -- Controls & Framework Library (ISO 27001, SOC 2, COSO, NIST CSF, India Statutory, DPDP, PCI/HIPAA)`, +2 more

- /penalties is a real calculator UI over GOV-07's tax engines (income-tax-engine.ts, tds-engine.ts, gst-engine.ts), not a separate calculation implementation.

### UI-03 -- Governance / Company Secretarial / Legal pages
*Enforced in:* `/board, /board-evaluation, /committees, /rpt, /doa, /directors, /statutory-registers, /cap-table, /charges, /secretarial-audit, /mca-filings (AOC-4/MGT-7/DIR-12/CHG-1 form-data prep, no live MCA submission)`, `/legal-matters (unified matter register + arbitration + spend), /legal-vendors, /litigation, /ip-portfolio, /legal-opinions (clause-library-backed AI draft generation)`, `/policies -- draft -> publish -> attestation, publish requires approval`

- Mostly SimpleModulePage-driven (list + inline add form) -- a shared generic component, not 18 bespoke implementations.

### UI-04 -- HR / People pages
*Enforced in:* `/hr (tabs: Directory, Org Chart, Leave), /hr-compliance, /leave-holiday`, `/posh (Confidential-classified), /recruitment (tabs: Job Openings, Candidates, Applications)`, `/performance-reviews (tabs: Review Cycles, Reviews)`

- /posh is explicitly classification-gated -- Confidential per the classification.ts CLASSIFICATION_LEVELS system.

### UI-05 -- Risk / Regulatory / Integrity pages
*Enforced in:* `/risks, /vendor-risk, /esg (BRSR, Social pillar computed from Policy+POSH data)`, `/sebi, /rbi, /irdai -- sector-gated (SectorGateNotice shown when entity type doesn't match)`, `/whistleblower, /bcm, /it-dr (+[id]), /fraud-cases, /contract-compliance, /incidents`

- /esg's Social pillar is COMPUTED (derived from Policy + POSH data), not independently entered -- a real cross-module data dependency.

### UI-06 -- Access & Approvals pages
*Enforced in:* `/approvals -- ApprovalTab (single-step maker-checker queue) + WorkflowApprovalsSection (multi-step/quorum workflow instances)`, `/access-review, /access-review/[id] -- periodic RBAC certification cycles, admin-gated`

- This page is the DIRECT UI for audit-tree D9 (Approval & Confirmation UX) and D15.B7 (Approval Governance) -- both option sets from that requirement tree converge here in practice.

### UI-07 -- Admin pages
*Enforced in:* `/users, /departments (+[id], /new)`, `/settings -- side-nav: Profile, Organisation, Notifications, AI Configuration, AI Assistants, My AI, Preferences, Project Management, Security/MFA, API Access, Webhooks, SSO`

- /settings is the single largest settings surface, backed by ~10 dedicated sub-panel components (AiConfigSection, AiAssistantsSection, PersonalAiConfigSection, OrchestraModelConfigSection, ApiKeySection, WebhookSection, MfaSection, SsoSection, PmsEnablementSection) -- see UI-13.

### UI-08 -- Finance / ERP pages -- 'VERI ERP AI', /erp/**
*Enforced in:* `journal-entries (tabs: Entries/Chart of Accounts/Cost Centers/Companies), budgets, reports (tabs: Trial Balance/P&L/Balance Sheet/Cash Flow), cash-management`, `credit-notes (tabs: Sales/Purchase), inventory (tabs: Ledger/Items/Warehouses/UOM/Batches/Serials), bank-reconciliation`, `gst-reconciliation (tabs: Imports/Reconcile 2B/Generate Return), tds-returns (Form 26Q/24Q)`, `procurement (tabs: Requisitions/RFQs/Quotations), goods-receipt (+[id], three-way-match/[id]), inventory-planning (+[id], tabs: Replenishment/ABC/Cycle Count)`, `payroll (tabs: Runs/Structures/Components/Rules/Tax Slabs), invoicing (tabs: Sales/Purchase/Pricing/Tax/Currencies), returns (tabs: Sales/Purchase)`, `contracts (tabs: Contracts/Subscriptions), clm-library (tabs: Clauses/Templates), customers (+[id]), suppliers (+[id]), periods (month-end close checklist/sign-off/close)`

- Every tabbed page here maps 1:1 onto a DB-15 sub-domain -- the UI tab structure mirrors the schema's own domain grouping almost exactly.

### UI-10 -- AI Operations / Dev-Team / Platform tool pages
*Enforced in:* `/orchestra -- AI Dev Team dispatch UI: 5 real assistants x 4-tier worker-agent library; RealAssistantColumn per assistant, AgentLibrarySheet browses global/customer/client/user-tier worker agents`, `/orchestra/analytics -- cost/latency/failure-rate over orchestra_executions`, `/fde -- 'VERI FDE' / 'Do It For Me': describe a need in plain language, matches existing capability or drafts a Worker Agent proposal (human-approved)`, `/capability-registry -- semantic index of every worker agent/automation rule/module (admin backfill + duplicate audit)`, `/automation -- deterministic trigger->condition->action rules (no AI)`, `/metric-alerts -- Grafana-style scheduled threshold alerts (cron-evaluated)`, +5 more

- /orchestra is THE UI for GOV-05/06's 57-role AI Dev Team roster and dispatch layer.

### UI-11 -- Knowledge / support / meetings pages
*Enforced in:* `/knowledge-base, /knowledge-base/[slug]`, `/help -- Help Centre`, `/team -- team member directory (read view, distinct from /users admin CRUD)`, `/tickets, /tickets/[id] -- customer support tickets, each backed by a VERI Chat conversation underneath, guest access supported`, `/problem-records -- ITIL-style problem management grouping tickets`, `/veri-meetings, /veri-meetings/[id] -- AI-assisted meeting minutes with task-linked action items`, +1 more

- Every ticket IS a VERI Chat conversation underneath -- not a separate messaging system, a real architectural reuse.

### UI-12 -- Project Management (/pms/**, opt-in) and THE FIRM (/the-firm-practice, opt-in)
*Enforced in:* `/pms -- project list. /pms/[projectId] + ProjectNav sub-tabs: Issues, Board, Sprints, Wiki, Time, Budgets, Meetings, Roadmap, wiki/[slug]`, `/the-firm-practice -- 'Practice Cockpit', tabs: Dashboard, Client & Engagements, Tax Cases, Time & Billing`

- Both are opt-in per org -- absent from the sidebar entirely for orgs that haven't enabled them, not just hidden/disabled.

### UI-14 -- Reusable components -- veri-chat/ (Dynamic Mode Pills + Chain Selector, the core VERI Chat mechanism)
*Enforced in:* `veri-chat-context.tsx -- VeriChatProvider, composerMode (what to DO) vs rightPanelView (what's LOOKED AT), CapabilityNode/PathSegment types`, `VeriComposer.tsx -- the persistent bottom composer (Mode Pills + cascading Chain rows), mounted once in AppShell`, `VeriChatPanel.tsx -- independent right-side panel (Overview/Tasks/Chats/To-Do views)`

- Mounted globally in AppShell.tsx when veriChatV2Enabled -- appears above every (app) page.

### UI-15 -- Reusable components -- chat/, home/, orchestra/, pms/, erp/, esignature/
*Enforced in:* `chat/: ConversationList.tsx, ThreadView.tsx, MessageContent.tsx (shared across /chat, /veri-ai, /home), StructuredMessageContent.tsx, MismatchBubble.tsx (flags an instruction/outcome mismatch to the assigner)`, `home/: ToDoTab.tsx, AnalyticsTab.tsx, ApprovalTab.tsx (doubles as /approvals' queue), DashboardAnalytics.tsx, WorkflowApprovalsSection.tsx, AchievementCard.tsx, VeriTreasureWidget.tsx`, `orchestra/: RealAssistantColumn.tsx, AgentLibrarySheet.tsx`, `pms/: ProjectNav.tsx, CreateIssueDialog.tsx, IssueDetailPanel.tsx`, `erp/: PartyAddressesAndContacts.tsx (polymorphic, shared by customers/[id] and suppliers/[id])`, `esignature/: RequestSignatureButton.tsx (polymorphic, shared by Documents and erp/contracts)`

- MismatchBubble.tsx is the UI surface for DB-10's instruction_mismatch_detections -- visible only to the commitment's original assigner, a real privacy-scoped rendering decision.

### UI-16 -- Reusable components -- shared top-level utilities & public-facing
*Enforced in:* `SectorGate.tsx, SimpleModulePage.tsx (+StatusPill, the generic list+inline-form CRUD pattern used by ~18-24 simple modules)`, `AiConfigSection.tsx, AiAssistantsSection.tsx, PersonalAiConfigSection.tsx, OrchestraModelConfigSection.tsx, ApiKeySection.tsx, WebhookSection.tsx, MfaSection.tsx, SsoSection.tsx, PmsEnablementSection.tsx, CustomReportsSection.tsx, DocumentUploadSection.tsx, ChallanSection.tsx`, `Public (outside (app)): ContactUsForm.tsx, JoinUsSection.tsx, ForgeIntakeComposer.tsx (reuses the Mode-Pills/Chain-Selector mechanism for public /forge lead intake), LegalBar.tsx, LegalShell.tsx, ProductSalesSection.tsx, RealProductDemo.tsx, VisitorIntelligence.tsx (anonymous visitor tracking), VisitorIntelligencePanel.tsx (the /sales-hq admin view of that data)`, `data-table.tsx, status-badge.tsx (StatusBadge/PriorityBadge), compliance-chart.tsx, dashboard-card.tsx -- the 4 non-trivial shared ui/ primitives beyond the ~52 shadcn files`

- SimpleModulePage is the single component behind roughly 18-24 of the ~130 pages (contract-compliance, irdai, rbi, sebi, secretarial-audit, ip-portfolio, charges, directors, committees, doa, legal-vendors, board, board-evaluation, cap-table, rpt, incidents, posh, whistleblower, bcm, hr-compliance, leave-holiday, litigation, risks, etc.) -- a real, deliberate DRY pattern, not duplicated bespoke code per module.
- ForgeIntakeComposer.tsx explicitly reuses VeriComposer's Mode-Pills/Chain-Selector mechanism for the PUBLIC (unauthenticated) lead-intake flow at /forge -- confirmed by code comment.

---

## PROJEXA

### PRX-01 -- Architecture -- thin client, owns no construction database
*Enforced in:* `src/lib/veridian-client.ts`

- callVeridian(path, {method, body, apiKey, organizationId}) is the single chokepoint for all construction-domain data/AI in this repo.
- getVeridianApiKey(organizationId) exists to look up a per-org key from veridian_credentials, but EVERY route currently calls callVeridian with no apiKey/organizationId -- confirmed by grepping every route -- so it silently falls back to the single shared process.env.VERIDIAN_API_KEY. This matches the codebase's own 'MVP note' comments, not a hidden bug.
- PROJEXA's own Postgres schema (Drizzle+postgres.js) holds ONLY tenant/auth/collaboration plumbing: organizations, memberships, veridianCredentials, assistantQueries, conversations, conversationParticipants, messages, profiles, todos. No BOQ/schedule/RFI/budget tables exist locally -- confirmed by the schema file's own header comment.
- Zero direct LLM-provider calls anywhere in PROJEXA -- no OpenAI/Anthropic/etc. SDK or key found in src/ or .env.local. /api/assistant and /api/discuss are pure proxies to VERIDIAN's /assistant and /discuss endpoints.

### PRX-02 -- Local database (tenant/auth/chat plumbing only, 8 tables)
*Enforced in:* `organizations`, `memberships`, `veridian_credentials`, `assistant_queries`, `conversations`, `conversation_participants`, +3 more

- assistant_queries is a SYNCHRONOUS stand-in for VERIDIAN's real async task system, per its own code comment in schema.ts and api/assistant/route.ts.

### PRX-04 -- Authenticated app pages (11 pages)
*Enforced in:* `/dashboard -- org-wide KPI cards (projects, budget, revenue, expenses) + per-project table, from VERIDIAN /dashboard`, `/schedule -- ScheduleGanttClient (Gantt/critical path)`, `/rfis, /submittals, /punch-list, /change-orders, /mood-boards, /ffe, /floor-plans, /floor-plans/[id], /floor-plans/[id]/walkthrough`

- Every list page shares one pattern: server component calls callVeridian('/dashboard'), takes data.projects[0], passes projectId to a client component -- a real, confirmed gap: no project switcher exists.

### PRX-05 -- GAP: 12+ sidebar-linked modules with NO page implementation
*Enforced in:* `/scope`, `/work-progress`, `/site-diary`, `/documents`, `/manpower`, `/labour`, +8 more

- src/middleware.ts protects these route prefixes AND AppSidebar.tsx links to all of them (Scope of Work/BOQ, Work Progress, Site Diary, Documents, Manpower & Attendance, Materials, Vendors, Budgets, Expenses, KPIs, Reports, AI Copilot, Settings) -- but NONE have a corresponding page under src/app/(app)/. Confirmed by direct file-tree comparison, not inferred.

### PRX-06 -- VERIDIAN-proxy API routes (thin passthrough)
*Enforced in:* `/api/assistant (GET history, POST -> VERIDIAN /assistant), /api/discuss (POST -> VERIDIAN /discuss)`, `/api/capability-tree (GET, keeps Bearer key server-side)`, `/api/change-orders(+[id]) -- PATCH action:'submit' drives an e-signature workflow via signers`, `/api/design-materials, /api/ffe(+[id],margin-summary), /api/floor-plans(+[id],rooms,rooms/[roomId],placements,placements/[placementId],scene)`, `/api/mood-boards(+[id]) -- status transitions draft->shared->approved`, `/api/punch-list(+[id]) -- status transitions open->ready_for_review->verified_closed`, +1 more

- All 20 of these routes call requireAuth() first, then are pure passthroughs to callVeridian -- matches API-06/API-02(v1/projexa) on the VERIDIAN side exactly.

### PRX-10 -- veri-chat/ components -- explicit UI port of VERIDIAN's own composer design
*Enforced in:* `veri-chat-context.tsx (VeriChatProvider, composerMode vs rightPanelView, renames VERIDIAN's 'tasks' to 'queries' since PROJEXA has no async task system)`, `VeriComposer.tsx (fixed mode pills + dynamic 'chain' modes from the capability tree, a queue of staged queries, free-text Discuss chat with client-only history)`, `VeriChatPanel.tsx (Overview/Queries/Chats/To Do)`

- Confirmed by its own code comments to be a deliberate UI port of VERIDIAN's design, not an independent reimplementation.

### PRX-11 -- ui/ components -- shadcn primitives plus 4 notable custom/dead-code cases
*Enforced in:* `~40 shadcn primitives (unremarkable)`, `dashboard-card.tsx (used only on /dashboard)`, `status-badge.tsx (StatusBadge/PriorityBadge) -- confirmed DEAD CODE, no usage found anywhere outside its own definition`, `compliance-chart.tsx -- confirmed DEAD CODE, same`, `data-table.tsx (DataTable, TanStack wrapper) -- confirmed UNREFERENCED anywhere, likely ported but not yet wired into any feature client`

- status-badge.tsx / compliance-chart.tsx / data-table.tsx all appear to be carried over from compliance-tracker (they use ct-* Tailwind color tokens, not PROJEXA's own px-* tokens).
- src/app/globals.css explicitly documents this: it defines --color-ct-navy/--color-ct-teal/etc. as aliases onto the px-* palette 'so copied VERIDIAN components don't need hand-editing' -- a DELIBERATE, self-documented workaround, not an accidental oversight.

---

## veda-advisors

### VA-01 -- SECURITY FINDING (not fixed by this tree, flagged for the Owner): plaintext committed credentials
*Enforced in:* `memory-notes/progress.md (Supabase anon key, SERVICE-ROLE key, DB password)`, `MASTER_IMPLEMENTATION_PROMPT.md (a GitHub Personal Access Token)`, `Linkedin.md (a Composio API key, entity/project/org IDs)`

- The Supabase anon key is legitimately client-side already (also embedded in stage0/page.tsx) -- not the issue. The SERVICE-ROLE key and DB password sitting in a plain markdown file IS the issue: either is sufficient to bypass RLS entirely.
- This is a genuine, real finding from this session's research, not carried over from a prior audit -- surfaced here because a 'granular tree of everything' would be dishonest if it silently walked past committed secrets.

### VA-02 -- Top-level structure
*Enforced in:* `website/ (static generated demo site)`, `docs/ (strategy.md, build-prompt.md)`, `memory-notes/ (progress.md, see VA-01)`, `code-by-zai/ (the REAL Next.js app + governance layer)`, `root .md/.js files (MASTER_IMPLEMENTATION_PROMPT.md, Veda_Advisors_Master_Prompt.md, Linkedin.md, LinkedIn_update.md, linkedin_auto_update.js)`

- No repo-root .git -- code-by-zai/ is itself a separate git checkout of FChecklist/veda-advisors nested inside this folder, which is the actual tracked repo.

### VA-03 -- website/ -- static, single-page HTML (NOT a Next.js app)
*Enforced in:* `website/index.html (3223 lines, 12 <section>s: hero/pain/numbers/proof/bscvi/rajat/audience/filter/stage0/global/whatsapp-cta/nav-footer)`, `website/images/ (26 files)`

- Near-identical (6-line diff) to code-by-zai/VedaAdvisors_Demo/index.html and code-by-zai/public/demo.html -- 3 copies of the same generated demo site exist in the repo.

### VA-04 -- code-by-zai/src/app/ -- the real Next.js 16 App Router site
*Enforced in:* `/ -- iframes /demo.html (the static generated site) -- the homepage is literally a wrapper, not a native React homepage`, `/founders -- '4 real reasons founders don't raise,' BSCVI 3.0 stage list, CTA`, `/students -- myth/truth cards, Rajat Sir bio, 3-step how-it-works`, `/india -- proof stats (UElement 15Cr, ARC Electric 3Cr, 400+ funded), India-specific fundraising differences`, `/stage0 -- THE lead-capture funnel (see VA-07)`, `layout.tsx (full SEO metadata for veda-advisors.vercel.app), sitemap.ts`

- /founders, /students, /india share the same inline-style layout pattern (copy-pasted, not shared as components) -- content differs, structure doesn't.

### VA-05 -- code-by-zai/src/app/api/ -- minimal, mostly stubs
*Enforced in:* `api/route.ts -- trivial GET hello-world stub, unused`, `api/veda/route.ts -- GET, serves VedaAdvisors_Demo/index.html off disk as raw HTML`

- No /api/contact, /api/consultation, /api/leads, or /api/health routes actually exist, DESPITE being documented as IMPLEMENTED in ai-os/registry/ARTIFACTS.yaml -- that registry file is confirmed aspirational/stale, not a description of real code. See VA-09.

### VA-06 -- Backend/DB reality
*Enforced in:* `Supabase (the REAL backing store)`, `Prisma + SQLite (leftover template boilerplate, unused by any real route)`

- stage0/page.tsx posts DIRECTLY (client-side fetch, no server route in between) to https://pcrjmlpuqsbocqfwoxod.supabase.co/rest/v1/stage0_submissions using a HARDCODED anon key in source, rather than reading NEXT_PUBLIC_SUPABASE_URL/ANON_KEY from .env.local (which exist but go unused by this specific code path).
- prisma/schema.prisma targets SQLite with generic unrelated User/Post models -- confirmed leftover template boilerplate (a local db/custom.db SQLite file exists), NOT the live data layer. src/lib/db.ts sets up a Prisma client singleton nothing actually imports.
- .env (DATABASE_URL only) and .env.local (Supabase keys) are BOTH tracked in the working tree -- 2 open PRs (#13/#14) exist to fix this, per VEDA_ADVISORS_GOVERNANCE.md's own honesty ledger.

### VA-07 -- Stage 0 lead-capture funnel -- the ONE real interactive business flow
*Enforced in:* `code-by-zai/src/app/stage0/page.tsx`, `stage0_submissions (Supabase table)`

- No payment step anywhere in the code -- Stage 0 and the initial session are explicitly free/no-commitment. No course-purchase/checkout flow exists (the only mention of payments is in docs/build-prompt.md, which itself says the login/payments/portal backend is explicitly non-functional in the demo).

### VA-08 -- BSCVI 3.0 -- the core advisory methodology (business content, not code, but repeated verbatim across the codebase)
*Enforced in:* `Stage 0 (READINESS, free)`, `Stage 1 (IDENTIFY -- 10 matched investors)`, `Stage 2 (APPROACH -- personalized investor approach)`, `Stage 3 (OFFER -- 'The Godfather Offer')`, `Stage 4 (CLOSE -- docs, term sheets, negotiation)`, `Stage 5 (SUSTAIN -- post-close structuring, next-round scouting)`

- Repeated verbatim across /founders, docs/strategy.md, and linkedin_auto_update.js -- the canonical description lives in docs/strategy.md.

### VA-09 -- Ported governance layer (code-by-zai/) -- a scaled-down version of compliance-tracker's pattern
*Enforced in:* `AGENTS.md (Z.ai GLM + Claude Code, both FULL_ACCESS; flags a standing item: agents self-granted FULL_ACCESS incl. merge/delete via a bot-authored [skip ci] commit on 2026-06-28, needing Owner reconfirmation)`, `CLAUDE.md, SENTINEL.md (prime directives, pre-task checklist, human-approval-gate table, confidence rules, hallucination-prevention, endless-loop escalation)`, `VEDA_ADVISORS_GOVERNANCE.md (2026-07-11, newest -- a lighter single-document replacement for compliance-tracker's 3-document constitution; contains a 'guardrail honesty ledger' tagging each claim ENFORCED/PARTIALLY ENFORCED/NOT ENFORCED/NOT APPLICABLE with evidence)`, `ai-os/OS.yaml, LIFECYCLE.yaml (11-stage task lifecycle), boss/BOSS.yaml (VEDAADVISORBOSS + 5 sub-agent roles), BOARD.yaml, ROSTER.yaml (confirmed EMPTY -- the 'register before working' rule has never been followed), COMPLETED.yaml (near-empty)`, `ai-os/engines/ENGINES.yaml, sentinel/{SENTINEL,VIOLATIONS,HEALTH}.yaml, registry/ARTIFACTS.yaml (see VA-05's overstatement finding), specs/modules/SPEC-MOD-*.yaml (10 stubs, all DRAFT), schemas/*.schema.json, secrets/SECRETS_REFERENCE.md`, `.github/workflows/{ai-dispatch,ci,codeql,sentinel}.yml -- ci.yml's steps are mostly wrapped in '|| echo "::warning"' so they CANNOT actually fail the job, per the governance doc's own honesty ledger`

- VEDA_ADVISORS_GOVERNANCE.md confirms via code grep: NO AI-facing feature exists in the shipped product (zero LLM SDK usage in src/).
- This is the MOST self-critical governance documentation found across any of the 4 repos in this tree -- it explicitly documents where its own CI is not a real gate, where ARTIFACTS.yaml overstates reality, and an unresolved FULL_ACCESS self-grant needing Owner sign-off.

### VA-10 -- Tests (present, but disconnected from real routes)
*Enforced in:* `src/__tests__/api/contact.test.ts (Vitest -- generic validation/rate-limit logic, not wired to a real /api/contact endpoint since one doesn't exist)`, `src/__tests__/seo.test.ts (buildCanonical tests against vedaadvisors.com, a domain the live site doesn't actually use)`, `e2e/homepage.spec.ts (Playwright -- checks for a /consultation link/'Book' button that DOESN'T EXIST in the real / page, which is just the demo.html iframe)`

- All 3 test files exercise logic/assertions that don't correspond to the app's actual current routes -- confirmed test/reality mismatch, not a false alarm.

---

## veridian-brain

### VB-01 -- Entire repo (placeholder scaffold)
*Enforced in:* `README.md (3218 bytes)`, `package.json (232 bytes)`, `packages/ (empty directory)`

- Repo description: "VERIDIAN AI OS 'Brain' -- Phase A groundwork scaffold. Not yet extracted from compliance-tracker; see README." -- confirmed accurate: nothing beyond a README and package.json exists.
- Not worth a granular tree yet -- there is no functional surface to decompose.

---

## Domains with no documented business rule (schema/plumbing/reusable-component domains)

- DB-11 -- Products / projects (2 tables)
- DB-16 -- CLM, recruitment/performance, e-signature -- see API-13/09 (already covered, listed for schema completeness)
- UI-09 -- Sales / CRM pages
- UI-13 -- Reusable components -- app shell & navigation
- PRX-03 -- Public pages (login/signup)
- PRX-07 -- Local-DB API routes (Supabase/Drizzle, no VERIDIAN call)
- PRX-08 -- App shell & navigation components
- PRX-09 -- Domain feature client components (one per construction module)
- PRX-12 -- Local lib/hooks
- PRX-13 -- Construction-domain concepts encoded in the UI/API layer (even though owned by VERIDIAN's DB)
- VA-11 -- Ancillary content/automation
