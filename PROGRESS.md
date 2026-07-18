# PROGRESS -- AI Architecture / AI Interaction Efficiency gap closure (11 findings)

Closing 11 related findings from the VERIDIAN Review Framework evaluation in one
coherent PR (all touch chat-service.ts / floor-tier-escalation.ts / the VERI Chat
composer surface). Read the current implementation first, per the dispatch's own
instruction, before writing any code -- see the per-finding disposition below.
(Note: this file's prior contents, about a live exchange-rate feed, belonged to an
already-merged task, PR #411 -- overwritten for this task.)

## Per-finding disposition

1. **[Medium] Detects repetitive AI tasks -- dynamic_chains dedup**: ALREADY
   RESOLVED. `capability-registry-service.ts`'s `CAPABILITY_ENTITY_TYPES` has
   included `"dynamic_chain"` as a 5th type since Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP),
   wired at `task-service.ts`'s `resolveDynamicChainId()`, covered by
   `findSimilarCapabilities()`/`auditDuplicateCapabilities()` with zero extra code,
   and has its own test (`capability-registry-service.test.ts`). No change needed.
2. **[Low] AI Clarification Minimization -- no metric**: real gap. Adding
   `detectClarificationRequest()` (chat-service.ts) + `conversations.clarificationRoundTrips`.
3. **[High] Personalized AI Responses -- confidence field dead code**: the specific
   premise (a dead `confidence` field already in the messages/conversations schema)
   doesn't match current code -- no such field exists on `messages`/`conversations`
   (only unrelated `confidence` columns on ingestion/extraction tables, all live).
   The underlying gap is real though (finding 7 confirms it independently): no
   confidence signal is ever computed or shown for a chat reply. Adding a real
   `messages.confidenceLabel` column, populated from floor-tier-escalation.ts's
   existing hedging-detection signal, honestly labeled as a heuristic proxy.
4. **[Low] Detects Repetitive AI Requests -- no compression strategy**: real gap.
   `buildConversationHistory()` already trims by char budget (oldest-first drop) but
   never compresses -- dropped turns are just gone. Adding a deterministic
   (no extra LLM call) summarization of dropped turns into one synthetic turn.
5. **[Medium] Measures AI Reduction Over Time -- Chain Selector not mandatory**:
   real gap, confirmed live: `ChainSelectorDialog` has a "Skip -- just start" button
   that silently omits modePill/pathKeys with zero signal a decision point even
   existed. `VERI_CHAT_GOVERNANCE.md` §5 / Priority 5 deliberately deferred a hard
   mandatory gate as "too big a live-surface UX change to rush" -- respecting that,
   NOT removing the skip option, but making the skip/resolve decision an explicit,
   required, recorded choice (`chainSelectorSkipped` column) instead of a silent
   default. Scoped to `createWorkflowThread()` only (the actual AI-thread creation
   path) -- not `createConversation()` (human-to-human threads, no chain concept).
6. **[Low] AI Chat-Based Help -- minor gaps only, N/A**: no separate action; covered
   by findings 3/7's confidence work.
7. **[High] AI Confidence Score -- never shown/computed**: same real gap as #3;
   confidence badge added to `ThreadView.tsx`'s message bubbles.
8. **[Medium] Communicates AI Limitations Honestly**: real gap -- no end-user-facing
   disclosure ever fires today. When `confidenceLabel` computes to `'low'`, `ThreadView.tsx`
   renders an honest inline notice under that message.
9. **[Low] Maintains Context Across Conversation -- no compression**: same as #4.
10. **[Medium] Uses Option Selectors Before AI Processing -- Chain Selector optional**:
    same as #5.
11. **[Low] Reduces AI Questions Through Structured Inputs**: real gap found --
    `RealAssistantColumn.tsx`'s task composer is free-text-only with zero structured
    input, unlike VeriComposer's ChainRows-driven dispatch. Adding a compact
    category/sub-category selector (reusing the same `/api/capability-tree` data)
    ahead of the free-text field, additive (blank selection = today's exact
    behavior). No separate free-text "approval creation" UI was found to exist
    (approvals are workflow/system-generated via `startApprovalWorkflow`, never
    manually free-typed) -- nothing to apply the pattern to there.

## Completed
- [x] Read governance docs (CONSTITUTION.yaml, ACTIVE-CLAIMS.yaml, AGENTS.md, CLAUDE.md)
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed + pushed separately
- [x] Read current implementation of all touched files before writing code
- [x] Migration `drizzle/0225_ai_interaction_efficiency_gap_closure.sql` + schema.ts:
      conversations.chainSelectorSkipped (bool, default false), conversations.clarificationRoundTrips
      (int, default 0), messages.confidenceLabel (text, nullable) -- all additive
- [x] floor-tier-escalation.ts: `deriveConfidenceLabel()` (honest hedging-based proxy,
      'high'|'medium'|'low') + 4 new unit tests
- [x] chat-service.ts: `detectClarificationRequest()` pure predicate; confidence
      labeling + clarification-round-trip counting wired into both
      `generateAiReply()` and `generateVeriGroupReply()`'s success paths;
      deterministic (no extra LLM call) context compression added to
      `buildConversationHistory()` via `summarizeOlderTurns()`;
      `createWorkflowThread()` now requires either a resolved chain or an
      explicit `skippedChainSelector: true`, scoped to that function only
      (not `createConversation()`'s human-to-human threads); `getMessages()`/
      `listConversations()` expose the new fields
- [x] chat-service.test.ts: 5 new tests for `detectClarificationRequest()`
- [x] API route: `workflow-thread/route.ts` passes `skippedChainSelector` through
- [x] Frontend: `ChainSelector.tsx` (`ChainSelectorResult.skippedChainSelector`,
      set in both `skip()` and `confirmWithChain()`), `veri-chat-context.tsx`
      (`createNewAiThread` 4th param + stale-comment fix), `VeriComposer.tsx`
      (`handleConfirm` passthrough + stale-comment fix)
- [x] `ThreadView.tsx`: confidence badge (labeled as a heuristic proxy via
      `title` tooltip) next to the VERI sender label + an honest inline
      disclosure notice under any message where confidence computed 'low'
- [x] `RealAssistantColumn.tsx`: compact 2-level category/sub-category
      `<select>` ahead of the free-text task field, reusing `/api/capability-tree`
      -- additive (blank selection = prior exact behavior), resolves through
      the same `chainPathKeys`/`validateChainDepth()` gate task-service.ts
      already enforces
- [x] Verify: `bun install`, `bunx tsc --noEmit` -- 0 errors. `bun run lint`
      -- 0 errors, 3 pre-existing warnings (litigation route, data-table,
      VeriComposer), none introduced by this change. `bun test` -- **1397
      pass, 0 fail**, 2730 expect() calls across 102 files (up from the
      pre-existing 1388/0 baseline by exactly the 9 new tests added: 4 in
      floor-tier-escalation.test.ts, 5 in chat-service.test.ts). Console
      noise during the run (APP_RUNTIME_DATABASE_URL warnings, "boom"/"db
      unreachable"/"simulated network failure" errors) is expected
      fail-closed logging from pre-existing unrelated tests exercising their
      own error paths, not failures. `bun run build` -- succeeds.

## Remaining
- [ ] None -- task complete. Not yet committed/pushed/PR'd.
