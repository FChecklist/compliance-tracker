# Prompt Template Directory

Closes the [Medium] "AI-Readable Prompt Documentation" finding (VERIDIAN Review Framework, AI
Documentation gap-closure, 2026-08-07, `UMR-20260801-170930-2080` sub-task).

**Scope note (important, read before extending this file):** the framework's finding text says
"complete the previously-scoped Prompt Directory build." That prior scope
(`docs/research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md` §3/§5) turned out to be a
**different feature** -- a chat-composer predictive-autocomplete UI (backend done, PR #50),
not a documentation surface for the platform's own prompt templates. This file does not build
that autocomplete UI (real, separate, multi-day product feature). It closes the actual
documentation gap: **`prompt_templates.description` is empty or generic auto-seeded boilerplate
for most rows** (confirmed: `scripts/generate-missing-prompt-templates.ts` writes the literal
string `"Auto-seeded v1 (Wave 172, area 4/9 prompt_templates gap-close)..."` for every AI Dev Team
role prompt, and no page lists what each template is actually for), and no catalog existed
mapping template key -> real call site -> real purpose.

## How this was built

Every `resolvePromptTemplate("<templateKey>")` call site in `src/` was found directly (not
assumed from a prior registry) and read in context. 26 distinct template keys found, excluding
the ~40 AI Dev Team role prompts (`ai-team/roster.ts`'s `promptKey` per role, seeded by
`scripts/generate-missing-prompt-templates.ts`) which are already self-describing via the
roster's own `title`/`team` fields -- cataloguing those here would duplicate `roster.ts`, not
add information.

Two adjacent, already-real mechanisms this directory complements rather than duplicates:
- **Where a template is used** is already answered live, not statically: `getPromptTemplateDependents()`
  in `src/lib/services/prompt-governance-service.ts` scans `src/` for real call sites on demand
  (governance UI, advisory-only). This file answers **why** each template exists instead.
- **What a template's live content is** is `promptVersions.content` in the DB, versioned and
  environment-labeled (`production`, etc.) -- this file does not restate prompt text, only purpose.

## Directory

| Template key | Call site | Purpose |
|---|---|---|
| `ai_team.ai_router` | `src/lib/ai-team/team-service.ts` `classifyTask()` | System prompt for the AI Router: classifies a free-text task description into an operational department role (Engineering, Data, Customer Setup, Customer Support, Sales & Marketing, Finance, HR, Admin, Quality & Safety, Legal & Compliance). |
| `asset_routing.classify` | `src/lib/services/asset-routing-engine.ts` | Classifies free text into an asset type + product module for routing (part of the `resolveModelConfig -> enforcePolicy -> resolvePromptTemplate` pipeline). |
| `chat.ai_thread_system` | `src/lib/services/chat-service.ts` | System prompt for a 1:1 AI chat thread; `{{PURPOSE_CLAUSE}}` is replaced per-org/domain before use. |
| `chat.veri_group_participant` | `src/lib/services/chat-service.ts` | System prompt for the AI participant inside a multi-user VERI Chat group conversation (distinct from the 1:1 thread prompt above). |
| `communication_drafting.draft` | `src/lib/services/communication-drafting-service.ts` | Drafts an outbound communication (email/notice/etc.) given a communication type, trigger, recipients, and free-text context. |
| `construction.describe_drawing` | `src/lib/services/construction-ai-service.ts` | Vision prompt: describes a construction drawing/photo (feeds the drawing-diff pipeline below). |
| `construction.detect_budget_schedule_risk` | `src/lib/services/construction-ai-service.ts` | Given real aggregated project dashboard + budget-vs-actual data, flags budget/schedule risk. |
| `construction.diff_drawing_descriptions` | `src/lib/services/construction-ai-service.ts` | Compares two drawing-revision descriptions (each produced by `construction.describe_drawing`) and summarizes the diff. |
| `construction.discuss` | `src/lib/services/construction-ai-service.ts` | Free-form construction-domain chat -- genuine open-ended user conversation, gated through the Policy Enforcement Engine (`enforcePolicy`, `user_assistant_oa` layer) same as VERI Chat/FDE/Page Agent. |
| `construction.estimate_progress_from_photo` | `src/lib/services/construction-ai-service.ts` | Vision prompt: estimates construction progress percentage from a site photo. |
| `construction.generate_progress_summary` | `src/lib/services/construction-ai-service.ts` | Turns a project's real dashboard data into a human-readable progress summary. |
| `crm_intelligence.analyze_opportunity` | `src/lib/services/crm-service.ts` | Analyzes a CRM opportunity; only the opportunity's own (user-authored) `name` field reaches the model, everything else is system-derived. |
| `crm_intelligence.score_lead` | `src/lib/services/crm-service.ts` | Scores a CRM lead; same narrow-user-input-surface discipline as the opportunity analyzer above (only `lead.name` is the injection/policy-checked text). |
| `document.extract_content` | `src/lib/services/document-extraction-service.ts` | Extracts structured content from an uploaded document (text or vision path, depending on MIME type). |
| `email_intelligence.detect` | `src/lib/services/email-intelligence-service.ts` | Classifies/extracts intelligence from an inbound email's subject + body. |
| `fde.evaluate_request` | `src/lib/services/fde-service.ts` | VERI FDE (Feature/Data/Engine request evaluator) -- VERIDIAN's highest-stakes free-text surface since it can propose new Worker Agents; policy-gated before the embedding search even runs. |
| `fm.register_digitize_extract` | `src/lib/services/fm-register-digitization-service.ts` | Extracts structured rows from a Facilities Management register during digitization, batched (`BATCH_SIZE = 80`) to fit LLM context limits. |
| `gst.ai_review_report` | `src/lib/gst/ai-review-report.ts` | Generates the AI-assisted review narrative for a GST return, over real reconciliation output (not a from-scratch AI computation -- see `ai-os/registry/BUSINESS-RULES-REGISTRY.md`'s GST rules for the deterministic layer underneath). |
| `help.ai_assistant_system` | `src/app/api/help/ask/route.ts` | Context-aware in-app help assistant. Note: this file's own seed SQL comment already states the description inline (`'Context-aware in-app help assistant'`) -- one of the few templates that was never generic boilerplate. |
| `instruction_mismatch.judgment` | `src/lib/loops/instruction-mismatch-audit.ts` | One of the 11 audit "loops" (`ai-os/system-tree/10-compliance-tracker-governance.yaml`): judges whether a user's real recorded activity matches an instruction/assignment given to them. |
| `loop_engineering.meta_synthesis` | `src/lib/loops/loop-engineering-audit.ts` | Another of the 11 audit loops: synthesizes findings across the loop-engineering audit run. Platform-level (no single org to attribute it to) -- deliberately not forced into a fake sentinel-org row, see the source comment. |
| `meeting_intelligence.extract` | `src/lib/services/veri-meeting-service.ts` | Extracts structured intelligence (action items, decisions, etc.) from a meeting's recorded minutes. |
| `sales_ai.funnel_analysis` | `src/lib/services/visitor-intelligence-service.ts` | Analyzes the 30-day visitor/lead funnel using the platform model config (not a per-org one -- this is platform-level sales intelligence, not a customer-facing feature). |
| `task_execution.planning_system` | `src/lib/task-execution-engine.ts` | The free-text AI task-planning system prompt -- the fallback path for any Chain Selector leaf without a real `codeReference`/`engineKey` (see `docs/master/CAPABILITY_COVERAGE.md`). Includes the live list of available worker agents in-context. |
| `ticket_intelligence.detect` | `src/lib/services/ticket-intelligence-service.ts` | Classifies/extracts intelligence from a support ticket's transcript. |
| `voice_ticket.extract` | `src/lib/services/voice-ticket-service.ts` | Extracts a structured ticket from a voice-originated conversation. |

## Maintaining this file

Not CI-enforced (unlike the other registries this pass added) -- deliberately, since a mismatch
here is a documentation-quality issue, not a build-breaking one, and the finding's own severity
is Medium, not High. When adding a new `resolvePromptTemplate("...")` call site outside the AI
Dev Team roster, add a row here in the same pass.
