# VERIDIAN Universal Context Packaging Runtime — Discovery v0.1 (OCID-042)

**Status: DISCOVERY ONLY. Not implemented. Not certified. Not complete.**

**UMR:** `UMR-20260803-084332-5b52` — this task's own real dispatch row, confirmed by direct query
against `umr_tasks` in `/opt/veridian/ai-os/memory/superboss-register.sqlite`
(`unit_name: veridian-worker@task-20260803-085550-register-ocid-042-universal-context-pack.service`,
`status: running` at time of writing), not narrated from the prompt text alone. Parent: **OCID-041**,
real UMR `UMR-20260803-084109-6875` (VERIDIAN Universal External Execution Foundation), registered the
same cycle as this task in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s 2026-08-03 "OCID-041 through
OCID-046" amendment. Citing per the Owner directive: `UMR-20260802-173631-ca85` (OCID-021, the ERP
Functional Completeness Master Program), `SEC-07` (`ai-os/CONSTITUTION.yaml`), and the OCID-022 through
OCID-041 chain.

## 0. Why this document is discovery-only, and what it explicitly does not do

This task's own dispatch prompt requested EXECUTION-type work: build a real context-packaging runtime.
That is not done here, for two independent, real reasons, not a single narrated one:

1. **OCID-042's own cited parent result does not exist yet.** OCID-041 (this document's parent) was
   registered this exact cycle as a governance record only — its own registration amendment says
   plainly "no worker has yet been dispatched for OCID-041" and its substantive discovery/design work
   "remain[s] genuinely undone." A runtime that depends on OCID-041's foundation design cannot honestly
   be built before that foundation exists. This document defers to whatever OCID-041's own discovery
   produces once dispatched, rather than inventing that foundation here.
2. **`SEC-07` (`ai-os/CONSTITUTION.yaml`)** locks real implementation, gap closure, production changes,
   and certification under the ERP Functional Completeness Master Program — and specifically under
   OCID-038/039/040 — until `UMR-20260802-165606-4413` (OCID-020) is independently verified complete.
   OCID-020 has not cleared as of this writing. Nothing downstream of OCID-021, including OCID-042, may
   implement ahead of that sequence without a fresh, explicit Owner override in chat.

What this document *does* do, as authorized for this cycle: a real, grounded inventory of the existing
VERIDIAN components a future context-packaging runtime would need to reuse, an honest map of what
already exists versus what is a genuine gap, and one canonical artifact recording that mapping — so that
whenever OCID-041 lands and the OCID-020/038/039/040 sequence clears, OCID-042's real implementation
starts from an accurate map instead of re-deriving it from scratch.

**Not done here**: no code written, no new table/type/module added, no existing call site rewired, no
`CONSTITUTION.yaml` or UTM functional change, no completion or certification claim.

## 1. Mission restated

A deterministic minimum context-packaging runtime so that **every** outbound request to an external AI
provider (ChatGPT/OpenAI, Z.ai/GLM, DeepSeek, Gemini, or any other approved provider) is built
**exclusively** from one standard VERIDIAN context package — never from raw chat text, raw document
text, or raw task text pasted directly into a prompt — while reusing existing components only: no new
context engine, no new prompt engine, no new database, and no duplicate knowledge/function/report/
analysis registry.

## 2. Real inventory — what already exists, with file:line evidence

Method: direct grep/read against this repository (`FChecklist/compliance-tracker`, this workspace) plus
a direct query against the live Superboss Register sqlite. No area below is filled in from memory or
plausible-sounding guesswork; every "NOT FOUND" below was an actual negative search result, not an
omission.

### 2.1 Context assembly / prompt compilation — the one real typed context bundle
`src/lib/prompt-compiler/context-assembly.ts` — `computeRelevance()`, `pruneContext()`,
`hydrateTemplate()`, `assembleContext()`. Its output type, `AssembledContext`
(`src/lib/prompt-compiler/types.ts`), carries `{ business, user, sessionMessages, pruneStats,
hydratedTemplate }` — real, typed, and genuinely serializable; the closest thing to a "context package"
already in this codebase. It is orchestrated end-to-end by `src/lib/prompt-compiler/pipeline.ts`'s
`runPipeline()` into a `PipelineResult { analysis, context, compiled, verification, timings }`.

**Critical existing gap**: this pipeline is not wired to any external LLM call today. Its only live
route, `src/app/api/prompt-compiler/execute/route.ts`, returns `compiled`/`verification` as diagnostic
JSON — it does not itself dispatch to `llm-client.ts` or any provider. `AssembledContext` is real and
reusable, but it currently reaches zero of the actual outbound-request call sites enumerated in 2.6.

### 2.2 Mother Router — resolution only, not payload construction
`src/lib/ai-router/mother-router.ts` — `MotherRouterContext` (discriminated union by `scope`),
`resolveModel()`. This is exclusively a model/provider **resolution, policy, and audit-log** layer: it
returns `{provider, model, reason, resolvedConfig?}`. It contains no `fetch(` call and no message-array
construction — payload-building is left entirely to whichever of the 24+ call sites in 2.6 uses its
resolution result.

### 2.3 VERI Chat — history bounding, not a bundled package
`src/lib/services/veri-chat-service.ts`'s `VeriChatContext` is an auth/tenant scope (`{orgId, userId}`),
not an AI-context bundle. The real chat-to-LLM assembly lives in `src/lib/services/chat-service.ts`:
`buildConversationHistory()` (history-bounding logic, a `HISTORY_CHAR_BUDGET`) producing a `ChatTurn[]`
(`llm-client.ts`), plus a `systemPrompt` built ad hoc via `resolvePromptTemplate()` + string
concatenation, then dispatched via `callLLM(...)`. No existing type resembling a bundled AI-context
package was found in this file.

### 2.4 Mode pills / option chains — real typed selection, never itself serialized into a request
`src/components/veri-chat/ChainSelector.tsx` resolves a `{modePill, pathKeys}` shape via the single
canonical `resolveDynamicChainId()` (`task-service.ts`). `dynamic-chain-directory-service.ts` is
explicitly "deterministic only, no LLM call." `capability-learning-service.ts`'s
`deriveCapabilityKey(modePill, pathKeys)` derives a stable key for `task_capabilities`/
`instruction_packages` rows. This is real, typed, reusable selection data — but it is never itself
serialized into an AI request payload; only a resolved template id/row flows onward, and whatever prompt
text is eventually built (in `task-execution-engine.ts`) is built from that resolved template text, not
from the chain object itself.

### 2.5 Task / document / report / function / analysis content sources
- `src/lib/task-execution-engine.ts` — `executeEngineDispatch()`; planning call sites build their own
  prompt text via `resolvePromptTemplate("task_execution.planning_system")`, pre-fetching UMR/platform
  context via `queryByKeywords()` against `platform_assets`.
- `src/lib/engines/engine-invocation.ts` — `invokeEngine()`: a deterministic-engine (VCEL/
  `computationEngines`) audit wrapper, no AI call itself.
- `src/lib/services/report-engine-service.ts` — its `ai_recipe` executor calls `callLLMJson()` with data
  pulled from real queried rows (`columns/rows/narrative`).
- Documents: `documents` table (`src/lib/db/schema.ts`), consumed by a document-extraction service via
  `callLLMVision`.

Each of these is a genuine, reusable **content source** a future package would pull from — none of them
already emits a bundled package; each builds its own ad hoc prompt text per call site today.

### 2.6 Existing external-AI-provider call sites — the central finding
**One canonical low-level dispatcher already exists**: `src/lib/llm-client.ts` — `callLLM()`,
`callLLMJson()`, `callLLMVision()`, routed through `dispatchLLM()`/`dispatchVisionLLM()` to per-provider
functions (`callOpenAICompatible()` for Groq/OpenAI/OpenRouter/Cerebras, `callAnthropic()`,
`callGoogle()`). This is the real, single choke point for outbound chat-completion HTTP calls.

**However, every caller builds its own payload ad hoc.** There is no shared context-package struct
feeding this dispatcher — each call site independently decides its own `systemPrompt: string`,
`userMessage: string`, and optional `ChatTurn[] history`. Real callers found (non-test):
`app/api/help/ask/route.ts`, `lib/ai-reply-gate.ts`, `lib/ai-team/team-service.ts`,
`lib/ingest/extractor.ts`, `lib/llm-response-cache.ts`, `lib/monitors/dispatch-completion-monitor.ts`,
`lib/orchestra-model-resolver.ts`, `lib/prompt-compiler/prompt-portability.ts`,
`lib/prompt-normalizer.ts`, `lib/prompt-security/*.ts`, `lib/response-vocabulary-gate.ts`,
`lib/services/{ai-report-builder-service,capability-audit-service,chat-service,
communication-drafting-service,construction-ai-service,dialogue-script-executor,
document-extraction-service,fm-register-digitization-service,prompt-eval-service}.ts`,
`lib/task-execution-engine.ts` — roughly two dozen independent construction paths.

**Two further payload shapes bypass `llm-client.ts` entirely**: `src/lib/whisper-client.ts` (multipart
audio transcription, not a message array) and `src/lib/embeddings.ts` (text-array-in/vector-out). Both
are legitimately non-chat shapes, not omissions from the count above.

### 2.7 Browser runtime
No literal `browser-execution-tiers` module exists outside its own e2e spec name; the real in-browser
AI path is `src/lib/browser-execution/webllm-engine.ts`, whose `runLiteLlmToolCall()` builds its own ad
hoc `{system, user}` message array via WebLLM's local `engine.chat.completions.create()` — a third,
fully independent, local-only message-construction path, separate from `llm-client.ts` and from any
external HTTP provider call.

### 2.8 Worker runtime
`worker-entrypoint.sh` invokes `claude -p "$PROMPT" --model ... --effort ...` where `$PROMPT` is built
from the literal contents of `task.yaml`'s `prompt.txt` file — i.e., raw task text, concatenated with a
short instruction preamble, with no structured context package and no UMR/UTM provenance embedded in the
outbound prompt itself beyond the model/budget flags. `dispatch_core.py` only performs queue bookkeeping
over `task.yaml` files; it makes no AI provider calls itself. This is precisely the "raw task text"
pattern the OCID-042 mission statement calls out as the thing a context package should replace.

### 2.9 UMR/UTM registries
Real, live Postgres tables (`src/lib/db/schema.ts`): `platform_assets`, `task_capabilities`,
`instruction_packages`, `computation_engines` — consumed via `asset-query-service.ts`'s
`queryByKeywords()` and `capability-learning-service.ts`. Separately, the ops-level Superboss Register
sqlite (`/opt/veridian/ai-os/memory/superboss-register.sqlite`) has its own `umr_tasks`,
`task_claims`, `task_audits` tables — a distinct, real, queryable registry this document itself used to
confirm its own dispatch UMR above. Both are real stores a future context package would need to read
from (for content/history) and write provenance into (for traceability) — neither is itself a
context-packaging format today.

### 2.10 Existing package-like abstractions — confirming no duplication
Grep across `src/` for `ContextPackage`, `RequestPackage`, `PromptPackage`, `ExecutionPackage`, or
`UniversalContext` returned zero matches. `instructionPackages`/`InstructionPackage` (schema.ts,
`capability-learning-service.ts`) denote a *learned execution recipe* record, not a per-request
AI-context bundle. **No existing abstraction would be duplicated by a real OCID-042 implementation.**

### 2.11 Relationship to the sibling OCID-034 document
`ai-os/VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md` (OCID-034, already merged)
covers a different, adjacent subject: how VERIDIAN maintains, discovers, reuses, and *predicts* end-user
context for the platform's own UI/UX (next-best-action, predictive navigation/form-population, context
carried across chat/session/browser/task for the *end user's* benefit). OCID-042's subject is narrower
and provider-facing: packaging context specifically for *outbound requests to external AI providers*, so
that VERIDIAN — not the raw chat/document/task text — is the sole author of what those providers
receive. The two documents' inventories overlap in places (both cite `AssembledContext`,
`MotherRouterContext`, mode-pill/chain data) because they are genuinely describing the same underlying
components from two different angles; this document adds the outbound-payload-construction inventory
(2.6-2.8) that OCID-034 does not cover, and does not re-litigate OCID-034's predictive-navigation
findings. Cross-referenced here, not duplicated.

## 3. What exists vs. genuine gap — summary

| Component a future package needs | Exists today? | Real gap |
|---|---|---|
| Typed, serializable context bundle | Yes — `AssembledContext` | Not wired to any provider call site |
| Model/provider resolution | Yes — `MotherRouterContext`/`resolveModel()` | Resolves provider only, builds no payload |
| Chat history bounding | Yes — `buildConversationHistory()` | Ad hoc per call site, not package-based |
| Mode-pill / chain selection data | Yes — `{modePill, pathKeys}` + capability key | Never serialized into the outbound request itself |
| Task/report/document content sources | Yes — task-execution-engine, report-engine-service, document-extraction | Each builds its own prompt text ad hoc |
| Single outbound HTTP dispatcher | Yes — `llm-client.ts` | ~24 independent ad hoc callers feed it; no shared struct |
| Browser-local AI path | Yes — `webllm-engine.ts` | Fully independent 3rd construction path, no package awareness |
| Worker-runtime AI path | Yes — `worker-entrypoint.sh` → `claude -p` | Raw task-file text, no structured package at all |
| UMR/UTM provenance stores | Yes — Postgres UMR tables + Superboss Register sqlite | Real stores exist; no context-package format writes/reads them yet |
| A pre-existing "context package" type | **No** | Confirmed absent (2.10) — the real, central gap OCID-042 exists to close |

**The single biggest genuine gap, stated once, plainly**: there is no canonical place today that builds
the outbound AI-provider request payload. `AssembledContext` is the one existing typed bundle capable of
becoming that canonical package, and `llm-client.ts` is the one existing dispatcher that could consume
it — but roughly 24-26 independent construction paths (2.6-2.8) currently exist between the platform's
real content sources and the provider call, each deciding its own prompt text. OCID-042's real future
job, once unlocked, is collapsing those paths into ones that are built from a single standard package
derived from `AssembledContext` plus the mode-pill/task/report/document sources in 2.4-2.5 — not
inventing a new context engine, prompt engine, database, or registry to do it.

## 4. Explicit non-actions this cycle

- `ai-os/CONSTITUTION.yaml` — not updated with any functional/architectural change.
- No UTM/UMR schema change, no new Postgres table or column.
- No code written, no existing call site (of the ~26 identified in 2.6-2.8) rewired.
- No claim of completion, certification, or "zero gaps" — this is a point-in-time inventory, not a
  living spec, and is explicitly superseded by whatever OCID-041's own discovery finds once dispatched.
- OCID-042 is **not** marked complete in any tracker.

## 5. Handoff note for whoever picks up OCID-041 and, later, OCID-042's real implementation

Once OCID-041 lands and the OCID-020 → OCID-038 → OCID-039 → OCID-040 unlock sequence independently
clears (or a fresh, explicit Owner override in chat authorizes work ahead of that sequence), the table in
Section 3 and the file:line citations in Section 2 are the starting inventory — re-verify them against
the then-current codebase rather than trusting this snapshot blindly, the same standard every prior OCID
document in this chain has held itself to.
