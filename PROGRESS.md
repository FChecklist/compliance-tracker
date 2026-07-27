# PROGRESS -- task-20260727-094516-architecture-phase-5-increment-2--webllm

phase_5_browser_execution_tiers increment 2 of N (claude-control repo's
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`), continuing
directly from increment 1 (merged compliance-tracker PR #586). Implements
increment 1's own PROGRESS.md "Remaining" checklist verbatim. Full detail,
real evidence, and honest disclosures in
`ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`.

## Completed

- [x] 1. Real WebLLM model install + wiring: `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`
      (confirmed real in `@mlc-ai/web-llm@0.2.84`'s own `prebuiltAppConfig`),
      wired behind `tier-orchestrator.ts`'s new `shouldAttemptWebLlm` gate
      (`src/lib/browser-execution/webllm-engine.ts`). 7 real tests via
      injected envs/factories: reachable when WebGPU present, honest
      fallback (factory never called) when `navigator.gpu` absent, correct
      `not-selected` when a higher tier wins.
- [x] 2/3. engine-browser-mcp + engine-browser-function: one real
      MCP-JSON-RPC-shaped tool-calling contract
      (`src/lib/browser-execution/tool-calling.ts`) -- real tool registry +
      execution (`BrowserToolRegistry`) and a real JSON-RPC envelope
      (`dispatchMcpToolCall`), reusing `/api/mcp/route.ts`'s existing
      `{name,description,inputSchema}` shape for consistency only (zero
      network hop, fully client-side). Distinct from
      `BROWSER_AUTOMATION_PROFILE`'s session-tooling scope. 9 real tests
      including a genuine register -> call -> execute -> JSON-RPC-envelope
      round trip.
- [x] 4. engine-browser-worker deepening: a real
      `SharedArrayBuffer`/`Atomics`-coordinated multi-worker pool
      (`src/lib/browser-execution/worker-pool.ts`), generalizing beyond
      litert-spike's single-worker pattern. Tested against **real Bun
      `Worker` instances** (`worker-pool-test-worker.ts`) -- concurrent
      dispatch, mid-flight busy-slot snapshot, and real queueing beyond
      pool capacity. 6 real tests.
- [x] 5. engine-browser-transformers: real `Xenova/all-MiniLM-L6-v2`
      wiring via `@huggingface/transformers`
      (`src/lib/browser-execution/transformers-engine.ts`), plus
      cosine-similarity tool selection for this tier's own (embeddings-only)
      tool-calling path. 4 real tests via an injected pipeline factory --
      see the status doc for why (a Bun+sharp/libvips dlopen incompatibility
      in this sandbox, unrelated to this module; real network+model
      integration independently verified via a `node`-run spike: real
      `dims: [1, 384]` output).
- [x] 6. stack-browser-compute / stack-parallelism deepening:
      `tier-orchestrator.ts#planParallelism`, sized off
      `navigator.hardwareConcurrency` via `worker-pool.ts#recommendPoolSize`.
- [x] 7. Tier-local IndexedDB model-weight caching: WebLLM's own native
      `cacheBackend:"indexeddb"` `AppConfig` flag (no custom code); a real
      custom `CacheInterface` adapter for Transformers.js
      (`src/lib/browser-execution/model-cache.ts`, since that library has
      no native IndexedDB option), 4 real put/match/delete round-trip
      tests. Explicitly scoped as engine-local plumbing only, NOT phase_6's
      shared cross-engine cache hierarchy.

## Remaining

- [ ] 8. Update the phase-plan yaml's phase_5 gap-item checklist -- **not
      done in this task**: `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
      and `OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml` both live in the
      separate claude-control repo, confirmed absent from this
      (compliance-tracker) workspace. Flagged as a genuine cross-repo
      follow-up in `ai-os/BROWSER_EXECUTION_TIERS_INCREMENT_2_STATUS_2026-07-27.md`
      rather than silently skipped, matching this phase's own established
      `cross_repo_dispatch_note` precedent.
- [ ] Streaming token-by-token WebLLM output (`asyncGenerate`) -- this
      increment wires non-streaming `chat.completions.create` only.
- [ ] A live-browser (real WebGPU device) manual smoke test -- this
      sandbox has no GPU; not possible from this task.
- [ ] Wiring any of these new engines into `VeriComposer.tsx`'s live send
      path -- explicitly out of scope per this task's own CONSTRAINTS.

## Verification

- `bun test src/lib/browser-execution/`: 58 pass / 0 fail (8 files, 101 `expect()` calls).
- `bun test` (full repo suite): 2088 pass / 0 fail (180 files).
- `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit`: 0 errors, repo-wide.
