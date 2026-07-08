# Wave 114 — Deterministic Dispatch + First VCEL Wiring

## Why

A full-platform audit (5 parallel research agents + direct code reads, 2026-07-08) found the central promise of the VERI Chat composer — "select options in the Mode Pills + Chain Selector, get a real answer without paying for an LLM" — didn't exist. Every task submission unconditionally called an LLM (`task-execution-engine.ts`'s `executeTask()`) to re-guess intent from a flattened breadcrumb string, even when the user had already told the system exactly what they wanted via clicks. Separately, VCEL — 211 of 247 registered computation engines, genuinely implemented with real logic — had zero callers anywhere in the app.

## What this wave closed

1. **Structured (non-LLM) dispatch path.** `tasks.resolvedWorkerAgentId` (new column) marks a task as created from a completed chain selection rather than free text. `VeriComposer.tsx` now sends the leaf's already-resolved `codeReference`/`engineKey` (it always had this data — `capability-tree-service.ts` set it on every leaf — it just was never sent to the backend). `task-service.ts`'s `createTask()` re-verifies the worker agent server-side (tier=global, lifecycleStatus approved/published, non-null codeReference) before trusting it. `executeTask()` skips the whole `resolveModelConfig`/`callLLMJson` planning block entirely when a resolution is present — zero LLM calls, zero `orchestra_executions` cost row.

2. **Safety-gate design decision (user-confirmed):** structured dispatch does **not** run `isToolAllowedForDomain()` (the `purpose-bound-ai.ts` allowlist). That allowlist exists to stop an LLM from picking an inappropriate tool on its own discretion; a human's explicit chain-selector click has no discretion to guard against. The allowlist is completely unchanged for the free-text/LLM-planning path, which still enforces it exactly as before.

3. **3 previously-unimplemented worker-agent dispatchers**, now real: `list_compliance_items`, `list_notices`, `get_task_status` (contextual — status of the task it's running inside, not an arbitrary lookup; structured dispatch has no argument-capture UI yet). `create_compliance_item`, `update_compliance_status` (write actions needing real field args) and `get_penalty_estimate` (needs a specific item) remain deliberately deferred, consistent with this engine's existing "recorded as a plan step, not auto-executed" posture for anything it can't safely run unattended.

   Net: **6 of 9 published worker agents are now genuinely dispatchable with zero LLM cost**, reachable directly from the chain selector (up from 0 reachable before this wave, due to the domain-gate mismatch above).

4. **First VCEL slice wired into real dispatch**: 3 GST Engine functions (`splitGst`, `calculateGst`, `isValidHsnFormat`) via a new `dispatchEngine()` in `task-execution-engine.ts` — deliberately a small, explicit `switch` allowlist, **not** a generic resolver that dynamic-imports whatever `computation_engines.implementation_ref` says (letting a database row control which file gets imported/called would be a real code-execution surface). `capability-tree-service.ts` gained a new "Calculators" branch sourced from the real `computation_engines` registry, scoped to just these 3 wired `engine_key`s. `VeriComposer.tsx` renders a small structured-input form (number/text fields, defined per engine) once a calculator leaf is selected — free text becomes optional context instead of the primary input for these leaves.

5. **Fixed a confirmed live regression**: `/api/home/todos` was calling the older `listMyTodos()` (bare `tasks` table only) instead of `listVeriTodos()` (unions tasks + instructionCommitments + pmsIssues — built specifically to fix this exact gap in an earlier wave and never wired at this call site). `ToDoTab.tsx` adapted to the real `{items: [...]}` shape; only `source: "task"` items get the interactive complete-checkbox (the only source with a real `/api/tasks/:id` PATCH target), the other two sources render read-only via their own `href`.

## What's still open (not this wave)

- Only 3 of 247 VCEL engines are wired. The pattern (registry lookup → structured input fields → explicit dispatch switch case) is now proven and mechanical to repeat, not a redesign — extending it to more engines (starting with the rest of GST Engine, then Fixed Asset/Income Tax) is the natural next wave.
- 3 worker-agent dispatchers remain deliberately deferred (2 write actions, 1 needing a specific-item argument) — need a confirmation-step UI before it's safe to auto-dispatch them.
- `office` and `veri_reward` product branches remain phantom/half-built (see audit). `procurement` has never been enabled for any org.
- The general pre-LLM routing cascade (AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md gap #1) is now closed for this one specific path (chain-selector → worker-agent/engine); it's still absent as a general pattern across other LLM call sites (chat, FDE, page agent).
- `/veri-ai` and `/chat` remain independent, hand-built chat UIs (a 3rd/4th implementation alongside GlobalChatDock and VeriComposer) — not touched this wave.
