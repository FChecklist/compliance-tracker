# PROGRESS -- task-20260720-022708-superboss-v2-plan--shared-cross-repo-pro

## Completed
- [x] Read governance: ACTIVE-CLAIMS.yaml (collision check), veridian-ui-kit repo, both repos' prompt-construction sites, src/lib/ai-router/, roster.ts, prompt-os-resolver.ts, llm-client.ts, policy-enforcement-engine.ts, orchestra-execution-logger.ts
- [x] Registered ACTIVE-CLAIMS entry (committed + pushed on its own, per Rule 11 protocol) — branch `worker/task-20260720-022708-superboss-v2-plan--shared-cross-repo-pro`
- [x] KEY FINDING (recorded in claim + here per task's "doesn't match the code" clause): projexa has ZERO prompt-construction code (no systemPrompt, no LLM-provider imports — every AI call proxies to compliance-tracker's `/api/v1/projexa/*` via `veridian-client.ts`). So there is NO live cross-repo prompt divergence to fix; projexa cannot diverge because it constructs no prompts. The real duplication is WITHIN compliance-tracker: ~30 call sites each hand-write the same 6-step sequence (resolveModelConfig → buildUserMessage → resolvePromptTemplate → enforcePolicy → callLLM/callLLMJson → recordOrchestraExecution).

## Remaining
- [ ] Build shared module `@fchecklist/veridian-ui-kit/prompt-patterns` (new server-safe export path, zero UI deps): `src/prompt-patterns/{index,types,runner,catalog}.ts` + tests + README section + package.json exports entry + git tag — PR in FChecklist/veridian-ui-kit
- [ ] Adopt at one call site in compliance-tracker (ticket-intelligence-service.ts) as proof + bump dep tag — PR in FChecklist/compliance-tracker
- [ ] Projexa adoption: wire shared module as dep + ADR note (no prompt-construction site exists to adopt at; honest per finding) — PR in FChecklist/projexa
- [ ] Tests green; self-merge Tier1 PRs once CI green
- [ ] Re-score CSV row #60; move ACTIVE-CLAIMS entry to recently_completed
