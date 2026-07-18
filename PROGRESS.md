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
- [x] Merged origin/main into PR branch. Conflicts: PROGRESS.md (kept ours), ai-os/boss/ACTIVE-CLAIMS.yaml (both sides additive list entries, kept both).
- [x] Confirmed no drizzle/*.sql or src/lib/db/schema.ts changes anywhere in the merged diff -- TIER1.
- [x] `bun install --frozen-lockfile`, `bunx tsc --noEmit` (clean), `bun run lint` (0 errors, 3 pre-existing unrelated warnings), `bun test` (1477 pass / 0 fail across 106 files). No real bugs found -- code was already correct.
- [x] Root-caused original CI failures: audit-check failed only because no AUDIT comment existed yet; Unit Tests failed on a pre-existing documented flake (tenant-isolation.test.ts mock.module leak, CI-order-dependent) already fixed on main before this merge -- confirmed via 0 reproductions in the full local suite post-merge.
- [x] Pushed merged branch to `worker/task-20260718-055002-ai-architecture--performance---cost-effi`.
- [x] Read the full PR diff myself; posted a structured `AUDIT: PASS` comment (all 8 audit-protocol.ts fields).
- [x] Watched CI on the pushed commit go green: all 7 required branch-protection checks pass (Lint, Type Check, Build, audit-check, Guardrail Presence Check, Asset Registry Coverage Check, Unit Tests). Only non-required check to fail: Vercel preview (build-rate-limited).
- [x] Moved this PR's ACTIVE-CLAIMS.yaml entry from `active:` to `recently_completed:`.

### Remaining
- [ ] Merge PR #420 (`gh pr merge 420 --squash --delete-branch`) now that TIER1 + CI green + audit PASS are all confirmed.
