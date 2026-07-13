# VERIDIAN AI OS — Module Map

**Purpose:** the canonical "where does X live" reference. Every domain in this codebase, mapped to its tables, services, API routes, and pages. Built 2026-07-09 from a direct structural pass over the repo (not from documentation claims) — table/service/route counts below are grep-verified against the live tree, not estimated.

**Scale at time of writing:** 115 migrations, 460+ tables (`compliance` schema), 114 files in `src/lib/services/`, 573+ API route files, 145+ page files, ~61K lines of TS/TSX. PROJEXA (construction ERP) lives inside this same repo, not a separate one.

Use this doc to scope a task before touching code: find your domain below, and you have the full file list without re-deriving it via grep every session.

---

## How product branches gate all of this

Everything below is real code, but not all of it is switched on for every org. `productBranches` (global catalog) × `orgProductBranchEnablements` (per-org on/off) governs which modules an organisation actually sees. Core GRC modules (compliance items, notices, audit, documents, etc.) are always on. Everything else — `pms`, `erp`, `veri_reward`, `veri_chat_v2`, `the_firm`, `facilities_management` — is opt-in per org, `is_enabled=false` by default. **When auditing "is X built," always check both the code AND the enablement row** — code that exists but is enabled for 0 orgs is not the same as code that's live for everyone (see `CRITICAL_GAPS.md` for confirmed examples of this exact gap).

---

## Auth, Users & Multi-Tenancy

| | |
|---|---|
| **Tables** | `organisations`, `branches`, `clients`, `clientEntities`, `users`, `departments`, `userClientAccess`, `accessReviewCycles`, `accessReviewCertifications`, `subscriptionPlans`, `orgProductBranchEnablements` |
| **Services** | `sso-service.ts`, `access-review-service.ts` (no dedicated "multi-tenant-service" — tenancy lives in the auth/db layer below) |
| **Core logic** | `src/lib/supabase/auth-guard.ts` (`requireAuth()`, `requireAuthOrApiKey()`, `autoProvisionUser()`, `hasRole()`/`ROLE_RANK`), `src/lib/supabase/api-key-auth.ts` (`validateApiKey()`), `src/lib/db/tenant-scoped.ts` (`withTenantContext()` — sets Postgres GUCs `app.current_org_id`/`app.current_client_ids`/`app.current_user_id` per request), `src/middleware.ts` (`PROTECTED_APP_ROUTE_PREFIXES` allowlist) |
| **Enforcement model** | Two DB roles: `postgres` (Drizzle's default, `rolbypassrls=true`, RLS-blind) and `app_runtime` (`NOSUPERUSER NOBYPASSRLS`, the role every tenant-scoped query actually runs as via a separate `APP_RUNTIME_DATABASE_URL`). RLS policies read `compliance.current_org_id()` etc., not `auth.uid()` directly, because Drizzle's raw Postgres connection doesn't carry the request JWT. |
| **Hierarchy** | Organisation (the tenant) → Client (a CA firm's own end-client) → Client Entity (a GSTIN/PAN-holding legal entity) → Users. 10-rank role system (`ROLE_RANK`: viewer/client_viewer/external_auditor=1 → member/team_member=2 → senior_professional/manager=3 → branch_manager=4 → admin=5 → veridian_admin=6). |
| **API keys** | `apiKeys`/`apiKeyRequestLog` — the one unified external credential (`vk_...`, SHA-256 hashed, read/write scopes, optional `domainScope`). Session auth always wins when both are present; API-key auth is scope-gated. |

---

## Core Compliance & Governance (GRC — always-on, the original product)

| | |
|---|---|
| **Tables** | `complianceItems`, `complianceFrameworks`, `complianceCosts`, `costPayments`, `challans`, `notices`, `noticeDispatches`, `auditPoints`, `auditLogs`, `auditEngagements`, `auditFindings`, `secretarialAudits`, `documents`, `comments`, `notifications`, `frameworkControls`, `policies` |
| **Services** | `compliance-service.ts`, `notice-service.ts`, `document-service.ts`, `audit.ts` |
| **Audit logging** | `src/lib/audit.ts`'s `logActivity()` — the single call site every module writes through; `audit_logs` has `UPDATE`/`DELETE` revoked from `app_runtime` at the DB level (true append-only, not just convention) |

## Governance Breadth (Wave 8 — Board/CoSec/Legal/HR/Risk/Sector/Audit/ESG/Integrity/Incidents)

~37 tables across: Board & Governance (`boardMeetings`, `boardEvaluations`, `boardActionItems`, `committees`), Company Secretarial (`capTableEntries`/`Events`, `charges`, statutory registers, `mcaFilings`, `secretarialAudits`), Legal (`legalMatters`, `legalOpinions`, `legalVendors`, `litigationMatters`, `ipPortfolio`), HR/POSH (`poshComplaints`, `poshCommittee`, `poshAnnualReports` — content-never-stored confidentiality gate), Risk (`risks`, `vendorRiskProfiles`), Sector Regulators (`sebiComplianceItems`, `rbiComplianceItems`, `irdaiComplianceItems`, gated by `organisations.regulatoryEntityType`), Audit/Controls (`frameworkControls`, `auditEngagements`/`auditFindings`), ESG (`esgMetrics`), Integrity (`fraudCases`, whistleblower — same confidentiality gate as POSH), Incidents (`incidents`, 7-stage Kanban lifecycle), BCM (`bcmPlans`, `bcmRecoveryProcedures`, `bcmBusinessImpactAnalyses`, `bcmExercises`), IT/DR (`itDrPlans`, `itDrFailoverTests`, `itDrBackupVerifications`). Classification model: `src/lib/classification.ts`'s `canAccess()` — 5-level access (public/company_wide/department/confidential/board_only) mapped onto the 10-role system.

---

## GST & Tax

| | |
|---|---|
| **GST reconciliation tables** | `gstReturnPeriods`, `gstReconciliationRuns`, `gstReconciliationMatches`, `gstCanonicalInvoices`, `gstCanonicalInvoiceItems`, `gstSourceProfiles`, `gstGstinMaster`, `gstHsnMaster`, `gstValidationFindings`, `gstImportBatches`, `gstImportStagingRows`, `gstAiReviewReports` |
| **Services** | `gst-reconciliation-service.ts` (reuses `src/lib/engines/gst-engine.ts` + `data-quality-engine.ts` — confirmed via grep, not duplicated) |
| **TDS** | `tds-return-service.ts` + `src/lib/engines/tds-engine.ts`; no standalone TDS tables — modeled via `complianceItems.complianceType='TDS'` |
| **MCA** | `mca-filing-service.ts` — same "prepare/track/SRN only, never files with government" honesty boundary as GST |

---

## ERP — Accounting & Finance (opt-in `erp` product branch, ~90 tables)

Built incrementally, Waves 49-71 (see `orchestra_changes.md`). Grounded in ERPNext's doctype shapes as read-only reference (GPL-3.0, no code copied — every wave's entry states this explicitly).

| | |
|---|---|
| **Chart of Accounts / Periods** | `erpAccounts`, `erpCostCenters`, `erpCompanies` (multi-entity, Wave 67), `erpFiscalYears`, `erpAccountingPeriods` |
| **Ledger** | `erpJournalEntries`, `erpJournalEntryLines` (the single source of truth every financial report sums live — never a duplicated ledger) |
| **Bank & Cash** | `erpBankAccounts`, `erpBankStatementImports`, `erpBankStatementLines`, `erpCashVouchers`, `erpCashAccounts` |
| **Sales/Receivables** | `erpSalesInvoices`+items, `erpSalesOrders`+items, `erpSalesReturns`+items, `erpSalesCreditNotes`+items, `erpQuotations`+items |
| **Purchases/Payables** | `erpPurchaseInvoices`+items, `erpPurchaseOrders`+items, `erpPurchaseReceipts`+items, `erpPurchaseRequisitions`+items, `erpPurchaseReturns`+items, `erpPurchaseCreditNotes`+items |
| **Procurement** | `erpRfqs`+items+suppliers+auction/negotiation tables, `erpSupplierQuotations`+items, `erpPricingRules` |
| **Fixed Assets** | `erpFixedAssets`, `erpAssetCategories`, `erpAssetMovements`, `erpAssetDisposals`, `erpDepreciationSchedules` |
| **Inventory** | `erpItems`, `erpItemGroups`, `erpItemUomConversions`, `erpItemBatches`, `erpItemSerials`, `erpStockLedgerEntries`, `erpStockValuationLayers` (real FIFO queue, Wave 53), `erpWarehouses`, `erpReorderLevels`, `erpAbcClassifications`, `erpCycleCountPlans`+lines |
| **Payroll/HR-tax** | `erpEmployees`, `erpSalaryStructures`+components, `erpPayslips`+lines, `erpPayrollRuns`, `erpIncomeTaxSlabs`+rates (Wave 68), `erpTaxWithholdingCategories`+rates |
| **Contracts** | `erpContracts`, `erpContractAmendments`, `erpContractObligations`, `erpContractBillingSchedules`, `erpContractRevenueSchedules`, `erpSubscriptionPlans`/`erpSubscriptions` (Wave 71) |
| **Budgeting** | `erpBudgets`/`erpBudgetLineItems` (Wave 70) — variance computed live against `erpJournalEntryLines`, never a duplicated actuals ledger |
| **e-Invoicing** | `erpEInvoiceLogs` (IRN payload generation — Wave 69; real IRP submission needs GSP credentials this environment doesn't have, explicitly documented as untestable rather than faked) |
| **Multi-currency** | `erpCurrencies`, `erpExchangeRates` (Wave 66) |
| **Services (21 files)** | `erp-accounting-service.ts`, `erp-financial-report-service.ts` (Trial Balance/P&L/Balance Sheet/Cash Flow), `erp-bank-reconciliation-service.ts`, `erp-budget-service.ts`, `erp-buying-service.ts`, `erp-cash-service.ts`, `erp-company-service.ts`, `erp-contract-service.ts`, `erp-credit-note-service.ts`, `erp-einvoice-service.ts`, `erp-goods-receipt-service.ts`, `erp-inventory-planning-service.ts`, `erp-inventory-service.ts`, `erp-invoicing-service.ts`, `erp-party-service.ts`, `erp-payroll-service.ts`, `erp-procurement-workflow-service.ts`, `erp-returns-service.ts`, `erp-selling-service.ts`, `erp-stock-service.ts`, `erp-uom-batch-service.ts`, `erp-vendor-master-service.ts` |
| **Pages** | `/erp/*` — journal-entries, reports, cash-management, credit-notes, inventory, bank-reconciliation, procurement, payroll, suppliers, invoicing, budgets, contracts |
| **Shared engine reuse** | Approval Workflow Engine (`approvalWorkflowDefinitions`/`Steps`/`Instances` — Wave 50/51) is entity-agnostic; journal entries and purchase requisitions are its two proven consumers |

---

## PROJEXA — Construction ERP (opt-in, embedded in this same repo)

| | |
|---|---|
| **Tables (15)** | `constructionBoqs`+lineItems, `constructionActivities`, `constructionWorkProgressEntries`, `constructionExpenseEntries`, `constructionLabourRoster`, `constructionAttendance`, `constructionSiteDiaries`, `constructionCategories`, `constructionKpiDefinitions`+entries |
| **Services (10)** | `construction-ai-service.ts` (photo-based progress estimation, AI progress summaries, budget/schedule risk detection — Wave 123, 3 of 8 originally-scoped AI features), `construction-boq-service.ts`, `construction-dashboard-service.ts`, `construction-expense-service.ts`, `construction-kpi-service.ts`, `construction-labour-service.ts`, `construction-prediction-service.ts`, `construction-progress-service.ts`, `construction-reports-service.ts`, `construction-site-diary-service.ts` |
| **API routes** | `/api/construction/*` (14 subdirectories, 24 route files), `/api/v1/construction/*` (8 aliased routes), `/api/v1/projexa/*` (15 routes — the primary external surface: ai, assistant, attendance, capability-tree, dashboard, discuss, expenses, kpis, labour, materials, predictions, project-budgets, reports, scope, site-diary, vendors, work-progress) |
| **Schema/validation** | `src/lib/schemas/construction.ts`, `src/lib/schemas/projexa-aliases.ts` |
| **Status** | Real schema + real services + real API layer, actively built through Wave ~131. Not a stub — this is the most recently active build area in the whole repo (waves in the 120s-130s, per migration file numbers 0100+). |

---

## AI Layer — full breakdown

### Task & Assistant System
| | |
|---|---|
| **Tables** | `aiAssistants` (5 per user, dormant per user — see Critical Gaps), `assistantMemories` (pgvector, temporal validity columns), `assistantSessions`, `assistantMetricsDaily`, `tasks`, `taskExecutionPlan`, `taskAgentExecutions`, `taskChatMessages` |
| **Services** | `task-service.ts`, `assistant-memory-service.ts`, `veri-todo-service.ts` (unions tasks + instructionCommitments + pmsIssues) |
| **Core logic** | `src/lib/task-execution-engine.ts` — `executeTask()`: LLM-planning path (default) + structured/deterministic dispatch path (skips the LLM entirely when a `resolvedWorkerAgentId`/`engineKey` is already known — Wave 114/131 this session) |

### Worker Agents (the dispatchable unit)
| | |
|---|---|
| **Tables** | `workerAgents` (4 tiers: global/customer/client/user; DB constraint enforces exactly one matching scope column per tier; `tier='global'` writes are RLS-blocked for `app_runtime` — only migrations/service_role can create platform agents), `workerAgentVersions`, `workerAgentUsageLog`, `workerAgentLearnings`, `workerAgentDomainIndex` |
| **Services** | `worker-agent-service.ts` (`proposeWorkerAgent()` — scope-limited by caller's role), `capability-tree-service.ts`, `capability-backfill-service.ts`, `capability-registry-service.ts` |
| **Governance** | `lifecycleStatus` state machine (draft/proposed/approved/published/retired), reuses `approvalRequests` for the proposal workflow (no separate table) |

### Orchestra (multi-layer model routing)
| | |
|---|---|
| **Tables** | `orchestraLayers` (5 seeded: `task_oa`/`user_assistant_oa`/`customer_account_oa`/`global_intelligence_oa`/`meta_oa`), `orchestraExecutions` (model/provider/tokens/cost, `status` incl. `denied`), `customerModelConfig`, `clientModelConfig` (Wave 45), `personalModelConfig`, `sharedPoolAllocations` (Wave 18 — org-to-platform lending only, never org-to-org) |
| **Core logic** | `src/lib/orchestra-model-resolver.ts` (`resolveModelConfig`/`resolvePlatformModelConfig`/`resolveClientModelConfig` — most-specific-scope-wins), `src/lib/orchestra-execution-logger.ts`, `src/lib/personal-model-resolver.ts`, `src/lib/llm-client.ts` (5 providers: Groq/OpenAI/Anthropic/Google/OpenRouter, unified `callLLM`/`callLLMJson`/`callLLMVision`) |
| **Purpose-Bound AI** | `src/lib/purpose-bound-ai.ts` — `DOMAIN_ALLOWED_TOOLS` (hard, server-enforced allowlist per domain: compliance/project_management/erp/facilities_management/the_firm), `buildPurposeClause()` (system-prompt layer). Belt-and-suspenders by design — neither layer trusts the model alone. |
| **Policy Enforcement** | `src/lib/policy-enforcement-engine.ts` (Wave 46) — deterministic regex/keyword pre-call gate (not an LLM classifier, by design — zero cost/latency, can't be prompt-injected), wired into VERI Chat, VERI FDE, Page Agent. **Only 3 of many free-text-to-LLM call sites are wired** — see Critical Gaps. |

### VCEL — Computation Engines
| | |
|---|---|
| **Registry table** | `computationEngines` (engineKey, category, status: implemented/partial/not_started, implementationRef) |
| **Engine files (25)** | `src/lib/engines/*.ts` — accounting, ai-support, analytics, audit, banking, compliance, costing, crm, data-quality, document-processing, fixed-asset, grc-workflow, gst, hr, income-tax, inventory, logistics, marketing, mathematical, payroll, procurement, project-management, sales, security, tds, validation |
| **Dispatch** | A deliberately small, explicit `switch` in `task-execution-engine.ts`'s `dispatchEngine()` — NOT a generic resolver dynamic-importing `implementationRef` (that would be a real code-execution injection surface) |
| **Status** | 25 engine files exist with real logic; only ~15 (GST-focused) are wired into real dispatch as of Wave 114/131 this session — the rest have zero callers |

### Memory / RAG
| | |
|---|---|
| **Tables** | `embeddings`, `embeddingCache`, `knowledgeBasePages`, `llmResponseCache`, `knowledgeFlowLog`, `dataSeparationAudit` |
| **Core logic** | `src/lib/embeddings.ts` (pgvector, OpenRouter `text-embedding-3-small` 1536-dim), `assistant-memory-service.ts` (semantic search wired into `task-execution-engine.ts` since Wave 77 — write-then-read loop closed) |

### Prompt OS & Observability
| | |
|---|---|
| **Tables** | `promptTemplates`, `promptVersions` (labeled `production`/`staging`), `promptEvalCases`, `promptEvalRuns` |
| **Services** | `prompt-os-service.ts` (`resolvePromptTemplate()`), `prompt-eval-service.ts` |
| **Core logic** | `src/lib/prompt-os-resolver.ts` |

### Self-Improvement Loops (platform-level, no org RLS by design)
| | |
|---|---|
| **Tables** | `loopDefinitions` (15 seeded), `loopExecutions`, `loopImprovements`, `loopHealthMetrics` |
| **Audit files (12 of 15 loops active)** | `src/lib/loops/*.ts` — api-token-audit (9), output-delivery-audit (8), process-turnaround-audit (5), user-behaviour-audit (10), loop-engineering-audit (1, the meta-loop), input-quality-audit (7), automation-progress-audit (11), byo-model-audit (14), instruction-mismatch-audit (product feature, not in the 15), knowledge-flow-audit (4), data-separation-audit (12), tier-integrity-audit (13) |
| **Deliberately inactive (documented, not oversights)** | Loop 2 (Self-Coding) and Loop 6 (Prompt Management) — need a track record from the others first; Loop 3 (UI/UX) — no real interaction telemetry exists; Loop 15 (Everything by AI) — explicitly the aspirational end-state marker, not meant to carry logic |

### MCP Integration
| | |
|---|---|
| **Route** | `src/app/api/mcp/route.ts` — Vercel Edge, tool definitions sourced from `workerAgents` (tier=global) with hardcoded fallback, `tools/call` logs to `worker_agent_usage_log` |
| **Auth** | Unified `apiKeys` (Wave 9-10; `mcp_access_codes` deprecated, not dropped) |
| **Tools (9)** | `list_compliance_items`, `get_compliance_stats`, `get_overdue_items`, `create_compliance_item`, `update_compliance_status`, `list_departments`, `get_penalty_estimate`, `list_notices`, `get_task_status` — **9 of ~40+ modules reachable via MCP**, everything since Wave 11 waits on its domain getting a service layer |
| **Spec** | `MCP_PROTOCOL.md` |

### Capability Registry
| | |
|---|---|
| **Service** | `capability-registry-service.ts` — thin wrapper over `embeddings.ts`, indexes worker agents/automation rules/modules for semantic duplicate-detection and fast FDE lookups (Wave 43) |

### VERI FDE (Forward Deployed AI)
| | |
|---|---|
| **Table** | `fdeRequests` |
| **Service** | `fde-service.ts` — natural-language front-end to the *existing* worker-agent proposal pipeline (embedding search first, LLM only if no high-confidence match, never auto-escalates scope) |

---

## VERI Chat Composer (persistent capability-tree UI, `veri_chat_v2` branch)

| | |
|---|---|
| **Context** | `src/components/veri-chat/veri-chat-context.tsx` (`VeriChatProvider`, `CapabilityNode`/`PathSegment` types) |
| **UI** | `VeriComposer.tsx` (bottom composer, Mode Pills + Chain Selector), `VeriChatPanel.tsx` (right panel, Overview/Tasks/Chats/To Do tabs) |
| **Tree assembly** | `capability-tree-service.ts`'s `buildCapabilityTree()` — real product branches → modules → worker agents → Products/Projects → Customers/Vendors → Compliance Items → Calculators (VCEL) |
| **Rollout status** | See `CRITICAL_GAPS.md` — was demo-only (1/15 orgs) until this session's Wave 131 rollout; now `status='live'`, enabled for all 15 orgs and auto-enabled for future signups |
| **Design doc** | `VERI_CHAT_COMPOSER_DESIGN.md` (this session) |

---

## VERI Chat / VERI AI / Guest Access / Tickets

| | |
|---|---|
| **Tables** | `conversations`, `messages`, `messageAttachments`, `conversationParticipants`, `conversationGuestAccess`, `conversationShareLinks`, `tickets`, `ticketSatisfactionSurveys` |
| **Services** | `chat-service.ts` (VERI AI thread — `generateAiReply()`, `regenerateAiReply()`), `veri-chat-service.ts` (VERI Chat — human-to-human, guest access, share links), `ticket-service.ts` (wraps a `conversations` row rather than a parallel messaging system) |
| **Pages** | `/veri-ai` (dedicated AI surface), `/chat` (VERI Chat), `/guest-chat/[token]` (public, no auth), `/shared/conversation/[token]` (public read-only), `/tickets` |
| **Known duplication** | `GlobalChatDock` (floating, every page) + `VeriComposer`/`VeriChatPanel` (veri_chat_v2 orgs) + `/veri-ai` + `/chat` are 3-4 independent chat surfaces — see `CRITICAL_GAPS.md` |

## VERI To Do / VERI Minutes of Meetings

| | |
|---|---|
| **Tables** | `veriMeetings` (publish/lock workflow, Wave 44), `veriMeetingActionItems`, `veriMeetingShareLinks` |
| **Services** | `veri-todo-service.ts` (`listVeriTodos()` — unions tasks + instructionCommitments + pmsIssues), `veri-meeting-service.ts` |
| **Pages** | `/veri-todo`, `/veri-meetings`, `/mom-share/[token]` (public) |

---

## Project Management System (PMS — opt-in, ~24 tables)

| | |
|---|---|
| **Tables** | `pmsIssueTypes`, `pmsIssueStatuses`, `pmsWorkflowTransitions`, `pmsIssues`, `pmsIssueAssignees`, `pmsIssueRelations`, `pmsLabels`/`pmsIssueLabels`, `pmsEstimateSchemes`/`pmsEstimatePoints`, `pmsMilestones`, `pmsSprints`, `pmsSavedViews`, `pmsWikiPages`, `pmsTimeEntries`/`pmsBillableRates`, `pmsBudgets`/`pmsBudgetLineItems`, `pmsMeetings`+agenda/outcomes/participants |
| **Services** | `pms-enablement-service.ts`, `pms-issue-service.ts`, `pms-taxonomy-service.ts`, `pms-sprint-service.ts`, `pms-view-service.ts`, `pms-wiki-service.ts`, `pms-time-service.ts`, `pms-budget-service.ts`, `pms-meeting-service.ts` |
| **Pages** | `/pms/*` — projects, issues, board (Kanban, `@dnd-kit/core`), sprints, wiki, time, budgets, meetings, roadmap (Gantt, pure CSS timeline, zero new schema) |

---

## HR & People

| | |
|---|---|
| **Statutory-compliance tables (original)** | `hrComplianceItems`, `directorsKmp`, `relatedPartyTransactions`, `poshComplaints`/`poshCommittee`/`poshAnnualReports` |
| **Employee-master tables (Wave 40)** | `employeeProfiles`, `leaveRequests`, `leaveBalances`, `leavePolicyEntries` — org chart needed zero new schema (`users.reportingToId`/`departmentId` already existed since Wave 1) |
| **Recruitment/Performance (Wave 62)** | `jobOpenings`, `candidates`, `jobApplications`, `interviewFeedback`, `performanceReviewCycles`, `performanceReviews` |
| **Services** | `hr-service.ts`, `recruitment-service.ts`, `performance-service.ts` |
| **Pages** | `/hr` (Directory/Org Chart/Leave), `/recruitment`, `/performance-reviews` |

## CRM & Sales

| | |
|---|---|
| **Tables** | `crmLeads`, `crmOpportunities` (Wave 41 — deliberately narrow, not a generic sales CRM), `salesPartners`, `salesReferrals`/`salesReferralLinks`, `salesCommissionPlans`/`salesCommissionAccruals`, `installedProducts` |
| **Services** | `crm-service.ts`, `sales-engine-service.ts` |
| **Pages** | `/crm` (Leads/Opportunities) |

## Knowledge Base, Automation, Custom Reports (always-on, core modules)

| | |
|---|---|
| **Tables** | `knowledgeBasePages`, `automationRules`/`automationRuleRuns`, `savedReports`, `metricAlertRules` (Wave 38 — scheduled threshold alerting) |
| **Services** | `knowledge-base-service.ts`, `automation-rule-service.ts`, `custom-report-service.ts`, `metric-alert-service.ts` |
| **Pages** | `/knowledge-base`, `/automation`, `/reports` (Custom Reports section) — see "Reports & Analysis" below for the full cross-domain report catalog |

## Reports & Analysis (unified catalog across all report-producing services)

Report logic lives in 4 separate services with no single index of what actually
exists — `report-catalog-service.ts` is that index: a data-only registry
(`REPORT_CATALOG`), one entry per real report/analysis type, each with its
domain, source function, real output formats, and the actual route it runs at
today (honestly noting when that route is API-only or cron-gated, not a page).

| | |
|---|---|
| **Catalog** | `src/lib/services/report-catalog-service.ts` — `REPORT_CATALOG` (26 entries across 5 domains: compliance/ERP/construction/AI-ops/custom) |
| **Source services** | `custom-report-service.ts` (1 generic entry — user-authored saved queries), `erp-financial-report-service.ts` (Trial Balance/P&L/Balance Sheet/Cash Flow — 4 entries), `construction-reports-service.ts` (17 PROJEXA reports), `ai-performance-report-service.ts` + `report-cadence-service.ts` (AI Performance/Escalations/Recommendations/Risk-Trends — 4 entries, cron-only) |
| **Pages** | `/reports` (Report & Analysis Catalog section, `ReportCatalogList.tsx`, links out to each entry's real route), `/erp/reports` (Trial Balance/P&L/Balance Sheet/Cash Flow tabs), `/reports#custom-reports` (Custom Reports) |
| **Chain integration** | `capability-tree-service.ts`'s `buildReportCatalogNodes()` surfaces a "Reports & Analysis" branch (grouped by domain) in the Dynamic Chain Options Selector (`ChainSelector.tsx`) — only entries with a directly-navigable, no-required-params route get wired as a clickable leaf; the rest (construction API-only reports, cron-only AI-ops reports) still appear as leaves but fall through to the normal AI-planning path |

## Facility Management (`facilities_management` product branch)

| | |
|---|---|
| **Tables** | `fmAssets`/`fmAssetCategories`/`fmAssetDuplicateCandidates`, `fmChecklistTemplates`+items, `fmPpmSchedules`/`fmPpmOccurrences`/`fmPpmOccurrenceItemResults`, `fmAmcContracts`, `fmRegisterDigitizationBatches`+rows, `fmVisitors`/`fmVisitorLogs` |
| **Services** | `fm-asset-service.ts`, `fm-asset-dedup-service.ts`, `fm-checklist-service.ts`, `fm-enablement-service.ts`, `fm-ppm-service.ts`, `fm-register-digitization-service.ts`, `fm-amc-service.ts`, `fm-visitor-service.ts` |

## Firm/Practice Management (`the_firm` product branch — CA/legal firms)

| | |
|---|---|
| **Tables** | `firmEngagements`+deliverables, `firmInvoices`+lineItems, `firmStaffAssignments`, `firmClientServiceLines`, `firmTimeEntries`, `firmTaxCases`, `firmBillableRates` |
| **Services** | `firm-billing-service.ts`, `firm-client-service-line-service.ts`, `firm-enablement-service.ts`, `firm-engagement-service.ts`, `firm-practice-dashboard-service.ts`, `firm-staff-assignment-service.ts`, `firm-tax-case-service.ts`, `firm-time-tracking-service.ts` |

## VERI Reward (gamification, free/on-by-default per `veri_reward` branch)

| | |
|---|---|
| **Tables** | `veriRewardAchievementDefinitions`/`Unlocks`, `veriRewardPointsLedger`, `veriRewardReferrals`, `veriRewardStreaks` |
| **Services** | `veri-reward-service.ts`, `veri-reward-enablement-service.ts` |

## Approval & Workflow Engine (entity-agnostic, always-on)

| | |
|---|---|
| **Tables** | `approvalWorkflowDefinitions`/`StepDefinitions`/`Instances`/`StepInstances`/`StepApprovals` (generic, Wave 50/51), `approvalRequests` (older, single-step maker-checker — still used by Policy publish and Worker Agent proposals), `delegationOfAuthority`, `codeChangeRequests` |
| **Services** | `approval-workflow-service.ts`, `code-change-request-service.ts` — **explicitly does NOT cause code to change; it's an intake/audit trail, not a pipeline** |

## Module Registry & Rules (platform catalog)

| | |
|---|---|
| **Tables** | `moduleRegistry`, `productBranches`, `productBranchModules`, `moduleRuleConfigs`, `sharedPoolAllocations` |
| **Services** | `module-registry-service.ts`, `module-rule-service.ts` |
| **Purpose** | `moduleRuleConfigs` generalizes the orchestra resolver's "most-specific-scope-wins" pattern to module *behavior* (not just AI model choice) — wired for 3 representative modules (risks/severity_matrix, incidents/regulatory_notify_triggers, posh/classification_ceiling_override) out of ~40 possible, deliberately |

## Other real, smaller modules

- **Ticketing & MDM**: `mdmDuplicateCandidates`/`mdmMergeLog` — `mdm-quality-service.ts`
- **Document extraction (vision)**: `document-extraction-service.ts`, `callLLMVision()` in `llm-client.ts` — image types only, PDF vision deliberately deferred
- **Visitor Intelligence**: `visitor-intelligence-service.ts`, `contactSubmissions`, `forgeProjectRequests` — landing-page lead capture, structurally near-identical tables with no joined "prospect 360" view yet
- **SSO**: `ssoConfigurations`, `sso-service.ts` — SAML 2.0 SP-side, real assertion validation, does **not** auto-provision users from IdP claims
- **Webhooks**: `webhooks`/`webhookDeliveries` — HMAC-signed, 3-attempt backoff, wired to 4+ ERP mutation events

---

## Frontend structure

**Authenticated app** (`src/app/(app)/`, ~55 directories): dashboard→home (redirects), compliance, checklists, tasks, reports, penalties, departments, users, audit, settings, team, plus every module above.

**Public routes** (outside `(app)`, outside the auth allowlist by design): `/login`, `/signup`, `/pricing`, `/join-us`, `/contact`, `/the-firm`, `/office`, `/veri-fm-cs`, `/forge`, `/partner`, `/vendor-portal`, `/guest-chat/[token]`, `/shared/conversation/[token]`, `/mom-share/[token]`, `/r/[token]`, `/vr/[token]`.

**Shell**: `src/components/AppShell.tsx` — flag-gated between the legacy sidebar-only layout and the `veri_chat_v2` two-column `ResizablePanelGroup` layout; `GlobalChatDock` (floating, hidden on `/veri-ai`/`/chat`) mounted for non-veri_chat_v2 orgs.

---

## Where the deep-audit findings live

This map is descriptive (what exists, where). Severity-rated evaluation of *how well* each of these is built lives in [`AUDIT_2026-07-09.md`](AUDIT_2026-07-09.md). Known cross-cutting problems (staleness, duplication, dormant scaffolding) live in [`CRITICAL_GAPS.md`](CRITICAL_GAPS.md).
