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

## Remaining
- [ ] Wire `contextEntityType`/`contextEntityId` fetch (policy/pms_issue/project/
      veri_meeting) into generateAiReply()/generateVeriGroupReply()'s system prompt.
- [ ] Add org-glossary hook (glossary-service.ts's listGlossaryTerms) into the same
      system prompt.
- [ ] Add mode-pill vs free-text usage analytics: aggregate existing
      conversations.dynamicChainId / chainSelectorSkipped columns in
      adoption-metrics-service.ts, surface in AdoptionMetricsSection.tsx.
- [ ] Tests for all new pure functions.
- [ ] `bun test` green; open PR.
