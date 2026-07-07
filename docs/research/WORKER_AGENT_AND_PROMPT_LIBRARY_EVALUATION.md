# Worker Agent Library & Prompt Directory — Evaluation & Recommendation

**Author:** CEO / Technical Director (AI Workforce) · **For:** Founder & CEO
**Status:** Evaluation only — no code changed. Grounded in direct reads of `capability-registry-service.ts`, `embeddings.ts`, `prompt-os-resolver.ts`, `worker-agent-service.ts`, `fde-service.ts`, `llm-response-cache.ts`, `automation-rule-service.ts`, `ai-team/roster.ts` + `team-service.ts`, `AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md`.

## Bottom line up front

**Don't build either system as new infrastructure. Both are already ~70% built.** What VERIDIAN needs is two small extension waves on top of existing mechanisms (Capability Registry + Embeddings + Prompt OS), not two new subsystems. Building "from scratch" would create a second, competing source of truth for exactly the problem the Capability Registry and VERI FDE were built to solve two waves ago. That duplication risk is the single biggest thing to flag to the Boss before anyone writes code.

---

## 1. Is a Worker Agent Library genuinely new?

**No — `worker_agents` + `capability-registry-service.ts` + VERI FDE already *is* the Worker Agent Library, at Wave 16/42/43 maturity.** Concretely, today:

- `worker_agents` table already stores tier-scoped (`user`/`client`/`customer`/`global`), lifecycle-gated (`proposed → approved → published`) reusable agents with `promptTemplate`, `inputSchema`, `outputSchema`.
- `capability-registry-service.ts` embeds each agent's full contract (name + domain + description + input/output schema) and exposes `findSimilarCapabilities()` for semantic lookup, plus `auditDuplicateCapabilities()` to catch near-duplicates (≥0.92 similarity).
- `fde-service.ts` (VERI FDE) already runs this lookup *before* any ad-hoc LLM reasoning: a ≥0.9 match short-circuits with **zero LLM call**; anything below that only sends the top-8 candidates (not the whole org catalog) to the LLM, which then either matches or proposes a brand-new agent through the same approval pipeline.
- Governance already exists: non-admins can only propose `user`-tier agents; `customer`/`client`-tier needs admin; `global`-tier is blocked at the RLS layer entirely — this *is* the maker-checker control the Boss would otherwise ask for.

What's honestly missing is **not the registry, it's dispatch and confidence.** Today, a high-confidence match in `fde-service.ts` produces a *message telling the user* an existing capability covers their request — it does not itself execute the matched worker agent's action against a VERIDIAN API. There is no `dispatchWorkerAgent()` that takes a match + extracted parameters and actually calls the module. That is the real gap, and it's a moderate, well-scoped addition, not a new system.

**Recommendation:** Do not build a second "Worker Agent Library." Extend the existing one with an execution/dispatch layer. Naming it as a new product initiative would be misleading to the team and to the Boss — call it "Worker Agent Dispatch," not "Worker Agent Library v2."

---

## 2. Proposed data shape for a worker agent entry

The `workerAgents` table + its embedded capability record already cover most of this. The concrete gap is fields needed for *auto-dispatch* decisions, which don't exist yet. Proposed additive columns (no new table):

| Field | Type | Purpose | Status |
|---|---|---|---|
| `name`, `domain`, `description` | text | identity, already embedded for search | **exists** |
| `inputSchema` / `outputSchema` | jsonb | contract for the API call | **exists** |
| `promptTemplate` | text | how to phrase the call if an LLM step is still needed | **exists** |
| `tier`, `lifecycleStatus` | enum | governance/scope | **exists** |
| **`triggerPatterns`** | text[] or jsonb | canonical phrasings/example utterances used to seed embedding search and (see §3) the prompt directory — currently the *description* doubles as this informally; should be explicit | **gap — add** |
| **`apiEndpoint` / `moduleKey` + `action`** | text | which VERIDIAN service/route this agent actually calls (e.g. `erp-invoicing-service.createInvoice`) — today `promptTemplate` implies this loosely via prose, never machine-callable | **gap — add** |
| **`requiredParams`** | jsonb (subset of `inputSchema`) | which fields *must* be filled before dispatch vs. optional | **gap — add, derivable from inputSchema** |
| **`autoDispatchThreshold`** | float, default e.g. 0.90 | confidence score (reuses the existing embedding similarity score) above which the agent fires without asking; below it, the user is shown a confirm-before-run prompt. Mirrors `HIGH_CONFIDENCE_THRESHOLD = 0.9` already hardcoded in `fde-service.ts` — should become a per-agent, admin-tunable column instead of one global constant. | **gap — add** |
| `successCount` / `lastDispatchedAt` | int / timestamp | usage-based evolution signal (see §4) | **gap — add** |

This is a schema migration on an existing table (2–4 new nullable columns), not a new domain model.

---

## 3. Prompt Directory / predictive matching — recommendation

Three options were named; here is the honest cost/latency tradeoff for VERIDIAN specifically:

- **(a) Embedding similarity against a curated catalog.** Reuses `embeddings.ts` and `capability-registry-service.ts` verbatim — no new infra. Cost: one embedding call (~$0.0001, cached via `embedding_cache` on exact repeat text) + a pgvector query (sub-ms at current scale, per the gap analysis). Latency: dominated by the OpenRouter embeddings round-trip (~100–300ms), already the system's known bottleneck, not the search itself.
- **(b) A cheap classifier-model call before the main LLM.** Adds a *second* network round-trip to a model provider on every request, before you even know if a template exists. This is strictly worse than (a) on both cost and latency for VERIDIAN's specific case, because (a) already gives a numeric confidence score for free from the same infra a classifier would need to be trained/prompted to produce. A classifier only earns its cost when embedding similarity alone is provably insufficient (e.g. needs multi-step reasoning) — not shown yet.
- **(c) Client-side prefix/fuzzy-match autocomplete.** Genuinely free and instant (no network call), but shallow — it matches literal text prefixes, not intent, so "cancel my last GST filing" and "undo the GST submission I made" would never match each other. It's a good *UI affordance* layered on top of (a), not a substitute for it.

**Recommendation: (a) embedding similarity, reusing `embeddings.ts` and `capability-registry-service.ts` directly, with (c) as a thin client-side layer on top for perceived speed — not (b).** Concretely: as the user types, debounce ~300ms, then run the same `findSimilar()`/`findSimilarCapabilities()` call already used by VERI FDE against a curated `prompt_pattern` embedding set (new entity type in the *existing* `CAPABILITY_ENTITY_TYPES` union, e.g. `"prompt_pattern"` — zero new tables, `embeddings` table is already entity-type-generic). A ≥0.9 match autocompletes/pre-fills the recognized intent client-side (cache-backed via `embedding_cache`, so a repeated common phrase across *any* user costs nothing after the first embed); below threshold, falls through to today's full LLM path unchanged. This is the direct token-and-latency win the Boss is asking for, and it is additive to infrastructure that already exists — no new vendor, no new model, no new latency category introduced.

---

## 4. How the library should evolve — concrete mechanism

VERIDIAN already has every piece needed except the promotion trigger itself:

1. **Track usage, not just creation.** Add `successCount`/`lastDispatchedAt` (§2) to `workerAgents`, incremented each time a dispatched call succeeds (mirrors the existing `workerAgentLearnings` / `worker_agent_usage_log` pattern already referenced in `worker-agent-service.ts`'s comments).
2. **Promotion trigger: N successful ad-hoc completions of the *same* semantic intent.** When `fde-service.ts` (or the new prompt-directory path) sees the *same* below-threshold candidate get resolved successfully by a full LLM pass N times (proposed: N=5, tunable), auto-generate a **draft** worker-agent/prompt-pattern proposal — reusing `proposeWorkerAgent()` exactly as it exists today, not a new pipeline. This is "promotion," not new-agent invention: the LLM has already solved this shape of request N times; the proposal just crystallizes that into a reusable, cheaper form.
3. **Versioning:** already solved — `promptVersions` (Prompt OS) is genuinely versioned/labeled (`production`/etc.) today; a promoted prompt pattern is just another `promptTemplates` row that goes through the same `createPromptVersion()` (veridian_admin-gated) as every other prompt in the system. No new versioning mechanism needed.
4. **Who approves a promotion:** use the *existing* maker-checker `approvalRequests` flow `proposeWorkerAgent()` already writes to — do not invent a new approval table. Tie the reviewer to the existing Guardrail Team roles already in `roster.ts`: **`quality_gate_manager`** (Claude-tier, judgment-critical by the founder's own 2-tier model policy) is the natural owner of "should this auto-detected pattern become a permanent capability," with **`data_quality_checker`** doing the cheap first-pass sanity check (duplicate/garbage detection) before it reaches quality_gate_manager — same "GLM cheap draft → Claude final sign-off" split already used everywhere else in the roster. A human (org admin, or veridian_admin for platform-tier) still holds final publish, same bar as today.
5. **Decay, not just growth:** an evolving library also needs to *retire* agents that stop matching real usage (product changes, deprecated modules). Recommend a quarterly `auditDuplicateCapabilities()`-style job (already exists, currently admin-triggered only) extended to flag agents with zero dispatches in N days for review — cheap to add once dispatch logging (§2) exists.

---

## 5. Phased build order & 30-day window assessment

| Phase | Scope | Depends on | Rough size |
|---|---|---|---|
| **1** | Add dispatch execution to VERI FDE: when `findSimilarCapabilities()` returns a high-confidence match, actually *call* the matched worker agent's target API (not just message the user), gated by the new `autoDispatchThreshold` column | existing `fde-service.ts`, `worker_agents` schema | small–medium |
| **2** | Add `prompt_pattern` as a 4th `CapabilityEntityType`; wire the typing-time predictive-match embedding call (§3) into the chat input surface | existing `capability-registry-service.ts`, `embeddings.ts` | small–medium |
| **3** | Usage-count columns + auto-draft-promotion trigger (N successes → proposal), routed through existing `proposeWorkerAgent()` + `approvalRequests` + `quality_gate_manager`/`data_quality_checker` review | Phase 1+2 telemetry | medium |
| **4** | Retirement/decay audit job, admin dashboard visibility into promotion candidates | Phase 3 | small |

**On the 30-day window:** Phase 1 and Phase 2 are genuinely small (each is one service function extension + one wiring point into an existing surface) and can fit inside the current build window *if* they are sequenced after whatever is already load-bearing this month — they are not urgent-and-blocking, they are cost/latency optimizations on a system that already works correctly, just less cheaply than it could. Phase 3 (the "evolve" mechanism) is where real judgment and testing time goes — auto-promoting anything into something VERI can auto-dispatch without a human in the loop is the first place a mistake compounds silently across many customers, and it should **not** be rushed to hit a 30-day deadline. **Recommendation: sequence Phases 1–2 into the current window as incremental, low-risk additions to already-shipping VERI FDE code; explicitly push Phase 3 (auto-promotion) and Phase 4 (decay) to the *next* cycle**, once Phase 1–2 have real production usage data to promote from — promoting from zero real usage data would just be guessing with extra ceremony.

## What needs the Boss's sign-off

- **Any change to auto-dispatch behavior** (Phase 1) means VERI can take a real action against a customer's data with *less* human-in-the-loop friction than today's "message the user" behavior. That is a genuine increase in blast radius and should get explicit Boss sign-off on the default `autoDispatchThreshold` value and which action types (read vs. write) are eligible for auto-dispatch at all before Phase 1 ships, not after.
- **Phase 3's auto-promotion trigger** turns repeated LLM behavior into a permanent, lower-friction capability without a human proposing it first. Recommend the Boss explicitly approve N (proposed default 5) and confirm `quality_gate_manager` + `data_quality_checker` as the review chain before this phase is scheduled at all.
