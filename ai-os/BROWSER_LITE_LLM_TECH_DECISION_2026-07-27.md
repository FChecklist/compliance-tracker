# Browser Lite LLM Engine: WebLLM vs. LiteRT technology decision

**Phase:** `phase_5_browser_execution_tiers` (claude-control repo:
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`), gap item
`engine-browser-lite-llm`.
**Decision date:** 2026-07-27.
**Required by:** the phase plan's own scope bullet -- "evaluate WebLLM as
the document's own named technology vs. continuing with LiteRT -- a real
technology-choice decision this phase must make and justify, not silently
keep LiteRT by default."

## The real prior art (confirmed by reading the code, not assumed)

`repos/compliance-tracker/src/app/litert-spike/` is a real, working
browser inference prototype using `@litertjs/core` (Google LiteRT.js) with
a genuine WebGPU-with-WASM-fallback code path
(`worker-src/inference-worker.ts`'s `init()`: tries `accelerator: "webgpu"`
first, falls back to `accelerator: "wasm"` on failure). But the model it
loads is a **MobileNetV2 blur/sharp binary image classifier** -- a vision
model, not a text-generation LLM. There is zero LiteRT.js usage anywhere in
either product repo for text generation, chat, or prompt compilation.

## The decision

**Adopt WebLLM for the Lite LLM tier's real use case (browser-native
text-generation / chat inference). Do not port litert-spike's vision
pipeline to WebLLM, and do not attempt to force LiteRT.js into a
text-generation role it has zero prior art for in this codebase.**

Both runtimes keep the exact role they already have real evidence for:

| Runtime | Real role | Status |
|---|---|---|
| LiteRT.js (`@litertjs/core`) | Vision-model inference (blur/sharp classifier) | Existing, untouched by this phase |
| WebLLM | Text-generation LLM inference for the Lite LLM tier | Adopted by this decision; **not yet installed/wired to a real model in this increment** -- see Follow-up below |

## Justification

1. **Different modality, not a competing choice.** LiteRT.js's only real
   usage in this codebase is a vision classifier. WebLLM is a
   text-generation-specific runtime (165+ chat/instruct models, streaming,
   JSON mode via its own grammar-constrained decoding) built specifically
   for the browser chat/prompt use case `engine-browser-lite-llm`'s own
   requirement text names. Neither runtime is being "replaced" -- they were
   never solving the same problem.
2. **The document names WebLLM explicitly** (`engine-browser-lite-llm`
   requirement: "WebGPU-accelerated local LLM inference via WebLLM (165+
   models, streaming, JSON mode)"). LiteRT.js was never the document's own
   choice for this tier; it became the *only* real prior art in this
   codebase by coincidence of a different, earlier spike (Priority 14,
   `GAP-LITERT-EDGE-INFERENCE`, unrelated to text generation).
3. **litert-spike's own model has a real, disclosed licensing caveat**
   (page.tsx header: "comes from a third-party GitHub repo with no LICENSE
   file... do not point any production build at this model without
   resolving that first"). This is a second, independent reason not to
   extend that specific pipeline into a production chat surface.
4. **WebGPU feature-detection is shared, not duplicated.** Both runtimes
   need the same browser capability (WebGPU, with a WASM fallback story).
   `src/lib/browser-execution/tier-detection.ts`'s `detectLiteLlmTier()`
   reports WebGPU/WASM availability once, generically, for whichever real
   runtime ends up running in that tier -- it does not hardcode either
   library.

## What this increment actually ships (honesty about scope)

Per the Owner's "no new engine unless necessary" / "use existing system"
directive and this task's own instruction to checkpoint real, working,
tested increments rather than attempt all 10 named browser engines at
once: this increment ships the **tier orchestration and real
feature-detection layer** (`src/lib/browser-execution/`), which is
runtime-agnostic and does not itself require WebLLM's model weights to be
downloaded or bundled. It does **not** ship a bundled WebLLM model or a
real client-side LLM text-generation call in this pass -- that requires
its own real decisions (which model(s) to ship, hosting/CDN, cache-budget
sizing against `stack-storage-tier`/L3 OPFS, which is `phase_6`'s own
scope) that would be reckless to rush inside a checkpoint whose job is to
land a real, working, tested slice.

**Follow-up (explicitly filed, not silently dropped):** install
`@mlc-ai/web-llm`, pick a first real small instruct model from its
catalog, and wire it behind the `lite-llm` tier's `gpuAccelerated` branch
in a subsequent phase_5 increment. Until then, the `lite-llm` tier's real,
honest behavior when selected is: run phase_2's existing deterministic
Layer 2 analysis (`analyzeLightweight`) client-side (genuinely real,
genuinely browser-native, zero LLM call) -- not a simulated or faked LLM
response.
