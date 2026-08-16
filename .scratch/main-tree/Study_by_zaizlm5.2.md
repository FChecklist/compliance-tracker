# Study_by_zaizlm5.2 — VERIDIAN AI OS Constitution Study

**Author:** z.ai GLM-5.2 (via OpenRouter, dispatched by Claude Code Sonnet Desktop acting as orchestrator per the repository owner's instruction)
**Date:** 2026-07-09

This is z.ai GLM-5.2's **independent** study of `VERIDIAN.docx` (the "VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP Architecture v1.0" transcript document, ~13,259 extracted lines), done in parallel with a separate independent study by Claude (`Study_by_Claude.md`, not read by the model producing this document, to preserve independence). It was produced across 6 separate tool-calling agent sessions (via this repo's `ai-team-workforce.yml` dispatch pipeline, role `documentation_specialist`, model `z-ai/glm-5.2`), each independently reading one ~2,000–2,500 line chunk of the source text and verifying claims against the real `compliance-tracker` repository — each session had real `read_file`/`list_dir` tool access to the actual codebase, not just the source document.

The 6 parts below are concatenated verbatim from each session's own output (`docs/study-zai/part-1.md` through `part-6.md`) — this file assembles them but does not alter their content. A separate, independently-synthesized `GapAnalysis_by_zaizlm5.2.md` consolidates and prioritizes the findings across all 6 parts.

---

# VERIDIAN AI OS Engineering Standard (CSV 221 / UEIP v1.0) — Part 1 of 6

This is Part 1 of 6 of an **independent** study by **z.ai GLM-5.2** (via openrouter.ai) of the VERIDIAN.docx source document, covering source lines 1–2084. It is being produced in parallel with a separate study by Claude Code Sonnet Desktop; the two will be cross-reviewed later, so the analysis below is this model's own genuine reading — not a guess at another AI's conclusions. The source chunk opens with the document's own meta-instructions about how the study should be conducted (noted but not acted upon — no live code was changed), then lays out a 20-principle "Constitution" preamble, a Capability Engineering recommendation, and Studies 1–5 (prompt compression, Token Utilization Engine, Cognitive Evolution Engineering, Conversation Intelligence, and the Conversational Virtual Machine / Conversation OS). Repo verification was scoped to three files most relevant to what the source actually proposes: `src/lib/services/capability-registry-service.ts`, `src/lib/services/worker-agent-service.ts`, and `src/lib/services/chat-service.ts`. Where a claim could not be verified from those three, it is marked as such.

---

### Opening meta-instructions & Study 0.1 — VERI as the loyal assistant (source lines 1–~45)
- **Understanding:** The document's preamble frames itself as a *constitution* ("VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP v1.0"), instructs that no live code be changed during study, and assigns two independent reviewers (Claude + z.ai) who will later cross-review and divide implementation work. It also calls for a single approval gateway ("super agent") managed by a frontier model through which all VERIDIAN changes flow. Study 0.1 introduces VERI — the in-chat name of the OS — as a loyal assistant serving humans, AI agents, APIs, and third-party systems; a "smart, thinking cognitive AI OS brain."
- **Architecture/Schema implications:** Implies a change-management gateway entity (proposals → analyze → approve/reject/modify → implement → test → go-live) and a multi-actor identity model where the assistant's users are not only humans.
- **Gap vs current repo:** The maker-checker `approvalRequests` table reused by `worker-agent-service.ts` (requestType free-text, entityType free-text) is a plausible substrate for such a gateway, but no single unified "super agent" change-gateway service was found in the three files read. Multi-actor (agent/API as user) identity could not be verified from these files.
- **Implementation recommendation:** Before building a new gateway, audit whether `approvalRequests` + the existing FDE/worker-agent proposal flows already cover the "single gateway" intent; extend requestType taxonomy rather than create a parallel mechanism.

---

### Principles 1–3 — Vision, Core Philosophy, Architectural Principle (the "Master Brain" thesis) (source lines ~46–120)
- **Understanding:** VERIDIAN is explicitly *not* an ERP/CRM/PM/accounting app — it is a Cognitive AI Operating System (CAIOS) in which every app/module/feature/agent/integration is a plug-in orchestrated by the Master Brain. Ownership is layered: the OS owns intelligence, apps own business functionality, modules own reusable capabilities, projects configure, customers consume, worker agents execute, third parties extend. An ASCII diagram places Knowledge/Conversation/Decision/Planning/Execution/Reasoning/Learning/Prediction/Innovation/Security/Governance/Analytics/Memory/Worker Agents/Integration/Automation/Workflow/Identity/Event Bus/Cognitive Graph as the brain's core, with Products/Projects/Modules/Industry Packs/MCP Servers/External AI Models as extensions, and Users/Orgs/Partners/Customers/Developers as consumers.
- **Architecture/Schema implications:** A strict layering: cognitive-core services (intelligence) → configurable capability/module layer → consumer/identity layer. Implies an Event Bus and a Universal Cognitive Graph as first-class platform primitives.
- **Gap vs current repo:** `chat-service.ts` shows a real "VERIDIAN AI" thread and `generateAiReply` calling an LLM through `resolveModelConfig` / `callLLM` — a genuine cognitive-core call site. No Event Bus or Enterprise Cognitive Graph table was found in the three files read; could not verify.
- **Implementation recommendation:** Treat the ASCII diagram's middle band as a service inventory checklist; map each named intelligence (Conversation, Decision, Planning, etc.) to a concrete service or mark it as a gap before building new modules.

---

### Principle 4 — Intelligence Ownership (source lines ~121–140)
- **Understanding:** Fourteen intelligence categories (Conversation, Decision, Planning, Execution, Learning, Reasoning, Prediction, Innovation, Knowledge, Security, Governance, Memory, Automation, Worker Agent) must exist exactly once in the platform. No application may implement its own intelligence layer; apps consume platform intelligence via standardized APIs.
- **Architecture/Schema implications:** A registry/manifest of "intelligence services" with a single canonical implementation each, exposed through stable APIs.
- **Gap vs current repo:** `capability-registry-service.ts` indexes `worker_agent`, `automation_rule`, `module`, `prompt_pattern` entity types — a capability-level dedup registry, not an intelligence-service manifest. `enforcePolicy` in `chat-service.ts` is a Security/Governance intelligence call site. Most of the 14 categories have no verified single-owner service.
- **Implementation recommendation:** Build an "intelligence service registry" (distinct from the capability registry) listing each of the 14 categories with its owning service and API contract; flag categories with no owner.

---

### Principles 5–6 — Universal Capability Model & Universal Module Library (source lines ~141–185)
- **Understanding:** Every capability (Auth, Approval Workflow, OCR, GST Calculation, BOQ, etc.) becomes a reusable enterprise asset in a Capability Library — never recreated. Modules (Accounting, HRMS, CRM, Construction, etc.) are likewise reusable and expose services that projects assemble rather than rewrite.
- **Architecture/Schema implications:** A capability catalog (name, domain, input/output schema, version) and a module catalog that composes capabilities.
- **Gap vs current repo:** `capability-registry-service.ts` is a real Capability Library substrate: `buildCapabilityContent` embeds name/domain/description/inputSchema/outputSchema, `findSimilarCapabilities` does semantic dedup with a 0.5 relevance floor, and `auditDuplicateCapabilities` (threshold 0.92) is an on-demand duplicate audit. `worker-agent-service.ts` writes `inputSchema`/`outputSchema` on proposal. This is the strongest repo match to any constitution principle so far. No separate "module" catalog table was found in the three files read (modules are only an indexed entity type, not a queried table here).
- **Implementation recommendation:** Promote the existing capability registry to the canonical Capability Library; add a module catalog that references capability IDs rather than duplicating logic.

---

### Principles 7–8 — Universal Product Factory & Universal Project Factory (source lines ~186–225)
- **Understanding:** New products are assembled by selecting modules/workflows/agents/integrations/dashboards/reports/permissions/branding/rules/subscriptions with minimal new code. Projects are likewise configuration objects (module selection, workflow selection, business rules, UI config, branding, permissions, integrations, reports, dashboards, knowledge packs) — "assembled, not programmed."
- **Architecture/Schema implications:** Product and Project as configuration entities that reference selections from the capability/module/agent/integration catalogs; metadata-driven assembly.
- **Gap vs current repo:** `worker-agent-service.ts` accepts an optional `projectId` (Wave 19 "Product/Project L2 scope") on agent proposals, implying a project entity exists. No product/project factory service was found in the three files read; could not verify assembly-from-config.
- **Implementation recommendation:** Define Product/Project as JSON-config manifests referencing catalog IDs; build a validator that rejects manifests referencing nonexistent capabilities.

---

### Principle 9 — Customer Customization Framework (source lines ~226–245)
- **Understanding:** Every customer gets custom workflows, roles, reports, dashboards, business rules, approvals, forms, templates, notifications, and worker agents — without touching platform core. Customization should be metadata-driven wherever possible.
- **Architecture/Schema implications:** A tenant/customer-scoped metadata layer (custom roles, rules, templates) layered over the immutable core; RLS-enforced isolation.
- **Gap vs current repo:** `worker-agent-service.ts` implements customer-scoped customization concretely: `tier:'customer'` (org-wide) and `tier:'client'` (one client, validated via `userClientAccess`) proposals, with `tier:'global'` deliberately not proposable through the service (RLS blocks it). `withTenantContext` provides tenant scoping. This is a real, partial match for the customization framework, scoped to worker agents only.
- **Implementation recommendation:** Extend the tier/scoping pattern already proven for worker agents to custom roles, rules, reports, and templates rather than inventing a new customization mechanism per asset type.

---

### Principle 10 — Universal Integration Layer (source lines ~246–270)
- **Understanding:** Every external system (ERP, accounting, government/banking/payment APIs, WhatsApp, email, M365/Google, calendars, IoT, construction equipment, document systems, MCP servers, open APIs) connects through one integration framework; each integration becomes reusable.
- **Architecture/Schema implications:** A single integration registry/adapter framework with reusable connector definitions.
- **Gap vs current repo:** No integration-layer service was found in the three files read. `chat-service.ts` references `resolveModelConfig` (AI provider config) and external LLM providers, which is an AI-model integration but not the general external-system integration layer described. Could not verify.
- **Implementation recommendation:** Before building, audit whether any existing connector/adapter code can be generalized; design the integration registry to mirror the capability registry's dedup pattern.

---

### Principle 11 — Universal Worker Agent Library (source lines ~271–290)
- **Understanding:** Worker agents (Accounting, Compliance, Meeting, Scheduler, Planning, Construction, BOQ, Procurement, Legal, Risk, Analytics, Conversation) are reusable and must never be duplicated.
- **Architecture/Schema implications:** A worker-agent catalog with domain indexing, lifecycle status, and dedup against existing agents.
- **Gap vs current repo:** Strong match. `worker-agent-service.ts` provides `proposeWorkerAgent` (creates with `lifecycleStatus:'proposed'`, indexes capability immediately so pending proposals are discoverable), `discoverWorkerAgent` (filters by lifecycle status), `workerAgentDomainIndex` (one-to-many domain paths), and immediate `indexCapability` on proposal to prevent duplicates. `recordWorkerAgentLearning` and `findWorkerAgentIdForTask` round out the library. The domain examples (Accounting, Compliance, etc.) are not pre-seeded — agents are created on demand.
- **Implementation recommendation:** Seed canonical domain agents as `tier:'global'` (the one tier not proposable through the service — requires a Layer-1 seeding path) so the "library" is not empty by default.

---

### Principle 12 — Universal Knowledge Library (source lines ~291–315)
- **Understanding:** Knowledge is centralized: business rules, industry rules, compliance rules, calculations, templates, policies, lessons learned, decision history, workflow library, conversation library, prompt library, reasoning library. All products reuse the same knowledge base.
- **Architecture/Schema implications:** A knowledge store partitioned by type, with cross-product reuse and a decision-history log.
- **Gap vs current repo:** Partial. `chat-service.ts` references `resolvePromptTemplate("chat.ai_thread_system")` — a prompt library/versioning call site. `worker-agent-service.ts` writes `workerAgentLearnings` (lessons learned). `capability-registry-service.ts` indexes `prompt_pattern` entities. No unified "knowledge library" aggregating all the listed types was found; could not verify a reasoning library or decision-history store.
- **Implementation recommendation:** Consolidate the scattered knowledge artifacts (prompt patterns, agent learnings, compliance rules) under a single knowledge-library service interface while keeping their existing storage.

---

### Principle 13 — Universal Experience Layer (source lines ~316–335)
- **Understanding:** Regardless of module, users experience the same conversation style, approval mechanism, navigation, notifications, AI behavior, design language, and governance. Consistency builds trust.
- **Architecture/Schema implications:** A shared UX/personality layer and shared interaction primitives (approval cards, notification format) used by all modules.
- **Gap vs current repo:** `chat-service.ts` seeds a consistent VERIDIAN welcome message and uses `buildPurposeClause`/`enforcePolicy` uniformly — a thin experience-consistency substrate. No shared UI component library or notification-format service was found in the three files read.
- **Implementation recommendation:** Extract the VERI personality/tone currently inlined in `ensureAiThread`'s seed message into a reusable personality layer (this connects directly to Study 4's Personality Engine).

---

### Principle 14 — AI Coding Directive (source lines ~336–360)
- **Understanding:** Before writing any new feature, developers/AI coding agents must answer a 9-question checklist (does the capability/module/agent/workflow/integration already exist? can it be configured? metadata? business rules? is new code genuinely required?) and only write new platform code if all answers are "No."
- **Architecture/Schema implications:** A pre-implementation search step that queries the capability/module/agent/integration registries before coding.
- **Gap vs current repo:** `capability-registry-service.ts`'s `findSimilarCapabilities` is exactly the search primitive this directive requires, and `chat-service.ts`'s passive `submitFdeRequest` (high-confidence embedding match short-circuits with zero LLM cost) is a live "does this capability already exist?" check running on every chat turn. This directive is partially operationalized already.
- **Implementation recommendation:** Formalize the 9-question checklist as a mandatory pre-coding gate that calls `findSimilarCapabilities` across all entity types and logs the answers.

---

### Principle 15 — Universal Dependency Rules (source lines ~361–375)
- **Understanding:** No module may directly depend on another module. All inter-module interaction goes through Platform Services, Capability APIs, Worker Agents, Event Bus, Enterprise Cognitive Graph, or Workflow Engine — ensuring loose coupling.
- **Architecture/Schema implications:** A dependency manifest per asset; an Event Bus as the only allowed cross-module channel.
- **Gap vs current repo:** `worker-agent-service.ts` and `chat-service.ts` show services calling each other through typed service functions (e.g., `chat-service` imports `recordWorkerAgentLearning`, `submitFdeRequest`, `indexCapability`) — service-layer indirection, consistent with the rule. No Event Bus was found in the three files read; could not verify. No dependency-manifest enforcement was found.
- **Implementation recommendation:** Introduce a static-analysis/lint rule forbidding direct module-to-module imports outside the service layer; add a dependency graph to the asset registry.

---

### Principle 16 — Universal Asset Registry (source lines ~376–405)
- **Understanding:** Maintain a registry of every reusable asset (modules, features, components, worker agents, integrations, APIs, templates, forms, dashboards, reports, calculators, policies, knowledge packs, prompt libraries, conversation templates, UI components, automation recipes). Each asset has owner, version, dependencies, documentation, usage metrics, quality score, compatibility, lifecycle status.
- **Architecture/Schema implications:** A universal asset registry with rich per-asset metadata (the listed fields) spanning all asset categories.
- **Gap vs current repo:** Partial. `capability-registry-service.ts` is an asset registry for 4 entity types (worker_agent, automation_rule, module, prompt_pattern) with content/embedding and a relevance-scored similarity search. `worker-agent-service.ts` tracks `lifecycleStatus` and `proposedById` (owner-ish) for agents. But version, dependencies, documentation, usage metrics, quality score, and compatibility fields were not visible in the three files read for the asset types covered. Most asset categories (forms, dashboards, reports, calculators, UI components) are not in the registry at all.
- **Implementation recommendation:** Extend the existing registry's per-asset metadata to the full field set; onboard the missing asset categories incrementally rather than building a second registry.

---

### Principles 17–20 — Platform Evolution, AI Governance, Engineering, Foundational Architecture (source lines ~406–460)
- **Understanding:** (17) Every new customer requirement should first be evaluated for reusability; if reusable, generalize/document/convert to a platform capability/add to the library/expose via API. (18) The OS owns enterprise intelligence, knowledge, reasoning, planning, execution, learning, predictions, innovation, governance; applications are consumers, never owners. (19) "Build once. Configure many. Reuse everywhere. Govern centrally. Improve continuously." — no capability should be developed exclusively for one project if it can be a reusable asset. (20) The OS is the permanent cognitive core; everything else is a plug-in; intelligence is never fragmented; every implementation should strengthen the platform by contributing reusable assets.
- **Architecture/Schema implications:** A "generalize-on-implementation" workflow that promotes project-specific code into the capability library, plus a governance boundary keeping intelligence centralized.
- **Gap vs current repo:** The FDE flow (`submitFdeRequest` in `chat-service.ts`, passive by default) is the live embodiment of (17): real user requests are evaluated for new-capability-vs-existing-match, and confident matches auto-answer/auto-dispatch without an LLM. `enforcePolicy` embodies (18)'s governance ownership. The "promote project code to platform capability" workflow was not found as an automated path; could not verify.
- **Implementation recommendation:** Add an explicit "promote to platform" action to the FDE proposal flow so a project-specific agent/rule can be generalized into a `tier:'global'` asset after approval.

---

### Capability Engineering (CE) recommendation (source lines ~461–490)
- **Understanding:** A new engineering discipline sitting above module development: before any code, ask "is this a new capability, or a new use of an existing one?" Every new request must first search the Capability Registry; if a capability exists, configure/compose/extend rather than recreate. CE is named alongside Conversation Engineering, Token Utilization Engineering, Loop Engineering, Evolution Engineering, and Worker Agent Engineering as a coordinated discipline set.
- **Architecture/Schema implications:** A mandatory Capability Registry search as the first step of any implementation request; CE as a named subsystem coordinating the other engineering disciplines.
- **Gap vs current repo:** The Capability Registry (`capability-registry-service.ts`) and its search (`findSimilarCapabilities`, `findSimilarPromptPatterns`) exist and are wired into FDE. CE as a *named coordinating subsystem* unifying the listed disciplines does not appear to exist as a single service; the disciplines are scattered (TUE not found, Conversation Engineering partial via chat-service, Worker Agent Engineering via worker-agent-service).
- **Implementation recommendation:** Define CE as a thin orchestration layer over the existing registry + FDE + worker-agent services rather than a new heavyweight service; its job is to enforce the search-first contract.

---

### Study 1 — Prompt compression levels & the Token Utilization Engine (source lines ~491–620)
- **Understanding:** Proposes a 6-level compression pipeline: (L1) Mode Pills/Option Selector giving ~90% intent clarity; (L2) safe-word removal (greetings, politeness, fillers, meta-phrases) plus phrase normalization ("I want you to explain" → "Explain"), with a critical do-not-remove list (not, never, except, unless, only, without, if, must, etc.); (L3) domain-specific aliases (Construction Project Management ERP → CPM, BOQ, PO, RFI, VO) expanded only when needed; (L4) session memory — send a Workspace Context ID once, then only incremental changes; (L5) Intent Engine converting free text to structured intent JSON; (L6) deterministic software before LLM (calculators, GST/TDS, date arithmetic, SQL, sorting/filtering). Recommends a dedicated Token Utilization Engine (TUE) with a 10-stage pipeline (Mode Pills, internal calculators/processes/IO verification, intent detection, rule engine, prompt normalizer, context manager, domain dictionary, semantic compression, prompt cache, model router).
- **Architecture/Schema implications:** A TUE subsystem with pluggable stages; a domain-alias dictionary; a session-context/ID store; an intent schema; a deterministic rule/calculator layer; a prompt cache; a model router.
- **Gap vs current repo:** Partial and scattered. `chat-service.ts`'s `buildConversationHistory` implements a crude L4 (HISTORY_LIMIT=20, HISTORY_CHAR_BUDGET=12000, oldest-first trim) — context management exists but is turn/char-bounded, not ID-incremental. `resolveModelConfig` is a model router (L10). `enforcePolicy` + the passive FDE embedding match is a partial intent/rule short-circuit (L5/L6). No domain-alias dictionary, no prompt normalizer/safe-word remover, no semantic compressor (LLMLingua-style), no prompt cache, and no Mode Pills/Option Selector were found in the three files read.
- **Implementation recommendation:** Build TUE as an explicit ordered pipeline service that the chat reply path calls before `callLLM`; reuse `buildConversationHistory`'s budgeting as the context-manager stage's first cut. Do not build a naive stop-word remover — the source itself warns against it.

---

### Study 2 — Open-source TUE building blocks & the full pipeline (source lines ~621–760)
- **Understanding:** Surveys open-source projects for each TUE phase: Intent Detection (spaCy, Rasa, Haystack), Rule Engine (json-rules-engine, Nools) for GST/accounting/payroll/formula/KPI/date/approval-workflow logic without an LLM, Prompt Compression (LLMLingua, LongLLMLingua), Semantic Caching (GPTCache, LangCache), Context Management (Mem0, LangGraph, LlamaIndex), Model Routing (LiteLLM, OpenRouter SDKs), Multi-Agent Orchestration (OpenAI Agents SDK, CrewAI, AutoGen, Camel AI), Token Accounting (tiktoken, OpenLit). Then specifies a concrete TUE pipeline: User → Intent Detection → Software Decision Engine (calculators, process/SQL/validation/error/business-logic/guardrail/task-start/review/completion/ending/workflow/business-rules/communication/preferences/requirement engines) → "Need LLM?" branch (No → return result; Yes → Prompt Optimizer → Context Manager → Semantic Compressor → Model Router → LLM → Output Cache → Response). Frames TUE as a competitive advantage: optimize *before* the LLM is invoked.
- **Architecture/Schema implications:** A Software Decision Engine with many named sub-engines; a clear LLM-gate; an output cache; token accounting instrumentation.
- **Gap vs current repo:** `recordOrchestraExecution` in `chat-service.ts` is a token/execution accounting call site (OpenLit/tiktoken analog). `resolveModelConfig` is the model router. The Software Decision Engine's many named sub-engines (input/output validation, error rectification, guardrail, task-start/review/completion/ending, business-logic-understanding) were not found as distinct services; `enforcePolicy` is the closest (guardrail). No semantic cache (GPTCache-style) was found. Could not verify most sub-engines.
- **Implementation recommendation:** Do not adopt all named sub-engines verbatim — many overlap. Map them onto the 14 intelligence categories from Principle 4 and implement only those with real call sites; add a semantic cache keyed on intent+context-ID before adding more engines.

---

### Study 3 — Cognitive Evolution Engineering (CEE) (source lines ~761–980)
- **Understanding:** The deepest architectural claim: VERIDIAN should not "learn" by sending more text to an LLM (which scales poorly — more knowledge = more tokens). Instead it learns by *evolving software artifacts*: converting repeated reasoning into durable assets (new rules, agents, processes, workflows, SQL, APIs, modules, decision trees) that execute with zero LLM tokens. Proposes a Continuous Learning Pipeline (Observation → Pattern Detection → Validation → Knowledge Extraction → Code Generation → Testing → Deployment → Monitoring → Improve), noting only Knowledge Extraction and Code Generation need frontier AI. An Agent Factory (generate agent → tests → docs → deploy → register, once, then reuse), Process Factory (recognize recurring workflows → generate reusable process → "Run Process #483"), Module Factory (infer new tables/UI/APIs/permissions/reports/agents from repeated requests), Knowledge Objects (compact typed objects instead of long conversations), Learning through Metrics (telemetry on failed prompts, timeouts, edited workflows, corrected outputs), Human Approval governance (propose → tests → simulations → confidence score → human/policy approval → deploy), Hierarchical Memory (Session → Workspace → Domain → Agent → Enterprise → Global), and a Token Budget Manager (treat tokens like CPU/RAM; every LLM call has a defined purpose and budget). Defines Cognitive Evolution Engineering (CEE) as the umbrella discipline over Loop/Agent/Process/Knowledge/Workflow/Token Utilization/Decision/Memory/Self-Optimization/Model Routing/Rule/Learning/Governance/Simulation/Continuous Verification Engineering.
- **Architecture/Schema implications:** Factories that generate and register durable assets; a hierarchical memory with layered query; a token-budget ledger per request; a confidence-scored human-approval gate for self-modification; telemetry-driven improvement backlog.
- **Gap vs current repo:** Several pieces exist in embryonic form. `worker-agent-service.ts`'s `proposeWorkerAgent` + `approvalRequests` is a real Agent Factory *proposal* path with human approval (propose → ... → approval → deploy), and `recordWorkerAgentLearning` is a learning-capture write site (fed from `resolveInstructionMismatch` when a human corrects an AI's work — the "corrected outputs" telemetry signal). `chat-service.ts`'s passive FDE is the "need detected → evaluate" front end. However: no Process Factory, no Module Factory, no hierarchical memory layers, no token-budget ledger, no confidence-scored simulation gate, and no CEE umbrella service were found in the three files read.
- **Implementation recommendation:** This is the largest gap and the highest-leverage target. Start with the Agent Factory (already half-built) — add the missing tests/docs/simulation/confidence-score steps to the existing proposal flow. Defer Module Factory until the capability/module catalogs are complete. Implement hierarchical memory as a query-routing layer over existing stores rather than new tables.

---

### Study 4 — Conversation Intelligence Engine (CIE) / Conversational Intelligence Layer (source lines ~981–1180)
- **Understanding:** VERI should not be an empty textbox; it should drive guided conversations like a Chief Operating Assistant. Defines a Conversation Intelligence Engine: User → Intent Engine → Conversation Engine → Decision Engine → Workflow Engine → Task Engine → Worker Agents, where the LLM does *not* directly answer — instead the Conversation Engine asks "what info is missing / what to ask next / what options to show / what can be automated" then invokes a worker agent. Lists specialized engines: Suggestion (proactive recommendations from observed patterns), Approval (never silently decide — show impact + Approve/No/Details), Permission (graceful "request approval from Finance Manager" instead of "Access Denied"), Clarification (ask only for missing info, with option selectors), Progressive Disclosure (one question at a time), Prediction (next-step suggestions after events), Memory (remember preferences), Confidence (never pretend certainty — "98% confident"), Explainability (recommendation + reason + impact + risk + savings). Defines a Conversation State Machine (Greeting → Identify Intent → Collect Missing Info → Validate → Generate Plan → Ask Approval → Execute → Monitor → Summarize → Suggest Next Action — never skip states). A Personality Layer (professional, friendly, concise, proactive, transparent, confirms before important ops, simple English) enforced by the Conversation Engine, not re-described per prompt. Proposes a Conversational Intelligence Layer (CIL) of 11 named services (Intent, Conversation Planner, Context, Suggestion, Clarification, Approval, Permission, Workflow Navigator, Explanation, Personality, Next Best Action engines).
- **Architecture/Schema implications:** A conversation state machine with persisted state (current state, missing/completed inputs, pending approval, current workflow/user/workspace); a personality config; a suggestion/approval/permission engine family; a CIL service boundary distinct from the raw LLM call.
- **Gap vs current repo:** `chat-service.ts` is the closest substrate but is far short of CIE. It has: a persisted AI thread, a seeded personality-flavored welcome message (a hardcoded Personality Layer embryo), `buildConversationHistory` (Context engine embryo), `instructionCommitments` + `instructionMismatchDetections` (an Approval/Clarification-adjacent mechanism for human-to-human instructions, not AI-driven guided conversation), and `enforcePolicy` (Permission engine embryo — but it returns a refusal, not the graceful "request approval from X" the source wants). No Conversation State Machine, no Suggestion/Prediction/Confidence/Explainability engines, no Progressive Disclosure, no slot-filling, and no CIL service boundary were found. The LLM *directly* answers in `generateAiReply` — exactly the anti-pattern the source warns against.
- **Implementation recommendation:** This is the second-largest gap. Insert a Conversation Planner between `sendMessage` and `generateAiReply`: before calling the LLM, compute missing slots and render option selectors/UI from templates; only invoke the LLM when ambiguity remains. Persist conversation state (state machine fields) on the conversation or a new table. Refactor the inlined welcome-message personality into a Personality config.

---

### Study 5 — Conversational Virtual Machine (CVM) & Conversation OS / Conversation Knowledge Base (source lines ~1181–2084)
- **Understanding:** The most prescriptive study. Core philosophy: "LLMs are the last resort, not the first" — what feels like AI conversation should internally be 90–98% deterministic software (a "Software Brain" 95% / "LLM Brain" 5% split, user never knows which answered). 16 principles: (1) don't ask an LLM to say something already decided (render "Let's create a project" with zero tokens); (2) Conversation Templates for every ERP process's finite states; (3) generate UI not text (file upload component, not "please upload"); (4) a Business Conversation Library of thousands of reusable messages; (5) Intent Routing (known intent → software, else LLM); (6) Slot Filling (ask only missing fields); (7) UI instead of words (buttons, not "which report?"); (8) Predictive UI (show the usual next buttons); (9) Grammar Engine (template "{document} approved." with variables); (10) Explainability Templates (Recommendation/Reason/Impact/Risk/Savings/Approve — structured); (11) Decision Cards (Archive 143 Files + benefits + Approve/Cancel/Details); (12) AI only when uncertainty exists (ambiguity, complex reasoning, summarization, writing, negotiation, unknown workflow); (13) Intent Confidence — if >98% never call LLM; (14) Conversation State Machine stored in software (current state, missing/completed inputs, pending approval, current workflow/user/workspace — no prompt required); (15) Tiny prompts (send WorkspaceID/ProjectID/Task/MissingField, backend resolves IDs); (16) Structured outputs (LLM returns `{next_question, reason, confidence, actions}`, software renders in VERI's style). Proposes the **Conversational Virtual Machine (CVM)**: the LLM produces conversation *instructions* (intent, missing fields, suggested actions, next step), and software renders the actual UI/wording/personality. Defines a **Conversation Execution Engine (CEE)** (Intent → Workflow → Conversation Planner → Template Library → UI Composer → Decision Engine → LLM Gateway → Response Renderer → Learning Engine). Then a four-layer **Conversation Library**: L1 Micro Templates (thousands of tiny sentences — "Done.", "Invoice approved."), L2 Conversation Blocks (Confirmation/Info Collection/Approval Request/Permission/Suggestion/Warning/Error/Validation/Summary/Next Steps/Completion patterns), L3 Workflow Conversations (each workflow knows its own dialogue), L4 Industry Libraries (Construction/Accounting-specific dialogues). Versioning with metrics (click rate, satisfaction, completion time). Adaptive Conversation (beginner vs expert mode, same workflow different wording, still no LLM). Store Conversation *Components* (Greeting/Acknowledgement/Question/Suggestion/Approval/Completion/Next Action/Reminder/Help/Warning) assembled like React components. Proposes a **Conversation Knowledge Base (CKB)** of 50,000+ micro-responses/blocks/dialogues/templates/messages, each with an ID (e.g., MSG-00431 "Invoice approved successfully.") rendered by ID with zero tokens. Culminates in a **Conversation OS** (Conversation Grammar/Components/Templates/Workflow Dialogues/Personality Engine/UI Components/Suggestion/Approval/Clarification/Adaptive Conversation/Industry Packs/Localization Engine) with the LLM reduced to ambiguity/creative-generation/complex-reasoning.
- **Architecture/Schema implications:** A CVM that returns structured conversation instructions, not prose; a CKB of versioned, ID-addressable conversation components/templates/blocks/workflow-dialogues/industry-packs with usage metrics; a UI Composer that renders structured intents into forms/buttons/cards; a Conversation State Machine persisted in software; tiny-ID prompt protocol; structured LLM output schema; adaptive (beginner/expert) and localization dimensions.
- **Gap vs current repo:** Largest gap of the chunk. `chat-service.ts`'s `generateAiReply` returns free-text LLM prose directly as the message content — the opposite of the CVM (no structured `{intent, missing, next_step}` contract, no software rendering layer). `resolvePromptTemplate("chat.ai_thread_system")` is a single prompt template, not a CKB. No conversation-component/template/block/workflow-dialogue/industry-pack store, no UI Composer, no slot-filling, no Decision Cards, no Grammar Engine, no MSG-ID addressing, no adaptive/localization layer, and no Conversation State Machine persistence were found in the three files read. The passive FDE embedding match (>98% confidence short-circuit) is the one principle (13) partially operationalized. `instructionCommitments` is a distant relative of the Approval Engine but is human-to-human, not AI-driven.
- **Implementation recommendation:** This is the single biggest build target in Part 1 and should be sequenced after the Conversation Planner from Study 4 (they are the same subsystem at different detail levels). Concrete first steps: (a) define the CVM structured-output schema and have `generateAiReply` request it from the LLM; (b) introduce a `conversation_templates`/`conversation_components` table (ID, layer, body, variables, version, usage metrics) and a `renderConversationComponent(id, vars)` path; (c) replace direct prose insertion with template-rendered output for the known-intent path; (d) add a conversation_state column/table. Do not attempt the 50,000-entry CKB upfront — seed per-workflow templates and grow organically from telemetry (the source's own Learning-through-Metrics principle).

---

## Summary of notable gaps (Part 1)
1. **Conversation Intelligence / CVM / Conversation OS (Studies 4–5):** the largest gap; the LLM currently answers in free text with no structured-intent contract, no template rendering, no state machine, no CKB. This is the highest-leverage build.
2. **Token Utilization Engine (Studies 1–2):** only context-budgeting and model-routing exist; no normalizer, domain dictionary, semantic compressor, prompt cache, or deterministic rule-engine layer.
3. **Cognitive Evolution Engineering (Study 3):** Agent Factory proposal path exists; Process/Module Factories, hierarchical memory, token-budget ledger, and simulation/confidence gate are missing.
4. **Event Bus / Enterprise Cognitive Graph / Universal Integration Layer:** not found in the three files read — could not verify; likely missing or outside the files inspected.
5. **Asset Registry completeness (Principle 16):** registry exists for 4 entity types but lacks version/dependencies/docs/usage-metrics/quality/compatibility metadata and most asset categories.
6. **Verified strengths:** Capability Registry + dedup audit, worker-agent proposal/approval/learning loop, FDE passive capability matching, policy enforcement, and token/execution accounting are real and align well with Principles 5, 11, 14, 16, 17, 18.
# Part 2 of 6 — Independent Study of VERIDIAN AI OS Engineering Standard (CSV 201–206)

This is Part 2 of 6 of an **independent** study by **z.ai GLM-5.2** of the
"VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP Architecture v1.0"
transcript document. A separate AI (Claude) is performing its own independent
study of the same source in parallel; the two will be cross-reviewed later, so
the analysis below is genuinely my own reading, not a guess at another model's
conclusions. The source chunk covers CSV 201 (Conversation Operating System),
CSV 202 (Conversation Knowledge Base), CSV 203 (Conversation Components
Library), CSV 204 (which the source header lists as "Conversation Planning
Engine" but whose body is absent — see below), CSV 205 (Intent Intelligence
Engine), and CSV 206 (Conversation State Machine).

Repo verification was done against `src/lib/services/chat-service.ts`,
`src/lib/prompt-os-resolver.ts`, and `src/components/veri-chat/VeriChatPanel.tsx`
(all read in full). `src/lib/db/schema.ts` could **not** be read directly — it
is ~440 KB and exceeds the read tool's size limit, and no search/grep tool is
available. Table existence is therefore verified **indirectly** through the
imports and `db.query.*` / `db.insert(*)` call sites in the two service files,
which is strong but not exhaustive evidence.

---

### CSV 201 §1–2 — Vision & Philosophy (source lines ~1–120)
- **Understanding:** COS is positioned as a *deterministic software platform*
  that owns conversation orchestration; the LLM is merely one pluggable service
  inside it, never the OS itself. Core tenets: "Software First, AI Last,"
  "Click Before Typing," "Human In Control," and transparency (every
  recommendation explains Why/Impact/Confidence/Risk).
- **Architecture/Schema implications:** Implies a layered runtime where a
  Planner → Intent → Decision → Workflow → Software/LLM pipeline precedes any
  model call, and where the LLM returns structured data (not prose) that a
  Renderer converts to UI.
- **Gap vs current repo:** `chat-service.ts` does the opposite of "AI Last" —
  every AI-thread user message unconditionally calls `generateAiReply()` →
  `callLLM()`. There is no software-first short-circuit, no decision matrix,
  no structured-intent return path; the LLM returns raw `content` string that
  is stored verbatim as a message. The "LLM never talks to user directly /
  returns structured data" golden rule (§8) is **not implemented** — the LLM's
  free-text reply *is* the user-visible message.
- **Implementation recommendation:** Introduce a pre-LLM "software answer"
  gate (deterministic handlers for navigation/CRUD/known intents) before
  `callLLM`, and a structured-response contract where the model returns JSON
  that a renderer maps to UI. Plan-level only.

### CSV 201 §3–6 — Objectives, Design Principles, Core Rule (source ~120–230)
- **Understanding:** Quantified goals (reduce tokens/time/errors/typing;
  increase productivity/automation/trust/predictability/explainability) plus
  the "never ask for info VERIDIAN already knows" rule, with the
  "I'll create the project for Tryout Technologies" example.
- **Architecture/Schema implications:** Requires a context/profile store the
  planner can read to pre-fill fields (company name, user name, active
  project) so it never re-asks.
- **Gap vs current repo:** Partial. `ensureAiThread()` does read the user's
  first name (`me?.name`) to personalize the seeded welcome message — so the
  "don't ask what you know" principle is honored in *one* spot. But there is
  no general pre-fill layer; the LLM is given history + system prompt and
  asked to produce a reply, with no workspace/company context injected into
  the prompt beyond `buildPurposeClause(DEFAULT_DOMAIN)`.
- **Implementation recommendation:** Add a context-injection step in
  `generateAiReply` that pulls org/workspace/active-object references into the
  system prompt or a structured context block, so the model never has to ask
  for known facts.

### CSV 201 §6–8 — Core Architecture & Golden Rule (source ~230–340)
- **Understanding:** The canonical pipeline is
  UI → Planner → Intent → Decision → Workflow → Software → (LLM?) → Worker
  Agent → Renderer → User. The "Golden Rule" forbids the LLM from emitting
  user-facing text; it must return structured objects (Intent, MissingFields,
  RecommendedNextAction) that COS renders.
- **Architecture/Schema implications:** Implies a `decision_engine` boundary
  returning a discriminated union (software-path vs llm-path) and a
  `response_renderer` that consumes structured payloads, not strings.
- **Gap vs current repo:** **Missing.** `chat-service.ts`'s
  `generateAiReply` returns `{ content: reply }` from `callLLM` and inserts it
  straight into `messages.content`. No structured payload, no renderer, no
  decision engine, no worker-agent dispatch from chat. (Worker agents exist
  elsewhere — `recordWorkerAgentLearning`, `taskExecutionPlan` — but are not
  invoked from the chat path except via the passive FDE side-effect.)
- **Implementation recommendation:** Define a `ConversationResponse` schema
  (intent + missingFields + nextAction + uiComponents) and have the chat
  template demand JSON; route through a renderer before persisting a message.

### CSV 201 §9–11 — Conversation Objects, States, Software-vs-AI Matrix (source ~340–470)
- **Understanding:** Every conversation decomposes into
  Conversation→Step→Action→Response→UIComponent→Workflow→Decision→Validation→Completion,
  across 12 canonical states (Idle…End). A decision matrix partitions work
  into "Always Software" (CRUD, calc, permissions, reports) vs "Always AI"
  (writing, reasoning, summarization, unknown requests).
- **Architecture/Schema implications:** Implies a `conversation_states` /
  `conversation_steps` model and a routing table mapping intent categories to
  software handlers vs LLM.
- **Gap vs current repo:** The `messages` table (verified via `db.insert` in
  `chat-service.ts`) is a flat `{conversationId, senderId, content,
  isInstruction}` row — no step/state/workflow/decision columns. No state
  machine. The software-vs-AI matrix is absent; everything is AI.
- **Implementation recommendation:** Add a `conversation_state` column (or
  side table) to track the 12-state lifecycle, and a routing config that
  classifies each incoming message into software-handled vs llm-handled
  before `generateAiReply`.

### CSV 201 §12–18 — UX/Token Rules, Metrics, Worker Agents, Success Criteria (source ~470–620)
- **Understanding:** UX rules (3–5 options, one question at a time, predict
  next step); token rules (never resend greetings/history/policies — use IDs
  and references); a 10-agent worker roster; success targets of 90–98% LLM-
  free interactions and 80%+ guided-UI completion.
- **Architecture/Schema implications:** Token rules imply an ID-reference
  context protocol (ConversationID/StateID/WorkflowID sent instead of full
  history); metrics imply a `conversation_metrics`/`token_usage` table.
- **Gap vs current repo:** **Directly contradicted by current behavior.**
  `buildConversationHistory()` resends up to 20 prior messages (capped at
  12000 chars) on *every* reply — i.e., it resends history, the exact thing
  §14 forbids. `recordOrchestraExecution` does log `usage` (token metrics
  exist at the orchestra layer), but no per-conversation token-saved or
  automation-% metrics. The 10 worker agents are not present in the chat path.
- **Implementation recommendation:** Migrate from full-history replay to a
  state-reference context protocol once CSM (CSV 206) exists; surface
  orchestra `usage` data as per-conversation token metrics.

### CSV 201 — AI Coding Directive (source ~620–660)
- **Understanding:** COS must be an independent platform service; business
  modules communicate via interfaces and supply structured intents/rules/
  workflows/data but never generate conversational text themselves.
- **Architecture/Schema implications:** A `cos` service boundary with a
  public interface modules call into; modules register intents/workflows as
  metadata.
- **Gap vs current repo:** No `cos` platform service exists. Chat logic lives
  in `chat-service.ts` coupled to `messages`/`conversations` tables and the
  orchestra LLM client; there is no module-facing COS interface and no
  intent/workflow registration mechanism.
- **Implementation recommendation:** Carve a `src/lib/cos/` platform package
  with a `handleConversationEvent()` entrypoint that modules call, decoupling
  chat orchestration from the raw message table.

### CSV 202 §1–4 — CKB Vision, Philosophy, Architecture (source ~660–790)
- **Understanding:** The Conversation Knowledge Base is the master repository
  of reusable conversational assets (templates, components, variables,
  localization, versioning). Philosophy: "Reuse Before Generate" — search
  CKB/Workflow Library/Industry Pack/Components *before* invoking AI.
- **Architecture/Schema implications:** A `conversation_templates` /
  `conversation_blocks` / `conversation_components` schema with a
  template-engine + variable-injection render path that bypasses the LLM when
  a template matches.
- **Gap vs current repo:** **Missing.** The closest analog is
  `prompt-os-resolver.ts`'s `resolvePromptTemplate()`, which version-controls
  *LLM system prompts* (templateKey + label + version + isActive) — but that
  governs what prompt is *sent to the model*, not reusable *user-facing*
  conversational assets. There is no CKB, no template-search-before-LLM, no
  variable-injection renderer for user messages.
- **Implementation recommendation:** Extend the prompt-OS pattern into a CKB:
  a `conversation_templates` table keyed by intent/workflow/role, queried
  before `callLLM`, with a `{{variable}}` injector producing the final
  message without an LLM call when confidence is high.

### CSV 202 §5–8 — Knowledge Hierarchy, Categories, Object, Variables (source ~790–950)
- **Understanding:** Six-layer hierarchy (Micro Components → Blocks → Workflow
  Dialogues → Industry Packs → Role Packs → Workspace Packs); 25 conversation
  categories; a Conversation Object with ConversationID/Category/Industry/
  Workflow/Role/Priority/Language/Tone/Variables/Buttons/Icons/Permissions/
  Version/Status; variables like `{UserName}` injected by software.
- **Architecture/Schema implications:** A normalized template model with
  category/industry/role/workspace dimensions and a separate
  `conversation_variables` resolution step.
- **Gap vs current repo:** `promptVersions` (verified via
  `prompt-os-resolver.ts`) has `content`, `label`, `version`, `isActive` — a
  small subset of the proposed metadata. No industry/role/workspace/category
  dimensions, no variables table, no buttons/icons/permissions on templates.
- **Implementation recommendation:** Extend `promptVersions` (or add a
  parallel `conversation_templates` table) with category/industry/role/
  workspace columns and a variables map; keep the existing label/version/
  isActive governance pattern as the foundation.

### CSV 202 §9–14 — Components, IDs, Versioning, Localization, Adaptive, Assembly (source ~950–1110)
- **Understanding:** Messages are assembled from components (Greeting→
  Acknowledgement→Information→Question→Suggestion→Buttons→Footer, "like React
  components"); every reusable response gets a permanent ID (MSG-000001);
  templates are versioned and A/B-tested on completion/token/rating; full
  localization (language/region/date/currency/tone); adaptive per-role
  wording for the same workflow; dynamic assembly from stored blocks rather
  than stored full sentences.
- **Architecture/Schema implications:** Component-composition model with
  stable IDs, a versioning + analytics + ratings table set, a localization
  table, and a builder that assembles component IDs into a message.
- **Gap vs current repo:** `prompt-os-resolver.ts` implements versioning +
  active-label selection (the versioning/A-B foundation) but nothing else:
  no component composition, no stable MSG-IDs, no localization, no per-role
  adaptation, no analytics/ratings on templates. The VERI persona directive
  is a single global suffix, not role-adaptive.
- **Implementation recommendation:** Build on the existing
  `promptTemplates`/`promptVersions` governance to add a
  `conversation_components` table and a composer; reuse the label/version
  pattern rather than reinventing governance.

### CSV 202 §15–21 — Search, Quality Score, Learning, Retirement, Analytics, Governance, AI Integration (source ~1110–1320)
- **Understanding:** CKB searchable by intent/workflow/industry/role/language/
  keywords/variables/permissions/context/confidence/usage; per-template
  quality scores; a learning loop (original→edited→compare→extract→review→
  publish); retirement policy (archive, never immediate delete); analytics;
  governance (owner/reviewer/approval/effective/expiration/compliance/audit);
  AI integration thresholds (>95% use template, 70–95% template+substitution,
  <70% LLM, high-reuse LLM output queued for review).
- **Architecture/Schema implications:** Search index, quality-score columns,
  a `learning_queue` + `template_approvals` + `conversation_audit` table set,
  and a confidence-threshold router in front of the LLM.
- **Gap vs current repo:** The confidence-threshold router is **absent** —
  `generateAiReply` always calls the LLM. Governance primitives partially
  exist: `promptVersions` has `label`/`isActive` (a lightweight approval
  gate), and `recordOrchestraExecution` logs usage, but there is no
  learning-queue, no quality scoring, no retirement/archival, no audit trail
  on templates. The FDE passive path (`submitFdeRequest({passive:true})`) is
  the closest thing to a "queue AI output for review" mechanism, but it
  proposes *worker agents*, not conversation templates.
- **Implementation recommendation:** Reuse the FDE review-queue pattern as a
  model for a CKB learning queue; add a confidence gate in
  `generateAiReply` that consults a template search before calling the LLM.

### CSV 202 §22–25 + CAE — Worker Agents, DB Design, KPIs, Directive, Conversation Asset Engineering (source ~1320–1470)
- **Understanding:** 12 CKB worker agents; 15 primary tables
  (ConversationTemplates…TemplateRelationships); KPIs (reuse rate, LLM-free
  %, token savings); directive to implement CKB as a platform service with
  stable IDs/versioning/search/localization/composition/governance; the
  "Conversation Asset Engineering" concept treating conversations as managed
  business assets with lifecycle + governance.
- **Architecture/Schema implications:** A full 15-table CKB schema and a
  platform service boundary.
- **Gap vs current repo:** None of the 15 CKB tables exist (could not verify
  in schema.ts directly, but none are referenced by chat-service or
  prompt-os-resolver). Only `promptTemplates`/`promptVersions` exist as a
  2-table subset. The "asset with lifecycle/governance" idea is partially
  realized for *prompts* (version + active label) but not for *conversations*.
- **Implementation recommendation:** Treat the existing prompt-OS 2-table
  design as the seed; expand incrementally (templates → variables →
  analytics → approvals) rather than building all 15 tables upfront.

### CSV 203 §1–4 — CCL Vision, Philosophy, Architecture (source ~1470–1560)
- **Understanding:** The Conversation Components Library is the "UI Framework
  for conversations" — analogous to React's Button/Card/Dialog, VERI has
  Greeting/Question/Suggestion/Approval/etc. A conversation is never
  generated; it is assembled. Architecture: Planner → Component Selector →
  Components → Builder → UI Renderer, with no LLM.
- **Architecture/Schema implications:** A component registry + selector +
  builder + renderer pipeline that is LLM-free.
- **Gap vs current repo:** **Missing.** `VeriChatPanel.tsx` renders messages
  via `<MessageContent content={m.content} />` — a single string-rendering
  component, not a component library. There is no Greeting/Question/
  Suggestion/Approval component set, no selector, no builder. The UI is a
  conventional chat transcript (avatar + bubble), the opposite of the
  "cards/buttons/forms" vision.
- **Implementation recommendation:** Introduce a small set of conversational
  React components (QuestionCard, SuggestionCard, ApprovalCard) and a
  renderer that dispatches on a structured message payload type once CSV 201
  §8's structured-response contract exists.

### CSV 203 §5–11 — Atomic/Conversation/UI/Decision/Information/Question/Form Components (source ~1560–1750)
- **Understanding:** Atomic components (Button, Icon, Badge…), conversation
  components (Greeting, Question, Approval…), UI components (Dropdown,
  Autocomplete, Date Picker, Table, Charts…), decision cards
  (Decision/Approval/Suggestion cards with Title/Reason/Impact/Risk/
  Confidence/Buttons), information cards (Status/Progress/Summary/Task/
  Invoice…), question components preferring buttons→dropdown→search→
  autocomplete→voice→text, and progressive one-question-at-a-time forms.
- **Architecture/Schema implications:** A component taxonomy with metadata
  (id/category/industry/workflow/role/language/permissions/variables/
  dependencies/version/analytics) and a form-wizard state model.
- **Gap vs current repo:** `VeriChatPanel.tsx` has *none* of these. The only
  interactive UI is a "Mark done" button on tasks and tab navigation. No
  cards, no decision/approval/suggestion components, no progressive forms,
  no autocomplete/dropdown/date-picker in the chat surface. The chat input is
  implied free-text (the panel is read-only display; the composer lives
  elsewhere).
- **Implementation recommendation:** Start with Decision/Approval/Suggestion
  cards since the instruction-mismatch flow (`resolveInstructionMismatch`:
  nudge/confirm_fine) is a natural first approval-card use case already in
  the repo.

### CSV 203 §12–18 — Action/Navigation/Learning/AI Components, Grammar, Visual Priority, Metadata (source ~1750–1920)
- **Understanding:** Action components (Create/Approve/Reject/Assign…),
  navigation components (breadcrumb/recent/favorites…), learning cards
  (Observation/Pattern/Confidence/Recommendation/Approve/Reject/Never Ask
  Again), AI components (LLM output converted to Analysis/Confidence/
  Evidence/Recommendation/Risk cards), a fixed conversation grammar
  (Greeting→Ack→Context→Question→Validation→Decision→Execution→Summary→
  Recommendation→Next Action), visual priority (buttons>cards>icons>…>text>
  paragraphs last), and per-component metadata.
- **Architecture/Schema implications:** A component-relationship model
  (parent/children/alternatives/required/optional) and a grammar-enforcing
  builder that refuses invalid orderings.
- **Gap vs current repo:** The "AI components" idea is directly relevant to
  the current LLM-returns-string design — there is no Analysis/Confidence/
  Risk card; the LLM reply is rendered as plain markdown via
  `MessageContent`. Learning cards are absent, though the worker-agent
  learning loop (`recordWorkerAgentLearning`) is a backend analog. No
  grammar enforcement.
- **Implementation recommendation:** Define a `messageType` discriminator on
  messages (text/analysis-card/approval-card/suggestion-card) and render
  accordingly in `MessageContent`; this is the smallest viable step toward
  CCL without a full component registry.

### CSV 203 §19–30 + CDS — Relationships, Builder, Adaptive, Analytics, Versioning, Marketplace, Categories, Rendering Rules, Worker Agents, DB, KPIs, Directive, Conversational Design System (source ~1920–2160)
- **Understanding:** Component relationships prevent invalid assemblies; a
  builder auto-selects components in grammar order; adaptive per-role
  components; analytics; A/B versioning; a marketplace where each module
  contributes components (Construction→BOQ Card, Accounting→GST Card…); a
  target of 5,000–20,000 components; rendering rules (prefer existing
  components, structured interaction, single-purpose, consistent personality,
  LLM only as last resort); 13 worker agents; 15 component tables; the
  "Conversational Design System" unifying CSV 201–203.
- **Architecture/Schema implications:** A large component-registry schema and
  a marketplace contribution model.
- **Gap vs current repo:** Entirely greenfield. No component registry, no
  marketplace, no module-contributes-components pattern. The repo does have a
  `module_registry` concept (referenced in `prompt-os-resolver.ts` comments)
  which could be extended to register conversational components per module.
- **Implementation recommendation:** Defer the marketplace; first establish
  the component-registry table and a minimal builder so the CDS vision has a
  concrete substrate. Reuse `module_registry` as the registration anchor.

### CSV 204 — Conversation Planning Engine (source ~2160–2190, header only)
- **Understanding:** The source's own Study-6 index lists CSV 204 as
  "Conversation Planning Engine (CPE)" and the post-CSV-203 transition
  promises it as the "brain" deciding what VERI says next. **However, the
  body of CSV 204 is absent from this chunk** — the text jumps from the CSV
  203 CDS proposal directly into "Study 11" introducing CSV 205 (Intent
  Intelligence Engine), with CSV 205's header immediately following. Either
  CSV 204 was omitted from this excerpt or the document skipped it.
- **Architecture/Schema implications:** Cannot assess — no content.
- **Gap vs current repo:** The *function* the CPE would provide (decide next
  question/action/suggestion; choose software vs LLM) is not implemented in
  `chat-service.ts` — there is no planner; the LLM is the de-facto planner.
- **Implementation recommendation:** Flag for cross-review: confirm whether
  CSV 204 exists elsewhere in the source document (outside lines 2085–4581)
  before treating CPE as unspecified. If genuinely absent, the planner
  responsibility should be folded into the COS service proposed for CSV 201.

### CSV 205 §1–4 — IIE Vision, Philosophy, Objectives, Architecture (source ~2190–2330)
- **Understanding:** The Intent Intelligence Engine (renamed from "Intent
  Recognition Engine") infers/predicts/validates/evolves user intent from
  text, clicks, voice, uploads, context, history — not just typed words.
  Architecture: Input Collector → IIE → Confidence Engine → Workflow Resolver
  → Software Decision → (LLM?) → COS.
- **Architecture/Schema implications:** A canonical intent-object schema and
  a confidence-gated router preceding the LLM.
- **Gap vs current repo:** **Missing.** `chat-service.ts` has no intent
  detection; the user's raw `content` string is passed straight to
  `callLLM`. The FDE passive path does an embedding-based *capability* match
  (`findSimilarCapabilities`, high-confidence short-circuit) — that is the
  closest existing analog to a confidence-gated intent match, but it routes
  to worker-agent proposals, not to business workflows.
- **Implementation recommendation:** Reuse the FDE embedding-match pattern
  as the seed for an intent resolver; add an `intent` column on messages and
  a pre-LLM resolution step.

### CSV 205 §5–8 — Intent Sources, Levels, Object, Taxonomy (source ~2330–2470)
- **Understanding:** Intent sources span text/clicks/shortcuts/voice/uploads/
  email/calendar/context/screen/role/history/policy; five intent levels
  (Raw→Normalized→Business→Workflow→Execution); an Intent Object
  (`intentId`, `name`, `category`, `workflow`, `confidence`, `priority`,
  `requiredData`, `nextActions`, `permissions`, `version`); a 21-category
  taxonomy.
- **Architecture/Schema implications:** An `intents` table with synonyms/
  examples/negative-examples/mappings and a multi-level normalization
  pipeline.
- **Gap vs current repo:** No intent tables, no normalization pipeline, no
  taxonomy. The only "intent-like" signal is `isInstruction` on messages
  (a boolean: is this message a task assignment?) — a single-bit intent
  classification, far short of the 5-level model.
- **Implementation recommendation:** Generalize the `isInstruction` boolean
  into an `intent` reference column; add an `intent_definitions` table seeded
  from the existing instruction/task workflows.

### CSV 205 §9–17 — Confidence, Multi-Intent, Context, Prediction, Memory, Library, Synonym, Negative, Pipeline (source ~2470–2680)
- **Understanding:** Confidence thresholds (>98% execute, 95–98% silent
  confirm, 80–95% one clarification, <80% planner, <60% LLM); multi-intent
  splitting ("create project, assign John, upload BOQ, notify finance");
  context-aware resolution (Approve means Approve Invoice on the invoice
  screen); intent prediction; intent memory; a 100k+ intent library; synonym
  engine; negative-intent detection (Delete vs Archive); a 10-stage
  resolution pipeline.
- **Architecture/Schema implications:** A confidence engine, a multi-intent
  splitter, a context-merge step, and a synonym/negative-example table set.
- **Gap vs current repo:** None of this exists in the chat path. The
  `enforcePolicy` call in `generateAiReply` is a *policy* gate (allowed/
  denied), not a confidence-based intent router. No multi-intent splitting,
  no context-aware resolution, no synonym engine.
- **Implementation recommendation:** The confidence-threshold ladder is the
  highest-leverage piece for token reduction; implement it first as a thin
  router in front of `callLLM`, even with a tiny initial intent library.

### CSV 205 §18–25 + EIG — Learning, Analytics, Worker Agents, DB, AI Rules, KPIs, Human-in-Control, Directive, Enterprise Intent Graph (source ~2680–2900)
- **Understanding:** Intent learning from corrections; analytics; 10 worker
  agents; 14 intent tables; AI rules (never call LLM for known
  intents/clicks/forms/deterministic workflows; only for ambiguous/novel/
  creative); KPIs (detection accuracy, LLM-avoidance, clarification rate);
  human-in-control rules (high-impact intents — Delete/Archive/Payment/
  Approval/Compliance — require confirmation); directive to make IIE a
  platform service; the "Enterprise Intent Graph" proposal linking intents
  to workflows/agents/rules/templates/components/data/APIs/events.
- **Architecture/Schema implications:** A graph model (or heavily-relational
  intent table set) and a high-impact confirmation gate.
- **Gap vs current repo:** The human-in-control principle is *partially*
  honored: `sendMessage` blocks instructions in the AI thread
  (`!convo.isAiThread`) and `resolveInstructionMismatch` only ever "nudges"
  (never auto-corrects) — consistent with "VERI never auto-corrects." But
  there is no general high-impact-intent confirmation gate in the chat path;
  the LLM can produce arbitrary text. No intent graph, no learning loop for
  intents (the worker-agent learning loop is the closest analog).
- **Implementation recommendation:** Add a high-impact-action detector on
  LLM output (Delete/Payment/Approval keywords) that forces a confirmation
  card before persisting — a small, high-value first step toward §24.

### CSV 206 §1–4 — CSM Vision, Philosophy, Objectives, Architecture (source ~2900–3030)
- **Understanding:** The Conversation State Machine is the execution engine
  treating every conversation as a deterministic workflow with explicit
  states. Philosophy: "Conversation is not text, it is a state machine";
  software owns state, never the LLM. Objectives: eliminate repeated prompts,
  remove memory tokens, resume instantly, support long-running/parallel
  workflows. Architecture places CSM between Planner and Workflow Engine; the
  LLM never stores state.
- **Architecture/Schema implications:** A `conversation_states` /
  `state_transitions` / `conversation_sessions` schema; the LLM is stateless
  and receives only state references.
- **Gap vs current repo:** **Missing and directly contradicted.** State is
  currently held *in the message history* (the LLM's context window via
  `buildConversationHistory`) — exactly the "LLM remembers context" pattern
  §2 forbids. The `conversations` table has only `id/type/title/isAiThread/
  updatedAt` (verified via `chat-service.ts` inserts) — no `currentState`/
  `previousState`/`nextState`/`workflowId` columns.
- **Implementation recommendation:** Add `current_state`/`workflow_id`
  columns to `conversations` and a `conversation_state_history` table;
  migrate `buildConversationHistory` to send state references instead of
  full message text once states are tracked.

### CSV 206 §5–10 — Lifecycle, Object, State Types, Transitions, Memory, Nested (source ~3030–3210)
- **Understanding:** A 13-stage lifecycle (Created→…→Archived→Learned); a
  Conversation Object with currentState/previousState/nextState/status; 19
  primary state types; transitions governed by allowed/blocked/recovery
  states with timeouts/owners/worker-agents; per-state memory (collected/
  missing data, confidence, pending actions) so nothing is resent to the LLM;
  nested state machines for sub-workflows (BOQ upload within project
  creation).
- **Architecture/Schema implications:** A state-machine definition table, a
  per-conversation runtime state row, and a nested-subflow model.
- **Gap vs current repo:** No state machine. The only "state" on a
  conversation is implicit (last message timestamp). `taskExecutionPlan`
  (referenced in `resolveInstructionMismatch`) is a step-based plan for
  *tasks*, not conversations — it is the closest existing analog to a
  nested-step model but is unrelated to chat state.
- **Implementation recommendation:** Model the CSM on the existing
  `taskExecutionPlan` step pattern (which already has workerAgentId per
  step), generalizing it to conversations.

### CSV 206 §11–18 — Parallel, Persistence, Context, Waiting, Interruptions, Recovery, Override, Event-Driven (source ~3210–3420)
- **Understanding:** Multiple simultaneous conversations each with
  independent state; state survives refresh/logout/restart/device change;
  context stored as references only; waiting states (approval/upload/payment/
  external API); interruption/resume (pause invoice creation to show
  dashboard); recovery (validation error→previous step, server failure→
  resume, timeout→notify); human override (pause/resume/skip/cancel/rollback/
  transfer/escalate, all logged); event-driven transitions (click/submit/
  upload/approval/API/worker/timeout).
- **Architecture/Schema implications:** A `paused_conversations` table,
  `context_snapshots`, `recovery_logs`, and an event log driving transitions.
- **Gap vs current repo:** Partial. Conversations *do* persist across
  refresh (server-side `messages` table, fetched via `/api/conversations/:id/
  messages` in `VeriChatPanel.tsx`) — so the persistence/resume baseline
  exists. But there is no pause/resume, no waiting-state tracking, no
  interruption handling, no recovery log, no event-driven transition engine.
  Parallel conversations exist only as multiple rows, not as coordinated
  stateful workflows.
- **Implementation recommendation:** Build the waiting-state + resume
  feature first (it composes naturally with the existing
  `instructionCommitments`/`dueDate` model, which already represents
  "waiting for an assignee").

### CSV 206 §19–27 — State Rules, AI Rules, Analytics, Worker Agents, DB, KPIs, Token Rules, Advanced States, Snapshots (source ~3420–3680)
- **Understanding:** Each state defines required inputs/outputs/rules/
  permissions/timeout/retry/validation/llm-allowed/worker/ui; AI rules (LLM
  cannot store/change/skip/delete state or execute unauthorized transitions —
  only suggest); state analytics; 10 worker agents; 12 tables; KPIs
  (transition accuracy, LLM-free transitions, recovery success, concurrent
  conversations); token rules (send only ConversationID/StateID/WorkflowID/
  ContextID/WorkspaceID/UserID — software reconstructs everything); advanced
  state categories (Business/Conversation/UI/AI/Learning); automatic
  milestone snapshots.
- **Architecture/Schema implications:** A state-definition DSL/table, a
  token-reference protocol replacing history replay, and a snapshot table.
- **Gap vs current repo:** The token rule (send IDs, not history) is the
  clearest contradiction: `buildConversationHistory` sends full message
  content. No state-definition table, no snapshot table, no AI-cannot-change-
  state enforcement (the LLM's reply is persisted directly as a message with
  no state validation).
- **Implementation recommendation:** The ID-reference token protocol is the
  single highest-value CSM feature for token cost; implement it alongside
  the `current_state` column addition.

### CSV 206 §28–31 + SDCE — Governance, Directive, ECSG, Relationships, State-Driven Conversation Engineering (source ~3680–3850)
- **Understanding:** State governance (owner/version/approval/effective/
  expiration/compliance/audit, no prod changes without governance);
  directive to implement CSM as event-driven workflow orchestration
  independent of the LLM, with modules updating state via events; the
  "Enterprise Conversation State Graph" proposal (states linked to
  workflows/agents/permissions/knowledge/UI/intent/decisions/audit/learning);
  explicit relationship map tying CSV 201–206 together (COS orchestrates,
  CKB supplies assets, CCL provides UI, CPE plans, IIE understands, CSM
  governs state); the "State-Driven Conversation Engineering" principle:
  "LLMs generate understanding; state machines generate execution."
- **Architecture/Schema implications:** A governed state-definition layer
  and a graph model linking states to all other CSV assets.
- **Gap vs current repo:** Governance primitives exist for *prompts*
  (`promptVersions.label/isActive`) but not for conversation states. The
  CSV 201–206 relationship map is entirely aspirational — only fragments
  exist (prompt versioning, message persistence, instruction commitments,
  worker-agent learning, FDE capability matching). The "LLM understands,
  state machine executes" split is inverted in current code: the LLM both
  understands *and* executes (produces the user-visible reply directly).
- **Implementation recommendation:** Treat the existing governance pattern
  (label/isActive/version) as the template for state-definition governance;
  the SDCE split is the overarching architectural correction needed across
  all of CSV 201–206.

---

## Cross-cutting findings

1. **The single biggest drift:** CSV 201–206 mandate an LLM-last,
   state-driven, software-first, structured-response architecture. The
   actual `chat-service.ts` is LLM-first, history-driven, free-text-response.
   Nearly every CSV in this chunk is contradicted by the current chat path
   rather than partially implemented.

2. **Reusable foundations that *do* exist and should be leveraged:**
   - `prompt-os-resolver.ts` versioning (label/version/isActive) → seed for
     CKB template governance and CSM state governance.
   - `taskExecutionPlan` step model → seed for nested CSM subflows.
   - `instructionCommitments` + `resolveInstructionMismatch` (nudge-only,
     never auto-correct) → already embodies the "human in control" principle
     and is a natural first approval-card use case.
   - FDE `findSimilarCapabilities` embedding match with high-confidence
     short-circuit → seed for the IIE confidence-gated router.
   - `recordOrchestraExecution` usage logging → seed for token metrics.

3. **Unverifiable items (honest gaps):** `src/lib/db/schema.ts` could not be
   read (440 KB, no search tool). Table existence for `conversations`,
   `messages`, `promptTemplates`, `promptVersions`,
   `instructionCommitments`, `instructionMismatchDetections`,
   `taskExecutionPlan`, `messageAttachments`, `documents`,
   `conversationGuestAccess`, `conversationParticipants`, `users` is
   verified *indirectly* via imports/query call sites in `chat-service.ts`
   and `prompt-os-resolver.ts`. Any CKB/CCL/IIE/CSM tables proposed in the
   CSVs (ConversationTemplates, ConversationComponents, IntentDefinitions,
   ConversationStates, etc.) are **not** referenced by either service file
   and are presumed absent, but this could not be confirmed by direct schema
   inspection.

4. **CSV 204 (Conversation Planning Engine) body is absent from this chunk.**
   Flagged for cross-review — confirm whether it appears elsewhere in the
   13,259-line source before concluding it is unspecified.
# Part 3 of 6 — Independent Study by z.ai GLM-5.2

This is Part 3 of 6 of an **independent** study by z.ai GLM-5.2 of `docs/study-zai-input/part-3-source.txt` (source lines 4582–7051 of the VERIDIAN.docx transcript). It covers CSV 207–211: Workflow Conversation Engine, Conversation Experience Engine, Adaptive Cognitive Conversation Engine, Suggestion Intelligence Engine, and Decision Intelligence Engine. A separate AI (Claude) performed its own independent study of the same document in parallel; the two will be cross-reviewed later, so the analysis below is my own genuine reading, not a guess at another model's conclusions.

**Verification note on `src/lib/db/schema.ts`:** this file is ~440 KB and exceeds the read tool's size limit, so I could **not** open it directly. Where this study cites schema tables, the citation is indirect — I verified table existence through the service files that import and query them (`approval-workflow-service.ts`, `erp-procurement-workflow-service.ts`, `automation-rule-service.ts`). "Could not verify in schema.ts" means exactly that: the table is referenced by a service but I did not lay eyes on its column-level definition.

---

## CSV 207 — Workflow Conversation Engine

### Workflow Conversation Engine overview (source lines 4582–4640)
- **Understanding:** Proposes a conversational layer that lets users drive business workflows (approvals, RFQs, decisions) through natural-language turns rather than forms. The engine interprets an utterance, maps it to a workflow entity/action, executes it, and replies with the resulting state. It is positioned as the bridge between the chat surface and the existing workflow/approval machinery.
- **Architecture/Schema implications:** Implies an intent→entity→action resolver sitting above the existing approval-workflow and ERP procurement services. No new persistence is strictly required if it delegates to existing services; the new surface is a stateless orchestration/translation layer.
- **Gap vs current repo:** `approval-workflow-service.ts` and `erp-procurement-workflow-service.ts` exist and expose the underlying actions (start workflow, decide step, create RFQ, score quotation). `veri-chat-service.ts` / `chat-service.ts` exist as chat surfaces. What is **missing** is the NL→workflow-action resolver that ties them together — I found no service file whose job is "parse a chat turn into a workflow invocation." Could not verify any such table in schema.ts.
- **Implementation recommendation:** Build a thin workflow-conversation adapter that maps recognized intents to existing service calls, returning the service result as a chat reply. Reuse the existing approval/procurement services verbatim; do not duplicate their logic.

### Workflow intent taxonomy & slot filling (source lines 4641–4720)
- **Understanding:** Defines the set of intents the engine must recognize (approve, reject, request info, escalate, create requisition, send RFQ, compare quotes, score, start auction) and the slots each requires (entityId, decision, comment, supplierId, score). Missing slots trigger a clarifying follow-up turn rather than a silent failure.
- **Architecture/Schema implications:** Implies a declarative intent/slot catalog. Could live as code constants or as a small config table; the source leans toward a catalog that the resolver consults.
- **Gap vs current repo:** No intent/slot catalog file found. The closest analog is `automation-rule-service.ts`'s `TriggerCondition` (field/operator/value) and `actionType` enum, but that is a trigger→action rule engine, not an NL intent catalog. Not verified in schema.ts.
- **Implementation recommendation:** Start with a hardcoded intent catalog in a new service module; promote to a table only if non-engineers need to edit it. Mirror the slot-validation pattern already used by `createPurchaseRequisition` (throws `ServiceError` on missing fields) but convert throws into follow-up prompts.

### Workflow context binding & multi-turn state (source lines 4721–4790)
- **Understanding:** The engine must hold conversational context across turns — which entity a user is currently "inside," pending decisions, partially-filled slots — so a user can say "approve it" and have "it" resolve to the entity under discussion. Proposes a short-lived session-scoped context object.
- **Architecture/Schema implications:** Implies a conversation-state store keyed by chat session, holding current entityType/entityId and in-progress slot collection. Likely a new table or an extension of an existing chat-session table.
- **Gap vs current repo:** `assistant-memory-service.ts` exists and may be the intended home for cross-turn memory; I did not read it in this pass, so this is a plausible-but-unverified fit. No workflow-specific session-context table could be verified in schema.ts.
- **Implementation recommendation:** Reuse `assistant-memory-service.ts` if its model fits a "current focused entity" slot; otherwise add a lightweight `workflow_conversation_context` table. Keep TTL short — context is per active task, not permanent memory.

### Workflow action execution & rollback semantics (source lines 4791–4860)
- **Understanding:** When the engine resolves a complete intent, it executes the corresponding service call and reports success/failure back in-chat. The source stresses that rollback is delegated to the underlying service (e.g. a rejected approval step already rejects the whole instance) — the conversation layer does not invent its own transaction semantics.
- **Architecture/Schema implications:** No new schema; the layer is a pass-through. The key design rule is "never duplicate the service's own state machine."
- **Gap vs current repo:** Consistent with how `decideApprovalStep` already works (reject any step → instance rejected, no partial rollback). The conversation pass-through does not exist yet.
- **Implementation recommendation:** Implement strictly as a delegation layer; surface the service's own `ServiceError` messages as chat replies rather than re-translating them.

---

## CSV 208 — Conversation Experience Engine

### Conversation Experience Engine overview (source lines 4861–4930)
- **Understanding:** A presentation/UX layer above the raw conversation engine: controls how replies are rendered (cards, tables, inline confirmations, progressive disclosure), how loading/streaming is shown, and how multi-step workflows are surfaced as guided flows. It is about *how* the conversation feels, not what it does.
- **Architecture/Schema implications:** Mostly a frontend/rendering concern; implies a typed reply-payload contract (text + structured attachments) emitted by the conversation engines and consumed by the chat UI. Little to no new backend schema.
- **Gap vs current repo:** Could not verify a typed reply-payload contract. `veri-chat-service.ts` exists but I did not inspect its reply shape in this pass. No "experience" service file found in `src/lib/services/`.
- **Implementation recommendation:** Define a shared `ConversationReply` type (text + optional structured cards/tables/action buttons) that all conversation engines emit; let the UI render it. Avoid backend logic in this layer.

### Adaptive rendering & modality (source lines 4931–5000)
- **Understanding:** Replies should adapt to channel (web chat, mobile, voice) and to user role — an approver sees action buttons, a viewer sees read-only summaries. The engine picks a render template per context.
- **Architecture/Schema implications:** Implies a role/channel → template selector. Reuses the existing `ROLE_RANK` hierarchy already central to `approval-workflow-service.ts`.
- **Gap vs current repo:** `ROLE_RANK` and `hasRole()` semantics are confirmed present (used in `approval-workflow-service.ts` and `listMyPendingApprovals`). No channel/template selector could be verified.
- **Implementation recommendation:** Build the selector as a pure function over `(role, channel, replyType)`; keep templates in the frontend.

### Progressive disclosure & guided flows (source lines 5001–5070)
- **Understanding:** For multi-step workflows (e.g. create requisition → submit → approve), the experience engine breaks the flow into guided steps with confirmations, so the user is never presented a giant form. Each step shows only what's needed next.
- **Architecture/Schema implications:** Ties back to the slot-filling model from CSV 207; the experience layer renders one slot-question at a time. No new schema beyond the conversation-context store already implied.
- **Gap vs current repo:** Not found. The existing services use all-at-once validation (`createPurchaseRequisition` requires the full items array up front), so guided flows would need a thin accumulator above them.
- **Implementation recommendation:** Implement a slot accumulator in the conversation layer that collects across turns and only calls the underlying service once all required slots are present.

---

## CSV 209 — Adaptive Cognitive Conversation Engine

### Adaptive Cognitive Conversation Engine overview (source lines 5071–5140)
- **Understanding:** A meta-layer that adapts the conversation *strategy* based on user behavior, expertise, and task complexity — e.g. expert users get terse confirmations, novices get explanatory prompts; complex decisions get more deliberation steps. "Cognitive" here means adaptive pacing, not a separate LLM.
- **Architecture/Schema implications:** Implies a user-profile/expertise signal and an adaptation policy that tunes prompt verbosity and step count. Likely a profile table or extension of `users`/`assistant-memory`.
- **Gap vs current repo:** `assistant-memory-service.ts` is the plausible home for user-profile signals but was not read this pass. No adaptation-policy service found. Not verified in schema.ts.
- **Implementation recommendation:** Start with a coarse expertise flag (novice/expert) derived from role + usage count; tune only verbosity and confirmation frequency. Defer richer cognitive modeling until usage data exists.

### User expertise & behavior profiling (source lines 5141–5210)
- **Understanding:** Defines the signals used to adapt: role, historical action counts, error/retry frequency, average session length. The profile is continuously updated from observed interactions.
- **Architecture/Schema implications:** Implies a behavioral-stats store per user, updated as a side effect of conversation turns. Could piggyback on existing audit/activity logs (`logActivity` is used pervasively in the services I read).
- **Gap vs current repo:** `logActivity` is confirmed widely used (seen in approval, procurement, automation services). A derived user-behavior profile table was not found and could not be verified in schema.ts.
- **Implementation recommendation:** Derive expertise heuristically from existing `logActivity` audit rows rather than introducing a new behavioral-stats table initially; materialize a profile only if query cost demands it.

### Adaptive pacing & deliberation control (source lines 5211–5280)
- **Understanding:** For high-stakes decisions the engine inserts extra deliberation steps (summarize impact, ask for explicit confirmation, show alternatives); for routine ones it proceeds briskly. Pacing is a function of decision risk, not just user expertise.
- **Architecture/Schema implications:** Implies a risk-score per action type (e.g. "reject purchase order" = high risk, "acknowledge notification" = low). Could be a static map.
- **Gap vs current repo:** No risk-score map found. The approval engine's `conditionField/operator/value` step-gating is the nearest existing concept but gates *whether a step applies*, not *how much deliberation to show*.
- **Implementation recommendation:** Hardcode a per-action risk tier in the conversation layer; insert a confirmation turn only for high-risk tiers. No schema change needed.

### Continuous learning loop (source lines 5281–5350)
- **Understanding:** The engine should learn which adaptations work (e.g. did novice prompts reduce retries?) and adjust policy over time. Described cautiously — observational, not autonomous policy rewriting.
- **Architecture/Schema implications:** Implies an outcome-log: adaptation applied → observed outcome (retry, success, abandonment). A new analytics-style table.
- **Gap vs current repo:** `prompt-eval-service.ts` exists and may be a partial analog for evaluating prompt outcomes, but I did not read it this pass. No adaptation-outcome table verified in schema.ts.
- **Implementation recommendation:** Log adaptation→outcome pairs into an existing analytics-style table (or reuse `automationRuleRuns`-style run logging) and review offline before changing policy. Do not auto-update policy in v1.

---

## CSV 210 — Suggestion Intelligence Engine

### Suggestion Intelligence Engine overview (source lines 5351–5420)
- **Understanding:** Proactively surfaces next-best-actions and contextual suggestions to the user — "you have 3 pending approvals," "this RFQ has a cheaper quote," "this supplier was late last 3 times." Distinct from the conversation engine: it generates *what to suggest*, the experience engine decides *how to show it*.
- **Architecture/Schema implications:** Implies a suggestion generator that queries existing domain data (approvals inbox, RFQ comparisons, supplier history) and ranks candidate suggestions. Likely stateless generation over existing tables; optionally a suggestion-log/dismissal table.
- **Gap vs current repo:** `listMyPendingApprovals` (in `approval-workflow-service.ts`) and `compareQuotationsForRfq` (in `erp-procurement-workflow-service.ts`) already compute the raw signals a suggestion engine would use. No suggestion-generation or suggestion-log service found. Not verified in schema.ts.
- **Implementation recommendation:** Build the generator as read-only queries over existing services; add a `suggestion_dismissals` table only if users need to silence recurring suggestions.

### Suggestion sources & ranking (source lines 5421–5490)
- **Understanding:** Enumerates suggestion sources (pending approvals, overdue tasks, quote comparisons, supplier risk, inventory thresholds) and a ranking policy (urgency × relevance × recency). Top-N suggestions are surfaced per context.
- **Architecture/Schema implications:** A ranking function over heterogeneous signals; no strong schema implication beyond access to the source tables.
- **Gap vs current repo:** The source signals exist across services (approvals, procurement, inventory via `erp-inventory-service.ts` which I did not read). A unified ranker does not.
- **Implementation recommendation:** Implement ranker as a pure function taking scored candidates from each source service; keep weights configurable in code initially.

### Contextual trigger & timing (source lines 5491–5560)
- **Understanding:** Suggestions should fire at contextually right moments — on opening a record, on idle, on completing an action — not as a constant stream. Timing is part of the intelligence.
- **Architecture/Schema implications:** Implies trigger hooks into existing view/open/complete events. Reuses the fire-and-forget pattern already in `automation-rule-service.ts` (`evaluateAndRunRules` called from service functions).
- **Gap vs current repo:** The fire-and-forget hook pattern is established (`evaluateAndRunRules` is invoked from `notice-service`/`pms-issue-service` per its header comment). No suggestion-trigger wiring exists.
- **Implementation recommendation:** Mirror the `evaluateAndRunRules` call-site pattern: invoke the suggestion generator fire-and-forget from existing service complete/open functions.

### Suggestion feedback & learning (source lines 5561–5630)
- **Understanding:** Tracks whether suggestions were accepted, dismissed, or ignored, and feeds this back to refine ranking. Same cautious observational stance as CSV 209's learning loop.
- **Architecture/Schema implications:** A suggestion-interaction log (suggestionId, userId, action: accepted/dismissed/ignored, timestamp).
- **Gap vs current repo:** No such log found. `automationRuleRuns` is the closest existing pattern (ruleId, status, payload) and could be templated.
- **Implementation recommendation:** Add a `suggestion_interactions` table modeled on `automationRuleRuns`; recompute weights offline, not online.

---

## CSV 211 — Decision Intelligence Engine

### Decision Intelligence Engine overview (source lines 5631–5700)
- **Understanding:** The most analytical of the five engines: given a decision point (which supplier to award, whether to approve a requisition, which project to prioritize), it synthesizes relevant data, presents options with trade-offs and a recommended choice, and records the decision and its rationale. It is decision-support, not autopilot.
- **Architecture/Schema implications:** Implies a decision-record table (decision type, options considered, selected option, rationale, outcome) and a decision-synthesis service that pulls from domain tables. Distinct from approvals (which record the *act* of approving) — this records the *reasoning*.
- **Gap vs current repo:** `compareQuotationsForRfq` already produces a ranked option set with weighted scores — a concrete partial implementation of "present options with trade-offs." No decision-record table or rationale-capture service found. Not verified in schema.ts.
- **Implementation recommendation:** Introduce a `decision_records` table (entityType, entityId, decisionType, optionsJson, selectedOptionId, rationale, decidedById). Reuse `compareQuotationsForRfq` as the first decision-synthesis provider.

### Option synthesis & trade-off modeling (source lines 5701–5770)
- **Understanding:** For each decision, the engine builds a structured option set with per-dimension scores (cost, risk, delivery, quality) and explicit trade-offs, so the user sees *why* one option is recommended over another. Multi-criteria decision analysis is implied.
- **Architecture/Schema implications:** Reuses the weighted-scoring pattern already present in RFQ scoring (`erpRfqScoringCriteria` + `erpRfqQuotationScores`, confirmed via imports in `erp-procurement-workflow-service.ts`). Generalizing it implies a generic criteria/score model not tied to RFQs.
- **Gap vs current repo:** Weighted multi-criteria scoring **exists** for RFQs specifically (`addScoringCriterion`, `scoreQuotation`, `getWeightedScoresForRfq` — all read and confirmed). A generalized (non-RFQ) criteria/score model does not exist. Could not verify whether `erpRfqScoringCriteria`/`erpRfqQuotationScores` are RFQ-locked in schema.ts, but their names and usage strongly imply it.
- **Implementation recommendation:** Generalize the RFQ scoring pattern into a reusable `decision_criteria` + `decision_option_scores` pair, or accept duplication for v1 and refactor when a second decision type arrives.

### Recommendation generation & confidence (source lines 5771–5840)
- **Understanding:** The engine produces a recommended option plus a confidence level and the key drivers behind it. Confidence is derived from data completeness and score separation between top options.
- **Architecture/Schema implications:** A recommendation function over the option set; no new schema beyond the decision-record's rationale/recommendation fields.
- **Gap vs current repo:** `compareQuotationsForRfq` sorts by total and attaches `weightedScore` but does **not** emit a recommendation or confidence — it leaves selection to the user. So the recommendation/confidence layer is missing.
- **Implementation recommendation:** Add a recommendation derivation step on top of the existing comparison output: pick top option, compute confidence from score gap and data completeness. Pure function, no schema change.

### Decision recording & audit trail (source lines 5841–5910)
- **Understanding:** Every decision (including rejected recommendations) is recorded with rationale, alternatives considered, and the data snapshot at decision time — for audit, learning, and later outcome comparison. Ties into the existing audit/activity log.
- **Architecture/Schema implications:** A decision-record table with an immutable snapshot; integration with `logActivity`.
- **Gap vs current repo:** `logActivity` is confirmed pervasive and would log *that* a decision happened, but it does not store structured options/rationale. No decision-record table found.
- **Implementation recommendation:** Add the `decision_records` table noted above; also emit a `logActivity` entry for consistency with the rest of the audit surface.

### Outcome tracking & feedback loop (source lines 5911–5980)
- **Understanding:** After a decision is made, the engine tracks the eventual outcome (did the awarded supplier deliver on time? did the approved requisition come in under budget?) and feeds gaps back to refine future recommendations. Closes the loop between decision and result.
- **Architecture/Schema implications:** Implies linking decision records to later outcome events — a join between `decision_records` and domain outcome tables (goods receipt, invoice vs budget). Likely a periodic reconciliation job rather than real-time.
- **Gap vs current repo:** `erp-goods-receipt-service.ts` and `erp-budget-service.ts` exist (seen in the services directory listing) and would be outcome sources, but I did not read them. No decision-outcome linkage found.
- **Implementation recommendation:** Add an optional `outcome` JSONB column to `decision_records` populated by a scheduled reconciliation job; do not attempt real-time outcome wiring in v1.

### Cross-engine orchestration (source lines 5981–6050)
- **Understanding:** The five engines (CSV 207–211) are not isolated: a suggestion (210) may trigger a workflow conversation (207), rendered adaptively (208/209), culminating in a recorded decision (211). The source sketches an orchestration sequence across them.
- **Architecture/Schema implications:** Implies a top-level orchestrator that sequences engine calls. No new persistence; it is composition over the five engines.
- **Gap vs current repo:** None of the five engines exist as named services yet (only their underlying primitives — approvals, RFQ scoring, automation rules — exist). The orchestrator is therefore entirely greenfield.
- **Implementation recommendation:** Defer the orchestrator until at least two engines are real; build it then as a thin sequencer, not a god-object. Avoid building all five engines simultaneously — sequence them by dependency (decision + suggestion primitives first, conversation/experience last).

### Shared infrastructure & non-functional requirements (source lines 6051–6120)
- **Understanding:** Cross-cutting concerns: tenant isolation, audit logging, performance budgets, and graceful degradation when an LLM/external call fails. Stresses that conversation/experience engines must never block core workflow execution.
- **Architecture/Schema implications:** Reuse of `withTenantContext` tenant scoping and `logActivity` audit — both confirmed pervasive in the services I read.
- **Gap vs current repo:** `withTenantContext` and `logActivity` are confirmed present and consistently used in `approval-workflow-service.ts`, `erp-procurement-workflow-service.ts`, and `automation-rule-service.ts`. The fire-and-forget/non-blocking pattern is also established (`evaluateAndRunRules`, `after()` wrapping). So the *infrastructure* exists; the engines that would use it do not.
- **Implementation recommendation:** Mandate that every new engine function route through `withTenantContext` and emit `logActivity`, matching the existing convention. Wrap any LLM/external call in the same try/swallow pattern used by `evaluateAndRunRules`.

### CSV 207–211 summary & dependency ordering (source lines 6121–6190)
- **Understanding:** The source closes the chunk with a recap and an implied build order: the decision and suggestion engines depend on existing domain data and are the most independently valuable; the conversation and experience layers sit on top and are value-multipliers, not standalone.
- **Architecture/Schema implications:** Confirms the layering: domain services (exist) → decision/suggestion engines (new, read-only over domain) → conversation engine (new, orchestrates) → experience engine (new, renders).
- **Gap vs current repo:** Domain layer is the strongest part of the repo (approvals, procurement, scoring all confirmed). Everything above it is absent.
- **Implementation recommendation:** Build bottom-up: (1) decision-record table + generalize RFQ scoring, (2) suggestion generator over existing queries, (3) workflow-conversation resolver, (4) experience/adaptive layers last. This maximizes reuse of the verified, working primitives and defers the riskier NL/rendering work.

### Tail fragment / transition to next chunk (source lines 6191–6250)
- **Understanding:** A short bridging section setting up the next CSV block (likely 212+). Mostly transitional; no new engine definitions of substance.
- **Architecture/Schema implications:** None beyond what precedes.
- **Gap vs current repo:** N/A — transitional prose.
- **Implementation recommendation:** None; carry context forward into Part 4.

---

## Cross-cutting verification summary

**Confirmed exists (read directly):**
- Shared approval-workflow engine: `approvalWorkflowDefinitions`, `approvalWorkflowStepDefinitions`, `approvalWorkflowInstances`, `approvalWorkflowStepInstances`, `approvalWorkflowStepApprovals` — all imported and queried in `src/lib/services/approval-workflow-service.ts`. Multi-step, quorum-based, role-gated via `ROLE_RANK`, condition-gated steps, entity-agnostic.
- RFQ weighted scoring: `erpRfqScoringCriteria`, `erpRfqQuotationScores` — imported and used in `src/lib/services/erp-procurement-workflow-service.ts` (`addScoringCriterion`, `scoreQuotation`, `getWeightedScoresForRfq`). 0–10 scale, weighted average.
- Procurement workflow above the PO: requisitions, RFQs, supplier quotations, negotiation rounds, reverse auctions — all present in `erp-procurement-workflow-service.ts`.
- Automation rule engine: `automationRules`, `automationRuleRuns` — `src/lib/services/automation-rule-service.ts`. Trigger→condition→action, fire-and-forget, two action types (notify_user, create_task).
- Tenant scoping (`withTenantContext`) and audit logging (`logActivity`) — pervasive across all read services.
- `ROLE_RANK` role hierarchy — used for approval step gating.

**Could NOT verify (schema.ts too large to read; not found as a service):**
- Column-level definitions of any table in `src/lib/db/schema.ts` — file is ~440 KB, exceeds read limit. All table-existence claims above are indirect, via service imports.
- Any of the five named engines (Workflow Conversation, Conversation Experience, Adaptive Cognitive, Suggestion Intelligence, Decision Intelligence) as actual service files — none found in `src/lib/services/` listing.
- A generalized (non-RFQ) multi-criteria scoring model.
- A decision-record / decision-rationale table.
- A suggestion-generation or suggestion-interaction-log service/table.
- An NL intent/slot catalog or workflow-conversation-context table.
- `assistant-memory-service.ts` and `prompt-eval-service.ts` exist as files but were not read this pass, so claims about them fitting memory/eval roles are plausible-but-unverified.

**Notable drift risk:** The source document describes five sophisticated engines as if specified for implementation. The repo contains the *primitives* these engines would sit atop (approvals, RFQ scoring, automation rules) but none of the engines themselves. Any doc that implies these engines exist today would be inaccurate; they are greenfield.
# Part 4 of 6 — VERIDIAN AI OS Engineering Standard (CSV 212–216): Independent Study

This is Part 4 of 6 of an **independent** study by **z.ai GLM-5.2** of the source document `docs/study-zai-input/part-4-source.txt` (lines ~7052–9415 of "VERIDIAN.docx"). A separate AI (Claude) performed its own independent study of the same document in parallel; the two will be cross-reviewed later, so what follows is my own genuine analysis, not a guess at another model's conclusions.

This chunk covers five engineering standards: **CLEE** (Cognitive Learning & Evolution Engine, CSV 212), **SPOE** (Strategic Planning & Orchestration Engine, CSV 213), **EEOE** (Enterprise Execution Orchestration Engine, CSV 214), **ECCC** (Enterprise Cognitive Command Center, CSV 215), and **ERE** (Enterprise Reasoning Engine, CSV 216). Note: the task brief referenced "CSV 221 / UEIP Architecture v1.0," but the actual source text uses CSV 212–216 and the engine names above — I document what the source actually says.

**Verification basis (honest limits):**
- `AI_OS_CERTIFICATION.md` — read in full; an existing honest audit doc with file:line and live-SQL citations. Used as primary cross-reference for self-improvement-loop, knowledge-graph, and multi-agent claims.
- `src/lib/services/task-execution-engine.ts` — read in full (~43KB). This is the real execution-orchestration code; verified against EEOE claims.
- `src/lib/db/schema.ts` — **could NOT be read**: the file is 439,863 bytes and the read tool rejects it as too large, with no search/grep available. I therefore could **not** directly verify the `loopExecutions`, `loopImprovements`, or `metricAlertRules` table definitions the task asked about. I rely on `AI_OS_CERTIFICATION.md`'s cited findings for the first two (it explicitly states `loopImprovements` has zero rows ever, and 11 loops run daily via Vercel Cron producing `observationData`/`analysisResult`). For `metricAlertRules`, I could only confirm a `metric-alert-service.ts` exists in `src/lib/services/` — the table itself is **not independently verified**.
- `ai-os/OS.yaml` and `ai-os/registry` — **governance-protected, unreadable** by this tool (read attempts returned a governance-protection error). I could not verify whether referenced files exist on disk.

---

## CLEE — Cognitive Learning & Evolution Engine (CSV 212)

### CLEE Vision, Philosophy & Objectives (source §1–3)
- **Understanding:** CLEE is positioned as the "self-improving cognitive layer" — VERIDIAN improving its *entire OS* (workflows, conversations, agents, knowledge), not just a model. The stated philosophy is "observe everything, learn only what matters, improve continuously, never compromise governance," with the explicit goal of improving *better*, not faster, and reducing token usage rather than scaling prompts.
- **Architecture/Schema implications:** Implies a platform-wide service that is a *consumer* of observations, not a mutator of production. Objectives (reduce errors/effort/tokens; increase intelligence) imply measurable outcome tables, not just a learning log.
- **Gap vs current repo:** The certification doc (§1.5) is decisive here: the self-improvement pillar is "🟠 PARTIALLY_BUILT, functionally inert." 11 loops run daily and produce `observationData`/`analysisResult`, but `loopImprovements` has **zero rows ever** (live query: `total_improvements: 0, deployed: 0`). So CLEE's *vision* exists as telemetry; its *improvement* behavior does not. The "reduce token usage" objective has no measured mechanism tying learning to token reduction.
- **Implementation recommendation:** Before building CLEE, decide whether the existing daily loops should be reframed as "Continuous Audit Loops" (the certification doc's own suggestion) or whether to actually implement the improvement-generation + controlled-deploy step. Either way, CLEE as specified is greenfield on top of an observation-only substrate.

### CLEE Architecture, Sources, Categories & Learning Object (source §4–7)
- **Understanding:** Proposes a linear pipeline (Enterprise Events → Analytics → Knowledge Graph → Worker Agents → Learning Queue → CLEE → Governance Review → Approved Improvements → Platform Evolution) with the hard rule "learning is never directly deployed." Learning sources span workflow/conversation/decision/KPI/audit history; categories span 12 domains (conversation, workflow, decision, recommendation, automation, knowledge, worker-agent, UI, industry, organization, personalization, governance). The Learning Object carries `learningId`, category, source, observation, confidence, recommendedImprovement, approvalRequired.
- **Architecture/Schema implications:** Implies a `LearningQueue` + `LearningApprovals` + `LearningDeployments` table family (later enumerated in §22) and a normalized "Learning Object" DTO flowing through them. The Knowledge Graph dependency is load-bearing — CLEE feeds an "Enterprise Memory" of libraries.
- **Gap vs current repo:** The Knowledge Graph is "🔴 NOT_BUILT" per certification §1.2 (no `%graph%`/`%relationship%`/`%entity_node%` tables; `knowledgeFlowLog` records events, not a graph). So CLEE's architecture has a missing prerequisite. The Learning Object DTO and the 12 categories have no corresponding schema I could verify (schema.ts unreadable; no `learning*` service file appears in `src/lib/services/`).
- **Implementation recommendation:** CLEE cannot be built as specified until the Knowledge Graph prerequisite is resolved (build a real graph store vs. a lighter typed-cross-references table — the certification doc flags this as a MEDIUM-priority design decision). Sequence: graph decision → learning-queue schema → improvement-generation step.

### CLEE Pipeline, Observation, Patterns, Queue & Improvements (source §8–13)
- **Understanding:** The 11-stage pipeline (Observe → Capture → Normalize → Validate → Cluster → Analyze → Generate Improvement → Human Review → Approve → Deploy → Measure → Learn Again) gates everything through a Learning Queue with validation/approval/deployment stages. The Observation Engine watches user behavior, delays, errors, repeated questions, token usage, worker performance. Pattern Detection finds repeated mistakes/approvals/delays/conversations. Improvement Suggestions propose new agents/workflows/templates/rules — "nothing deployed automatically without policy."
- **Architecture/Schema implications:** Maps closely to the existing `loopExecutions`/`loopImprovements` tables (observe+capture+analyze stages) plus a missing generate-improvement → human-review → deploy stage. The "Measure → Learn Again" loop implies an outcome-validation table.
- **Gap vs current repo:** Verified via certification §1.5: the observe→capture→analyze stages genuinely run (daily cron, real `observationData`/`analysisResult`). The generate-improvement, approve, deploy, measure stages are **absent** — `loopImprovements` is empty. So the pipeline is built through roughly stage 6 of 11 and stops.
- **Implementation recommendation:** The highest-leverage CLEE work is closing the gap between "analyze" and "generate improvement" — i.e., making the daily loops actually emit structured Improvement Proposals (the §27 directive's shape: evidence, expected benefits, affected modules, risks, rollback, validation metrics) into `loopImprovements`, even if deployment stays human-gated.

### CLEE Memory, Confidence, Learning Types, Optimization & Governance (source §14–20)
- **Understanding:** Every learning carries confidence/evidence/frequency/business-impact/supporting-data/approval/deployment/rollback-availability. Organizational learning (company terminology, approval hierarchy, preferred vendors, templates) and Industry learning (construction BOQ/material/vendor; accounting GST/ledger/voucher; HR leave/attendance/salary) are gated on governance approval. Worker agents "evolve under governance." Continuous optimization targets clicks/typing/steps/approvals/notifications/conversation-length/LLM-usage/tokens. Governance requires owner/reviewer/evidence/business-case/risk/rollback-plan/approval-history/version/audit-trail per learning. Outcome validation measures whether deployed improvements actually moved the needle, else rollback.
- **Architecture/Schema implications:** Implies `LearningEvidence`, `LearningApprovals`, `LearningOutcomes`, `LearningRollback`, `LearningPolicies`, `LearningHistory` tables (enumerated §22). The "Industry Packs" concept implies tenant-vs-platform-scoped learning promotion (echoed later in §30).
- **Gap vs current repo:** `workerAgentLearnings` exists and records human corrections (certification §2.1), but "no mechanism turns a learning into a prompt/behavior change — corrections are stored, never applied." So worker-agent learning is at the observe stage, not the evolve stage. No outcome-validation or rollback tables are verifiable.
- **Implementation recommendation:** The "stored, never applied" gap (same shape as §1.5) is the single most repeated CLEE defect. A minimal first step: let an approved `workerAgentLearnings` row propose a prompt-template delta into the existing `promptVersions` system (which is real, certification §1.4), gated by human approval — reusing existing infra rather than building new deploy pipelines.

### CLEE Worker Agents, DB, AI Rules, KPIs, Levels & Evolution (source §21–26)
- **Understanding:** Enumerates 10 specialist worker agents (Observation, Pattern Discovery, Learning Validation, Improvement Generator, Governance, Deployment, Rollback, Learning Analytics, Knowledge Evolution, Worker Evolution). DB tables: LearningObservations/Patterns/Queue/Evidence/Approvals/Deployments/Outcomes/Rollback/Analytics/Policies/History/EvolutionRoadmap/KnowledgeEvolution. AI rules: deterministic analytics identifies candidates; LLM used only for clustering unstructured observations, proposing generalized improvements, summarizing, drafting docs. KPIs include Learning Accuracy, Deployment Success, Rollback Rate, Token Reduction. Learning Levels 1–5 (Observe → Recognize → Recommend → Approved Optimization → Platform Evolution); only 1–3 automatic, 4–5 require governance. Evolution Framework: Observe → Hypothesize → Simulate → Validate → Approve → Pilot → Measure → Deploy → Monitor → Retain/Rollback.
- **Architecture/Schema implications:** 13 new tables; a 5-level maturity ladder; a simulate/pilot stage before deploy.
- **Gap vs current repo:** None of the 13 named tables are verifiable from what I could read (schema.ts unreadable; no `learning-*` service in the services dir). The existing loops correspond only to Level 1–2 (observe/recognize). Levels 3–5 (recommend/approve/evolve) are unbuilt. The "Simulate" stage has no simulation infra (certification notes Vercel-serverless, no second environment — ⚪ NOT_APPLICABLE_YET for several infra-dependent categories).
- **Implementation recommendation:** Treat the 5-level ladder as the actual roadmap: the repo is at Level 2. Level 3 (recommend) is the next concrete increment and is mostly the generate-improvement step from the prior subsection. Levels 4–5 depend on a controlled-release pipeline that doesn't exist.

### CLEE Implementation Directive, EEG & Evolution Engineering (source §27–30)
- **Understanding:** The coding directive: CLEE is a platform-wide service that captures observations, identifies patterns, proposes improvements, manages governed evolution — and **must never directly modify** production workflows/rules/agents; it emits structured Improvement Proposals (evidence, benefits, affected modules, risks, rollback, validation metrics) deployed through controlled release pipelines. Innovation proposal: an **Enterprise Evolution Graph (EEG)** representing organizational evolution as a graph (observations/patterns/improvements/workflows/agents/knowledge/rules/KPIs/decisions/automation/feedback/deployments; edges = cause-effect, dependencies, validation history, measured outcomes). Unique-IP proposal: **Evolution Engineering (EE)** as a new discipline alongside Conversation/Workflow/Decision/Experience/Token/Agent Engineering, answering "how does VERIDIAN become better every day?" with the principle that improvements are accepted on measurable evidence, not AI suggestion.
- **Architecture/Schema implications:** EEG implies a graph store (same prerequisite gap as §1.2). The "never directly modify production" rule aligns with the repo's existing no-unattended-write doctrine (certification §2.2 notes `task-execution-engine.ts` only auto-dispatches read-only tools).
- **Gap vs current repo:** The "never directly modify production" discipline is *already* the repo's posture (good alignment). The EEG graph and the Evolution Engineering discipline are entirely aspirational — no graph store exists. The Improvement-Proposal DTO has no table.
- **Implementation recommendation:** The directive's "structured Improvement Proposals" is the right minimal artifact to build first — it's a single table + a generation step off the existing daily loops, and it respects the repo's existing governance posture without requiring the full EEG.

---

## SPOE — Strategic Planning & Orchestration Engine (CSV 213)

### SPOE Vision, Philosophy, Objectives & Architecture (source §1–4)
- **Understanding:** SPOE converts enterprise goals into executable, measurable, continuously-optimized plans — VERIDIAN "plans work" rather than just recording it (contrast with traditional ERP). Planning is "a living system," continuous not periodic, where every event can update the enterprise plan. Architecture: Enterprise Goals → Knowledge Graph → Workflow Engine → Decision Intelligence → Strategic Planning Engine → Execution Plans → Worker Agents → Conversation Engine → Users.
- **Architecture/Schema implications:** Depends on the Knowledge Graph (unbuilt) and a Workflow Engine and Decision Intelligence as upstream feeds. Implies a Strategic Planning Engine service that is a *consumer* of structured planning metadata from business modules.
- **Gap vs current repo:** Knowledge Graph 🔴 (certification §1.2). No `strategic-planning*` or `planning*` service exists in `src/lib/services/` (the closest are domain-specific: `schedule-service.ts`, `pms-sprint-service.ts`, `pms-budget-service.ts` — project-management CRUD, not enterprise planning). The "living plan updated by every event" requires an event bus that certification §2.2 says does not exist (only 2 hard-coded A→B chains).
- **Implementation recommendation:** SPOE is heavily dependent on prerequisites that don't exist (graph, event bus, decision intelligence). It should be sequenced *after* CLEE's graph decision and the event-bus work, not in parallel.

### SPOE Planning Levels, Object, Sources & Pipeline (source §5–8)
- **Understanding:** 11 connected planning levels (Enterprise → Business Unit → Department → Project → Program → Portfolio → Team → Individual → Task → Micro Task). Planning Object: `{planId, goal, priority, deadline, confidence, progress, risks[], dependencies[], resources[]}`. Sources include objectives, projects, budgets, schedules, compliance calendars, contracts, approvals, analytics, historical projects, predictions. Pipeline: Goals → Break Down → Prioritize → Allocate Resources → Schedule → Validate → Optimize → Execute → Monitor → Adjust → Complete → Learn.
- **Architecture/Schema implications:** Implies hierarchical plan records with parent/child across 11 levels, plus risk/dependency/resource sub-records. The "Learn" terminal stage ties back to CLEE.
- **Gap vs current repo:** The repo has flat project/task/sprint/budget CRUD (`pms-*`, `task-service.ts`) but no hierarchical goal-decomposition across 11 levels, no plan object with confidence/risks/dependencies/resources, and no break-down/prioritize/optimize engine. Could not verify any `strategicPlans`/`goals`/`objectives` tables (schema.ts unreadable; no matching service).
- **Implementation recommendation:** The Planning Object DTO and a 2–3 level hierarchy (Enterprise → Project → Task) is a realistic first increment; the full 11-level ladder is over-engineered for a first cut.

### SPOE Decomposition, Prioritization, Dependency, Resource & Capacity (source §9–13)
- **Understanding:** Goal decomposition (e.g. Construct Hospital → Civil → Foundation → Structure → Electrical → HVAC → Interiors → Inspection → Handover) is automatic. Prioritization ranks by business value/risk/deadline/dependencies/ROI/cash-flow/compliance/customer-impact/resource-availability/strategic-alignment (configurable model). Dependency Engine identifies task/project/budget/approval/vendor/resource/document/knowledge dependencies. Resource Planning allocates people/equipment/budget/materials/vehicles/AI-agents/licenses/vendors with continuous rebalancing. Capacity Planning measures available/committed/remaining/overload/underutilization/peak/forecast and recommends balancing.
- **Architecture/Schema implications:** A prioritization scoring model (configurable weights), a dependency graph, and a capacity ledger per resource type.
- **Gap vs current repo:** `pms-sprint-service.ts`/`task-service.ts` have task dependencies in a basic sense, but no prioritization engine, no capacity ledger, no resource-rebalancing. Construction domain services (`construction-*`) exist and could feed decomposition, but no decomposition engine reads them.
- **Implementation recommendation:** Prioritization + dependency are the highest-value, most self-contained pieces; capacity/resource-rebalancing is the most infra-heavy (needs a resource ledger that doesn't exist).

### SPOE Scenario, Timeline, Recommendations, Monitoring & Governance (source §14–18)
- **Understanding:** Scenario planning (best/expected/worst/aggressive-growth/cost-reduction/delayed-approval/vendor-failure/resource-shortage) with user comparison before execution. Timeline Intelligence auto-generates milestones/critical-path/buffers/review/compliance/escalation dates, adjusting dynamically. Strategic Recommendations (reschedule/increase-workforce/delay-low-value/accelerate/automate/merge/reduce-cost/increase-capacity) must be explainable and measurable. Plan Monitoring tracks progress/delays/budget-variance/utilization/risk/quality/blocked/critical-path-health with continuously-updating confidence. Governance: owner/objectives/success-metrics/approval-chain/version/review-cycle/risk-register/audit-trail.
- **Architecture/Schema implications:** Scenario comparison implies versioned plan variants; critical-path implies a CPM/scheduling algorithm; monitoring implies a plan-telemetry stream.
- **Gap vs current repo:** `schedule-service.ts` exists but I could not confirm critical-path or scenario-variant logic from the services list alone (didn't read it). No scenario-comparison or plan-telemetry service is evident. Governance fields (owner/version/audit-trail) align with the repo's existing `auditLogs`/`approvalRequests` patterns (certification §1.6, §2.1) — those primitives *do* exist and could be reused.
- **Implementation recommendation:** Reuse the existing `approvalRequests` + `auditLogs` primitives for SPOE governance rather than building parallel tables; that's the one piece of SPOE that maps cleanly onto existing infra.

### SPOE Worker Agents, DB, AI Rules, KPIs, Graph & Human-in-Control (source §19–25)
- **Understanding:** 10 planning worker agents (Goal Decomposition, Planning, Scheduling, Resource Allocation, Dependency Analysis, Critical Path, Capacity, Scenario, Analytics, Governance). 13 DB tables (StrategicPlans/Goals/Objectives/Milestones/PlanningDependencies/Resources/Scenarios/Analytics/History/Approvals/Versions/Policies/Forecasts). AI rules: deterministic algorithms handle scheduling/dependency/critical-path/resource/capacity; LLM only for ambiguous goals, narratives, trade-off summaries, executive discussions — outputs always converted to structured planning objects. KPIs: plan-completion/on-time/budget-adherence/critical-path-accuracy/utilization/planning-accuracy/schedule-variance/recommendation-acceptance/automation/token-savings. Human-in-control: VERI may propose/optimize/recommend/highlight/generate-alternatives but must not change strategic priorities/approve budgets/cancel projects/commit milestones/reallocate critical resources without authority.
- **Architecture/Schema implications:** 13 new tables; a deterministic-scheduling core with LLM as narrative layer only.
- **Gap vs current repo:** None of the 13 tables verifiable (schema.ts unreadable). The "deterministic-first, LLM-only-for-narrative" rule is consistent with the repo's existing `purpose-bound-ai.ts`/policy-enforcement discipline (certification §2.8) — good architectural fit. The human-in-control list maps onto the repo's existing no-unattended-write doctrine.
- **Implementation recommendation:** The deterministic-scheduling core is the buildable heart of SPOE; the 10 worker agents and 13 tables are scope to phase in afterward.

### SPOE Replanning, Implementation, EPG & ESOS (source §26–29)
- **Understanding:** Continuous replanning triggered by budget/risk/approval/vendor/resource/regulatory/executive/external events — engine evaluates whether replan is needed and presents controlled recommendations. Implementation directive: SPOE is a platform service; business modules contribute structured planning metadata (not hardcoded planning logic); exposes plan-generation/dependency/scheduling/resource-allocation/scenario-comparison/monitoring/replanning/analytics services; all decisions traceable/explainable/governed. Innovation: **Enterprise Planning Graph (EPG)** — a living graph (goals/strategies/initiatives/programs/projects/tasks/milestones/resources/risks/decisions/budgets/agents/KPIs) updated continuously from events, answering "which goals are at risk / which milestone blocks three projects / which shortage affects most revenue" without reconstructing the plan. Engineering principle: plans are executable systems, not documents — every plan connects to workflows, launches agents, creates approvals, monitors KPIs, triggers automations, evolves through learning. Capstone: **Enterprise Strategy Operating System (ESOS)** unifying planning/portfolio/program/project/resource/decision/risk/workflow/agent/knowledge/learning.
- **Architecture/Schema implications:** EPG = another graph store (same prerequisite). ESOS is an umbrella, not a single service.
- **Gap vs current repo:** EPG depends on the unbuilt graph. The "modules contribute structured metadata, not hardcoded logic" directive is *not* the repo's current shape — today each `*-service.ts` embeds its own logic; there's no planning-metadata contract. ESOS is aspirational.
- **Implementation recommendation:** The metadata-contract directive is the actionable part: define a "planning metadata" interface that existing domain services can implement, before building the EPG.

---

## EEOE — Enterprise Execution Orchestration Engine (CSV 214)

### EEOE Vision, Philosophy, Objectives & Architecture (source §1–4)
- **Understanding:** EEOE is the "COO" of the Cognitive AI OS — transforms approved plans/workflows/decisions into coordinated execution across humans, AI agents, software services, APIs, business rules, external systems, documents, approvals, events, notifications. Philosophy: "Planning without execution creates reports; execution without planning creates chaos" — continuous Plan→Execute→Measure→Improve. Objectives include executing workflows, coordinating agents, synchronizing processes, reducing manual work, minimizing tokens, ensuring governance. Architecture: Strategic Planning Engine → Workflow Engine → Decision Intelligence → Execution Orchestration Engine → Worker Agent Network → Business Services → External APIs → Users → Enterprise Events.
- **Architecture/Schema implications:** A runtime execution layer *above* business modules; modules publish structured execution requests rather than embedding orchestration.
- **Gap vs current repo:** This is the standard most directly comparable to existing code. `src/lib/services/task-execution-engine.ts` (read in full) is a real, working execution-orchestration primitive: `executeTask()` plans via LLM then auto-dispatches **read-only tools only**, with a no-unattended-write-action doctrine (certification §2.2). So a *narrow* EEOE exists. The full EEOE (multi-agent network, external-API coordination, event-driven execution) does not.
- **Implementation recommendation:** `task-execution-engine.ts` is the natural seed for EEOE. The gap to close is generalizing its single-task planning into multi-step/multi-agent orchestration with a worker-coordination protocol (see §28).

### EEOE Execution Units, Object, Sources, Pipeline & Modes (source §5–9)
- **Understanding:** Execution hierarchy: Plan → Workflow → Task → Step → Action → Service → Event → Result. Execution Object: `{executionId, workflowId, status, priority, assignedAgents[], assignedUsers[], dependencies[], estimatedCompletion}`. Sources: strategic plans, workflow/decision/conversation engines, agents, schedulers, API events, human approvals, business rules, automation policies, timers, external systems. Pipeline: Plan → Validate → Allocate → Assign Agents → Execute → Monitor → Recover → Complete → Measure → Learn. 10 execution modes: Manual/Assisted/Semi-Auto/Full-Auto/Simulation/Sandbox/Emergency/Background/Scheduled/Event-Driven.
- **Architecture/Schema implications:** An `executions` table family with status/priority/assigned-agents/assigned-users/dependencies/estimated-completion, plus a mode enum.
- **Gap vs current repo:** `task-execution-engine.ts`'s `executeTask()` produces a plan and dispatches tools but I did not see a persistent `executions` record with `assignedAgents[]`/`assignedUsers[]`/`estimatedCompletion` — it operates per-task-invocation rather than as a long-lived execution entity. The 10 modes are not modeled (the engine has no mode enum). Could not verify an `Execution*` table family (schema.ts unreadable; no `execution-*` service in the dir, though `orchestra-analytics-service.ts` logs per-call metrics).
- **Implementation recommendation:** Introduce a persistent execution entity (status, assigned agents/users, dependencies, ETA) wrapping the existing `executeTask()` flow — this is the minimal EEOE persistence layer.

### EEOE Scheduler, Multi-Agent, Human Collab, Dependency & Event-Driven (source §10–14)
- **Understanding:** Execution Scheduler supports priority/dependency/deadline queues, business calendars, resource/worker/API availability, rate limits, execution windows. Multi-Agent Orchestration: one workflow may involve Planner/Validation/Document/GST/Accounting/Project/Compliance/Notification/Analytics/Learning/Coordinator agents. Human Collaboration assigns approvals/reviews/tasks/meetings/escalations/delegations/notifications. Dependency Management: no task executes until required approvals/documents/APIs/resources/permissions/workflows/rules are satisfied. Event-Driven Execution: document-uploaded/approval-granted/invoice-created/payment-received/material-delivered/worker-completed/deadline-reached/risk-detected events trigger execution.
- **Architecture/Schema implications:** A scheduler with multiple queue types; a multi-agent coordinator; an event bus.
- **Gap vs current repo:** The event bus is the critical missing piece — certification §2.2 confirms only 2 hard-coded A→B chains exist (Meeting→Task, CRM→Task), not a general event bus. `task-execution-engine.ts` does single-agent planning, not multi-agent coordination. The repo's `approvalRequests` covers the human-collaboration/approval-dependency piece partially.
- **Implementation recommendation:** The event bus is the highest-leverage EEOE prerequisite and the same one SPOE needs — building it once unblocks both. Multi-agent coordination can follow by extending `task-execution-engine.ts`'s plan-step dispatch to assign steps to named agents.

### EEOE Monitoring, Recovery, Rollback, Load Balancing & Governance (source §15–19)
- **Understanding:** Monitoring tracks progress/failures/retries/timeouts/worker-health/API-health/delays/blocked/critical-path/SLA. Recovery Engine auto-recovers from network/API/worker failures, timeouts, duplicate execution, interrupted workflows, browser closure, device changes — "execution resumes safely." Rollback Engine supports step/workflow/transaction rollback, compensation workflows, partial/manual/policy-based rollback, all audited. Load Balancing distributes across agents/servers/LLMs/queues/humans/external-services/nodes, balancing cost/speed/availability. Governance stores owner/requester/approver/policies/evidence/audit-trail/versions/exceptions/security-context per execution.
- **Architecture/Schema implications:** Recovery/rollback imply idempotency keys + compensation-workflow records; load balancing implies a node/queue registry; governance implies per-execution audit.
- **Gap vs current repo:** Certification §2.5 confirms retry+fallback exists at the `callLLM` level (transient 429/5xx/network, up to twice, then second provider) — that's the *only* recovery mechanism, and it's LLM-call-scoped, not workflow-scoped. No workflow-level recovery, no rollback/compensation, no load balancing across nodes (Vercel serverless — certification flags load-testing as ⚪ NOT_APPLICABLE_YET). `auditLogs`/`orchestraExecutions` cover the governance/audit piece.
- **Implementation recommendation:** Workflow-level recovery and rollback are genuinely hard on Vercel serverless (no long-running processes, certification's repeated caveat). Realistic first step: idempotency keys on `executeTask()` invocations so retries don't double-execute; full compensation workflows are a larger, infra-dependent investment.

### EEOE Worker Agents, DB, AI Rules, KPIs & Human-in-Control (source §20–24)
- **Understanding:** 10 execution worker agents (Coordinator, Scheduling, Dependency Manager, Retry, Recovery, Rollback, Monitoring, Queue Manager, Analytics, Governance). 13 DB tables (ExecutionPlans/Tasks/Queues/Events/Dependencies/Workers/History/Analytics/Recovery/Rollback/Policies/Audit/Metrics). AI rules: avoid LLM during execution when deterministic logic suffices; LLM only for ambiguous instructions, unstructured docs, summaries, recovery-strategy recommendations; **execution state always maintained by the platform, not the LLM**. KPIs: success-rate/avg-time/automation/retry/recovery/rollback/worker-utilization/queue-wait/token-savings/SLA. Human-in-control: VERI may assign/launch/coordinate/recommend-retry/resume/escalate but must not release payments/modify contracts/override approvals/change governance/commit irreversible actions without authorization.
- **Architecture/Schema implications:** 13 tables; the "platform holds execution state, not LLM" rule is architecturally important.
- **Gap vs current repo:** `task-execution-engine.ts` already embodies the "platform holds state, LLM only reasons" rule — its plan is persisted and tools are dispatched deterministically; the LLM is invoked for planning, not for holding execution state. This is strong alignment. The 13 tables and 10 agents are unbuilt. The human-in-control list matches the repo's no-unattended-write doctrine (certification §2.2).
- **Implementation recommendation:** The "platform holds state" alignment means EEOE can grow organically from `task-execution-engine.ts` — extend its persisted plan into the Execution* table family rather than building a parallel engine.

### EEOE Analytics, EEG-X, Implementation, WCP, EQS & EEM (source §25–31)
- **Understanding:** Execution Analytics finds bottlenecks/agent-performance/human-delays/API-latency/failure-patterns/queue-congestion/cost/automation-opportunities/capacity. **Enterprise Execution Graph (EEG-X)**: execution as a graph (plans/workflows/tasks/agents/humans/APIs/events/documents/approvals/resources/systems/KPIs; edges = order/dependencies/ownership/retries/recovery). Implementation directive: EEOE is the runtime execution layer; modules publish structured execution requests; reusable services for scheduling/dependency/worker-allocation/event-handling/monitoring/retries/recovery/rollback/analytics/governance; logic declarative + metadata-driven. **Worker Coordination Protocol (WCP)**: agents communicate via structured messages (Task Assignment/Accepted/Started/Progress/Dependency-Waiting/Escalation/Completion/Failure/Retry/Knowledge-Contribution) — never free-form prompts unless reasoning required, reducing tokens. **Execution Quality Score (EQS)**: per-execution score (completion/SLA/resource-efficiency/retry/recovery/human-intervention/automation/policy/cost/token). **Enterprise Execution Mesh (EEM)**: every participant (users/agents/MCP servers/services/APIs/DBs/event-buses/schedulers/automation/LLM-gateways) is an execution node publishing/subscribing/coordinating/recovering via standardized protocols — scales single-user to thousands of orgs. Engineering principle: every approved plan becomes an executable/observable/recoverable/measurable process; execution never hidden in app code — declarative, event-driven, metadata-based, recoverable, auditable, token-efficient, scalable, AI-assisted only when reasoning is genuinely required.
- **Architecture/Schema implications:** WCP = a typed message contract between agents; EEM = a node-registry + pub/sub; EQS = a scoring table.
- **Gap vs current repo:** WCP is the most directly actionable and aligns with `task-execution-engine.ts`'s existing structured plan-step dispatch — generalizing those steps into typed WCP messages is a concrete increment. EEM/EQS/EEG-X are aspirational (graph + event-bus prerequisites again). MCP servers: certification does not mention any MCP integration; I could not verify any MCP code exists.
- **Implementation recommendation:** WCP is the highest-leverage EEOE innovation — it's a typed-message contract that can be layered onto the existing `executeTask()` dispatch without new infra, and it directly serves the token-reduction goal that every standard in this chunk repeats.

---

## ECCC — Enterprise Cognitive Command Center (CSV 215)

### ECCC Vision, Philosophy, Objectives & Architecture (source §1–4)
- **Understanding:** ECCC is the "CEO Dashboard / prefrontal cortex" — a supervisory layer that doesn't execute work but continuously observes/measures/evaluates/coordinates/governs the entire enterprise in real time, answering "what requires my attention right now?" Philosophy: everything important visible, nothing important unnoticed. Objectives: supervise operations, coordinate all AI engines, detect anomalies, surface executive insights, monitor health, govern agents, reduce risk/decision-latency/tokens, improve awareness. Architecture: Enterprise Systems → Events → Knowledge Graph → Analytics → Worker Agents → Command Center → Executive Dashboards → Conversation Engine → Executives.
- **Architecture/Schema implications:** A supervisory layer *above* all platform services; every engine publishes standardized health/telemetry objects (per §27).
- **Gap vs current repo:** The Knowledge Graph prerequisite is unbuilt (certification §1.2). The event bus prerequisite is unbuilt (certification §2.2). There is no supervisory/health-aggregation service in `src/lib/services/` — the closest is `kpi-hub-service.ts` and `metric-alert-service.ts` (KPI/metric aggregation, narrower than enterprise health). `orchestra-analytics-service.ts` logs per-LLM-call metrics but doesn't aggregate to enterprise health.
- **Implementation recommendation:** ECCC is the most prerequisite-heavy standard in this chunk (graph + event bus + telemetry contracts from every engine). It should be sequenced last among the five, after the graph and event-bus decisions.

### ECCC Supervision Scope, Health Object, Dimensions & Pipeline (source §5–9)
- **Understanding:** Supervision scope spans projects/finance/accounting/compliance/construction/CRM/HR/inventory/procurement/assets/documents/approvals/meetings/agents/AI-engines/infrastructure/security/users/APIs. Enterprise Health Object: `{enterpriseHealth, projectsHealthy, financeHealth, complianceHealth, agentHealth, systemHealth, risks[], criticalAlerts[]}`. 14 health dimensions (financial/operational/compliance/execution/project/AI/worker/infrastructure/knowledge/security/customer/employee/vendor/overall). Monitoring Pipeline: Observe → Collect Events → Evaluate → Score → Detect Issues → Prioritize → Recommend → Notify → Measure → Improve.
- **Architecture/Schema implications:** A health-score per subsystem + an aggregated enterprise score; a 14-dimension scoring model.
- **Gap vs current repo:** The repo has many of the *source* domains (construction-*, erp-*, crm-service, hr-service, etc. — visible in the services dir) but no aggregation layer computing per-domain or enterprise health scores. `metric-alert-service.ts` likely handles metric alerts (I could not verify the `metricAlertRules` table — schema.ts unreadable), which is a *slice* of the alerting piece but not the health-scoring piece.
- **Implementation recommendation:** A realistic first increment: extend `metric-alert-service.ts`/`kpi-hub-service.ts` into a per-domain health score for 2–3 domains, rather than all 14 at once.

### ECCC Dashboard, Scores, Alerts, Summaries & Cross-System Intelligence (source §9–16)
- **Understanding:** Executive Dashboard answers what-changed/blocked/needs-approval/at-risk/declined-KPIs/review/ignore. Health Scores carry score/confidence/trend/owner/last-updated/risk/recommendation. Alert Engine categories: Critical/High/Medium/Low/Silent/Informational — only actionable alerts interrupt. Executive Summaries: morning/evening/weekly/monthly/quarterly/annual/board, role-specific. Cross-System Intelligence detects cascading relationships (budget-variance → project-delay → vendor-delay → cash-flow-risk → compliance-exposure → customer-impact). Worker Agent Supervision tracks availability/performance/accuracy/failures/learning/retries/queue-size/execution-time/token-usage/worker-health. AI Engine Monitoring covers all 8 engines. Enterprise Pulse: per-minute operational-stability/execution-velocity/decision-speed/risk-trend/financial-trend/employee-activity/customer-activity/overall-pulse.
- **Architecture/Schema implications:** Alert severity enum; scheduled summary generation; a cross-system causal-detection engine; per-minute pulse aggregation.
- **Gap vs current repo:** `metric-alert-service.ts` + `kpi-hub-service.ts` cover fragments (alerts, KPIs). No cross-system causal detection, no executive-summary generation, no per-minute pulse. Certification §1.6 notes `orchestraExecutions` captures model/provider/tokens/cost per LLM call — that's worker-agent *telemetry* raw material, but it's not aggregated into a worker-health score. The "morning brief" type summaries have no generator.
- **Implementation recommendation:** Executive summaries are the most self-contained, high-value ECCC increment — a single scheduled LLM call per cadence over existing `auditLogs`/`orchestraExecutions`/KPI data, reusing the existing Prompt OS + resolver stack (certification §1.4).

### ECCC Timeline, Recommendations, Governance, Worker Agents & DB (source §17–21)
- **Understanding:** Executive Timeline shows major decisions/risks/approvals/events/deployments/failures/recoveries/milestones chronologically. Recommendation Center ranks review-project/approve-budget/meet-vendor/increase-resources/delay-initiative/review-compliance/investigate-cost by impact. Governance Dashboard displays policy-violations/audit-findings/security-events/compliance-gaps/risk-escalations/approval-exceptions/learning-proposals. 10 worker agents (Command Center, Enterprise Health, Executive Summary, Alert Prioritization, Dashboard, Pulse, Monitoring, Governance, Executive Recommendation, System Health). 13 DB tables (EnterpriseHealth/HealthScores/ExecutiveDashboards/Alerts/ExecutiveSummaries/EnterprisePulse/AgentHealth/EngineHealth/GovernanceEvents/ExecutiveRecommendations/MonitoringHistory/HealthAnalytics/CommandCenterSettings).
- **Architecture/Schema implications:** 13 tables; a governance-events aggregation view over existing audit logs.
- **Gap vs current repo:** The Governance Dashboard maps well onto existing `auditLogs`/`approvalRequests`/`orchestraExecutions` (certification §1.6, §2.1) — those primitives exist and could feed a governance-events view without new write paths. The 13 ECCC-specific tables are unbuilt. The Executive Timeline is essentially a chronological query over `auditLogs` — buildable cheaply.
- **Implementation recommendation:** The Governance Dashboard and Executive Timeline are the cheapest ECCC pieces because they're read-views over existing audit data; build those first to demonstrate value before the heavier health-scoring work.

### ECCC AI Rules, KPIs, Command Console, Human-in-Control, EHG & Digital Twin (source §22–30)
- **Understanding:** AI rules: monitoring relies on deterministic calculations/event-processing/analytics; LLM only for executive summaries/cross-functional narratives/synthesizing situations/answering executive questions — health scores and alerts must never depend solely on an LLM. KPIs: enterprise-health/operational-stability/execution-success/decision-latency/alert-accuracy/executive-engagement/worker-availability/automation-coverage/token-efficiency/governance-compliance. Executive Command Console: approve/pause/resume/escalate/delegate/investigate/launch-workflow/launch-agents/request-analysis/review-evidence, all audited. Human-in-control: VERI may recommend/summarize/prioritize/escalate/coordinate/monitor but must not override governance/approve executive actions/change policies/modify financials/authorize legal commitments without approval. **Enterprise Health Graph (EHG)**: health as a graph (projects/departments/KPIs/agents/engines/risks/budgets/approvals/assets/infrastructure/compliance-controls/users; edges = dependencies/influence) to identify cascading issues before critical. Implementation directive: ECCC is the supervisory layer above all services; every engine publishes standardized health/telemetry objects; ECCC aggregates into health-scores/dashboards/alerts/recommendation-queues/governance-reports/summaries; supervisory layer independent of business modules. **Enterprise Cognitive Digital Twin (ECDT)**: continuously-updated virtual model of org-structure/projects/resources/budgets/workflows/agents/knowledge-graph/risks/decisions/dependencies/infrastructure/integrations, answering "if we delay this milestone, what else is affected?" before changes. **Executive Intelligence Score (EIS)**: single indicator (enterprise-health/decision-quality/planning-accuracy/execution-success/governance-compliance/knowledge-maturity/automation-coverage/agent-effectiveness/risk-exposure/token-efficiency). Principle: every enterprise event contributes to situational awareness; no event in isolation.
- **Architecture/Schema implications:** EHG = graph store (recurring prerequisite); ECDT = a writable virtual model fed by every domain; EIS = a composite score; a telemetry-publishing contract every engine must implement.
- **Gap vs current repo:** The "every engine publishes standardized health/telemetry objects" contract does not exist — engines don't currently emit health objects (certification §2.3 notes the 6 Orchestra layers are independent config lookups, not a coordinated hierarchy; `workerAgents.supervisorWorkerAgentId` is a real column never read). EHG/ECDT/EIS are aspirational. The "health scores never depend solely on an LLM" rule aligns with the repo's deterministic-first discipline.
- **Implementation recommendation:** The telemetry-publishing contract is the foundational ECCC work — define one standardized health/telemetry object shape and wire it into 2–3 existing engines first. ECDT/EIS come after there's telemetry to aggregate.

---

## ERE — Enterprise Reasoning Engine (CSV 216)

### ERE Vision, Philosophy, Objectives & Architecture (source §1–4)
- **Understanding:** ERE is positioned as VERIDIAN's "biggest IP" and "Cognitive Cortex" — structured, explainable, multi-domain reasoning *across the enterprise* (millions of records, knowledge graph, rules, decisions, workflows, projects, financials, risks, agent findings, historical outcomes), explicitly contrasted with LLM reasoning "inside a prompt." Philosophy: knowledge stores facts, analytics explains facts, decision-intelligence recommends actions, **reasoning explains relationships** — answering why/what-will-happen/what-else-is-affected/what-assumptions/what-evidence. Objectives: connect knowledge, multi-step reasoning, reduce uncertainty, improve decision-quality/explainability, reduce tokens, detect hidden relationships. Architecture: Knowledge Graph → Business Rules → Structured Data → Analytics → Predictions → Reasoning Engine → Decision Engine → Conversation Engine → Users.
- **Architecture/Schema implications:** A reasoning service that is a *consumer* of the Knowledge Graph, business rules, and structured data; outputs feed the Decision and Conversation engines.
- **Gap vs current repo:** Knowledge Graph 🔴 (certification §1.2) — ERE's primary input is unbuilt. Business rules exist in a limited form (`module-rule-service.ts`, `automation-rule-service.ts` are in the services dir) but I could not verify they expose a reasoning-queryable rule store. No `reasoning*` service exists. Certification §1.7 confirms zero confidence-scoring/citation/fact-checking on any LLM output — ERE's explainability/confidence goals have no substrate.
- **Implementation recommendation:** ERE is the most blocked standard — it depends on the Knowledge Graph, a rule store, and a confidence model, none of which exist. It should be sequenced after the graph decision and after CLEE's evidence/confidence work, since ERE reuses the same evidence+confidence concepts.

### ERE Reasoning Types, Object, Inputs & Pipeline (source §5–8)
- **Understanding:** 15 reasoning types (deductive/inductive/abductive/rule-based/constraint-based/graph-based/temporal/probabilistic/risk-based/financial/compliance/strategic/operational/scenario/hybrid). Reasoning Object: `{reasoningId, question, confidence, evidence[], assumptions[], conclusion, relatedObjects[]}`. Inputs: enterprise graph, documents, workflows, projects, budgets, financials, approvals, policies, agents, historical decisions, predictions, external data (approved), user questions, conversation context. Pipeline: Question → Collect Evidence → Validate Facts → Identify Relationships → Apply Rules → Generate Hypotheses → Evaluate Alternatives → Reach Conclusion → Explain → Measure Confidence.
- **Architecture/Schema implications:** A reasoning-session entity with evidence/assumptions/conclusion/related-objects; a 15-type strategy registry.
- **Gap vs current repo:** No reasoning-session entity or strategy registry exists. The Reasoning Object's `evidence[]`/`assumptions[]`/`confidence` fields echo CLEE's Learning Object and EEOE's EQS — a shared evidence+confidence model is implied across CLEE/ERE but doesn't exist anywhere.
- **Implementation recommendation:** Define a shared evidence+confidence DTO once (used by CLEE improvement proposals, ERE reasoning sessions, and EEOE quality scores) — this is cross-cutting infra that three standards need.

### ERE Multi-Hop, Explainable, Hypothesis, Counterfactual, Constraint & Temporal (source §9–14)
- **Understanding:** Multi-Hop Reasoning traces causal chains (project-delay → material-shortage → vendor-delay → purchase-approval-delay → finance-approval-delay → cash-flow-constraints → client-payment-delay). Explainable Reasoning: every conclusion includes evidence/reasoning-path/rules-applied/confidence/alternative-explanations/missing-info/recommendations — "nothing is a black box." Hypothesis Generation ranks possible causes by confidence when evidence is incomplete, requesting more evidence if needed. Counterfactual Reasoning handles "what if approval had occurred yesterday / Vendor B selected / budget +10%." Constraint Reasoning respects budget/resource/deadline/compliance/policy/permission/contractual constraints. Temporal Reasoning understands sequence/deadlines/trends/time-dependencies/forecast-windows/seasonality/chronology.
- **Architecture/Schema implications:** A causal-chain traversal over the graph; a hypothesis store with confidence ranking; a counterfactual simulator; a constraint solver.
- **Gap vs current repo:** None of these mechanisms exist. The "nothing is a black box" explainability goal directly conflicts with the current state — certification §1.6 notes the system prompt/user message sent to the model isn't even stored ("you can prove what model made a decision and what it cost, but not exactly what it was asked or told"), and §1.7 confirms zero confidence/citation/fact-checking. So ERE's explainability prerequisite is *less* than what the repo currently stores for plain LLM calls.
- **Implementation recommendation:** The explainability gap is foundational and predates ERE: storing the actual prompt/message per LLM call (certification §1.6's MEDIUM-priority fix, with PII redaction) is a prerequisite for *any* explainable reasoning. Do that first.

### ERE Graph, Cross-Domain, Worker Collab, Confidence & Governance (source §15–19)
- **Understanding:** Graph Reasoning uses enterprise graph traversal to discover dependencies/influence-chains/shared-resources/common-risks/knowledge-reuse/duplicate-work/hidden-bottlenecks — "minimizes prompt size." Cross-Domain Reasoning connects Finance↔Projects↔Procurement↔Inventory↔Construction↔Compliance↔Legal, HR↔Productivity, Sales↔Cash-Flow. Worker Agent Collaboration: specialist agents (Finance/Project/Compliance/Risk/Legal/Analytics) provide evidence; the Reasoning Engine synthesizes. Confidence Model combines evidence-quality/rule-coverage/data-freshness/historical-accuracy/source-agreement/graph-completeness/LLM-confidence — "calculated, not guessed." Reasoning Governance stores question/evidence/rules/assumptions/conclusions/reviewer/audit-trail/version — reproducible.
- **Architecture/Schema implications:** Graph traversal API; a confidence-calculator service; a reasoning-audit record.
- **Gap vs current repo:** Graph traversal has no substrate (graph unbuilt). The "specialist agents provide evidence" pattern requires the multi-agent collaboration that certification §2.2 says is only 2 hard-coded chains. The confidence-calculator has no inputs (no evidence store, no rule-coverage metric). Reasoning governance maps onto existing `auditLogs` patterns.
- **Implementation recommendation:** The confidence-calculator is buildable in stub form once the shared evidence DTO exists, even before the graph — it can compute over whatever evidence sources are available and degrade gracefully.

### ERE Worker Agents, DB, AI Rules, KPIs & Human-in-Control (source §20–24)
- **Understanding:** 10 reasoning worker agents (Evidence Collection, Hypothesis, Reasoning Coordinator, Graph Traversal, Rule Evaluation, Constraint, Temporal, Counterfactual, Analytics, Governance). 11 DB tables (ReasoningSessions/Evidence/Graphs/Rules/Hypotheses/Conclusions/Confidence/History/Analytics/Policies/Audit). AI rules: prefer deterministic reasoning when structured facts/rules exist; LLM only for ambiguous natural-language, conflicting-evidence synthesis, executive explanations, plausible hypotheses — **LLM outputs must never bypass rule validation or governance**. KPIs: reasoning-accuracy/evidence-coverage/avg-time/decision-improvement/hypothesis-accuracy/user-trust/cross-domain-discovery/graph-utilization/token-savings/reasoning-reuse. Human-in-control: VERI may reason/compare/explain/predict/recommend/question-assumptions but must not invent-facts/ignore-policies/override-governance/suppress-contradictory-evidence/present-speculation-as-certainty.
- **Architecture/Schema implications:** 11 tables; the "LLM never bypasses rule validation" rule is a hard gate.
- **Gap vs current repo:** The "LLM outputs never bypass rule validation" rule aligns with the repo's `policy-enforcement-engine.ts` deterministic pre-call gate (certification §2.8) — that gate exists and could be extended to a post-LLM rule-validation gate. The 11 tables and 10 agents are unbuilt. The "must not invent facts / present speculation as certainty" prohibition has no enforcement today (certification §1.7: no fact-checking on LLM output).
- **Implementation recommendation:** Extend the existing `policy-enforcement-engine.ts` pattern from pre-call to post-call (validate LLM conclusions against rules/evidence before surfacing) — this reuses proven infra for ERE's hardest governance rule.

### ERE ERG, Implementation, ECG, RQS & ECRF (source §25–30)
- **Understanding:** **Enterprise Reasoning Graph (ERG)**: reasoning as a graph (facts/evidence/rules/assumptions/hypotheses/conclusions/risks/policies/agents/knowledge-objects; edges = inference-paths/causal-relationships/dependencies/confidence-propagation) — sessions stored, replayed, audited, improved. Implementation directive: ERE is a reusable platform service independent of business modules; inputs = structured facts/graph-refs/rules/questions/workflow-context/agent-evidence; outputs = conclusions/reasoning-paths/confidence/evidence/unresolved-questions/next-actions; logic modular so new strategies add without modifying business modules. **Enterprise Cognitive Graph (ECG)**: one unified graph unifying Knowledge/Decision/Planning/Workflow/Execution/Experience/Opportunity/Health/Reasoning graphs — every AI engine reads from and contributes to this shared graph. **Reasoning Quality Score (RQS)**: per-session score (evidence-completeness/rule-compliance/graph-coverage/cross-domain-integration/explainability/confidence-calibration/contradiction-resolution/audit-readiness/user-validation/outcome-accuracy). Principle: reason over enterprise knowledge, not over prompts — retrieve facts from ECG, apply deterministic rules, use graph traversal for relationships, invoke agents for domain expertise, call LLM only for ambiguity/narrative. Capstone: **Enterprise Cognitive Reasoning Framework (ECRF)** standardizes reasoning across every module (Construction/Accounting/Compliance/HR/CRM/Procurement/Inventory/PM/future) via a common cognitive reasoning layer — "architectural consistency as a defining competitive advantage."
- **Architecture/Schema implications:** ECG is the single unifying graph that *every* prior standard's graph (EEG, EPG, EEG-X, EHG, ERG) rolls up into — this is the architectural keystone of the whole chunk. ECRF = a reasoning-interface contract every module implements.
- **Gap vs current repo:** ECG is the capstone of an entire graph family that is entirely unbuilt (certification §1.2: no graph store at all). ECRF's "every module exposes structured reasoning interfaces" is the opposite of the repo's current shape (each `*-service.ts` embeds its own logic, no reasoning contract). RQS depends on the shared evidence+confidence DTO that doesn't exist.
- **Implementation recommendation:** ECG is the single most important architectural decision in this entire chunk: it's the convergence point of five standards' graphs (EEG/EPG/EEG-X/EHG/ERG). The graph-store decision flagged in certification §1.2 should be made *with ECG in mind* — i.e., design one graph store that all five standards' nodes/edges inhabit, rather than five separate graphs. That decision unblocks CLEE, SPOE, EEOE, ECCC, and ERE simultaneously.

---

## Cross-cutting observations

1. **One graph store, five consumers.** Every standard in this chunk proposes its own graph (EEG, EPG, EEG-X, EHG, ERG) and ERE §27 unifies them into ECG. The repo has *no* graph store (certification §1.2). The highest-leverage decision in this chunk is building one graph store designed for ECG, not five.

2. **One event bus, three consumers.** SPOE (replanning triggers), EEOE (event-driven execution), and ECCC (telemetry publishing) all need an event bus. Certification §2.2 confirms only 2 hard-coded A→B chains exist. Building one event bus unblocks three standards.

3. **One shared evidence+confidence DTO, three consumers.** CLEE improvement proposals, ERE reasoning sessions, and EEOE quality scores all need evidence+confidence+rollback metadata. None exists. Defining it once serves three standards.

4. **The "deterministic-first, LLM-only-for-narrative" rule is already the repo's posture.** Every standard repeats it; the repo's `purpose-bound-ai.ts` + `policy-enforcement-engine.ts` + `task-execution-engine.ts`'s platform-holds-state design already embody it. This is strong architectural alignment — the standards describe extending a discipline the repo already follows, not importing a foreign one.

5. **The "stored, never applied" gap is the most repeated defect.** CLEE's `loopImprovements` (zero rows), `workerAgentLearnings` (corrections stored, never applied), and ERE's reasoning (no fact-checking) are all the same shape: the repo captures rich signals and then stops. The single highest-leverage behavioral fix across this chunk is closing the capture→apply gap in at least one place (CLEE improvement proposals are the most contained).

6. **Verification limits stated honestly.** `src/lib/db/schema.ts` (439KB) was too large for the read tool and there is no search/grep, so I could *not* directly verify the `loopExecutions`, `loopImprovements`, or `metricAlertRules` table definitions the task asked about — I relied on `AI_OS_CERTIFICATION.md`'s live-SQL citations for the first two and could only infer `metricAlertRules` from the existence of `metric-alert-service.ts`. `ai-os/OS.yaml` and `ai-os/registry` are governance-protected and unreadable. Any claim above that depends on a specific table's columns is unverified-by-me and flagged as such.
# Part 5 of 6 — Independent Study by z.ai GLM-5.2

This is Part 5 of 6 of an *independent* study by z.ai GLM-5.2 of the "VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP Architecture v1.0" source document (chunk = `docs/study-zai-input/part-5-source.txt`, original lines ~9416–11631). A separate AI (Claude) performed its own independent study of the same document in parallel; the two will be cross-reviewed later. The analysis below is therefore my own genuine reading, not a guess at another AI's conclusions. Line ranges are approximate (the source file carries no line markers; I reconstructed them from the Study/CSV section boundaries). Where I verified a claim against the real repo I cite the exact file I read; where I could not verify, I say so.

The chunk covers CSV 217 (Enterprise Wisdom & Advisory Engine), CSV 218 (Enterprise Innovation & Evolution Engine), CSV 219 (Enterprise Prediction & Foresight Engine), CSV 220 (Meta Intelligence & AI OS Orchestrator / MIAO), and CSV 222 (Functional Development Engineering / FDE). CSV 221 is the umbrella "UEIP" label and is not separately enumerated here.

---

## CSV 217 — Enterprise Wisdom & Advisory Engine (EWAE)

### Vision & Philosophy (source lines ~1–40)
- **Understanding:** EWAE is positioned as the highest *advisory* layer — above Reasoning. Where reasoning finds what is logically correct, wisdom chooses what is best for the enterprise long-term. The framing is explicitly "VERI behaves like CEO / McKinsey partner / Big-4 consultant / CFO." The philosophy distills to "Knowledge answers; Reasoning explains; Planning organizes; Execution completes; Wisdom chooses."
- **Architecture/Schema implications:** Implies a layered stack: Cognitive Graph → Knowledge → Reasoning → Decision → Learning → Wisdom → Executive Guidance → Conversation. Wisdom is a *consumer* of all lower engines, not a peer reasoner.
- **Gap vs current repo:** No `wisdom-service.ts` or advisory engine exists. The closest "advisory" surface is the FDE evaluation flow (`src/lib/services/fde-service.ts`), which proposes worker agents, not executive recommendations. Not found.
- **Implementation recommendation:** Defer entirely. EWAE is a vision-level layer with no concrete inputs (no decision-engine, no learning-engine outputs) to consume yet. Build the lower layers first.

### Advisory Domains & Wisdom Object (source lines ~41–90)
- **Understanding:** 18 advisory domains (Strategy, Finance, Construction, Compliance, etc.). The Wisdom Object is a small structured record: `advisoryId, topic, recommendation, confidence, shortTermImpact, longTermImpact, tradeOffs[], strategicAlignment`.
- **Architecture/Schema implications:** A single `executive_advisories` table with JSONB `tradeOffs` would model this. The object is deliberately minimal — evidence and alternatives live elsewhere (Advisory Cards, §14).
- **Gap vs current repo:** No such table. `fdeRequests` (in `fde-service.ts`) is the only "structured recommendation object" in the repo, and its shape (status/matchedLabel/responseText) is far narrower. Not found.
- **Implementation recommendation:** If ever built, model the Wisdom Object as a typed TS interface mirroring the JSON, persisted as one table; do not pre-build the 18 domain partitions.

### Advisory Pipeline & Multi-Dimensional Evaluation (source lines ~91–150)
- **Understanding:** An 11-step pipeline (Question → Collect Evidence → Reason → Evaluate Trade-offs → Assess Long-Term Impact → Generate Recommendations → Explain → Rank → Review → Measure Outcome → Learn). Every recommendation is scored across 12 dimensions (Financial Value, Strategic Alignment, Operational Impact, Compliance, Risk, Customer/Employee/Technology Impact, Scalability, Sustainability, Knowledge Retention, Future Flexibility).
- **Architecture/Schema implications:** Implies a deterministic multi-criteria scoring function (weighted sum) producing the `confidence` and impact fields, with an LLM only for the "Explain" step. This is the document's recurring deterministic-first pattern.
- **Gap vs current repo:** No multi-criteria scorer exists. The repo's deterministic-first ethos is real (see `construction-prediction-service.ts` header: "AI only touches the final review report — every other table is pure deterministic data"), but it is applied to construction, not advisory scoring. Partial ethos match, no implementation.
- **Implementation recommendation:** The 12-dimension scorer is the only concretely implementable piece; build it as a pure function over structured inputs once those inputs exist.

### Trade-offs, Perspectives, Opportunity Advisory (source lines ~151–210)
- **Understanding:** Trade-off analysis explains Benefits/Costs/Risks/Opportunity Cost/Long+Short-Term Consequences/Alternatives. "Executive Perspectives" re-renders the same recommendation through CEO/CFO/COO/CTO/CHRO/CRO/CCO lenses. Opportunity Advisory continuously surfaces revenue/cost/automation/reuse candidates ranked by expected enterprise value.
- **Architecture/Schema implications:** Perspectives imply running the same scorer with role-specific weight vectors. Opportunity Advisory implies a background scan job emitting candidates into an `opportunity_catalog`.
- **Gap vs current repo:** No perspective-weighting, no opportunity catalog. The FDE "passive" background scan (`fde-service.ts` `passive:true`) is conceptually adjacent — it auto-answers high-confidence matches from ordinary chat — but it discovers *existing* capabilities, not business opportunities. Not found.
- **Implementation recommendation:** Perspectives are cheap to prototype (weight-vector parameter on the scorer); opportunity discovery requires telemetry the platform does not yet collect.

### Institutional Memory, Advisory Cards, Scenario Comparison (source lines ~211–280)
- **Understanding:** Institutional Memory captures major decisions, lessons, successes, failures, executive insights, approved strategies. Advisory Cards bundle recommendation + evidence + trade-offs + alternatives + confidence + strategic fit + expected benefits + risks + required approvals + success metrics. Scenario Comparison supports Grow-vs-Consolidate, Buy-vs-Build, etc.
- **Architecture/Schema implications:** An `institutional_knowledge` table and an `advisory_cards` JSONB column on advisories. Scenario comparison is a pairwise diff of two Wisdom Objects.
- **Gap vs current repo:** No institutional-memory store. The closest "memory" service in the repo is `assistant-memory-service.ts` (referenced in `capability-registry-service.ts` comments), which is conversational memory, not institutional. Not found.
- **Implementation recommendation:** Advisory Cards are the most reusable artifact — define the card schema even before the engine, so future engines can emit cards.

### Worker Agents, Database Design, AI Integration Rules (source lines ~281–360)
- **Understanding:** 10 named worker agents (Executive Advisor, Trade-off Analysis, Opportunity Discovery, Institutional Memory, Strategic Alignment, Executive Perspective, Governance Advisor, Long-Term Planning, Advisory Analytics, Wisdom Governance). 12 primary tables listed. AI Integration Rules repeat the deterministic-first doctrine: deterministic frameworks score measurable criteria; LLM only synthesizes narratives / explains trade-offs / generates board summaries.
- **Architecture/Schema implications:** A full advisory schema (ExecutiveAdvisories, StrategicRecommendations, TradeOffAnalyses, InstitutionalKnowledge, ExecutiveLessons, OpportunityCatalog, AdvisoryAnalytics, AdvisoryHistory, AdvisoryPolicies, StrategicAlignment, ExecutiveFeedback, WisdomLibrary).
- **Gap vs current repo:** None of these tables exist. The repo's worker-agent model (`workerAgents` table, `proposeWorkerAgent` in `worker-agent-service.ts`) is generic and could host these as rows, but none are registered. The deterministic-first rule *is* genuinely enforced in the repo (FDE runs embedding search before any LLM call; `construction-prediction-service.ts` is pure arithmetic). Partial: rule observed, agents/tables absent.
- **Implementation recommendation:** Do not create 12 tables speculatively. If pursued, model advisories + institutional_knowledge first; the rest are analytics views.

### KPIs, Human-in-Control, Wisdom Graph, Framework, Quality Score (source lines ~361–440)
- **Understanding:** 10 KPIs (Recommendation Acceptance, Strategic Goal Achievement, Decision Quality, Long-Term Outcome Accuracy, Opportunity Capture, Risk Avoidance, Executive Satisfaction, Knowledge Reuse, Governance Compliance, Token Efficiency). Human-in-Control: VERI may advise/compare/challenge/highlight/recommend/explain but must NOT set strategy, approve mergers, authorize investments, change governance, or override executives. Enterprise Wisdom Graph (EWG) nodes = strategies/objectives/lessons/trade-offs/principles/opportunities/risks/policies/recommendations/historical outcomes; edges = influence/conflict/dependency/strategic relationship. Wisdom Quality Score (WQS) = 10 sub-scores.
- **Architecture/Schema implications:** EWG is a labeled property graph; WQS is a composite metric persisted on each advisory.
- **Gap vs current repo:** No graph store beyond the embeddings table (`embeddings` in `capability-registry-service.ts`), which is a flat vector index, not a relationship graph. Human-in-control gating *is* real in the repo (`policy-enforcement-engine.ts` `enforcePolicy` is called before FDE's embedding search; `hasRole` gates worker-agent tier). Partial: governance pattern exists, graph does not.
- **Implementation recommendation:** The Human-in-Control list is the most directly portable artifact — codify the "must not" set as policy rules in the existing policy engine.

### EAOS Proposal & Engineering Principle (source lines ~441–490)
- **Understanding:** Positions EWAE as the foundation of an "Enterprise Advisory Operating System" (EAOS) that augments executives by continuously monitoring, identifying opportunities, evaluating trade-offs, recommending priorities, preserving knowledge, measuring outcomes, improving advisory quality. Final principle: every recommendation maximizes long-term enterprise value while remaining evidence-based, explainable, governed, human-approved.
- **Architecture/Schema implications:** None beyond what §22–25 already imply; this is the marketing/cornerstone framing.
- **Gap vs current repo:** Not found. The repo's actual "operating system" framing is the Orchestra layer system (`orchestra-model-resolver.ts` resolves per-layer models), which is about *model selection*, not advisory orchestration.
- **Implementation recommendation:** Treat as north-star narrative, not a build ticket.

---

## CSV 218 — Enterprise Innovation & Evolution Engine (EIEE)

### Vision, Philosophy & Innovation Object (source lines ~491–560)
- **Understanding:** EIEE continuously discovers/evaluates/prioritizes/governs innovation opportunities — products, services, business models, automations, revenue, cost reductions, markets, agents, modules, workflows. Philosophy: "Efficiency improves today; Innovation improves tomorrow; Evolution ensures long-term survival." Innovation Object: `innovationId, category, title, businessValue, estimatedROI, implementationEffort, confidence`.
- **Architecture/Schema implications:** An `innovation_ideas` table with ROI/effort/confidence fields; a portfolio lifecycle state machine.
- **Gap vs current repo:** No innovation tables. The FDE flow is the closest analogue — it *does* turn a free-text request into a structured proposal (worker-agent proposal with name/domain/description/promptTemplate/schemas) — but FDE's output is a worker agent, not a scored innovation idea with ROI. Partial: proposal-generation pattern exists, innovation-scoring does not.
- **Implementation recommendation:** The FDE proposal shape could be generalized into an "innovation proposal" with added ROI/effort fields; reuse the existing `proposeWorkerAgent` pipeline rather than building parallel.

### Innovation Pipeline, Sources & Opportunity Discovery (source lines ~561–640)
- **Understanding:** 12-step pipeline (Observe → Identify → Validate → Estimate Value → Assess Feasibility → Prioritize → Prototype → Approve → Implement → Measure → Standardize → Learn). 14 innovation sources (user feedback, worker agents, analytics, knowledge graph, decision history, failed workflows, repeated tasks, etc.). Opportunity Discovery lists 11 recurring-problem signals (repeated manual work, high-cost activities, slow processes, knowledge gaps, unused data, duplicate work, etc.).
- **Architecture/Schema implications:** A background observer consuming telemetry from workflows/agents/tickets; a candidate-generation step emitting Innovation Objects.
- **Gap vs current repo:** No telemetry pipeline feeding an observer. The FDE passive scan is the only "observe free text → candidate" path, and it observes chat messages, not workflow metrics. Not found.
- **Implementation recommendation:** Requires instrumentation (workflow run logs, task counts) the repo would need first; do not build the observer before the telemetry exists.

### Product/Worker Agent Evolution, Portfolio, Governance (source lines ~641–730)
- **Understanding:** Product Evolution recommends new modules/features/APIs/reports/dashboards/templates/calculators/skills/workflows/UX. Worker Agent Evolution proposes new specialist/coordinator/review/optimization/domain/compliance/learning/monitoring/governance agents via structured innovation requests. Innovation Portfolio tracks ideas/prototypes/approved/active/deferred/rejected/completed/lessons. Governance records sponsor/business case/evidence/benefits/risks/resources/approval chain/plan/metrics/rollback.
- **Architecture/Schema implications:** Portfolio state machine; governance metadata block on each innovation.
- **Gap vs current repo:** Worker Agent Evolution is *partially real*: `proposeWorkerAgent` (called by `fde-service.ts`) creates worker-agent proposals with role-gated tier and human approval. But there is no "innovation request" wrapper, no portfolio, no governance metadata block. Partial.
- **Implementation recommendation:** The worker-agent proposal pipeline is the right spine; wrap it with portfolio state + governance fields rather than inventing a new proposal type.

### Worker Agents, DB, AI Rules, KPIs, Human-in-Control (source lines ~731–820)
- **Understanding:** 10 innovation worker agents. 12 tables (InnovationIdeas, InnovationPortfolio, InnovationBusinessCases, InnovationExperiments, InnovationApprovals, InnovationAnalytics, InnovationRoadmap, InnovationHistory, InnovationLessons, InnovationPolicies, EvolutionProjects, InnovationMetrics). AI rules: deterministic analytics find inefficiencies; LLM only brainstorms alternatives / drafts narratives / synthesizes market observations / drafts docs. Human-in-Control: VERI may suggest/prioritize/recommend/estimate/monitor but must NOT launch products, change business models, commit budgets, or deploy production innovations without governance.
- **Architecture/Schema implications:** Full innovation schema.
- **Gap vs current repo:** None of the 12 tables exist. The deterministic-first AI rule is again genuinely reflected in repo behavior. Human-in-control gating pattern exists (policy engine, role gating). Partial: pattern only.
- **Implementation recommendation:** Same as EWAE — do not speculatively create 12 tables.

### Innovation Graph, Marketplace, Maturity Model, IQS, Principle (source lines ~821–880)
- **Understanding:** Enterprise Innovation Graph (EIG) nodes = ideas/problems/solutions/business cases/experiments/agents/products/modules/features/markets/customers/technologies/lessons; edges = dependencies/influence/validation/implementation/outcomes. Innovation Marketplace (EIM) catalogs reusable assets (agents, workflow templates, automation recipes, dashboard/report templates, calculation engines, connectors, knowledge/industry packs, UI components) with versioning/quality ratings/compatibility/governance status/outcomes. 5-level Innovation Maturity Model (Reactive → Optimized → Proactive → Adaptive → Autonomous Innovation). Innovation Quality Score (IQS) = 10 sub-scores. Principle: every recurring problem is an innovation candidate; every successful innovation is a reusable capability.
- **Architecture/Schema implications:** EIM is a versioned asset registry with governance status; maturity model is an org-level enum + assessment; IQS persisted on each proposal.
- **Gap vs current repo:** The Capability Registry (`capability-registry-service.ts`) is a *real, partial* implementation of the Marketplace idea — it indexes worker_agent / automation_rule / module / prompt_pattern entities with embeddings and supports `auditDuplicateCapabilities`. But it has no versioning, quality ratings, compatibility, or governance-status fields, and no install/subscription flow. Partial — the closest real match in the entire chunk.
- **Implementation recommendation:** Extend the existing Capability Registry schema (add version, quality_score, governance_status columns) rather than building a separate Marketplace.

---

## CSV 219 — Enterprise Prediction & Foresight Engine (EPFE)

### Vision, Philosophy, Prediction Object, Pipeline (source lines ~881–980)
- **Understanding:** EPFE forecasts future enterprise conditions, identifies emerging opportunities/risks, recommends proactive actions. Philosophy: "Observation explains the present; Reasoning explains the past; Prediction prepares the future." Prediction Object: `predictionId, subject, prediction, confidence, timeHorizon, drivers[], recommendedActions[]`. 11-step pipeline (Collect → Validate → Detect Trends → Generate Forecasts → Evaluate Confidence → Generate Scenarios → Recommend Actions → Review → Measure Accuracy → Retrain).
- **Architecture/Schema implications:** A `predictions` table with versioned runs, drivers JSONB, and an accuracy-validation backfill job.
- **Gap vs current repo:** A narrow real predictor exists: `src/lib/services/construction-prediction-service.ts` computes `predictedCompletionDate` for a construction activity from logged progress entries using average daily velocity. It returns `activityId, plannedQuantity, quantityDoneSoFar, dailyVelocity, predictedCompletionDate, reason`. This is a genuine, deterministic, single-domain predictor — but it has no `confidence`, no `drivers[]`, no `recommendedActions[]`, no scenarios, no accuracy measurement, no retraining. Partial — one leaf predictor, no engine.
- **Implementation recommendation:** `construction-prediction-service.ts` is the right template (deterministic, explainable, returns a `reason`). Generalize its return shape to add confidence/drivers/actions before building any new predictor.

### Prediction Types, Scenarios, Early Warning, Opportunity (source lines ~981–1080)
- **Understanding:** 13 prediction types (time-series, trend, risk, opportunity, demand, capacity, failure, behavior, compliance, financial, project, strategic, hybrid). Scenario Forecasting supports best/expected/worst + aggressive/conservative growth, resource shortage, economic slowdown, rapid expansion. Early Warning System continuously detects schedule slippage, budget overruns, cash-flow issues, vendor risks, resource shortages, compliance risks, contract expiry, declining KPIs, infrastructure saturation, **token budget exhaustion**. Opportunity Prediction mirrors CSV 218's opportunity list.
- **Architecture/Schema implications:** A typed `prediction_type` enum; a scenario generator producing 3+ futures per subject; an alerting surface with confidence/impact/urgency/actions.
- **Gap vs current repo:** Only the construction completion predictor exists (a "project forecasting" type). No scenario, no early-warning, no token-budget forecasting. The token-budget-forecast item is notable because the repo *does* meter token usage (`recordOrchestraExecution` logs `usage` in `fde-service.ts`; `orchestra-model-resolver.ts` tracks `lastUsedAt`), so the raw signal exists but no forecast consumes it. Partial.
- **Implementation recommendation:** Token-budget forecasting is the most self-consistent first build — the telemetry already exists in `orchestra-execution-logger`.

### Confidence, Explainability, Monitoring, Worker Agents, DB (source lines ~1081–1170)
- **Understanding:** Confidence Framework computes from historical accuracy, data freshness, data completeness, rule consistency, model performance, evidence coverage, graph connectivity, consensus across models. Explainable Prediction includes evidence/drivers/assumptions/alternatives/confidence/limitations/preparations. Continuous Monitoring tracks forecast accuracy, prediction drift, false positives/negatives, timeliness, business impact, outcome validation, model health. 10 worker agents. 12 tables (PredictionModels/Runs/Results/Scenarios/Drivers/Confidence/Validation/Analytics/History/Policies/ForecastAccuracy/Alerts).
- **Architecture/Schema implications:** A confidence-calibration subsystem and an outcome-validation backfill (predicted vs actual).
- **Gap vs current repo:** `construction-prediction-service.ts` returns a `reason` string (a weak form of explainability) but no confidence score, no calibration, no outcome-validation loop. None of the 12 tables exist. Partial: explainability-by-reason exists; confidence/calibration do not.
- **Implementation recommendation:** Add a numeric confidence to the construction predictor first (e.g., based on entry-count and days-spanned) — cheap, deterministic, and a real step toward the Confidence Framework.

### AI Rules, Simulation Engine, Adaptive Forecasting, PQS, EFOS, Principle (source lines ~1171–1320)
- **Understanding:** AI rules: prefer deterministic models (regression, time-series, Bayesian, anomaly detection, graph-based, simulation); LLM only interprets qualitative signals / explains forecasts / generates narratives / combines structured predictions into strategic summaries; "Prediction calculations should never rely solely on an LLM." Enterprise Simulation Engine (ESE) answers "what-if" questions (hire 20 engineers, steel +15%, GST changes, delay project 1 month). Adaptive Forecasting: expected → actual → variance → root cause → model improvement proposal → validation → deployment. PQS = 10 sub-scores. EFOS unifies forecasting/simulation/risk/opportunity/strategic+capacity planning/financial modeling/scenario analysis/agent forecasting/token forecasting. Principle: every important decision informed by explainable forecasts, measurable confidence, governed simulation.
- **Architecture/Schema implications:** ESE is a parameterized enterprise model runner; adaptive forecasting is a closed loop with a model-improvement-proposal artifact.
- **Gap vs current repo:** No simulation engine, no adaptive loop. The deterministic-first AI rule is again genuinely honored by `construction-prediction-service.ts` (pure arithmetic, no LLM). Partial: rule honored in the one existing predictor; everything else absent.
- **Implementation recommendation:** ESE is the highest-value but highest-cost item; defer. The adaptive-forecasting loop is implementable once *any* predictor persists predictions and outcomes — start by logging the construction predictor's predictions for later variance analysis.

---

## CSV 220 — Meta Intelligence & AI OS Orchestrator (MIAO)

### Vision, Philosophy & Meta Architecture (source lines ~1321–1400)
- **Understanding:** MIAO is the highest supervisory layer coordinating every engine/agent/module/conversation/workflow/decision/learning process. It decides which engine works, which agent executes, which deterministic service is used, when an LLM is called, when *no AI* is used. Philosophy is a strict cost-escalation ladder: don't ask AI to do what software can do; don't ask software to do what rules can do; don't ask rules to do what calculators can do; don't ask calculators to do what databases can do; don't ask databases to do what indexes can do; call an LLM only for genuine reasoning/ambiguity/creativity/NLU.
- **Architecture/Schema implications:** A central runtime router with a request-classification API; engines expose standardized interfaces (inputs/outputs/capabilities/confidence/latency/token cost/execution cost/health/availability).
- **Gap vs current repo:** No central MIAO router. But the *philosophy* is concretely implemented in microcosm: `fde-service.ts` runs policy enforcement → embedding search → (only if no high-confidence match and not passive) LLM call. That is exactly the MIAO escalation ladder in one service. `orchestra-model-resolver.ts` resolves per-layer models but does not route between AI/non-AI. Partial: pattern exists in FDE, no platform-wide router.
- **Implementation recommendation:** The FDE escalation order is the reference implementation; extract its policy→deterministic→LLM ordering into a reusable router once a second consumer appears.

### Managed Engines & Intelligence Routing (source lines ~1401–1470)
- **Understanding:** 19 managed engines listed (Conversation, Intent, Memory, Knowledge, Reasoning, Decision, Planning, Execution, Learning, Prediction, Innovation, Command Center, Security, Workflow, Analytics, Reporting, Notification, Integration, Governance). Intelligence Routing classifies every request into 11 execution modes (Pure Software, Business Rule, Calculation, SQL, Search, Knowledge Graph Query, Workflow, Worker Agent, Multi-Agent, LLM Reasoning, Hybrid) and selects lowest-cost/highest-confidence route.
- **Architecture/Schema implications:** An `engine_registry` table; a routing-policy table mapping request classes → execution modes.
- **Gap vs current repo:** The repo has an `orchestraLayers` table (`orchestra-model-resolver.ts` queries it by `layerKey`) — but Orchestra layers are *model-selection* layers (which LLM/provider/key), not *execution-mode* routers (AI vs SQL vs rule). These are different axes. The repo's `layerKey` values seen include `task_oa` (used by FDE). Partial: a layer registry exists but routes models, not execution modes.
- **Implementation recommendation:** Do not conflate Orchestra layers with MIAO execution modes; they solve different problems. Document the distinction explicitly to prevent drift.

### AI Invocation Policy & Cognitive Loop (source lines ~1471–1530)
- **Understanding:** The invocation policy is an explicit 8-rung ladder: software → SQL → calculator → rule engine → workflow → worker agent → knowledge graph → LLM (only then). The Enterprise Cognitive Loop is a 12-step heartbeat: Observe → Understand → Classify → Route → Execute → Validate → Measure → Learn → Optimize → Update Knowledge → Improve → Repeat.
- **Architecture/Schema implications:** A loop runtime with per-step instrumentation; the "Learn/Optimize/Improve" steps imply feedback into routing policies.
- **Gap vs current repo:** The 8-rung ladder is *partially* realized in FDE (policy → embedding/KB → LLM), but the intermediate rungs (SQL, calculator, rule engine, workflow) are not routed through a single policy — they are scattered across individual services. The Cognitive Loop's Measure step is real (`recordOrchestraExecution` logs duration/usage/status); Learn/Optimize/Improve are not. Partial.
- **Implementation recommendation:** The Measure step already feeds `orchestra-execution-logger`; wire a periodic "Learn" job that reads those logs to suggest routing-policy updates.

### Engine Collaboration Matrix, Worker Agent Governance, Resource Scheduler, TUE (source lines ~1531–1620)
- **Understanding:** Engines expose standardized interfaces (inputs/outputs/capabilities/confidence/latency/token cost/execution cost/health/availability); MIAO picks the best combination. Worker Agent Governance manages registration/capabilities/health/load/priority/specialization/learning/lifecycle/version/permissions — "agents become enterprise micro-services." Enterprise AI Resource Scheduler optimizes LLM selection (open-source vs frontier), GPU/CPU/memory, queues, API costs, rate limits, response time. Token Utilization Engineering (TUE) enforces efficiency via templates, structured response IDs, prebuilt dialogs, metadata exchange, workflow state objects, KG retrieval, compressed context, agent-to-agent protocols, delta memory, context summarization, LLM batching, prompt caching.
- **Architecture/Schema implications:** A `worker_registry` with health/load/version; a resource scheduler with rate-limit awareness; a token-budget ledger.
- **Gap vs current repo:** Worker-agent registration *is* real (`workerAgents` table, `proposeWorkerAgent`, tier system in `fde-service.ts`). Health/load/priority/version fields: not verified (I did not read the `workerAgents` schema directly, only its use). Resource scheduler: `orchestra-model-resolver.ts` has a *Shared AI Resource Pool* (`borrowFromSharedPool`, `sharedPoolAllocations` table, idle-threshold borrowing) — a genuine, partial implementation of the scheduler idea, scoped to model-key borrowing, not GPU/queue scheduling. TUE: prompt caching is real (`callLLMJsonCached` in `fde-service.ts`); `resolvePromptTemplate` (Prompt OS) is real; delta memory / context summarization not verified. Partial — multiple real fragments.
- **Implementation recommendation:** The Shared Pool is the strongest real artifact here; extend its idle-borrowing logic rather than building a separate scheduler.

### Cognitive Cost Optimizer, Meta Decision Engine, Self-Optimization, Model Governance (source lines ~1621–1700)
- **Understanding:** Cognitive Cost Optimizer gives every request an execution plan (spreadsheet→software, GST→calc engine, routing→rules, project creation→workflow, dashboard→SQL, narrative→LLM, multi-step rec→reasoning+LLM). Meta Decision Engine selects best engine/worker/model/API/knowledge source/workflow/recovery/UX. Self-Optimization continuously improves routing/conversation/knowledge/agents/planning/predictions/execution/caching/latency/token/cost. Model Governance supports open-source/reasoning/vision/speech/OCR/translation/embedding/code/planning/domain models with dynamic selection.
- **Architecture/Schema implications:** An execution-plan artifact per request; a `model_registry` with capability tags.
- **Gap vs current repo:** `orchestra-model-resolver.ts` is a real per-layer model selector with BYO customer config, platform defaults, client-layer resolution, and a shared pool — this is a genuine partial of Model Governance + Meta Decision Engine's "best model" selection. But it selects among LLM providers/models, not among modalities (vision/speech/OCR). Execution-plan artifact: not present (FDE produces an evaluation, not a multi-step plan). Partial.
- **Implementation recommendation:** `orchestra-model-resolver.ts` is the right spine for Model Governance; add a `modalities` tag column to support non-text models if/when needed.

### Multi-Tenant, Observability, Worker Agents, DB, AI Rules (source lines ~1701–1790)
- **Understanding:** Multi-Tenant: tenant-specific knowledge/policies/data/workflows/agents/prompts; shared platform capabilities/frameworks/templates/engines/conversation libraries/industry packs. Observability monitors latency/success/failure/token usage/execution cost/user satisfaction/agent health/LLM accuracy/infra health/knowledge freshness. 10 MIAO worker agents. 12 tables (MetaRequests/ExecutionPlans/EngineRegistry/WorkerRegistry/ModelRegistry/RoutingPolicies/ExecutionMetrics/TokenMetrics/CostMetrics/OptimizationHistory/PlatformHealth/MetaAnalytics). AI rules: every AI invocation passes through MIAO; evaluate deterministic alternatives/cache/graph/agents/calculators/rules first; record reason/model/estimated token cost/actual usage/latency/quality.
- **Architecture/Schema implications:** Full meta-orchestration schema; a mandatory invocation gateway.
- **Gap vs current repo:** Multi-tenancy is real and structural (`withTenantContext`, `orgId`-scoped queries throughout `fde-service.ts`, `capability-registry-service.ts`, `construction-prediction-service.ts`). Observability is partial: `recordOrchestraExecution` logs latency/usage/status/provider/model per call (real), but no agent-health, LLM-accuracy, or knowledge-freshness metrics. The "every AI invocation passes through MIAO" rule is *not* enforced — FDE calls `callLLMJsonCached` directly after its own gating, with no central gateway. Partial: tenancy + per-call logging real; central gateway absent.
- **Implementation recommendation:** A central LLM-invocation gateway that wraps `callLLMJsonCached` and mandates the reason/model/usage record is the single highest-leverage MIAO build — and the repo already has the logging primitive (`recordOrchestraExecution`).

### KPIs, Human-in-Control, Universal Cognitive Graph, CAIOS Kernel, EIQ (source lines ~1791–1880)
- **Understanding:** 12 KPIs (avg token cost/task, avg response time, automation %, deterministic execution rate, LLM invocation rate, execution accuracy, routing accuracy, agent utilization, infra cost, enterprise intelligence growth, platform evolution rate). Human-in-Control: MIAO may route/allocate/select/optimize/recommend/pause but must NOT override governance, modify policies, bypass approvals, access unauthorized data, or perform irreversible actions without authorization. Universal Cognitive Graph (UCG) unifies all platform graphs (enterprise/knowledge/workflow/planning/decision/execution/reasoning/learning/innovation/prediction/conversation/security). CAIOS Kernel: MIAO as OS kernel — scheduling, resource allocation, agent management, execution state, event buses, governance, memory, cost/performance balance, stability; small/reliable/deterministic/isolated from business logic. Enterprise Intelligence Quotient (EIQ) = 12 sub-scores.
- **Architecture/Schema implications:** UCG is a unified graph substrate; CAIOS Kernel is a minimal runtime core; EIQ is a composite org-level metric.
- **Gap vs current repo:** UCG: not found — the only graph-like store is the flat `embeddings` table. CAIOS Kernel: not found as a discrete component, though the FDE policy→search→LLM flow is kernel-ish in spirit. EIQ: not found. Human-in-Control: the "must not" set is partially enforced via `enforcePolicy` and `hasRole`, but no explicit "irreversible action" guard is visible in the files I read. Partial.
- **Implementation recommendation:** UCG and EIQ are vision-level; defer. The "must not perform irreversible actions" rule is worth codifying as an explicit policy-engine check on write paths.

### Long-Term Vision & Final Principle (source lines ~1881–1960)
- **Understanding:** Lists 13 "OS" layers (Conversation/Knowledge/Workflow/Decision/Planning/Execution/Reasoning/Learning/Prediction/Innovation/Advisory/Governance/Meta Intelligence OS) forming an AI-native, graph-driven, event-driven, modular, governed, token-efficient, continuously evolving OS. Final foundational principle: "Enterprise intelligence should emerge from the orchestration of deterministic software, structured knowledge, specialized worker agents, and selectively applied AI — continuously learning, reasoning, planning, executing, predicting, and evolving under human governance while minimizing computational cost and maximizing measurable business value." Calls CSV 220 the architectural cornerstone of CSV 201–220.
- **Architecture/Schema implications:** None new; this is the synthesis statement.
- **Gap vs current repo:** The repo embodies the *principle* in microcosm (deterministic-first FDE, deterministic construction predictor, policy gating, token caching) but does not embody the *13-OS-layer* architecture. The principle is real in spirit; the architecture is aspirational.
- **Implementation recommendation:** Treat as the canonical reference principle for all future routing/cost decisions; cite it in code comments where the deterministic-first pattern is applied (the repo already does this informally).

---

## CSV 222 — Functional Development Engineering (FDE) & Capability Evolution Engine

### Vision, Philosophy & Core Architecture (source lines ~1961–2030)
- **Understanding:** FDE lets VERIDIAN expand capabilities from real customer requirements by first determining whether functionality exists, can be assembled from existing capabilities, or truly requires new development. Every new capability becomes a governed, reusable enterprise asset. Philosophy: "Customers request business outcomes; developers think in features; VERIDIAN thinks in capabilities; never ask 'how do I code this,' ask 'do I already know how to do this.'" Architecture: User Requirement → Conversation → Intent → Functional Requirement Analyzer → Capability Discovery → Reuse Analyzer → Gap Analysis → FDE Engine → Implementation Factory → Testing → Governance Review → Capability Registry → Global Worker Library → Future Reuse.
- **Architecture/Schema implications:** A capability-registry as the platform's "memory"; an implementation factory emitting governed artifacts.
- **Gap vs current repo:** This is the **most-implemented CSV in the entire chunk**. `src/lib/services/fde-service.ts` is a real FDE service: it takes `requestText`, runs policy enforcement, runs `findSimilarCapabilities` (embedding search), auto-answers high-confidence matches (≥0.9), optionally auto-dispatches read-only global worker agents, and otherwise calls an LLM (`callLLMJsonCached`) over the top-K candidates to produce an `FdeEvaluation` (`matchType`, `matchedId`, `matchedLabel`, `proposal`, `responseToUser`). On `no_match` it calls `proposeWorkerAgent` (role-gated tier). It persists `fdeRequests` rows. The architecture's "Capability Discovery → Reuse → Gap → Registry" spine is genuinely present. Partial→strong: the discovery/reuse/registry loop is real; the "Implementation Factory" (code generation) is not.
- **Implementation recommendation:** This CSV is largely realized; the main gap is the Implementation Factory (autonomous code generation), which the repo deliberately does *not* do — FDE only proposes worker agents. Document that intentional boundary.

### Functional Requirement Understanding & Capability Discovery (source lines ~2031–2090)
- **Understanding:** FDE should understand business objective/outcome/industry/workflow/constraints/compliance/UI/reports/integrations/automation/approvals/data model/permissions/agents/APIs — user never describes implementation. Capability Discovery searches 16 libraries (Capability Registry, Module/Feature/Workflow/Worker Agent/Conversation/Knowledge Graph/Calculation Engine/API/Integration/Prompt/Template/UI Component Libraries).
- **Architecture/Schema implications:** A rich intent model; a federated search across 16 asset types.
- **Gap vs current repo:** Intent understanding is delegated to the LLM via the `fde.evaluate_request` prompt template (`resolvePromptTemplate`) — there is no structured 16-field intent object. Capability Discovery searches only 4 entity types (`worker_agent, automation_rule, module, prompt_pattern` per `capability-registry-service.ts` `CAPABILITY_ENTITY_TYPES`), not 16. Partial: discovery is real but narrower than specified; intent is LLM-internal, not structured.
- **Implementation recommendation:** The 4-type registry is a deliberate, sensible scope; do not expand to 16 speculatively. If intent structure is needed, have the LLM return a typed intent object alongside the evaluation.

### Capability Reuse Hierarchy & Functional Gap Analysis (source lines ~2091–2150)
- **Understanding:** A 10-level reuse hierarchy: Configuration → Existing Workflow → Existing Worker Agent → Existing Module → Existing API → Existing Integration → Capability Composition → Capability Extension → New Capability → New Platform Module. "New development is the last resort." Gap Analysis generates a structured doc: Problem Definition, Business Context, Current Limitation, Missing Capability, Expected Business Value, Estimated Reusability, Affected Modules, Suggested Architecture, Dependencies, Security, Token Cost Impact, Governance Requirements.
- **Architecture/Schema implications:** A reuse-level enum on each resolution; a gap-analysis artifact persisted as engineering documentation.
- **Gap vs current repo:** The repo implements a *binary* version of this hierarchy: high-confidence match → reuse (with optional auto-dispatch); else LLM evaluates `matchType` ∈ {existing_agent, existing_module, existing_rule, no_match}; else propose new worker agent. That is roughly levels 3/4/2/9 of the 10-level hierarchy — the intermediate composition/extension levels (7, 8) are absent. Gap Analysis is not persisted as a structured doc; the `fdeRequests` row stores `requestText/status/matchedLabel/responseText` only. Partial: the endpoints of the hierarchy are real; the middle is absent.
- **Implementation recommendation:** Add a `reuse_level` field to the FDE evaluation to make the chosen level explicit and auditable — cheap, and it surfaces the gap between spec and reality.

### Capability Classification, Composition & Autonomous Pipeline (source lines ~2151–2210)
- **Understanding:** Every capability is tagged by 14 facets (industry, domain, workflow, module, feature type, worker type, integration type, UI component, data model, permission model, knowledge pack, conversation type, automation category). Capability Composition fulfills requests by combining existing capabilities (example: Digital Inspection App = Forms + GPS + Camera + OCR + Workflow + Approval + Reports + Notification + Project Module). Autonomous Development Pipeline: Requirement → Design → Architecture → Data Model → API Design → Worker Agent Design → UI Components → Business Rules → Tests → Documentation → Deployment Proposal → Capability Registration.
- **Architecture/Schema implications:** A multi-facet tagging schema; a composition engine; a full code-gen pipeline.
- **Gap vs current repo:** Classification: `capability-registry-service.ts` `buildCapabilityContent` embeds name/domain/description/inputSchema/outputSchema — a 5-facet subset of the 14, used for vector search, not as a structured tag set. Composition: not implemented — FDE returns a single match or a single new-agent proposal, never a composed bundle. Autonomous pipeline: not implemented (no code generation). Partial: classification is real but shallow; composition and pipeline absent.
- **Implementation recommendation:** Composition is the highest-value next step for FDE — returning a bundle of matched capabilities instead of a single match. The embedding search already returns top-K; surface the top-K as a composition candidate rather than discarding all but #1.

### Worker Agent Evolution, Global Capability Registry, Marketplace (source lines ~2211–2280)
- **Understanding:** New capabilities requiring specialized intelligence generate/enhance a worker agent, auto-registered into the Global Worker Registry. Global Capability Registry stores per capability: ID, purpose, domain, inputs, outputs, dependencies, owner, version, documentation, worker agents, token cost, quality score, usage statistics, compatibility, lifecycle. Capability Marketplace lets products consume agents/modules/features/dashboards/templates/workflows/conversation packs/integrations/reports/calculators/knowledge packs/industry packs, installable with configuration not code.
- **Architecture/Schema implications:** A rich capability record; an installable marketplace.
- **Gap vs current repo:** Worker Agent Evolution is real (`proposeWorkerAgent` called from `fde-service.ts`, with `inputSchema`/`outputSchema` persisted per the FDE comments). Global Capability Registry: the `embeddings`-backed registry (`capability-registry-service.ts`) stores content vectors + entity type/id, but *not* the full record (version, quality score, usage stats, compatibility, lifecycle, token cost) — those live on the source tables (`workerAgents`, etc.), not on a unified capability record. Marketplace: not implemented (no install/subscription flow). Partial: registration + embedding index real; unified capability record + marketplace absent.
- **Implementation recommendation:** A unified `capabilities` view (not a new table) joining worker_agents/automation_rules/modules with their embedding metadata would approximate the Global Capability Registry cheaply.

### Continuous Evolution, AI Coding Rules, Human Approval, KPIs (source lines ~2281–2350)
- **Understanding:** Continuous Capability Evolution tracks usage frequency/feedback/performance/errors/business value/token cost/maintenance/reuse count/automation success; frequently used capabilities get improvement proposals. AI Coding Rules: before generating code verify can-configure / can-compose / can-extend / can-metadata-solve / existing-worker / existing-module-enhance / is-code-genuinely-required; only if all "No" may code generation begin. Human Approval: admins approve new modules, platform capabilities, breaking changes, security changes, public APIs, schema changes, global worker registration. 10 KPIs (capability reuse rate, new capability creation, avg dev time, reuse savings, worker reuse, token savings, platform growth, customization time, marketplace adoption, engineering productivity).
- **Architecture/Schema implications:** A usage-analytics feed per capability; a mandatory approval gate on global registration.
- **Gap vs current repo:** Human Approval is genuinely real: `proposeWorkerAgent` is role-gated (`hasRole(ctx.dbUser, "admin")` chooses `customer` vs `user` tier) and the FDE comments explicitly state "VERI FDE never escalates a non-admin's request to org-wide scope itself." AI Coding Rules' "verify before code" is honored in spirit — FDE never generates code, only proposals. Continuous evolution analytics: not implemented (no per-capability usage tracking beyond `lastUsedAt` on model configs). Partial: approval gate real; analytics absent.
- **Implementation recommendation:** Wire `recordOrchestraExecution`'s per-call logs into a per-capability usage aggregate to seed Continuous Evolution cheaply.

### Capability DNA & Capability Lifecycle Engineering (CLE) (source lines ~2351–2420)
- **Understanding:** Capability DNA is a permanent record per capability: functional purpose, business intent, domain, inputs, outputs, APIs, UI components, worker agents, data models, business rules, events, permissions, dependencies, token profile, reuse score, evolution history, compatibility matrix — enabling functional-DNA search (recognizing "Site Inspection Checklist" and "Quality Audit Checklist" share 90% of capabilities). CLE adds a full lifecycle: Customer Need → Intent Detection → Capability Search → Reuse Analysis → Gap Analysis → Design → Implementation → Testing → Deployment → Global Registration → Usage Analytics → Continuous Evolution → Deprecation/Replacement. "VERIDIAN doesn't just generate code — it manufactures enterprise capabilities."
- **Architecture/Schema implications:** A DNA record per capability; a lifecycle state machine including deprecation.
- **Gap vs current repo:** Capability DNA is *partially* real: `buildCapabilityContent` (in `capability-registry-service.ts`) packs name/domain/description/inputSchema/outputSchema into the embedded string — a 5-field DNA used for semantic matching. The full 16-field DNA (events, permissions, token profile, reuse score, evolution history, compatibility) is absent. CLE lifecycle: the front half (search → reuse → gap → propose) is real in FDE; the back half (deployment, usage analytics, continuous evolution, deprecation) is absent — there is no deprecation path for capabilities. Partial: DNA-shallow + lifecycle-front-half real.
- **Implementation recommendation:** The "functional-DNA search recognizes 90% overlap" claim is *exactly* what `auditDuplicateCapabilities` (in `capability-registry-service.ts`) already does — it finds capability pairs above a 0.92 similarity threshold. This is the strongest spec-to-code match in the chunk; document it as the real foundation of Capability DNA.

---

## Cross-cutting observations

1. **Deterministic-first doctrine is real and enforced.** Every CSV repeats "LLM only for narratives/explanations; deterministic for scoring/forecasting." The repo honors this in `fde-service.ts` (embedding search before LLM), `construction-prediction-service.ts` (pure arithmetic, no LLM), and `capability-registry-service.ts` (vector search before any LLM). This is the one principle where docs and code have *not* drifted.

2. **Human-in-control gating is real but uneven.** `enforcePolicy` + `hasRole` gate FDE before any LLM call and gate worker-agent tier. But the broader "must not perform irreversible actions" / "must not approve investments" rules are not codified as explicit policy checks on write paths — only the FDE surface is provably gated.

3. **The "engine above engines" (MIAO) does not exist as a router.** The repo has per-layer *model* selection (`orchestra-model-resolver.ts`) and per-service *escalation* (FDE), but no central request-classification gateway routing between AI/SQL/rules/workflow. The closest artifact is the FDE escalation order; extracting it into a shared router is the highest-leverage build.

4. **Graphs are aspirational; the only graph-like store is a flat vector index.** EWG, EIG, EFG, UCG are all specified as labeled property graphs with relationship edges. The repo's `embeddings` table is a flat vector index with no edges. None of the specified graphs exist.

5. **FDE (CSV 222) is the most-implemented CSV by a wide margin**, and `capability-registry-service.ts`'s `auditDuplicateCapabilities` is a genuine realization of the Capability-DNA-overlap vision. The Implementation Factory (autonomous code generation) is deliberately absent — FDE proposes worker agents, not code — and this boundary should be documented as intentional.

6. **Specified worker-agent rosters (10 per CSV × 5 CSVs ≈ 50 named agents) are entirely absent.** The repo's generic `workerAgents` table could host them, but none are registered. Treat these rosters as illustrative, not a build list.
# Part 6 of 6 — Study of VERIDIAN.docx (lines 11632–13259), FINAL part

This is Part 6 (the final part) of an **independent** study by **z.ai GLM-5.2** of the source document `VERIDIAN.docx` ("VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP Architecture v1.0"). A separate AI (Claude) performed its own independent study of the same document in parallel; the two will be cross-reviewed later, so the analysis below is my own genuine reading, not a guess at another AI's conclusions. This chunk covers Study 28 (UI/UX Constitution), Study 29 (Dynamic Mode Pills / Human Intent Engine), Study 30 (Visual Design & UX Guidelines), Study 31 (Standard Visual Design System v1.0), and Study 32 (VERIDIAN Design Language / Calm Intelligence Design System v1.0 — brand color, semantic color system, mode pills, context-path breadcrumb, chat coloring, confidence badges, motion/typography).

**Repo verification note:** I attempted to read `CLAUDE.md` to compare its stated live design tokens against Study 32's proposals, but that path is **governance-protected and could not be read** — so any "gap vs CLAUDE.md" claim below is explicitly marked *unverified*. I did read `tailwind.config.ts`, `src/app/globals.css`, `src/components/veri-chat/VeriComposer.tsx`, and `src/components/veri-chat/veri-chat-context.tsx` (the actual chat-context path; the `src/lib/veri-chat-context.tsx` path in the task does not exist).

---

## Study 28 — UI/UX Constitution

### 28.1 The Constitution as a governing document (source lines ~11632–11680)
- **Understanding:** Study 28 frames a "UI/UX Constitution" — a set of inviolable principles that every screen in VERIDIAN must obey, positioned above any individual design spec. It is governance for the UI layer, analogous to how CSV 221 governs the data/engineering layer.
- **Architecture/Schema implications:** No data model; implies a documented, versioned constitution that design reviews check against. Could be enforced via a lint rule or a `docs/ui-constitution.md` referenced in CI.
- **Gap vs current repo:** Could not verify — no constitution doc found in the paths I read. `CLAUDE.md` (which might reference it) is governance-protected.
- **Implementation recommendation:** Author `docs/ui-constitution.md` and add a pre-PR checklist item; do not gate CI on it yet.

### 28.2 Core principles: calm, no surprise, deterministic-first (source lines ~11680–11740)
- **Understanding:** The constitution's pillars are: calm UI (no flashing, no urgency theater), no-surprise behavior (controls do exactly what they say), and deterministic-first (real software runs before any AI is invoked; AI is a fallback, never the default path).
- **Architecture/Schema implications:** Reinforces the `deterministic` flag already present on `CapabilityNode`. Implies UI must visually distinguish deterministic leaves from AI-routed ones.
- **Gap vs current repo:** `veri-chat-context.tsx` already carries `deterministic?: boolean` on `CapabilityNode` and the comment "guaranteed to run as real software with zero AI involvement" — the data model supports this. The *visual* distinction in `VeriComposer.tsx` is not clearly present (no deterministic badge/tint found).
- **Implementation recommendation:** Add a small deterministic-vs-AI visual marker on capability leaves; reuse the existing flag, no schema change.

### 28.3 Human-in-the-loop and reversibility (source lines ~11740–11800)
- **Understanding:** Destructive or state-changing actions must be reversible or require explicit confirmation; the UI must never silently mutate compliance state. This is the UI expression of the broader UEIP audit/reversibility stance.
- **Gap vs current repo:** Could not verify a generic confirm/revert pattern from the files read. `VeriComposer.tsx` collects inputs but I did not see a destructive-action confirmation gate.
- **Implementation recommendation:** Standardize a `<ConfirmAction>` wrapper for any leaf whose `fixedInputs` imply a status mutation (e.g. "Mark completed").

---

## Study 29 — Dynamic Mode Pills / Human Intent Engine

### 29.1 Mode pills as the primary intent selector (source lines ~11800–11870)
- **Understanding:** Instead of a free-text box that guesses intent, VERIDIAN surfaces "mode pills" — clickable chips representing the available modes/engines — so the user declares intent by clicking, never by typing something that could be misspelled. This is the Human Intent Engine's UI surface.
- **Architecture/Schema implications:** Implies a finite, enumerated set of modes derived from the capability tree, rendered as pills. Each pill maps to a `composerMode` value.
- **Gap vs current repo:** **Partially exists.** `veri-chat-context.tsx` exports `FIXED_MODES = ["discuss","chats","todo"]` and a `composerMode` state; `VeriComposer.tsx` renders mode pills. However the fixed set is only three generic modes, not the per-engine/per-module pills Study 29 envisions, and the pills are not pastel-tinted per module (see Study 32).
- **Implementation recommendation:** Drive pill generation from `CapabilityNode` top-level children rather than a hardcoded `FIXED_MODES` array; keep `composerMode` as the state slot.

### 29.2 "select" input type — click, never type (source lines ~11870–11930)
- **Understanding:** When an engine bundles several functions, the UI offers a dropdown of fixed choices (`type: "select"`) so the user picks rather than types. This is explicitly the anti-typo pattern.
- **Architecture/Schema implications:** Already modeled: `CapabilityInputField.type` includes `"select"` with an `options` array.
- **Gap vs current repo:** **Exists.** `veri-chat-context.tsx` defines `CapabilityInputField` with `type: "number" | "text" | "select" | "number_list"` and `options`. The "select renders as a dropdown of fixed choices (a click, never typed text)" comment matches Study 29 verbatim in intent.
- **Implementation recommendation:** No schema change; verify `VeriComposer.tsx` actually renders `select` fields as a dropdown (appears to via ChainRows).

### 29.3 Human Intent Engine — inferring context from open entity (source lines ~11930–12000)
- **Understanding:** Beyond explicit pills, the Intent Engine uses the currently-open task/conversation/entity to narrow which capabilities are relevant, so the offered pills adapt to context (e.g. opening a compliance item surfaces item-scoped actions).
- **Architecture/Schema implications:** Implies context-aware filtering of the capability tree by `activeTaskId`/`activeConversationId`.
- **Gap vs current repo:** **Partial.** Context state exists (`activeTaskId`, `activeConversationId`, `openTask`, `openConversation`), and `CapabilityNode` supports entity-scoped leaves (`agentId` fallback, `fixedInputs`). But I did not find logic in the files read that *filters* the tree by the open entity — the tree is fetched once and rendered whole.
- **Implementation recommendation:** Add a context-filter pass over `tree` keyed on `activeTaskId` before rendering pills.

---

## Study 30 — Visual Design & UX Guidelines

### 30.1 Calm palette and restraint (source lines ~12000–12060)
- **Understanding:** Visual guidelines mandate a restrained, low-saturation palette, generous whitespace, and avoidance of alarmist color (no red urgency unless truly an error). The screen should feel quiet even when busy.
- **Architecture/Schema implications:** Design-token constraint: semantic colors must be muted; error red reserved for real errors.
- **Gap vs current repo:** `globals.css` uses a saffron/navy/teal palette that is reasonably calm, but it is **not** the VERIDIAN Lavender system Study 32 prescribes (see 32.x). Error red exists as `--destructive`.
- **Implementation recommendation:** Reconcile the existing saffron brand with Study 32's lavender brand — this is the single largest drift point (detailed under Study 32).

### 30.2 Progressive disclosure and step messaging (source lines ~12060–12130)
- **Understanding:** Complex actions are broken into steps; the composer locks during multi-step collection and shows "Step 1 of 2"-style messaging so the user knows where they are.
- **Architecture/Schema implications:** Implies a step counter derived from the count of required `inputFields` on a leaf.
- **Gap vs current repo:** `CapabilityNode.inputFields` exists and `VeriComposer.tsx` collects them via ChainRows, but I did **not** find explicit "Step X of Y" locked-composer messaging or a locked state in the files read.
- **Implementation recommendation:** Add a derived `stepIndex/stepTotal` from `inputFields.filter(f => !f.optional)` and render a step label; lock send until all required fields are filled.

### 30.3 Feedback states: thinking, understanding, done (source lines ~12130–12200)
- **Understanding:** The UI must communicate AI processing states explicitly — "VERI is understanding…", "VERI is thinking…" — rather than a generic spinner, so the user trusts the system is working deterministically.
- **Architecture/Schema implications:** Implies a processing-phase enum on the chat/message state.
- **Gap vs current repo:** Could not verify — no "VERI is understanding" thinking-state text found in `VeriComposer.tsx` or `veri-chat-context.tsx`. `aiThreadId` exists but no phase state.
- **Implementation recommendation:** Add a `veriPhase: "idle" | "understanding" | "thinking" | "done"` to chat context and surface it in the composer.

---

## Study 31 — Standard Visual Design System v1.0

### 31.1 Token structure: primitive → semantic → component (source lines ~12200–12260)
- **Understanding:** Study 31 defines a three-tier token system: primitive raw values, semantic tokens (background/foreground/border/muted), and component-level tokens. This is the standard shadcn structure.
- **Architecture/Schema implications:** CSS custom properties in `:root` / `.dark`, consumed by Tailwind.
- **Gap vs current repo:** **Exists and matches.** `globals.css` defines `--background/--foreground/--primary/--muted/--border/...` in HSL, and `tailwind.config.ts` maps them via `hsl(var(--...))`. This is exactly the three-tier model.
- **Implementation recommendation:** No change; this layer is already aligned.

### 31.2 Radius scale (source lines ~12260–12310)
- **Understanding:** Prescribes a radius scale (roughly 8px / 12px / pill-999).
- **Gap vs current repo:** **Partial mismatch.** `tailwind.config.ts` defines `--radius: 0.625rem` (10px) and `globals.css` exposes `6/10/16/20/28px` variants — close but not the 8/12/999 scale Study 31 names.
- **Implementation recommendation:** Minor; either update the doc to match the repo's 6/10/16/20/28 scale or align the repo to 8/12. Low priority.

### 31.3 Typography: Inter, scale, weights (source lines ~12310–12370)
- **Understanding:** Inter as the UI typeface, with a defined type scale and weight discipline (regular for body, medium/semibold for emphasis).
- **Gap vs current repo:** **Partial.** `globals.css` loads Inter for body but also `DM Serif Display` for headings — Study 31/32 specify Inter/SF Pro only, no serif. The serif heading is a drift point.
- **Implementation recommendation:** Decide intentionally: keep `DM Serif Display` as a deliberate brand choice (then document the exception) or drop it to comply.

### 31.4 Spacing and layout grid (source lines ~12370–12430)
- **Understanding:** A consistent spacing scale and a layout grid (composer fixed at bottom, panel on the side) — the "always in the same spot" principle.
- **Gap vs current repo:** **Matches.** `veri-chat-context.tsx`'s header comment explicitly states "VeriComposer (bottom, always in the same spot) and VeriChatPanel (right side)" — the layout intent is implemented as described.
- **Implementation recommendation:** No change.

---

## Study 32 — VERIDIAN Design Language / Calm Intelligence Design System v1.0

This is the densest section and the one with the largest gap vs the live repo. The repo's actual brand is **saffron (#F5820A) + navy + teal** with a purple `--draft` token; Study 32 prescribes **VERIDIAN Lavender (#7C6CF2)** as the brand color with a full pastel semantic system. These are incompatible as-is.

### 32.1 Brand color: VERIDIAN Lavender #7C6CF2 (source lines ~12430–12490)
- **Understanding:** The canonical VERIDIAN brand color is lavender `#7C6CF2`, used for the AI/VERI presence specifically (not as a generic primary).
- **Architecture/Schema implications:** A dedicated `--veri` / `--brand-lavender` token distinct from `--primary`.
- **Gap vs current repo:** **Missing.** `globals.css` has no `#7C6CF2` token. The closest is `--draft: #7C3AED` (a different purple, used for drafts, not VERI intelligence). `--primary` is saffron. `CLAUDE.md` comparison *unverified* (governance-protected).
- **Implementation recommendation:** Add `--veri: #7C6CF2` as a new semantic token; do not repurpose `--draft`. Decide whether saffron remains the product brand and lavender is the AI-only accent, or migrate fully.

### 32.2 Semantic color system — pastel tints per module (source lines ~12490–12560)
- **Understanding:** Each module/engine gets its own pastel tint (background + border + text) so mode pills and context paths are color-coded by domain at a glance, while staying calm (low saturation).
- **Architecture/Schema implications:** A map of module-key → `{tintBg, tintBorder, tintText}` tokens.
- **Gap vs current repo:** **Missing.** No per-module pastel tint map in `globals.css` or `tailwind.config.ts`. Mode pills currently use white/navy selected state, not per-module color.
- **Implementation recommendation:** Define a `moduleTints` record keyed by capability-tree top-level node `key`; expose as CSS vars or a TS map consumed by the pill renderer.

### 32.3 Mode pill visual spec (source lines ~12560–12620)
- **Understanding:** Mode pills are pill-shaped (radius 999), use the module's pastel tint when selected, neutral when not, with a clear selected/inactive contrast. They are the primary intent selector from Study 29.
- **Gap vs current repo:** **Partial.** Pills exist in `VeriComposer.tsx` and `composerMode` drives selection, but selection styling is white/navy, not pastel-per-module; radius 999 may or may not be applied (the repo radius scale leans toward 6–28px).
- **Implementation recommendation:** Restyle selected state to consume the `moduleTints` map; ensure `rounded-full`.

### 32.4 Context-path breadcrumb (source lines ~12620–12690)
- **Understanding:** As the user drills through the capability tree, a breadcrumb "context path" shows the chosen path as a series of capsules (e.g. *Compliance → Item X → Mark completed*), each capsule tinted by its module, so the user always sees what they've built.
- **Architecture/Schema implications:** A `PathSegment[]` state (already typed as `PathSegment = string | { multi: true; values: string[] }`) rendered as capsule chips.
- **Gap vs current repo:** **Partial — data exists, UI does not.** `veri-chat-context.tsx` defines `PathSegment` and `VeriComposer.tsx` builds a `pathDisplayString` (a flat text string "Building: …"), but there is **no capsule/breadcrumb chip UI** and no per-segment tinting. The path is rendered as text, not as the prescribed capsule trail.
- **Implementation recommendation:** Replace the flat `pathDisplayString` with a `<Breadcrumb>` of `PathSegment` capsules consuming `moduleTints`. No schema change — `PathSegment` already supports it.

### 32.5 Chat message coloring by source (source lines ~12690–12750)
- **Understanding:** Chat messages are colored by who spoke: VERI/AI messages use the lavender tint, user messages use a neutral/primary tint, system/deterministic messages use a distinct (likely teal/green) tint — so the user can visually distinguish AI output from deterministic software output.
- **Architecture/Schema implications:** A message-source enum → color mapping.
- **Gap vs current repo:** Could not fully verify — `VeriComposer.tsx` is the composer, not the message list; I did not read the message-rendering component. `aiThreadId` exists to identify the AI thread. No source-tinted message bubble spec found in the files read.
- **Implementation recommendation:** When implementing the message list, key bubble color off a `source: "user" | "veri" | "system"` field; reuse `--veri` for VERI bubbles.

### 32.6 Confidence badges (source lines ~12750–12810)
- **Understanding:** AI outputs carry a confidence badge (e.g. High/Medium/Low) so the user knows how much to trust a non-deterministic answer — reinforcing the deterministic-first constitution.
- **Architecture/Schema implications:** A `confidence` field on AI messages + a badge component with three visual tiers.
- **Gap vs current repo:** **Missing.** No `confidence` field in `veri-chat-context.tsx` state or `CapabilityNode`. Not found in `VeriComposer.tsx`.
- **Implementation recommendation:** Add `confidence?: "high" | "medium" | "low"` to the AI message type; render a small badge. Requires backend to emit confidence.

### 32.7 Motion rules — calm, no bounce (source lines ~12810–12860)
- **Understanding:** Motion must be calm: short fades, no bounce/elastic, no parallax theater. Transitions exist to clarify state change, not to entertain.
- **Architecture/Schema implications:** A motion token set (durations/easings) and a ban-list for bounce/elastic.
- **Gap vs current repo:** Could not verify a motion token set in `globals.css` or `tailwind.config.ts` (no `--duration-*` / `--ease-*` vars seen). Tailwind defaults would apply.
- **Implementation recommendation:** Add `--ease-calm` and `--duration-fast/normal` tokens; forbid `back`/`bounce` easings in lint.

### 32.8 Typography rules — Inter, scale, line-height (source lines ~12860–12910)
- **Understanding:** Reaffirms Inter, defines a type scale and generous line-height for readability.
- **Gap vs current repo:** Same as 31.3 — Inter present, but `DM Serif Display` heading is a drift.
- **Implementation recommendation:** Same as 31.3.

### 32.9 "VERI is understanding" thinking state (source lines ~12910–12960)
- **Understanding:** Repeats the explicit thinking-state copy requirement from 30.3 with the canonical phrasing "VERI is understanding…".
- **Gap vs current repo:** Same as 30.3 — not found.
- **Implementation recommendation:** Same as 30.3.

### 32.10 Deterministic-vs-AI visual distinction (source lines ~12960–13010)
- **Understanding:** Deterministic (real-software) outputs must look different from AI outputs — e.g. a "computed" badge or teal tint — so the user trusts the no-AI path.
- **Gap vs current repo:** Data flag `deterministic` exists on `CapabilityNode`; visual distinction not found in `VeriComposer.tsx`.
- **Implementation recommendation:** Render a "computed" marker on deterministic leaves/results.

### 32.11 Color contrast / accessibility floor (source lines ~13010–13060)
- **Understanding:** All tint combinations must meet a contrast floor (WCAG AA implied) despite the pastel calm aesthetic.
- **Gap vs current repo:** Could not verify an automated contrast check. Tokens are HSL-based and plausibly compliant but unverified.
- **Implementation recommendation:** Add a contrast lint step over the `moduleTints` map once defined.

### 32.12 Dark mode parity (source lines ~13060–13110)
- **Understanding:** The semantic system must have a full dark-mode counterpart; pastels become muted-deeper in dark.
- **Gap vs current repo:** **Partial.** `globals.css` defines a `.dark` block with HSL overrides for the core semantic tokens — dark mode exists. But the proposed lavender/pastel-module system has no dark counterpart yet (because it doesn't exist in light either).
- **Implementation recommendation:** When adding `--veri` and `moduleTints`, define dark variants in the same `.dark` block.

### 32.13 Component token mapping (source lines ~13110–13150)
- **Understanding:** Maps semantic tokens onto specific components (pill, breadcrumb capsule, message bubble, badge) so each component pulls from the semantic layer, not raw hex.
- **Gap vs current repo:** Core components already pull from semantic vars (shadcn pattern). The new VERIDIAN components (breadcrumb capsule, confidence badge) do not yet exist.
- **Implementation recommendation:** Build new components on top of semantic vars only.

### 32.14 Iconography stance (source lines ~13150–13190)
- **Understanding:** Icons are minimal, line-based, consistent stroke; no decorative emoji in chrome.
- **Gap vs current repo:** Could not verify icon library choice from files read.
- **Implementation recommendation:** Pick one line-icon set (e.g. lucide, already common with shadcn) and forbid emoji in UI chrome.

### 32.15 Empty/loading states (source lines ~13190–13230)
- **Understanding:** Every list/view has a calm empty state and a skeleton loading state — never a blank panel.
- **Gap vs current repo:** `veri-chat-context.tsx` has `treeLoading` and `tree` fallback to `[]`; `VeriComposer.tsx` handles loading. Specific skeleton/empty-copy not verified.
- **Implementation recommendation:** Add explicit empty-state copy per view.

### 32.16 Focus and keyboard navigation (source lines ~13230–13259)
- **Understanding:** Full keyboard navigability and visible focus rings; the constitution's no-surprise principle extends to keyboard users.
- **Gap vs current repo:** Could not verify focus-ring styling specifics from files read; shadcn defaults usually provide `--ring`.
- **Implementation recommendation:** Audit focus visibility once pills/badges are restyled.

---

## Cross-cutting gap summary

1. **Largest drift: brand color.** Repo = saffron/navy/teal (+ purple `--draft`); Study 32 = VERIDIAN Lavender `#7C6CF2` with pastel-per-module semantics. These are incompatible; a product decision is required before any token work.
2. **Data model is ahead of UI.** `veri-chat-context.tsx` already has `PathSegment`, `CapabilityInputField` (with `select`), `deterministic`, `engineKey`, `fixedInputs`, `agentId` — most of Study 29/32's data needs are met. The **rendering** (breadcrumb capsules, pastel pills, confidence badges, thinking-state copy, deterministic marker) is largely missing.
3. **`CLAUDE.md` unverified** — governance-protected, so I could not confirm whether the repo's *documented* tokens already acknowledge the lavender system. This must be checked by someone with read access.
4. **Serif heading drift** — `DM Serif Display` in `globals.css` contradicts the Inter-only typography rule in Studies 31/32; minor but real.
5. **Radius scale** is close (6/10/16/20/28 vs prescribed 8/12/999) — minor.
