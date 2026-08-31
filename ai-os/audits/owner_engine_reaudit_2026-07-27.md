# OWNER_ENGINE Phases 4/5/8/9 -- Independent Re-Audit (2026-07-27)

**Auditor:** Claude Code (interactive session, task
`task-20260727-153025-re-audit-owner-engine--phases-4-5-8-9--f`), verification-only,
no fix work performed.

**Method:** every claim below was re-derived from (a) the real file contents on
`compliance-tracker` `main` at commit `c32c6db6` (this branch, forked from
`main` at `df665722`), (b) real `bun test` / `tsc --noEmit` output run live in
this session, and (c) the real GitHub PR comment history via `gh api`/`gh pr
view` -- not from PROGRESS.md self-reports. Where the task's own KNOWN_CONTEXT
named an open question (phase 5's true total scope), the authoritative
phase-plan source was located and read read-only at
`/opt/veridian/repos/claude-control` (a separate, sibling repo on this
machine's filesystem, outside this task's write-scope) since that document does
not exist inside `compliance-tracker`.

**Headline verdict: INCOMPLETE-WITH-GAPS.** All 4 phases shipped real,
tested, genuinely-audited code that is present and working on `main` today.
None of the 4 is a false "done" self-report in the way earlier drift incidents
in this program were (e.g. phase_4's own two reverted false self-reports,
see below). But by the actual scope each phase's authoritative plan defines,
phase 5 and phase 8 are demonstrably **partial**, not complete, and the
governance record that is supposed to track phase completion (the
claude-control phase-plan yaml) has not been updated to reflect any of these
5 merges -- it still reads `not_started`/`blocked` for all 4 phases as of this
audit.

---

## Phase 4 -- Defense-in-Depth Prompt Security (PR #562)

**Files verified present on `main`** (all real implementations, not
stubs -- each has a corresponding non-trivial `.test.ts`):
- `src/lib/prompt-security/defense-in-depth.ts` (orchestrator)
- `src/lib/prompt-security/layer1-input-sanitization.ts`
- `src/lib/prompt-security/layer2-system-prompt-hardening.ts`
- `src/lib/prompt-security/layer3-runtime-guardrails.ts`
- `src/lib/prompt-security/layer4-output-filtering.ts`
- `src/lib/prompt-security/quality-engine.ts`
- `src/lib/prompt-security/red-team-battery.ts`
- `src/lib/prompt-security/types.ts`, `src/lib/prompt-security/index.ts`
- `scripts/defense-in-depth-smoke-test.ts`, `scripts/red-team-prompt-security.ts`
- Wired into a real production call site: `src/app/api/help/ask/route.ts`
  (`import { runDefenseInDepth } from "@/lib/prompt-security"`, real call at
  line 107) -- confirmed by direct grep of current `main`, not assumed.

**Tests:** `bun test src/lib/prompt-security` -> **44 pass / 0 fail** (97
`expect()` calls). (The `console.error` lines visible in test output are the
fail-closed Layer 3 handler logging its own simulated network failure --
expected test behavior, not failures.)

**tsc clean:** Yes -- `tsc --noEmit` is 0 errors repo-wide (see Cross-Cutting
section for the single full run covering all 4 phases at once).

**Audit verdict history (real, from `gh api .../issues/562/comments`):**
this PR went through two full FAIL -> fix -> PASS cycles before merge, not
one:

1. `2026-07-26T04:59:23Z` -- **AUDIT: FAIL** (severity: medium). Real findings:
   the new module duplicated `policy-enforcement-engine.ts`/`pii-redaction.ts`
   with zero cross-reference, and `runDefenseInDepth()` had zero production
   call sites.
2. `2026-07-26T07:05:23Z` -- **AUDIT: PASS**, after a corrective commit wired
   Layer 1 to the existing `checkPromptInjection()` gate, Layer 4 to
   `pii-redaction.ts`'s shared `findPii()`/`redactPii()`, and made Layer 3 fail
   **closed** instead of open.
3. `2026-07-27T07:17:36Z` -- **AUDIT: FAIL** again (a *different* worker
   re-ran the original, pre-fix diff and re-found essentially the same class
   of defect -- Layer 3's post-call Llama Guard verdict and Layer 4's
   leaked-system-instruction detection were computed but never enforced).
4. `2026-07-27T08:46:15Z` -- **AUDIT: PASS** (final, immediately pre-merge).
   Quoted verdict line: *"Verdict: pass ... Recommend a human merge given
   tier2 (path contains 'prompt-security'/'security')."* Full quote of the
   evidence paragraph: *"This diff (PR #562, all three rounds) adds a 4-layer
   defense-in-depth prompt-security module and, in its round-2 fix, correctly
   closes the two real enforcement gaps a prior audit found: Layer 3's Llama
   Guard input/output calls now fail CLOSED ... and a genuine Layer 4
   leaked-system-instruction detection now actually blocks the reply ...
   instead of being computed and discarded."*
5. Merged **2026-07-27T09:10:43Z** -- i.e. the final PASS (08:46:15Z) genuinely
   precedes the merge timestamp.

**Independently re-verified the fix is real, not just claimed:** grepped
`defense-in-depth.ts` on current `main` and confirmed `blocked: true` is set
on the Layer-3-fail-closed path and the Layer-4-leak path (lines ~70, ~102,
~140, ~176), matching the final audit's own description.

**Phase 4 verdict: COMPLETE.** Matches its authoritative scope
(`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
`phase_4_defense_in_depth_security_quality`: Layers 1-4 real for at least one
compiled prompt's execution, wired to a real call site) with a real,
pre-merge PASS verdict on record.

---

## Phase 5 -- Browser Execution Tiers (PR #586 increment 1, PR #590 increment 2)

**Files verified present on `main`** (`src/lib/browser-execution/`):
`tier-detection.ts`, `tier-orchestrator.ts`, `client-compile.ts`,
`webllm-engine.ts`, `tool-calling.ts`, `worker-pool.ts`,
`worker-pool-test-worker.ts`, `transformers-engine.ts`, `model-cache.ts` --
each with a real `.test.ts`. Plus `src/app/api/prompt-compiler/execute/route.ts`
(new authenticated API route) and `src/components/veri-chat/VeriComposer.tsx`
wiring (both composer send paths call `runBrowserFirstPass()`).

**Tests:** `bun test src/lib/browser-execution` -> **58 pass / 0 fail** (101
`expect()` calls, 8 files).

**tsc clean:** Yes (repo-wide, see Cross-Cutting section).

**Audit verdicts (both real PASS, pre-merge):**
- PR #586, `2026-07-27T07:51:00Z` (before merge 09:25:21Z) -- **AUDIT: PASS**.
  Quote: *"The architecture is sound: tier detection/selection is a pure,
  injectable-env function with real unit coverage; the new API route
  correctly uses requireAuth()/Drizzle, treats client-supplied
  browserCompiled telemetry as strictly non-authoritative..."*
- PR #590, before merge `2026-07-27T10:48:22Z` -- **AUDIT: PASS**. Quote: *"I
  independently re-ran the claimed verification rather than trusting the
  self-report: `bun test src/lib/browser-execution/` reproduced exactly 58
  pass/0 fail across 8 files, the full `bun test` reproduced exactly 2088
  pass/0 fail across 180 files ..., and `bunx tsc --noEmit` is clean
  repo-wide."*

**Is phase 5 fully done? No -- this is the central finding of this audit.**
The task's KNOWN_CONTEXT correctly flagged this as an open question rather
than assuming completeness; the answer requires the authoritative scope
document, which does not live in `compliance-tracker`. It was located and
read read-only at `/opt/veridian/repos/claude-control` (a separate repo on
this machine, outside this task's write-scope):
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
(`phase_5_browser_execution_tiers`) plus the current
`ai-os/OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml` per-item verdicts.
That document does **not** define phase 5 in terms of numbered
"increment 1/2/N" (that framing is a dispatch-level artifact invented by the
task-issuing process, visible only in this repo's own PROGRESS.md/status
docs) -- it defines phase 5 by an explicit list of named gap items. Checked
against that real list, using the real code on `main` today:

| Gap item (phase-plan's own name) | Real status on `main` today |
|---|---|
| `engine-browser-lite-llm` (WebLLM) | **Done** -- `webllm-engine.ts`, real model wiring, 7 real tests |
| `engine-browser-mcp` | **Done** -- `tool-calling.ts#dispatchMcpToolCall`, real JSON-RPC envelope |
| `engine-browser-function` | **Done** -- `tool-calling.ts#BrowserToolRegistry`, real handler invocation |
| `engine-browser-worker` (deepen) | **Done** -- `worker-pool.ts`, real SharedArrayBuffer/Atomics pool, 6 real tests |
| `engine-browser-transformers` | **Done** -- `transformers-engine.ts`, real ONNX embedding pipeline |
| `engine-model-selection` | **Done** -- `tier-orchestrator.ts#planExecution`, real priority-ordered tier selection (this is newer code than the claude-control gap-analysis's own "UNCHANGED, not_implemented" verdict for this item, which was written before PR #586 merged and has not been re-checked since) |
| `engine-execution-planner` | **Done** -- same file, `ExecutionPlan`/`fallbackChain` logic, same staleness note applies |
| `engine-server-escalation` (deepen) | **Done** -- `tier-orchestrator.ts#requiresServerEscalation` |
| `stack-browser-compute` / `stack-parallelism` (deepen) | **Done** -- `tier-orchestrator.ts#planParallelism`, `worker-pool.ts#recommendPoolSize` |
| **`engine-browser-npu`** | **Not done** -- `tier-detection.ts#detectNpuTier` is feature-**detection** only (`navigator.ml` presence check); there is no code anywhere that actually runs WebNN inference. The phase's own requirement is "WebNN-based NPU **inference**." |
| **`engine-browser-builtin-ai`** | **Not done** -- same gap: `detectBuiltinAiTier` only checks `window.ai`/`window.LanguageModel` presence; no code calls it to actually run Gemini Nano inference. |
| **`engine-browser-storage`** | **Not done as scoped.** `model-cache.ts` is real, but PR #590's own comment explicitly scopes it as "engine-local plumbing for each engine's own weight cache, with zero cross-engine/cross-tier sharing" and explicitly disclaims that it is phase_6's shared cache hierarchy. The phase-plan's actual requirement for this item is a general "multi-backend storage management across OPFS, IndexedDB, and Cache API" -- no OPFS or Cache API code exists anywhere in `src/lib/browser-execution/`. |
| **`engine-browser-sync`** | **Not done at all.** Zero code anywhere in the repo implements "server synchronization with conflict resolution, offline queuing, delta sync" for the browser tier. Confirmed by grep -- no match beyond unrelated identifiers. |
| **`litert-spike` registration in `MASTER_INDEX.yaml`** | **Not done.** Phase 5's own scope explicitly names this as its required "FIRST STEP, before any new code." Checked the real `ai-os/MASTER_INDEX.yaml` in claude-control: `litert-spike` appears only in narrative prose inside an unrelated gap-analysis entry, never as its own registry entry. |
| Phase-plan yaml status update | **Not done** (see Cross-Cutting Governance-Drift section below) -- explicitly disclosed as a cross-repo follow-up in PR #590's own status doc, not silently skipped. |

**Phase 5 verdict: INCOMPLETE.** Real, substantial, well-tested progress
(9 of 13 real gap items done, including two -- `engine-model-selection`/
`engine-execution-planner` -- that the authoritative tracker still lists as
`not_implemented` because it hasn't been re-run since these PRs merged), but
NPU/Built-in-AI tiers are detection-only stubs with no real inference path,
the general browser storage engine and the entire browser-sync engine are
unbuilt, and the phase's own mandated first step (litert-spike registration)
was never done. This is not a case of a false "done" claim -- no PR or
status doc in `compliance-tracker` claims phase 5 is fully done -- but the
task's open question is answered: **phase 5 has real, named, un-dispatched
scope remaining.**

---

## Phase 8 -- DSPy / AI-Learning Increment 1 (PR #589)

**Files verified present on `main`:**
`ai-os/VERIDIAN_V2_DSPY_TECH_DECISION_2026-07-27.md` (adopt/reject decision
document), `src/lib/services/capability-learning-service.ts` (extended with
`shouldExploreAsUnknownPrompt`/`exploreUnknownPrompt`/
`UNKNOWN_PROMPT_MODE_PILL`, confirmed by grep on current `main`), one real
call site added in `src/app/api/prompt-compiler/execute/route.ts`.

**Tests:** `bun test src/lib/services/capability-learning-service` -> **27
pass / 0 fail** (44 `expect()` calls). Combined with phase 4:
`bun test src/lib/prompt-security src/lib/services` -> **1032 pass / 0 fail**
(1931 `expect()` calls, 89 files).

**tsc clean:** Yes (repo-wide).

**Audit verdict (real, pre-merge):** `2026-07-27`, before merge
`11:24:34Z` -- **AUDIT: PASS**. Quote: *"The DSPy adopt/reject decision is
well-reasoned and evidenced (real pip dry-run installability check, a clear
conflict against the Owner's existing 2026-07-25 deterministic-pipeline
directive, and no fabricated integration point), and the engine-ai-learning
extension to capability-learning-service.ts ... is a genuine, non-duplicative
reuse ..."* One non-blocking reliability gap was flagged by the auditor and
left open (an unguarded `await exploreUnknownPrompt(...)` in the main request
path of the execute route could turn a transient DB failure into a hard 500)
-- correctly disclosed, not merge-blocking, still open today (confirmed:
`grep -n "exploreUnknownPrompt" src/app/api/prompt-compiler/execute/route.ts`
shows no surrounding `try`/`catch`).

**Is phase 8 fully done? No.** Its authoritative scope
(`phase_8_dspy_learning_distribution_engines`) names 7 gap items:
`engine-dspy-integration` (done -- real, justified rejection decision, not a
build gap: DSPy is honestly not adopted, with a documented, still-open
follow-up trigger), `engine-ai-learning` (done, per above), and five more --
`engine-prompt-translation`, `engine-prompt-localization`,
`engine-prompt-marketplace`, `engine-prompt-export`, `engine-prompt-import` --
**none of which PR #589 touches at all.** This matches the PR's own title,
"increment 1... zero-prior-art engine scoping" (i.e. it scoped/deferred them,
it did not build them), and the current claude-control gap analysis still
marks all five `not_implemented` (export is only incidentally,
partially covered by an unrelated pre-existing PR #561 script, not by this
phase's own work).

**Phase 8 verdict: INCOMPLETE.** 2 of 7 named gap items done (with real,
tested code and a genuine technology-adoption decision); 5 of 7 --
translation/localization/marketplace/export/import -- remain entirely
unbuilt and are honestly disclosed as such by the PR's own "increment 1"
framing, not hidden.

---

## Phase 9 -- Gateway/Knowledge-Sync Wiring (PR #588)

**Files verified present on `main`:** `src/app/api/ai/orchestrate/route.ts`
(now calls Mother Router's `resolveModel({scope:"end_user_org",...})` instead
of a direct `orchestra-model-resolver.ts` call, confirmed at
route.ts:225-226), `src/lib/ai-router/mother-router.ts` (new
`resolvedConfig` field), `src/lib/ai-router/mother-router.test.ts` (4 new
tests for the added behavior).

**Tests:** `bun test src/lib/ai-router/mother-router.test.ts` -> **30 pass /
0 fail** (72 `expect()` calls) -- isolated to the file this PR actually
changed. (Note: `bun test src/lib/ai-router` as a whole directory reports 7
failures in a *different*, unrelated file, `tenant-ai-config.test.ts`
-- a pre-existing `mock.module()` test-isolation artifact around a missing
`tokenUsageLedger` re-export that disappears when the full repo suite runs
together; confirmed non-reproducing in the full `bun test` run, 2210 pass / 0
fail. This is unrelated to phase 9's V2-5 BYOB feature area and out of this
audit's scope -- flagged here only for completeness, not counted against
phase 9.)

**tsc clean:** Yes (repo-wide).

**Audit verdict (real, pre-merge):** before merge `09:35:01Z` --
**AUDIT: PASS**. Quote: *"the change is additive, isolated to one route plus
mother-router.ts's new optional resolvedConfig field, preserves the existing
BYO-precedence and audit-log contract ... keeps the enforcePolicy() guardrail
marker required by scripts/check-guardrail-presence.mjs intact, does not
touch migrations/auth/payment/billing/RLS paths or .github/workflows/**."*
One real, disclosed, dormant bug was found and left open (a package-override
branch silently carries over the pre-override `fallback` chain) -- confirmed
today still present in `mother-router.ts`, confirmed still unreachable in
production (no seeded `ai_routing_policies` row exists), matching the
auditor's own "does not block this... tier1" framing.

**Is phase 9 fully done? Partially, and correctly scoped as such.** Its
authoritative scope names 3 gap items: `engine-gateway-integration`,
`engine-knowledge-sync`, `engine-capability-intel`. The current claude-control
gap analysis (re-verified 2026-07-27, post-merge, via its own real
`grep -q veridian-v2 ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json` check --
independently reproduced by this audit, **found**, entity
`route-RT-veridian-v2-gateway-knowledge-sync-001`) explicitly keeps both
`engine-gateway-integration` and `engine-knowledge-sync` at
`partially_implemented`, not `fully_implemented`, by the phase's own design:
this phase deliberately wires exactly one real call site
(`orchestrate/route.ts`) through Gateway G05 as a proof, not all ~35 other AI
dispatch call sites mother-router.ts documents, and deliberately does not
attempt the knowledge-sync engine's browser-cache half (explicitly phase 5's
concern). This is a phase whose own scope note anticipates and accepts
partial closure, not a phase falsely claimed complete.

**Phase 9 verdict: COMPLETE against its own stated scope** (one real,
audited, tested gateway hop, honestly not claiming to close the other
~35 call sites or the browser-cache half of knowledge-sync, both of which its
own plan explicitly defers elsewhere).

---

## Cross-Cutting: Governance-Record Drift (applies to all 4 phases)

The authoritative phase-plan tracker in the `claude-control` repo
(`ai-os/OWNER_ENGINE_TASK2_PHASE_PLAN_2026-07-27.yaml`, committed
`2026-07-27T06:17:57Z`, only one commit ever touching it) still reads, as of
this audit:
- `phase_4`: `status: blocked_needs_conflict_resolution_and_review`
- `phase_5`: `status: not_started`
- `phase_8`: `status: not_started`
- `phase_9`: `status: not_started`

All 5 PRs in this audit's scope merged **after** that commit
(09:10-11:24 UTC on 2026-07-27, vs. the tracker's 06:17:57Z snapshot), and
nothing has updated these 4 status fields since. The companion gap-analysis
file (`ai-os/OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml`) has been
partially refreshed (phase 9's 3 items were explicitly re-verified post-merge
in a later commit, `d00816b`), but phase 5's and phase 8's per-item verdicts
for several genuinely-shipped items (`engine-model-selection`,
`engine-execution-planner`, `engine-ai-learning`) still read
"UNCHANGED 2026-07-27... no commits touch this area since PR #561" -- which
is factually stale, since PR #586/#590/#589 all post-date PR #561 and do
touch those exact areas. This is a real tracking gap independent of the code
itself: the code is real and audited, but the cross-repo status registry
that is supposed to reflect "is this phase done" has not caught up, exactly
as PR #590's own status doc flagged for its own item 8 ("cross-repo follow-up,
not done here"). Not fixed by this task, per its own report-only constraint --
flagged here as a genuine open item for whichever session next has
claude-control write access.

## Cross-Cutting: Full Test/Type-Check Evidence

- `NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit`: **0 errors**,
  repo-wide, run live this session.
- `bun test src/lib/prompt-security src/lib/services`: **1032 pass / 0 fail**
  (1931 `expect()` calls, 89 files).
- `bun test src/lib/browser-execution`: **58 pass / 0 fail** (101 `expect()`
  calls, 8 files).
- `bun test src/lib/ai-router/mother-router.test.ts`: **30 pass / 0 fail**
  (72 `expect()` calls) -- the file phase 9 actually changed.
- Full repo suite, `bun test`: **2210 pass / 0 fail** (4348 `expect()` calls,
  199 files).
- All figures above were reproduced live in this session against
  `compliance-tracker` `main` (commit `c32c6db6`, forked from `df665722`),
  not copied from any prior PROGRESS.md or PR comment.

## Summary Table

| Phase | Files present & real | Tests | tsc | Pre-merge PASS verdict quoted | Verdict |
|---|---|---|---|---|---|
| 4 -- Defense-in-depth | Yes | 44/44 pass | Clean | Yes (after 2 real FAIL rounds) | **COMPLETE** |
| 5 -- Browser execution | Yes (9/13 gap items) | 58/58 pass | Clean | Yes (both increments) | **INCOMPLETE** -- NPU/Built-in-AI real inference, general storage engine, sync engine, and litert-spike registration all still unbuilt |
| 8 -- DSPy/AI-learning | Yes (2/7 gap items) | 27/27 + 1032/1032 combined pass | Clean | Yes | **INCOMPLETE** -- translation/localization/marketplace/export/import engines unbuilt (honestly disclosed as deferred, not hidden) |
| 9 -- Gateway/knowledge-sync | Yes | 30/30 pass | Clean | Yes | **COMPLETE against its own explicitly partial scope** |

**Overall OWNER_ENGINE phases 4/5/8/9: NOT 100% complete.** Phases 4 and 9 are
genuinely done against their real, authoritative scope. Phases 5 and 8 have
real, tested, honestly-audited partial progress, with specific, named,
un-dispatched scope items remaining (detailed above) -- this was an open
question the task asked to resolve, not an assumption, and it is now
answered with file-level evidence rather than left to a self-report.
