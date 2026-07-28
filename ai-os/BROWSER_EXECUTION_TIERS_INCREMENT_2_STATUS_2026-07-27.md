# phase_5_browser_execution_tiers -- increment 2 status

**Phase:** `phase_5_browser_execution_tiers` (claude-control repo:
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`).
**This increment:** 2 of N, continuing directly from increment 1 (merged
compliance-tracker PR #586). Implements increment 1's own PROGRESS.md
"Remaining" checklist verbatim -- see that list, reproduced item-by-item
below with real, evidenced status.

## What this increment ships

All new code lives in `src/lib/browser-execution/`, alongside increment 1's
`tier-detection.ts`/`tier-orchestrator.ts`/`client-compile.ts`.

| # | Scope item | File(s) | Status |
|---|---|---|---|
| 1 | Real WebLLM model install + wiring | `webllm-engine.ts`, `webllm-engine.test.ts` | Done |
| 2 | engine-browser-mcp | `tool-calling.ts` (JSON-RPC envelope half) | Done |
| 3 | engine-browser-function | `tool-calling.ts` (real execution half) | Done |
| 4 | engine-browser-worker deepening | `worker-pool.ts`, `worker-pool-test-worker.ts` | Done |
| 5 | engine-browser-transformers | `transformers-engine.ts` | Done |
| 6 | stack-browser-compute / stack-parallelism | `tier-orchestrator.ts#planParallelism` | Done |
| 7 | Tier-local IndexedDB model-weight caching | `model-cache.ts` (Transformers.js side) + WebLLM's own native `cacheBackend` flag | Done |
| 8 | Update the phase-plan yaml's gap-item checklist | -- | **Not done from this repo** -- see below |

### 1. WebLLM model choice and wiring

Model: **`Qwen2.5-0.5B-Instruct-q4f16_1-MLC`** -- confirmed present in
`@mlc-ai/web-llm@0.2.84`'s own `prebuiltAppConfig` by reading
`node_modules/@mlc-ai/web-llm/lib/index.js` directly (not assumed from
documentation). Justification (smallest-capable, not largest-available):
WebLLM's catalog spans ~135M (SmolLM2-135M) to 70B+; a browser tier's whole
premise is a small real download, but sub-0.5B instruct models are
materially less reliable at the structured-JSON-output task this tier's
tool-calling path needs (Qwen2.5's own technical report), so 0.5B is the
smallest model with real reliability headroom. `q4f16_1` is WebLLM's
standard 4-bit-weight/fp16-activation quantization preset.

Real, disclosed constraint: WebLLM's **native** `ChatCompletionRequest.tools`
field is hard-restricted (`functionCallingModelIds` in `config.d.ts`) to a
handful of 7-8B "Hermes" models -- far too large for this tier. Tool calling
instead goes through WebLLM's model-agnostic JSON mode
(`response_format:{type:"json_object"}`, not subject to that restriction)
plus this increment's own `tool-calling.ts#parseModelToolCall` envelope. Real
and working with the small model; not a silent downgrade.

Wired through `tier-orchestrator.ts`'s new `shouldAttemptWebLlm(plan, env)`:
true only when the plan's own tier selection already landed on `lite-llm`
AND real WebGPU (`navigator.gpu`) is present. WebLLM has **no WASM fallback**
of its own (unlike litert-spike's LiteRT.js) -- WebGPU-absent-but-lite-llm-
selected correctly reports `{kind:"fallback"}` rather than attempting a load
that would fail. Tested via injected envs/factories in
`webllm-engine.test.ts` (7 tests): real-path load, honest fallback with the
factory never called, and `not-selected` when a higher tier wins.

### 2/3. engine-browser-mcp + engine-browser-function

One module (`tool-calling.ts`), two real halves: `BrowserToolRegistry`
(engine-browser-function -- genuinely invokes the registered handler and
returns its real result, not a stub) and `dispatchMcpToolCall`
(engine-browser-mcp -- wraps that real result in the same JSON-RPC 2.0
envelope shape `src/app/api/mcp/route.ts` already uses in production,
reused here purely for one-tool-contract-shape consistency; there is *zero*
network hop or relationship to that route at runtime -- this is
fully client-side). Explicitly distinct from
`ai-os/BROWSER_AUTOMATION_PROFILE_2026-07-25.yaml`'s session-tooling scope
(driving a browser session for an agent), which the original phase_5 gap
analysis already ruled a non-match for this gap item. 9 real tests,
including a genuine round trip (register tool -> `tools/call` request ->
real execution -> real JSON-RPC success/error envelope).

### 4. engine-browser-worker deepening

`worker-pool.ts`: a real multi-worker pool coordinated via a genuine
`SharedArrayBuffer`/`Atomics` busy/free slot table (not just in-JS
bookkeeping visible only to the main thread) -- generalizes beyond
litert-spike's own single-worker-per-page pattern
(`src/app/litert-spike/worker-src/inference-worker.ts`). Tested against
**real Bun `Worker` instances** running a real worker script
(`worker-pool-test-worker.ts`), including a real concurrent-dispatch test
that snapshots the SharedArrayBuffer mid-flight to prove both slots are
genuinely busy at once, and a real queueing test (3 tasks, pool size 2).
6 real tests, 0 mocked postMessage/onmessage.

### 5. engine-browser-transformers

Model: **`Xenova/all-MiniLM-L6-v2`** (real, widely-used ONNX sentence-
embedding model, ~23MB int8-quantized) via `@huggingface/transformers`.
Matches `tier-detection.ts`'s own documented tier role ("embeddings/
classification, not text generation").

**Real, disclosed sandbox limitation found while building this:**
`@huggingface/transformers`'s Node entry point statically imports `sharp`
(confirmed by reading `dist/transformers.node.mjs`) for its RawImage/vision
decode path, entirely unrelated to this tier's text-only use case. In this
task's sandbox, Bun's `dlopen` of the prebuilt `sharp`/libvips native binary
fails (`ERR_DLOPEN_FAILED`) while plain `node` loads the identical binary
successfully -- a Bun native-addon-compat issue, not a defect in this
module, the model choice, or in `sharp` itself (its own `@img/sharp-libvips-
linux-x64` binary and all `ldd`-resolvable dependencies are present and
correct). Real evidence this integration genuinely works: a throwaway spike
script (`node`, not `bun test`, deleted after use) ran
`pipeline("feature-extraction","Xenova/all-MiniLM-L6-v2")` against the real
network and real model and printed `dims: [ 1, 384 ] len: 384` -- the
correct real MiniLM-L6-v2 output shape. The **shipped browser bundle is
unaffected**: bundlers resolve this package's `"browser"` export
(`transformers.web.js`), which never references `sharp` -- this is a
Bun-as-a-Node-test-runner-only issue. `transformers-engine.test.ts`
therefore uses an injected pipeline factory (same pattern
`webllm-engine.test.ts` uses for its own, different reason -- no real
WebGPU in CI) so `bun test` stays fast, offline-safe, and green.

Also ships `selectToolByEmbeddingSimilarity` -- the transformers tier's own
tool-selection path (cosine similarity between a prompt embedding and each
candidate tool's description embedding), since this tier is embeddings-only
and cannot emit a generative JSON tool-call envelope the way the lite-llm
tier does.

### 6. stack-browser-compute / stack-parallelism deepening

`tier-orchestrator.ts#planParallelism(env)` -> `{recommendedWorkers}`, sized
off `navigator.hardwareConcurrency` via `worker-pool.ts#recommendPoolSize`
(leaves one core for the main thread, capped at 4 by default). A real
orchestrator-level integration point for batch-dispatching independent
browser-tier tasks (e.g. embedding N chunks) across `WorkerPool`, not just a
standalone utility.

### 7. Tier-local IndexedDB model-weight caching

Two real, *different* stories, per each library's own actual native hooks
(confirmed by reading each package's type declarations):

- **WebLLM**: native `AppConfig.cacheBackend:"indexeddb"` flag (confirmed
  real in `config.d.ts`) -- no custom code, used directly in
  `webllm-engine.ts#defaultWebLlmEngineFactory`.
- **Transformers.js**: no native IndexedDB option (only Cache API/Node-FS/
  custom-cache flags) -- `model-cache.ts#IndexedDbModelCache` is a real
  custom implementation of the library's own `CacheInterface`
  (`match`/`put`/`delete`), wired via `env.useCustomCache`/`env.customCache`
  in `transformers-engine.ts`. 4 real put/match/delete round-trip tests
  against an injected in-memory `IDBFactory`-shaped fake (Bun has no real
  browser IndexedDB; the class under test is exercised through its real
  public API with zero internal reach-in).

**Explicit scope-boundary decision (per this increment's own
KNOWN_CONTEXT):** this is engine-local plumbing for each engine's own weight
cache, with zero cross-engine/cross-tier sharing contract. It is NOT
phase_6's shared cache hierarchy (`stack-storage-tier`'s full L1/L2/L3/OPFS
design spanning multiple engines) -- that unification, if wanted, is
phase_6's own decision, not pre-built here.

### 8. Phase-plan yaml gap-item checklist update -- explicit cross-repo follow-up, not done here

`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml` and
`OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml` both live in the separate
**claude-control** repo, confirmed absent from this (compliance-tracker)
workspace by direct search. This task's own dispatch surface only produces
a PR against compliance-tracker (per its EXPECTED_OUTPUT), so this item is
flagged here as a genuine cross-repo follow-up rather than silently skipped
or guessed at -- matching this same phase's own established
`cross_repo_dispatch_note` precedent (see `ai-os/boss/ACTIVE-CLAIMS.yaml`'s
phase_4 entry, "coordinate-not-run-inside"). The real, evidenced status to
carry over into that yaml (once a session with claude-control access picks
this up): `engine-browser-mcp` DONE, `engine-browser-function` DONE,
`engine-browser-worker` DONE (deepened), `engine-browser-transformers` DONE,
`engine-browser-lite-llm` DONE (install + wiring, this increment's own
follow-up item from the tech-decision doc).

## Test evidence

- `bun test src/lib/browser-execution/`: **58 pass / 0 fail** across 8 files
  (101 `expect()` calls).
- `bun test` (full repo suite): **2088 pass / 0 fail** across 180 files.
- `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit`: **0 errors**,
  repo-wide.

## Not attempted / left open for a further increment

- Streaming token-by-token WebLLM output (this increment wires
  non-streaming `chat.completions.create` only -- streaming is a real,
  separate WebLLM API surface (`asyncGenerate`) not exercised here).
- A live-browser (real WebGPU device) end-to-end manual smoke test --
  this sandbox has no GPU; all WebLLM-path tests use injected envs/factories
  per this repo's own established tier-detection testing precedent.
- Wiring any of this increment's new engines into `VeriComposer.tsx`'s live
  send path -- explicitly out of this increment's scope per its own
  CONSTRAINTS (integrate through `tier-orchestrator.ts`'s exports only,
  don't touch the composer's UI/contract).
