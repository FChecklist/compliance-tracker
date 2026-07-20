# AI Cache & Triage Architecture — Reference (v1, 2026-07-20)

AUDIENCE: AI agents (Mother Router, task-dispatch workers, Claude sessions). NOT written for human readability — machine-parseable structure, no narrative padding, per Owner directive. Objective: fast work, lowest token usage. Applies to both the end-user product path and software-development/gap-closure dispatch.

STATUS legend used throughout: `[LIVE]` = built and tested. `[DESIGNED]` = specified precisely, not yet implemented. `[EXISTING]` = already exists elsewhere, cross-referenced not rebuilt.

---

## 0. FLOW

```
End User
  |
  v
[L0] UI Cache (mode pills, recent selections, prompt history)      [EXISTING, partial — see §4]
  |
  v
API Gateway
  |
  v
SOFTWARE REQUEST ANALYZER (§1)  <-- MANDATORY GATE, runs before any cache lookup or AI call
  |
  +-- 100% software-solvable --> execute in software --> User (AI never invoked, $0 tokens)
  |
  +-- needs AI (wholly or partly) --> CACHE CHECK, in this order:
       |
       +-- [L1] Exact Output Cache     [LIVE]
       +-- [L2] Semantic Cache         [DESIGNED]
       +-- [L3] Workflow Cache         [DESIGNED]
       +-- [L4] Tool Cache             [DESIGNED]
       +-- [L5] Context Cache          [LIVE, partial]
       +-- [L6] Vector Retrieval/RAG   [DESIGNED, infra exists — see §3.6]
       |
       v (no cache layer hit)
  Prompt Builder (adds ONLY the missing context, per §5 watertight template)
       |
       v
  AI Router  (Mother Router / task-dispatch — sends ONLY the AI-required portion)
       |
       v
  Post-Processor
       |
       v
  Store output in L1-L6 as applicable
       |
       v
  User
```

---

## 1. SOFTWARE REQUEST ANALYZER (mandatory triage gate)

Runs BEFORE any cache lookup and BEFORE any AI call. This is the single highest-leverage step: every request routed to AI that software could have handled is 100% wasted tokens.

**Decision procedure, in order:**

1. **CAN_SOFTWARE_SOLVE check** — is this fully deterministic? YES if the operation is: a lookup, a calculation, a format conversion, a validation against a fixed rule, a CRUD operation with no judgment call, a status transition with an explicit rule table, a report/aggregation from existing data, a regex/pattern match, a schema check, a file operation, a test run, a lint/typecheck, a git operation. See VCEL computation-engine registry (`src/lib/engines/`, confirmed live tonight — 32 engine files present, e.g. `accounting-engine.ts`, `analytics-engine.ts` — check it before assuming something needs AI; prior sessions referenced "247 engines across 25 categories" but that count wasn't re-verified tonight, treat it as unconfirmed) for the canonical "software can do this" catalog in this codebase.
   - If YES → route to software (0 tokens, 0 AI calls). Log `route=SOFTWARE_ONLY`.
2. **SPLIT_ESTIMATE** — if not 100% software, estimate the split. Categories that are typically majority-software with a small AI sliver: "generate boilerplate matching an existing pattern" (~80% software — copy pattern, ~20% AI — adapt names/fields), "explain why X failed" (~60% software — gather logs/state, ~40% AI — synthesize explanation), "write new business logic with no existing pattern" (~10% software — scaffolding, ~90% AI — actual logic).
   - Route the software portion to deterministic code FIRST. Only the residual AI-required portion goes to step 3.
3. **AI portion** gets a watertight prompt (§5) covering ONLY that residual — never re-derive the software portion inside the AI call.
4. **LOG** the decision: `route`, `software_pct`, `ai_pct`, `reasoning` (one line) — feeds the task register (§6).

**This is not optional per-task discretion.** A task prompt that routes 100% to AI without running this triage first is non-compliant with this architecture.

---

## 2. NUMBERED CACHE LAYERS

### [L1] Exact Output Cache — LIVE
- **What**: full response cached against an exact hash of (model + messages + tools + tool_choice).
- **Where**: `/opt/veridian/scripts/anthropic_openrouter_proxy_v2.py`, SQLite at `/opt/veridian/ai-os/logs/glm-response-cache.sqlite`.
- **Hit action**: return cached response, $0 real cost, logged with `cache_hit: true`.
- **Scope**: catches literal repeats — a retry that resends an identical prompt because nothing changed. Does NOT match near-duplicates (that's L2).
- **Test evidence**: 36x latency drop on hit, concurrency-safe, never caches errors. See `ai-os/COST-CONTROL.md`.
- **Who uses it**: automatic — every call through the GLM proxy passes through L1 with no caller action needed.

### [L2] Semantic Cache — DESIGNED
- **What**: embedding-similarity match above a threshold (proposed: cosine ≥ 0.92) returns a cached response for a *near*-duplicate request, flagged `semantic_match: true` so the caller knows it's not exact.
- **Restriction**: advisory/read-only queries ONLY. Never for a tool-use call that mutates state (create/edit/delete/commit) — a near-duplicate prompt in a mutating context can have a materially different correct action. This restriction is a hard guardrail, not a tuning knob.
- **Proposed store**: the `pgvector` extension is confirmed installed (checked tonight via direct SQL) on the Supabase project referenced by `compliance-tracker/.env.local` (`pcrjmlpuqsbocqfwoxod`). Caveat carried over from `COST-CONTROL.md`: that same project was found to have only 7 tables unrelated to the main app schema when checked earlier tonight — whether this is genuinely the production database or a stale/wrong `.env.local` pointer was flagged then and is still unresolved. Confirm which before building on it; don't assume it's production-ready infra without that check.
- **Not yet built**: needs an embedding call per request (itself a cost — must be cheaper than the alternative to be worth it; only apply to genuinely repetitive query shapes, e.g. "what does field X mean" style lookups).

### [L3] Workflow Cache — DESIGNED
- **What**: caches a whole multi-step *procedure/plan* (not a single response) keyed by request archetype — e.g. "add a new ERP module page" always follows the same N-step shape (schema → service → route → page → test). Cache the PLAN, not the generated code, so the AI doesn't re-derive "what are the steps" every time, only executes them.
- **Key**: archetype label (small, curated, human-assigned list — e.g. `erp-module-add`, `report-add`, `role-permission-add`), not a hash.
- **Store**: proposed `ai-os/workflow-cache/<archetype>.md` per archetype, versioned, checked into the repo (not a runtime DB — these are meant to be reviewed/edited by a person occasionally).
- **Not yet built**: needs the archetype catalog written first (a real inventory of this codebase's recurring task shapes) before the cache has anything to store.

### [L4] Tool Cache — DESIGNED (highly implementable, flagged as next quick win)
- **What**: tool/function schemas are currently re-sent in full on every single call (confirmed — the proxy's `anthropic_tools_to_openai()` re-serializes the full tool list every request). Tool schemas rarely change within a session. Cache the serialized tool-schema block once per session/task, reference it by ID on subsequent calls instead of re-transmitting.
- **Why not done tonight**: requires either provider-side support for a referenced/cached tool block (unverified for OpenRouter/GLM-5.2, same caveat as provider prompt-caching in `COST-CONTROL.md` Q8) or a proxy-side rewrite that reconstructs the full payload from a cached tool-block ID before forwarding — the latter is buildable without provider support and is the recommended next implementation step given it doesn't depend on unverified provider features.

### [L5] Context Cache — LIVE (partial)
- **What**: static context (the original task prompt, standing instructions, repo conventions) referenced by pointer instead of re-embedded in full on every resumed invocation.
- **Where**: `worker-entrypoint.sh` — confirmed fixed for the original-task-prompt case (`SPEC: full task spec is prompt.txt in cwd... not restated here`). See `COST-CONTROL.md` Q8 for test evidence.
- **Not yet generalized**: only the original-prompt case is fixed. Other static context (repo directory structure, coding-style docs, this very architecture document) is not yet systematically pointer-referenced across all task types — same principle should extend there. Flagged as remaining work, not falsely claimed complete.

### [L6] Vector Retrieval / RAG — DESIGNED, infra exists
- **What**: retrieval-augmented generation over the codebase/docs for context the AI needs but that's too large to always include (e.g. "find the existing pattern for X" instead of an AI guessing).
- **Infra**: Supabase pgvector already deployed for `verdian-ai` (embedding cache built per prior work — do not rebuild). Wiring task dispatch to actually query it is the remaining gap.
- **Not yet built tonight.**

---

## 3. [L0] UI CACHE — EXISTING, cross-referenced not rebuilt

Mode pills / recent selections / prompt history already has a real implementation: the IndexedDB workflow-recall palette on VeriComposer (prior work, "browser intent cache"). This document doesn't rebuild it — it's the client-side layer sitting above everything in §0's flow diagram, feeding into the API Gateway.

---

## 4. WATERTIGHT PROMPT TEMPLATE — mandatory for every AI-bound prompt

Every prompt sent to an AI (after the Software Request Analyzer has already stripped out the software-solvable portion) MUST specify these fields explicitly. Machine-language, not prose — a human reads the SUMMARY a task produces; the PROMPT itself is read only by AI.

```
INPUT: <exact data provided, nothing implicit assumed known>
OUTPUT: <exact expected output shape/format/location>
GUARDRAILS: <hard constraints — things that must NOT happen, non-negotiable>
FAILURE_DETECTION: <the specific, checkable condition that means this failed>
SUCCESS_DETECTION: <the specific, checkable condition that means this succeeded>
CACHE_LAYERS_CHECKED: <which of L1-L6 were consulted before this prompt was built>
SOFTWARE_PCT / AI_PCT: <the §1 triage split for this request>
```

An "open" instruction — one that describes a goal without INPUT/OUTPUT/GUARDRAILS/FAILURE_DETECTION/SUCCESS_DETECTION filled in — is non-compliant. The RCA in `COST-CONTROL.md` traces real wasted spend (BYOB-AI-model, 2.3 hours, 12 retries) directly to an open-ended instruction with no failure-detection criterion, letting it retry the identical broken approach without ever being told clearly that it had already failed the same way.

---

## 5. TASK REGISTER INTEGRATION

Every task's `task.yaml` (via `veridian-task.py checkpoint`) should record, per invocation:
- `cache_layers_used`: list of L1-L6 that were hit (empty list is valid and honest if none hit).
- `software_ai_split`: `{software_pct, ai_pct}` from the §1 triage.
- `watertight_prompt_compliant`: bool — did this invocation's prompt carry all 5 mandatory fields from §4.

See `ai-os/scripts/preflight-guard.py` and `worker-entrypoint.sh` for the mechanism this plugs into — the schema extension itself is tracked as a follow-up implementation item (see COST-CONTROL.md's honest-gaps section for what's designed vs. built as of this document's writing).

---

## 7. COVERAGE MATRIX — real recheck, 2026-07-20, "ensure 100% for all AI tasks" audit

Every distinct AI-invocation path found by direct grep of the codebase (not assumed complete — this list itself may still be incomplete; treat as the best real inventory taken so far, not a guarantee no path was missed).

| Path | Cache | Circuit breaker / loop prevention | Cumulative budget | Software-vs-AI triage | Hallucination/low-confidence detection |
|---|---|---|---|---|---|
| `worker-entrypoint.sh` (GLM worker fleet) | `[LIVE]` L1 exact-match | `[LIVE]` 2-identical-failures stop | `[LIVE]` proxy hard ceiling | not wired (existing app-side `classifyExecution` not reachable from bash) | not present |
| `doc-worker-entrypoint.sh` (reverse-engineering fleet) | none (real subscription path, different cost model) | `[LIVE]`, added this pass | n/a (subscription, not metered per-call the same way) | not wired | not present |
| `runRole()` / AI Team dispatch (`team-service.ts`) | none (no exact-match response cache) | `[EXISTING]` bounded per-call retry with failure-signal injection (`detectLowConfidenceResponse`/`detectKnowledgeGap`), real and good, not rebuilt | `[LIVE]`, added this pass — real gap closed: this call bypasses the GLM proxy entirely, called directly from the Next.js process | `[EXISTING]` `software-coverage-service.ts`'s `classifyExecution()` — mature, DB-backed, NOT duplicated by this document's earlier `software-request-analyzer.py` (that script is scoped to the shell/bash layer only, which has no access to this TS/DB-backed system) | `[EXISTING]` `floor-tier-escalation.ts` + `knowledge-sufficiency-gate.ts`, deterministic phrase-matching, honestly scoped (catches hedging, not confident-wrong-answers) |
| `generateAiReply()` / VERI Chat (`chat-service.ts`) | `[EXISTING, partial]` `prompt-cache/` framework — fingerprints Anthropic's own `cache_control` usage for metrics; unverified tonight whether VERI Chat's live calls still go through real Anthropic or have also moved to OpenRouter (if the latter, this framework's premise may be stale, same class of issue as the "proxy disabled" doc drift found earlier) | not verified this pass | not verified this pass | not verified this pass | not verified this pass |
| `supervisor-entrypoint.sh` | none | none | n/a | not wired | not present |
| `master-decompose.py` | none | none | n/a | not wired | not present |
| Remaining ~20 of the 26 TS files found touching AI calls (`task-execution-engine.ts`, `dialogue-script-executor.ts`, `purpose-bound-ai.ts`, `communication-drafting-service.ts`, etc.) | not individually re-verified this pass | not individually re-verified this pass | not individually re-verified this pass | not individually re-verified this pass | not individually re-verified this pass |

**Honest conclusion: not 100%.** Real, verified, tested progress landed this pass on the two highest-risk gaps found (doc-worker fleet had zero protection; `runRole()` bypassed every cost control that exists). `supervisor-entrypoint.sh`, `master-decompose.py`, the VERI Chat path, and ~20 further TS call sites are confirmed NOT yet re-verified against this checklist — flagged as open, not silently assumed fine.

**UTM-style indexation — not built this pass.** Specified in §2 as a requirement but no implementation landed: the cache DB still keys on a raw SHA-256 hash, the task register still uses free-text titles and timestamp-slug IDs. This is real, scoped, buildable work — deferred here in favor of closing live, currently-unprotected paths first, not because it's less important.

## 6. WHO USES THIS DOCUMENT

- **Mother Router** (`src/lib/ai-router/mother-router.ts`): should consult §1 (triage) before dispatch, and route through §2's cache layers before invoking a model. Not yet wired into that file — this document is the specification for that integration, not a claim that it's done.
- **Task-dispatch workers** (`worker-entrypoint.sh`, `doc-worker-entrypoint.sh`): L1 and L5 already live via the GLM proxy and prompt-construction fix respectively.
- **Any AI agent authoring a new task prompt**: use §4's template. Non-compliant prompts should be flagged in review, not merged as-is.
