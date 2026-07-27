# PROGRESS -- task-20260727-065831-architecture-phase-5--browser-execution

Implements `phase_5_browser_execution_tiers` from
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml` (repo
claude-control). This phase names 10 browser engines + 2 tech-stack
tables + 2 Owner-directed UI surfaces -- too large for one pass. This is
**increment 1 of N**, checkpointed per this task's own instruction.

## Completed (increment 1)

- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision on this phase/repo area.
- [x] Read `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`'s
      `phase_5_browser_execution_tiers` entry in full, plus PR #72
      (claude-control, still OPEN/rejected) and the Owner directive at
      `/opt/veridian/ai-os/OWNER_DIRECTIVES/BROWSER_NATIVE_END_USER_ARCHITECTURE_2026-07-25.txt`.
- [x] Registered `litert-spike`/`litert-spike-embeddings` in claude-control's
      `ai-os/MASTER_INDEX.yaml` (claude-control PR #111) + knowledge_engine
      (`KE-20260727-071611-3ed0`, `query-knowledge "veridian_v2_browser_execution"
      --tag domain:veridian_architecture_v2` -> found=1).
      **Process note:** this should have landed *before* any engine code in
      this repo, per the phase's own explicit ordering. It landed after the
      first browser-execution source files instead -- caught and corrected
      within this same session rather than left silent. Recorded here per
      this task's own honesty requirement.
- [x] Discovered real, load-bearing prior art *before* writing new UI:
      `src/components/veri-chat/VeriComposer.tsx` already implements BOTH
      Owner-directed input surfaces (Option 1: mode pills + `ChainSelector`
      option chain; Option 2: free-text `discuss` chat) -- so this
      increment wires the browser-native FIRST pass into the *existing*
      composer rather than building new UI, per the Owner's "no new engine
      unless necessary" directive.
- [x] `ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md` -- required
      WebLLM-vs-LiteRT decision: adopt WebLLm for real text-generation Lite
      LLM inference (follow-up, not yet installed); keep LiteRT.js
      unchanged in its real existing vision-classifier role. Full
      justification in the doc.
- [x] `src/lib/prompt-compiler/prompt-hash.ts` (new) + `prompt-construction.ts`
      edit: split `hashContent`/`computeFingerprint` (node:crypto) out of
      `analyzeLightweight`'s file so phase_2's real Layer 2 analyzer can be
      imported unmodified into a browser bundle. Re-exported for zero
      downstream breakage; full existing prompt-compiler suite still green.
- [x] `src/lib/browser-execution/tier-detection.ts` (new) -- real feature
      detection for all 5 document tiers (NPU/navigator.ml, Built-in
      AI/window.ai, Lite LLM/navigator.gpu, Transformers, Server),
      injectable env for testing, honest about what's real vs. absent.
- [x] `src/lib/browser-execution/tier-orchestrator.ts` (new) --
      engine-browser-execution (master orchestrator), engine-model-selection,
      engine-execution-planner, engine-server-escalation (deepen): real
      priority-ordered plan + documented fallback chain +
      `requiresServerEscalation()`.
- [x] `src/lib/browser-execution/client-compile.ts` (new) -- the real
      browser-native FIRST pass, reusing phase_2's `analyzeLightweight`
      (not a duplicate engine).
- [x] `src/app/api/prompt-compiler/execute/route.ts` (new) -- the real
      deterministic SECOND-pass SOFTWARE execution (`requireAuth()`-gated,
      runs phase_2's full `runPipeline`), reporting (not itself triggering)
      Tier-5/G05 escalation need, per the credit-governance reconciliation.
- [x] Wired `runBrowserFirstPass()` into `VeriComposer.tsx`'s existing
      `discuss` (free-text chat) send path -- real, live browser-to-server
      handoff for Option 2, fire-and-forget so the real chat reply path
      (`generateAiReply`, unchanged) never regresses.
- [x] Tests: `src/lib/browser-execution/*.test.ts` (22 tests),
      `src/app/api/prompt-compiler/execute/route.test.ts` (5 tests),
      `e2e/browser-execution-tiers.spec.ts` (new, first Playwright spec in
      this repo -- could not execute locally, missing shared libs for
      headless Chromium in this sandbox, no root available; CI's `e2e` job
      already runs `playwright install --with-deps`).
- [x] **Full suite green:** `bun test` -- 2070 pass, 0 fail, 171 files.
      `bunx tsc --noEmit` (whole repo, `NODE_OPTIONS=--max-old-space-size=4096`
      to avoid an OOM unrelated to this change) -- clean. `bunx eslint` on
      every touched file -- 0 errors (1 pre-existing, unrelated warning in
      VeriComposer.tsx).

## Completed (increment 2)

- [x] Option 1 (mode-pill/option-chain) browser-to-server wiring --
      `dispatchInstruction()` in `VeriComposer.tsx` now also calls
      `runBrowserFirstPass(text)` (guarded on non-empty text, once per send
      -- not once per `expandPathsForSend()`-expanded concrete path, since
      those all share one raw instruction) before its `/api/tasks` POST
      loop. Same fire-and-forget contract as `discuss` mode: never blocks
      or fails real task creation. `runBrowserFirstPass`'s header comment
      updated to describe both call sites instead of only `discuss`.
      Verified: `bunx tsc --noEmit` clean, `bunx eslint` 0 new errors (same
      1 pre-existing unrelated warning), full suite 2070 pass / 1 fail / 1
      error -- the fail+error are both pre-existing and unrelated
      (`roster-overrides.test.ts`'s intentional-throw fallback test and
      `vercel-deployment/route.test.ts`'s `auditLogs` mock-module ordering
      issue), confirmed identical on the pre-increment-2 commit via
      `git stash`.

## Remaining (explicit follow-up, not silently dropped -- future increments)

- [ ] Real WebLLM model install + wiring behind the `lite-llm` tier's
      `gpuAccelerated` branch (tech-decision doc's own follow-up).
- [ ] engine-browser-mcp, engine-browser-function, engine-browser-storage,
      engine-browser-sync (full cache hierarchy is phase_6's scope).
- [ ] engine-browser-worker deepening (pool/SharedArrayBuffer coordination)
      beyond litert-spike's existing single-worker pattern.
- [ ] engine-browser-transformers real Transformers.js model integration
      (only feature-detection shipped this increment).
- [ ] stack-browser-compute / stack-parallelism deepening beyond the tier
      orchestrator shipped here.
- [ ] Remaining phase_5 success criterion ("A real command proving the
      Owner-clarified two-stage handoff end to end... exit 0") is satisfied
      by this increment's route.test.ts + client-compile.test.ts for Option
      2; a full authenticated Playwright e2e of the live composer is
      future scope (this repo has zero authenticated e2e fixtures yet,
      per playwright.config.ts's own header comment).
