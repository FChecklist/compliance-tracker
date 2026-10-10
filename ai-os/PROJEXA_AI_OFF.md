# PROJEXA internal AI: OFF by default

Package `lf-b3-ai-off`. Owner's order (2026-10-02): "the user's own AI, never ours". Priority: **cost near zero first**, ease of work second, security third.

PROJEXA does not call its own AI models. The user's own AI assistant does the AI work through the **AI work link**, and that user's AI vendor bills them. The in-app model lanes are switched off behind one flag. While they are off, the user gets one plain answer:

> PROJEXA does not run its own AI. Open your own AI assistant and paste your PROJEXA AI link. The buttons and menus still work.

(`USE_YOUR_OWN_AI` in `src/lib/projexa-internal-ai.ts`.)

The deterministic paths keep working exactly as before:
- Level 0 phrase and pill resolution
- the reuse cache and the phrase-fuzzy tier
- the codeReference and pill functions
- the AI work link itself
- the templates (for example the budget/schedule risk template)

## The switch

| | |
|---|---|
| Variable | `PROJEXA_INTERNAL_AI_ENABLED` |
| On | exactly `1` |
| Off (default) | unset, empty, `0`, `true`, `yes`, ` 1`: anything that is not exactly `1` |
| Where it is read | at call time, by `projexaInternalAiEnabled()` (Next.js side) and `chooseModel()` in `supabase/functions/projexa-document-extract/wiring.ts` (Edge side, from the Edge Function's own environment) |

**Switching it on is an owner/PM decision, never an agent's.** To switch it on:
1. Set `PROJEXA_INTERNAL_AI_ENABLED=1` in the compliance-tracker deployment's environment, and also in the Supabase Edge Function secrets if document extraction should use the model.
2. Redeploy, or restart the server, so the new value is read.

To switch it off again, remove the variable or set it to any other value. No migration and no data change is involved either way.

**Scope note:** the transports are shared by every product served from compliance-tracker. The switch therefore turns off internal model calls platform-wide, not only for PROJEXA screens. The flag is named for PROJEXA because PROJEXA is the product the owner's order is about. The cost goal is the same for all of them.

## How it is enforced (two layers)

1. **Transports.** These are the only modules that reach a model endpoint or spawn a model CLI. Each one checks the switch, so a call site nobody gated by hand still costs nothing.
2. **Call sites.** Each user-facing surface answers in a shape its screen already renders, with no PROJEXA UI change. Each cron or worker job returns a quiet "skipped" result.

The guard is `src/lib/projexa-internal-ai.architecture.test.ts`. It fails the build when any of these happens:
- a file outside the transports reaches a model
- a transport loses its gate
- a new file starts importing a model-calling function without being registered there and here
- this document stops naming a registered file

### Why each refusal has the shape it has (read from the projexa repo, 2026-10-02)

- **Discuss** (`VeriComposer.tsx`). The screen shows a 200 response's `reply` as VERI's message. It turns *any* non-2xx response into "VERI AI didn't reply - try again", which is wrong here because retrying never helps. So Discuss answers **HTTP 200 `{reply: USE_YOUR_OWN_AI}`**.
- **Everything else** (assistant codeReferences, construction AI routes, meeting intelligence, document extraction). The screens toast the proxy's `d.error`. PROJEXA's `veridian-client.ts` turns a 4xx into `VeridianApiError(status, code null)` carrying the body's `error`, and `veridian-response.ts` answers the browser **403 `{error, code: null}`**. So these throw `ProjexaInternalAiOffError`: a `ServiceError` with status 403, message `USE_YOUR_OWN_AI` and code `PROJEXA_INTERNAL_AI_OFF`. PROJEXA keeps that code as `ruleCode`. Every route that already maps `ServiceError` to `{error: message}` carries it unchanged.
- **Typed composer** (`M24Shell.tsx`). A `gap` verdict's `message` is shown as the notice. A Level-0 miss therefore stays the normal gap verdict, and only its wording changes. AI-work-link callers keep the old wording, because their own AI is already the one doing the work, so "paste your link" would be wrong for them.

## Transports (each checks the switch)

| File | Off behaviour |
|---|---|
| `src/lib/llm-client.ts` | `callLLM` / `callLLMVision` (and so `callLLMJson`) throw `ProjexaInternalAiOffError` before any provider, fallback, retry or the `AI_BRIDGE` queue is reached |
| `src/lib/ai/providers/claude-cli.ts` | `runClaudeCli` (every path to `claude -p`) refuses before spawning |
| `src/lib/ai/providers/claude-cli-remote.ts` | `callBridgeJson` refuses before the tunnel is reached |
| `src/lib/whisper-client.ts` | `transcribeAudio` refuses before the key is read |
| `src/lib/embeddings.ts` | `generateEmbeddingUncached` / `generateEmbeddingsBatchUncached` return the deterministic **hash pseudo-vector** (`isReal: false`) and ask no provider; see "Embeddings" below |
| `src/lib/pipeline/level1.ts` | `runLevel1` returns "nothing resolved, zero model calls" before the provider gate |
| `src/lib/services/document-extraction-service.ts` | `createEdgeExtractCaller` answers `503 internal_ai_off` without fetching; `readEdgeOutput` turns it into `ExtractionRejectedError("model_not_configured", USE_YOUR_OWN_AI)` |
| `src/lib/ai/internal-model-gateway.ts` | the internal extract caller answers `503 internal_ai_off` before the model and before the meter, so no "failed call" ledger row is written for a call that never happened |
| `src/lib/ai/internal-ai-policy.ts` | `resolveInternalAiRoute` refuses first with `projexa_internal_ai_off`; `refusalSentence` returns `USE_YOUR_OWN_AI` |
| `supabase/functions/projexa-document-extract/wiring.ts` | `chooseModel` returns no model unless the Edge environment says `PROJEXA_INTERNAL_AI_ENABLED=1`, whatever keys are set. The handler then answers `503 model_not_configured` |

### Embeddings: how search degrades

With the switch off, every new embedding is the hash pseudo-vector, labelled `hash-pseudo-vector`. Three consequences:
- **Search returns fewer or no matches.** `findSimilar()` compares a query only against stored vectors with the same model label. It never matches a hash query against a real vector, so it finds hash-labelled rows or nothing, never a wrong match.
- **No new chunks are embedded.** `storeEmbedding()` and `storeChunkEmbedding()` already refuse to persist a hash vector (CRR D-1). New documents stay `CHUNKED`, which can be resumed later.
- **Cached real vectors still work.** A real vector already in `embedding_cache` is still returned by `generateEmbedding()`, because a cache hit costs nothing.

Nothing fails that did not already fail in an environment with no embedding key.

## Named call sites (each has a committed test: switch unset = no model and the refusal or fallback; switch `1` = the old behaviour)

| Call site | Off behaviour | Test |
|---|---|---|
| Level 1, `effectiveLevel1()` in `src/lib/pipeline/run-submission.ts` | `"off"` for every caller. This covers `runSubmission`, `submitForVerdict` (and the dry run behind it) and `confirmSubmission`, whose input has no `level1` field, which is why the check lives in this function | `src/lib/pipeline/projexa-internal-ai-off.test.ts` |
| Gap wording, `gapAnswer()` in `src/lib/pipeline/dry-run.ts` | `USE_YOUR_OWN_AI - Open <screen>`, with the same route. `runSubmission` adds `USE_YOUR_OWN_AI` once to `chatMessages` when something stayed unresolved | same |
| `classifyOnly` in `src/lib/pipeline/classify-only.ts` (calls `runLevel1` directly) | `level1OffRunner`; `message: USE_YOUR_OWN_AI` when there is a gap | same |
| `src/lib/pipeline/reuse-cache.ts` | `runLevel1` itself answers off | `src/lib/projexa-internal-ai.test.ts` |
| Discuss (`discussConstruction`, `POST /api/v1/projexa/discuss`) | 200 `{reply: USE_YOUR_OWN_AI}` | `src/lib/services/projexa-internal-ai-off.services.test.ts`, `src/app/api/construction/ai/projexa-internal-ai-off.route.test.ts` |
| Progress summary (`generateProgressSummary`, codeReference `generate_construction_progress_summary`) | 403 refusal | services test |
| Photo progress (`estimateProgressFromPhoto`, `POST /api/construction/ai/estimate-progress`) | 403 refusal, before the body is read or the image is downloaded | services test, route test |
| Drawing diff (`diffDrawingRevisions`, `POST /api/construction/ai/diff-drawings`) | 403 refusal, before any image is downloaded | services test, route test |
| Budget/schedule risk (`detectBudgetScheduleRisk`, codeReference `detect_construction_budget_schedule_risk`) | `templateBudgetScheduleRisk`: the deterministic riskLevel and template prose | services test |
| Meeting minutes intelligence (`generateMeetingIntelligence` in `src/lib/services/veri-meeting-service.ts`) | 403 refusal before the meeting is read (never counted as a failed MOM generation by the monitor) | services test |
| Meeting publish (`publishVeriMeeting`) | published and locked as before; the background model pass is not queued | services test |
| `ai_recipe` reports (`runAiRecipe` in `src/lib/services/report-engine-service.ts`) | one `Note` row with `USE_YOUR_OWN_AI` (the engine's own refusal shape, so a scheduled mix of reports still delivers every deterministic one) | services test |
| `extractDocumentContent` (background enrichment) | silent skip | services test |
| `extractComplianceFields` (`POST /api/documents/extract`) | 403 refusal | services test |
| Chat attachment (`src/lib/pipeline/chat-attachment.ts`) | route policy refuses first; the answer is `USE_YOUR_OWN_AI` | transports test (policy) |

## Cron / worker paths (silent when off)

Test file: `src/lib/projexa-internal-ai-off.workers.test.ts`.

| Job | Service | Off behaviour |
|---|---|---|
| `/api/internal/l2-phrase-promotion/run` | `runL2Batch` (`src/lib/ai/batch/analyse.ts`) | `{..., skipped: "internal_ai_off"}`. No org scan, and the system-batch provider gate is not consulted, so there is no nightly 500 |
| `/api/internal/role-quality-regression/run` | `runAllRoleQualityChecks` (`src/lib/services/role-quality-regression-service.ts`) | `internalAiOff: true`, nothing read, no history row |
| `/api/internal/instruction-audit/run` | `runInstructionMismatchAudit` (`src/lib/loops/instruction-mismatch-audit.ts`) | `skipped`. Commitments stay pending rather than being marked drifted |
| `/api/internal/dispatch-completion-monitor/run` | `runDispatchCompletionSweep` (`src/lib/monitors/dispatch-completion-monitor.ts`) | `skipped`. Its fail-closed answer to a failed model call is to escalate, so running it off would page a human for every stuck row every night |
| `/api/internal/loops/run` (loop 1) | `runLoopEngineeringAudit` (`src/lib/loops/loop-engineering-audit.ts`) | the audit is still recorded; the model synthesis is skipped (`llmSynthesis: null`), with no error log |
| `/api/internal/capability-audit/run` | `runCapabilityAudit` (`src/lib/services/capability-audit-service.ts`) | `{audited: false, reason: "internal_ai_off..."}`. Nothing is read, and the capability keeps its turn |
| `/api/internal/crr-catchup-worker/run` | the route itself | 200 `{skipped: true, reason: "internal_ai_off"}` after the cron-secret check. Stuck rows keep their resumable status |
| Email attachment intake, connected-folder scan, scheduler-proposal approve, extraction executor | the Edge caller | the job is rejected `model_not_configured` with `USE_YOUR_OWN_AI`. The Edge Function is not called |

## Every file that imports a model-calling function (the frozen registry)

The full list, with each file's off behaviour, is `CALL_SITES` in `src/lib/projexa-internal-ai.architecture.test.ts`. Each file below is in one of these categories:

- **transport/wrapper:** gated inside.
- **Level 1:** no model; a miss is a gap.
- **embeddings:** hash pseudo-vector.
- **document extraction:** the Edge Function is not called.
- **refused by the transport:** `ProjexaInternalAiOffError`, 403 `USE_YOUR_OWN_AI`. The surface's own error handling shows or logs it. These surfaces have no individual test beyond the transport tests and the architecture test.
- **explicit:** see the tables above.
- **cron:** see the table above.

| File | Category |
|---|---|
| `src/app/api/assistants/[id]/memories/route.ts` | embeddings |
| `src/app/api/assistants/[id]/memories/search/route.ts` | embeddings |
| `src/app/api/documents/extract/route.ts` | embeddings + explicit refusal |
| `src/app/api/search/semantic/route.ts` | embeddings |
| `src/app/api/v1/projexa/projects/from-document/route.ts` | document extraction |
| `src/app/api/v1/projexa/scheduler-proposals/[id]/approve/route.ts` | document extraction |
| `src/lib/ai/batch/analyse.ts` | cron |
| `src/lib/ai/internal-model-gateway.ts` | transport/wrapper |
| `src/lib/ai/providers/openrouter.ts` | transport/wrapper |
| `src/lib/ai-router/mother-router.ts` | refused by the transport |
| `src/lib/ai-team/team-service.ts` | refused by the transport (AI dev-team roles) |
| `src/lib/crr/embed.ts` | embeddings |
| `src/lib/gst/ai-review-report.ts` | refused by the transport |
| `src/lib/ingest/extractor.ts` | refused by the transport |
| `src/lib/llm-client.ts` | transport (the `AI_BRIDGE` queue is reached only through `callLLM`) |
| `src/lib/llm-response-cache.ts` | refused by the transport (a cache hit still answers) |
| `src/lib/loops/instruction-mismatch-audit.ts` | cron |
| `src/lib/loops/loop-engineering-audit.ts` | cron |
| `src/lib/monitors/dispatch-completion-monitor.ts` | cron |
| `src/lib/orchestra-model-resolver.ts` | refused by the transport (Settings "test connection") |
| `src/lib/pipeline/chat-attachment.ts` | explicit (route policy) |
| `src/lib/pipeline/classify-only.ts` | Level 1 |
| `src/lib/pipeline/dry-run.ts` | Level 1 |
| `src/lib/pipeline/executors/extraction.ts` | document extraction |
| `src/lib/pipeline/level1.ts` | transport/wrapper |
| `src/lib/pipeline/reuse-cache.ts` | Level 1 |
| `src/lib/pipeline/run-submission.ts` | Level 1 |
| `src/lib/pipeline/scan-connected-folder-job.ts` | document extraction |
| `src/lib/prompt-security/defense-in-depth.ts` | refused by the transport |
| `src/lib/prompt-security/layer1-input-sanitization.ts` | refused by the transport |
| `src/lib/prompt-security/layer3-runtime-guardrails.ts` | refused by the transport |
| `src/lib/services/ai-report-builder-service.ts` | refused by the transport |
| `src/lib/services/asset-routing-engine.ts` | refused by the transport |
| `src/lib/services/asset-vector-search-service.ts` | embeddings |
| `src/lib/services/assistant-memory-service.ts` | embeddings |
| `src/lib/services/capability-registry-service.ts` | embeddings |
| `src/lib/services/chat-service.ts` | refused by the transport |
| `src/lib/services/communication-drafting-service.ts` | refused by the transport |
| `src/lib/services/construction-ai-service.ts` | explicit |
| `src/lib/services/crm-accounts-service.ts` | refused by the transport |
| `src/lib/services/crm-service.ts` | refused by the transport |
| `src/lib/services/dialogue-script-executor.ts` | refused by the transport |
| `src/lib/services/document-extraction-service.ts` | explicit + transport |
| `src/lib/services/email-attachment-intake.ts` | document extraction |
| `src/lib/services/email-intelligence-service.ts` | refused by the transport |
| `src/lib/services/fm-register-digitization-service.ts` | refused by the transport |
| `src/lib/services/instruction-execution-cache-service.ts` | embeddings |
| `src/lib/services/knowledge-base-service.ts` | embeddings |
| `src/lib/services/memory-recall-service.ts` | embeddings |
| `src/lib/services/memory-service.ts` | embeddings |
| `src/lib/services/prompt-eval-service.ts` | refused by the transport |
| `src/lib/services/prompt-localization-service.ts` | refused by the transport |
| `src/lib/services/prompt-translation-service.ts` | refused by the transport |
| `src/lib/services/report-engine-service.ts` | explicit |
| `src/lib/services/role-quality-regression-service.ts` | cron |
| `src/lib/services/task-dedup-service.ts` | embeddings |
| `src/lib/services/ticket-intelligence-service.ts` | refused by the transport |
| `src/lib/services/veri-meeting-service.ts` | explicit |
| `src/lib/services/visitor-intelligence-service.ts` | refused by the transport |
| `src/lib/services/voice-ticket-service.ts` | refused by the transport (the memo is marked failed with `USE_YOUR_OWN_AI`) |
| `src/lib/task-execution-engine.ts` | refused by the transport |

## Not gated (outside the app, recorded so nobody assumes otherwise)

These scripts are run by hand, by the owner, on a laptop or a host. They are not part of the deployed app, and none of them runs from a request or a cron of the app:
- `scripts/ai-bridge-worker.mjs`: the laptop worker for the `AI_BRIDGE` queue. With the switch off, `callLLM` never enqueues anything, so the worker has nothing to do.
- `scripts/l1-remote-bridge.mjs`: the laptop end of `claude-cli-remote`. `callBridgeJson` never reaches it while off.
- `scripts/veridian-browser-ux-test.mjs`: a manual UX test harness.

## Adding a new AI call site

1. Call a transport (`callLLM*`, embeddings, and so on). Never write a raw provider `fetch`; rule 1 of the architecture test fails if you do.
2. Decide what the surface does while the switch is off: a plain refusal (`assertProjexaInternalAi(surface)`), a deterministic fallback, or a silent skip for background or cron work.
3. Write a test for both sides: switch unset means the model spy is never called, and switch `1` means the old behaviour.
4. Add the file to `CALL_SITES` in the architecture test and to the table above.
