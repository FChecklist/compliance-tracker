# PROGRESS -- task-20260726-171946-chat-context---terminology---mode-pill-a

V2-13-CHAT-CONTEXT-ANALYTICS -- Chat context + terminology + mode-pill analytics.
Claim registered in `ai-os/boss/ACTIVE-CLAIMS.yaml`.

## Completed
- [x] Re-verified live repo state: `contextEntityId`/`contextEntityType` (conversations
      table) plumbed by veri-chat-service.ts/veri-meeting-service.ts but never read in
      chat-service.ts's generateAiReply()/generateVeriGroupReply(). Glossary feature
      (glossary-service.ts) is UI-tooltip-only, no system-prompt hook. No mode-pill vs
      free-text analytics anywhere. Confirms 2026-07-26 triage evidence still accurate.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (collision-checked against
      `gh pr list --state open` and existing active claims -- no overlap).
- [x] Wired `contextEntityType`/`contextEntityId` fetch into the AI reply prompt:
      chat-service.ts gained `fetchContextEntitySummary()` (real DB fetch, best-effort,
      known types: policy/pms_issue/project/veri_meeting; unknown/internal types like
      `shared_in_inbox` are an honest no-op) + `formatContextEntityBlock()` (pure
      formatter). Wired into both `generateAiReply()` (1:1 AI thread) and
      `generateVeriGroupReply()` (group @veri mentions) via a new
      `ConversationContextRef` parameter; `sendMessage()`/`regenerateAiReply()` pass it
      through from the conversation row they already fetch (no extra query).
      Verification: `grep -n "contextEntityId" src/lib/services/chat-service.ts` now
      shows it consulted inside fetchContextEntitySummary (called from
      generateAiReply/generateVeriGroupReply), not just plumbed at the write side.
- [x] Added an org-glossary hook into the same system prompt: `formatGlossaryBlock()`
      (pure, char-budget-capped at 2000 chars so a large org glossary can't silently
      balloon token cost) + a `listGlossaryTerms()` call (glossary-service.ts, already
      existed for the UI hover-tooltip -- reused, not duplicated), appended to the
      static system prompt before `compileStaticPrefix()` so prompt-cache fingerprinting
      still reflects exactly what's sent.
- [x] Added mode-pill vs free-text usage analytics, reusing existing infra (no new
      analytics vendor): `computeModePillUsageRate()` (pure) + one new aggregation
      query in `adoption-metrics-service.ts`'s `computeOrgAdoptionMetrics()`, counting
      `conversations.dynamicChainId IS NOT NULL` (mode-pill used) vs
      `conversations.chainSelectorSkipped = true` (explicit free-text skip -- only ever
      set by createWorkflowThread()'s Chain Selector gate, so it never conflates with
      conversation flows where that gate was never offered). Surfaced through the
      existing AdoptionMetricsSection.tsx dashboard (new "Mode-Pill Usage" stat tile) --
      no new UI page, no new vendor.
- [x] Tests: new pure-function tests in chat-service.test.ts
      (formatContextEntityBlock/formatGlossaryBlock, all 4 entity types + null/empty/
      budget-cap edge cases) and a new adoption-metrics-service.test.ts
      (computeModePillUsageRate: null-when-undecided, 0%, 50%, 100%, rounded mixed).
- [x] `bun install` + `bunx tsc --noEmit -p .` clean (0 errors) + `bun test`: 2043 pass,
      0 fail (full suite, includes the 35 new/updated tests in the two touched files).
- [x] No schema/migration change -- all columns used
      (dynamicChainId/chainSelectorSkipped/contextEntityType/contextEntityId/
      businessTerminologyGlossary) already existed. Tier1, additive-only.

## Remaining
- [ ] None for this task's three sub-asks. Left for reviewer/CI: PR open, not
      self-merged (per this task's own constraint).
