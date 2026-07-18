# PROGRESS -- task-20260718-055002-ai-architecture--performance---cost-effi

VERIDIAN Review Framework gap-closure: AI Architecture / Performance & Cost Efficiency (4 findings).

## Completed

- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` (no conflicting claim on this area) and registered this session's own claim before starting real work, per Rule 11.
- [x] Read the actual current implementation of `src/lib/llm-client.ts`, `src/lib/orchestra-execution-logger.ts`, `src/lib/loops/*`, `src/app/api/internal/loops/run/route.ts`, `src/app/api/help/ask/route.ts`, `src/lib/services/chat-service.ts`, `src/lib/structured-message.ts`, and `src/lib/orchestra-model-resolver.ts` before making any change (gap descriptions were 2026-07 era; codebase has moved since).
- [x] **[Medium] AI Latency** -- confirmed real gap: ~30 call sites of `callLLM`/`callLLMJson`/`callLLMVision`, each manually tracking (or, e.g. the pre-fix `api/help/ask/route.ts`, simply not tracking) its own `Date.now()` before/after. Fixed by instrumenting `callLLM`/`callLLMJson`/`callLLMVision` themselves in `src/lib/llm-client.ts`: every call now measures wall-clock time centrally (through any retries/fallback) and returns it as `LLMResult.durationMs`, with a new `LLM_LATENCY_SLA_MS` (8000ms) constant logged via `console.warn` on breach -- systematic and automatic for every caller, no per-site opt-in required. A breach only warns; it never truncates/fails an already-paid-for call. Updated the internal per-provider dispatch functions' return types accordingly, and `src/lib/llm-response-cache.ts`'s cache-hit branch to report `durationMs: 0` (no real call made).
- [x] **[Low] Cache Strategy** -- verified: Anthropic provider is fully wired (`llm-client.ts`'s `callAnthropic`, `orchestra-model-resolver.ts`'s `platformApiKeyFor("anthropic")`) but `ANTHROPIC_API_KEY` is unset, and every real call site (e.g. `prompt-eval-service.ts`) already degrades gracefully (`ServiceError`, no crash) when it's absent -- this is a genuine, already-handled honest limitation, not a bug. Per the finding's own recommended approach, this is an **owner-funding decision**, not a code gap -- **no code change made**; documented here instead of taking a unilateral action. Decision needed: fund a live `ANTHROPIC_API_KEY` (unlocks Claude models for org BYO config + the platform's own prompt-caching path, which today only exercises `callAnthropic`'s cache_control logic when an org supplies its own Anthropic key) or leave as-is.
- [x] **[Low] AI Cost Optimization** -- confirmed `MODEL_PRICING` (`llm-client.ts`) is still a manual, honest-limitation constant with no live billing API behind it. Added a new recurring audit, `src/lib/loops/model-pricing-audit.ts` (`runModelPricingAudit()`), piggybacked onto the existing daily `/api/internal/loops/run` cron (same non-canonical-loop pattern as `capability-index-freshness-audit.ts` -- not one of the 15 canonical `loop_definitions` rows, so no new `vercel.json` cron entry needed). Flags any `(provider, model)` pair with real, recent (30-day) token usage in `orchestra_executions` whose `costUsd` is still null across every one of its calls -- the concrete, checkable symptom of a missing `MODEL_PRICING` row (a real cost blind spot), since there's no live billing API to diff against instead.
- [x] **[Low] AI Context Compression** -- confirmed real gap: `src/app/api/help/ask/route.ts` called `callLLM` directly with none of `chat-service.ts`'s `generateAiReply()` pipeline (no `normalizeForLlm` -- the actual context-compression mechanism in this codebase -- no reply gate, no PII redaction, no `orchestra_executions`/prompt-cache observability at all; confirmed via `HelpWidget.tsx` that the UI renders `answer` as plain text with no structured-message rendering, so nothing there depended on the old shape). Wired in `normalizeForLlm`, `passesReplyGate`, `redactPii`, `recordOrchestraExecution` (with the now-centrally-tracked real `durationMs`), and the prompt-cache `compileStaticPrefix`/`recordPromptCacheMetric` pair -- additive, the widget's `{ question, currentPath } -> { answer }` contract is unchanged. Also added a try/catch around the LLM call (previously absent), matching chat-service.ts's own failure-handling posture instead of letting an uncaught exception 500 the route.
- [x] Verification: `bunx tsc --noEmit` clean (no new errors introduced; pre-existing `scripts/`/`*.config.ts` errors are unrelated missing @types/node, present before this change). `bun run lint`: 0 errors, 3 pre-existing warnings unrelated to these files. `bun test`: 1421 pass / 0 fail across 103 files (full suite).

## Remaining

- [ ] Owner decision on Cache Strategy finding (fund `ANTHROPIC_API_KEY` or accept the current honest limitation) -- not actionable by an agent, see note above.

---

## RESCUE TASK (task-20260718-185244-rescue-pr--420)

CI was failing on audit-check and Unit Tests as of PR open. Rescuing to get green + merged.

### Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no conflicting claim on this PR's file scope.
- [x] Checked out real PR #420 head branch.

### Remaining
- [ ] Merge origin/main into PR branch, resolve conflicts (PROGRESS.md -> keep ours).
- [ ] Check for drizzle/*.sql migrations (none expected per file list -- TIER1 candidate).
- [ ] Run bun install / tsc / lint / test locally, fix real failures.
- [ ] Push rebased branch.
- [ ] Read full diff, post AUDIT PASS/FAIL comment (required for merge per Rule 10).
- [ ] Wait for CI green.
- [ ] Classify tier and merge (TIER1) or stop (TIER2).
