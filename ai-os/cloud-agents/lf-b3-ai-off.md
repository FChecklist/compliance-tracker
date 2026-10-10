# Package lf-b3-ai-off (backend, repo compliance-tracker)

Branch `claude/lf-b3-ai-off` from `origin/feat/lf-sync-backend`. No migration.

## Goal (owner: "the user's own AI, never ours"; zero LLM cost)
PROJEXA must not call ITS OWN AI models. An outside AI works through the AI work link; the in-app model lanes are switched OFF behind one flag, default OFF, with a plain "use your own AI" answer. Deterministic paths (Level 0 phrase/pill resolution, codeReference/pill functions, the AI link, templates) keep working exactly as they do.

## Find every model call site in compliance-tracker
`src/lib/pipeline/level1.ts` `runLevel1` (OpenRouter), `src/lib/ai/providers/openrouter.ts`, `src/lib/ai/llm-client.ts` (`callLLM`, `callLLMJson`, `callLLMVision`), `src/lib/embeddings.ts` (OpenRouter/Groq embeddings), `src/lib/services/construction-ai-service.ts` (discuss, progress summary, risk narrative, photo progress, drawing diff), `src/lib/services/veri-meeting-service.ts` (minutes), `src/lib/services/report-engine-service.ts` (`ai_recipe` reports), the `crr/` and cron/worker paths.
Earlier analysis: the single Level-1 chokepoint is `effectiveLevel1()` in `src/lib/pipeline/run-submission.ts` (`RunSubmissionInput.level1` 'internal' | 'off', already used by the MCP link route via `level1OffRunner`); `ConfirmSubmissionInput` has no `level1` field so the env check belongs INSIDE `effectiveLevel1`; `classifyOnly` (`src/lib/pipeline/classify-only.ts`) calls `runLevel1` directly. The DPDP precedent: `src/lib/dpdp-internal-ai.ts` `dpdpInternalAiEnabled()` (strict `=== '1'`, default off) and `src/app/api/dpdp/internal-ai-off.test.ts`.

## Build
1. `src/lib/projexa-internal-ai.ts` exporting `projexaInternalAiEnabled()` (env `PROJEXA_INTERNAL_AI_ENABLED` strictly '1'; unset or anything else = OFF) and `USE_YOUR_OWN_AI` (the one plain-words message: PROJEXA does not run its own AI; open your own AI assistant and paste your PROJEXA AI link; the buttons and menus still work) plus the refusal shape the existing UI already renders (read how PROJEXA shows `d.error` and `chatMessages`: the projexa repo is cloned: `src/components/shell/M24Shell.tsx` around the submit handlers and `src/components/veri-chat/VeriComposer.tsx`; the proxy-only alternative is HTTP 403 `{error, code:null}`; choose the shape that needs no UI change and say why).
2. Gate every model call site above behind it. Level 1 off => a Level-0 miss yields the normal gap verdict BUT with the USE_YOUR_OWN_AI wording instead of "not enabled for this workspace yet"; discuss / progress-summary / photo / diff / minutes / `ai_recipe` / embeddings => the refusal (embeddings: fall back to the existing deterministic hash pseudo-vector path so search degrades instead of failing; document it); the two construction functions that today reach a model but have deterministic fallbacks (`detect_construction_budget_schedule_risk` -> `templateBudgetScheduleRisk`) must use the template when off.
3. A test per call site: flag unset -> the model client/provider is NEVER invoked (spy), the answer is the refusal or the deterministic fallback; flag '1' -> the old behaviour is unchanged.
4. The cron/worker paths that call a model must also be silent when off (list them).
5. Docs: `ai-os/PROJEXA_AI_OFF.md` listing every call site, its off-behaviour and how to switch it on (an owner/PM switch, never done by you).

## Acceptance
With `PROJEXA_INTERNAL_AI_ENABLED` unset, an architecture test (bun test) proves no module outside the gated wrappers imports the provider / llm client functions directly (it fails if a new ungated call site is added). All existing tests that touch these modules still pass (run the pipeline, ai and services tests you touch).
PLANT: the flag ignored in `effectiveLevel1`; a call site left ungated (the architecture test must catch it).
