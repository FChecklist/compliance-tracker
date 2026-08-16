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
