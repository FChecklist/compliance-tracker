# PROGRESS -- task-20260718-053002-ai-architecture--explainability---transp

VERIDIAN Review Framework: AI Architecture / Explainability & Transparency (26 findings).
Grounded every finding against the CURRENT codebase (2026-07-18) before writing code -- see
"Ground-truth notes" at the bottom for where the original gap description no longer matched
reality. One coherent PR: a new shared explainability layer + targeted application to the
real call sites that already produce AI/engine/report output, not 26 separate changes.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS.yaml, CONSTITUTION.yaml) and registered claim
- [x] Ground-truthed all 26 findings against current code (report-engine-service.ts,
      crm-service.ts, ServiceError, llm-client.ts/chat-service.ts, engines/*,
      high-impact-action-detector.ts, orchestra-execution-logger.ts, help/ask route,
      embeddings.ts, knowledge-base-service.ts, ai-reply-gate.ts, task-prediction-service.ts)

### Shared infrastructure
- [x] `src/lib/errors/error-catalog.ts` -- ERROR_CODES lookup table (friendlyMessage +
      remediationSteps), `ServiceError` extended (compliance-service.ts) with optional
      code/friendlyMessage/remediationSteps + `serviceErrorBody()` helper. Applied to
      compliance-service.ts/crm-service.ts throw sites + compliance API routes as a real,
      working sample (see ground-truth notes for why not all ~683 route catch blocks).
- [x] `src/lib/explainability/ai-decision-explanation.ts` -- generic `AiDecisionExplanation`
      type (summary/reasoning/confidence/recommendedAction/rejectedAlternatives/assumptions/
      businessImpact) + converters (explainCrmLeadDecision/explainCrmOpportunityDecision/
      explainTaskPrediction)
- [x] `src/components/ai/AiDecisionExplanationCard.tsx` -- shared UI component (extracted
      ReportDefinitionRunner.tsx's note/narrative rendering pattern, generalized); wired into
      the CRM page via a "Why?" toggle + new `/api/crm/{leads,opportunities}/[id]/explain` routes
- [x] `src/lib/engines/types.ts` -- shared `EngineResult<T>` type (explanation required,
      assumptions + steps optional)

### Applied
- [x] crm-service.ts: scoreLead/analyzeOpportunity request + store
      rejectedAlternatives/assumptions/confidence (migration 0225, prompt versions bumped)
      and expose via `explainCrmAiDecision()`
- [x] task-prediction-service.ts: `explainTaskPrediction()` converter, surfaced as an
      additive `explanation` field on GET /api/tasks/[id]/prediction (tasks case of "apply to
      approvals/tasks" -- see ground-truth notes for why approvals is not touched)
- [x] accounting-engine.ts / analytics-engine.ts: additive `verifyBalancesNetToZeroExplained()`
      / `analyzeTrendExplained()` returning `EngineResult<T>` with a real intermediate-steps
      trace; task-execution-engine.ts's balance_verification_engine/trend_analysis_engine
      dispatch cases wired to the explained variants (only real callers, confirmed via grep;
      safe because that dispatch's output is only ever JSON.stringify'd + sanity-checked by
      assertValidDispatchOutput, which tolerates any nested shape)
- [x] report-engine-service.ts: `runAggregationFromConfig()` always returns a generated
      `note` (`buildAggregationNote()`) describing table/grouping/aggregation/filters --
      closes the 110/204 (54%) report rows that previously returned zero explanation
- [x] purpose-bound-ai.ts: `buildUserContextBlock()` + chat-service.ts wired to prepend it to
      the per-call message sent to the LLM (NOT the cached system prompt -- see ground-truth
      note on why, to avoid silently defeating the Prompt & Cache Management Framework)
- [x] high-impact-action-detector.ts: broadened HIGH_IMPACT_CATEGORY_GUIDANCE from 9 to 12
      categories (bulk_operations/communication_send/financial_posting) + new
      `logHighImpactClassification()` sample-audit logging (matched or not), wired into
      task-service.ts's real createTask gate
- [x] orchestra-execution-logger.ts: added optional `routingRationale` column (migration
      0225), populated at chat-service.ts's escalation decision; surfaced on request via
      `getOrchestraExecutionRationale()` + `GET /api/orchestra/executions/[id]`
- [x] embeddings.ts pattern reused: knowledge-base-service.ts indexes KB pages on
      create/update (storeEmbedding); help/ask/route.ts retrieves relevant chunks before
      answering (retrieveRelevantKbPages, RAG), returns `sources` (rendered in HelpWidget.tsx);
      `resolveLinkedKnowledgeBasePages()` resolves dynamic_chains.linkedKnowledgeBasePageIds
      into readable content wherever a chain has them set
- [x] Glossary: `business_terminology_glossary` table (migration 0225, seeded with 10 real
      platform terms) + glossary-service.ts + `/api/glossary` (+`/[id]`, `/lookup`) routes +
      `GlossaryTermTooltip` component, wired into the CRM page's "win" label
- [x] Unit tests: error-catalog, ai-decision-explanation, accounting-engine/analytics-engine
      explained variants, report-engine-service's buildAggregationNote, 4 new
      high-impact-action-detector categories (46 new test assertions total, all passing)
- [x] `bunx tsc --noEmit` clean, `bun run lint` clean (0 errors, 3 pre-existing unrelated
      warnings), `bun test` -- **1452 pass, 0 fail**, 2871 expect() calls across 107 files
- [x] Confirmed `src/lib/services/permission-service.ts` untouched, no overlap with other
      ACTIVE-CLAIMS.yaml entries

## Remaining
- [ ] Move this session's ACTIVE-CLAIMS.yaml entry to `recently_completed:` once this PR
      merges (left in `active:` until then, per that file's own protocol)
- [ ] Not done, documented as deliberately out of scope this pass (see ground-truth notes):
      full rollout of ServiceError's friendlyMessage/remediationSteps to the other ~670 API
      route catch blocks beyond the representative sample touched here -- mechanical,
      high-volume, high-collision-risk with other in-flight workers' route-file edits

## Ground-truth notes (gap descriptions that didn't match current code, or scope decisions made while implementing)
- CRM AI pattern already covers **both** leads and opportunities, not "confined to
  opportunities" as one finding claimed (crm-service.ts scoreLead + analyzeOpportunity).
- `llm-client.ts` is a pure provider-transport client with zero prompt-assembly logic --
  the finding asking for a "system prompt assembly" personalization block in that file
  doesn't match reality. Real assembly point is chat-service.ts (template + purpose
  clause).
- Personalization is deliberately NOT appended to chat-service.ts's `systemPrompt` string
  itself -- that exact string is what the Prompt & Cache Management Framework (Phase 1,
  prompt-cache/compiler.ts) treats as one static cache_control block shared across every
  user in an org/domain (confirmed in llm-client.ts's callAnthropic: the whole system
  string becomes one cacheable block). Personalizing it per-user would silently defeat
  that caching for every call -- a real cost/latency regression. Instead
  `buildUserContextBlock()` is prepended to the per-call user message (which already
  varies every call), leaving the cached system prompt and the orchestra_executions
  "what was actually asked" log (Wave 144's stated intent) both untouched.
- General chat-level AI-reply confidence (`ai-reply-gate.ts`'s `aiReplyEnvelopeSchema.
  confidence`) is dead/unused -- populating it requires the structured-JSON-reply rewrite
  that Phase 3 (Phase3_Design_by_Claude.md) explicitly deferred as a large, separate,
  documented decision ("OUT OF SCOPE for this pass... would risk breaking the one
  AI-facing feature that's currently live"). Not reopened here; confidence is instead
  wired through the new AiDecisionExplanation pattern (CRM, task prediction), which is
  the finding's own stated remedy ("same as parameter 32/45").
- No AI-driven approval-recommendation feature exists anywhere in the codebase today
  (approval_workflow_* tables are pure human/RBAC workflow, no LLM call site touches
  them) -- "apply [AiDecisionExplanation] to approvals/tasks" is only half-applicable;
  applied it to tasks (task-prediction-service.ts) for real, documenting the approvals
  half as nothing-to-extend rather than inventing a new AI feature just to check a box.
- `dynamic_chains.linkedKnowledgeBasePageIds` is genuinely schema-only (confirmed no
  write site populates it automatically) -- did not build automatic derivation (a
  separate, larger routing feature); the new KB retrieval helper is reused so a chain's
  linked pages *can* be resolved into readable content wherever `linkedKnowledgeBasePageIds`
  is set, which is the realistic scope of "extend the same knowledge-explainability fix."
- `ServiceError` friendlyMessage/remediationSteps: ~683 API route catch blocks currently
  do `if (error instanceof ServiceError) return { error: error.message }`. Rewriting all
  683 in one PR would be a huge, high-collision-risk mechanical change touching files many
  other in-flight workers (per ACTIVE-CLAIMS.yaml) are actively editing. Shipped the
  shared type + catalog + helper, applied it to a representative real sample (compliance
  + CRM), and left full rollout as documented follow-up rather than a fabricated "done".
- Engines: only 2 of ~100 engine functions across `src/lib/engines/*` got an `*Explained()`
  variant (the 2 with a real, confirmed single caller in task-execution-engine.ts). Changing
  every engine's own return shape was avoided as a much larger blast radius than this
  gap-closure pass justifies -- `EngineResult<T>` (src/lib/engines/types.ts) is the
  sanctioned shape for new engine work and additive `*Explained()` variants going forward,
  not a claim that all engines were migrated.
