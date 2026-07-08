# AI OS Master Prompt — Gap Analysis (Wave 110)

## Context

The user supplied a detailed "VERIDIAN AI Operating System — Master Prompt" specifying a 4-level architecture (Execution / Enterprise Memory / Intelligence / Evolution), a routing cascade ("try business rules → SQL → workflow → cache → memory → knowledge graph → retrieval → tool → small model → large model, AI as last resort"), ~150 named "engineering disciplines" (with a "Most Critical 25" subset), and a specific architectural counter-proposal: **Capability Engineering** — a large registry of reusable capabilities plus *ephemeral, on-demand agent composition*, explicitly rejecting a "thousands of permanent agents" design. The user also asked for a specific evaluation of `alibaba/zvec` and `TencentDB-Agent-Memory` alongside Supabase/Vercel/MCP, with the explicit instruction: **don't rebuild or build until required — evaluate first, implement only what's missing, don't duplicate.**

This document is that evaluation, grounded in direct code reads (not the 2-day-old `AI_OS_CERTIFICATION.md` snapshot, which predates ~15 waves of subsequent work) plus two dedicated research passes this session.

## Headline finding

**Most of the master prompt's "Most Critical 25" disciplines already exist in this codebase, under different names, built incrementally across Waves 16–17, 21–23, 43, 45, 72–78, 93–95.** The prompt is a good forcing function for naming what's real vs. partial vs. absent — it is not describing a platform that needs to be built from scratch. Six concrete new gaps are worth closing; three of the master prompt's own proposals turn out to be either already-satisfied or premature for this platform's current scale.

## What already exists (do not rebuild)

| Master prompt discipline | Existing VERIDIAN mechanism | Maturity |
|---|---|---|
| Purpose Engineering | `src/lib/purpose-bound-ai.ts` (Wave 17) — hard per-domain tool allowlist, `DOMAIN_ALLOWED_TOOLS` | Real, enforced |
| Guardrail Engineering | `VERIDIAN_AI_CONSTITUTION.md` + `src/lib/policy-enforcement-engine.ts` (Wave 46) — deterministic (non-LLM) prompt-injection/domain/purpose checks before the LLM call | Real, but wired at only 3 call sites (VERI Chat, VERI FDE, Page Agent) — the only 3 free-text-to-LLM surfaces that exist today |
| Memory Engineering | `assistantMemories` + `searchAssistantMemories()` (Wave 77) — real cosine-similarity retrieval, not a flat log | Real, but wired only into `task-execution-engine.ts`, not chat/FDE |
| Retrieval Engineering / Vector Engineering | `compliance.embeddings` (pgvector HNSW) + `embedding_cache` (Wave 45/73/99) — real OpenRouter/Groq embeddings with hash-based fallback clearly flagged | Real |
| Capability Engineering (partial) | `src/lib/services/capability-registry-service.ts` (Wave 43) — real semantic search (`findSimilarCapabilities`), used by VERI FDE to short-circuit a new proposal when a ≥0.9-similarity match exists (**zero LLM call** on a hit) | Real, narrower scope than the master prompt's "20,000 capabilities" vision, but the mechanism is genuine |
| Model Routing Engineering (partial) | `orchestra-model-resolver.ts` / `personal-model-resolver.ts` — 4-layer config resolution (platform → org → client → user) with real retry+fallback (Wave 72) | Real, but it's "which model is *configured*," not "which model can *cheaply solve this task*" |
| Cost Engineering / Observability Engineering | `orchestra-execution-logger.ts` (Wave 23) + Orchestra Analytics Dashboard (Wave 95) — cost/latency/tokens/model captured at 38 call sites | Real, broad coverage |
| Prompt Engineering | Prompt OS (Wave 22) — versioned templates, `resolvePromptTemplate()` | Real |
| Model/Prompt Evaluation Engineering | `prompt-eval-service.ts` (Wave 94) — deterministic keyword-containment scoring, admin-only, platform keys only | Real but intentionally narrow (not LLM-judging-LLM, by design) |
| Business Rule Engineering (partial) | `module-rules-resolver.ts` (Wave 21) — most-specific-scope-wins config resolution (e.g., per-org POSH witness-count rules) | Real, but this is **per-org feature configuration**, not "can a business rule answer this question instead of calling an LLM" — a narrower thing than the master prompt means by this term |
| Multi-Agent Engineering | Meeting AI → CRM/Task AI chaining (Wave 78) | Real, but only this one chain exists |

## Genuine gaps, confirmed absent

1. **No pre-LLM routing cascade for cost/latency** — nothing checks "can cache/rules/memory answer this before spending an LLM call" as a *general* pattern across call sites (the policy gate checks *safety*, not *necessity*). **Partially closed, Wave 114** (`WAVE_114_DETERMINISTIC_DISPATCH.md`): the one specific path this applies to most directly — VERI Chat's chain-selector completing at a known worker agent or VCEL calculator — now skips the LLM entirely (structured dispatch, zero `orchestra_executions` cost). Still absent as a *general* pattern: chat, VERI FDE, and Page Agent's free-text call sites have no cache/rules-before-LLM check.
2. **No LLM response cache** — `embedding_cache` caches embeddings only; identical prompts still re-call the LLM every time.
3. **Policy enforcement coverage is partial** — real, but only 3 of N LLM call sites are wired (VERI Chat, VERI FDE, Page Agent). Internal loops, document extraction, and the Level 1 orchestrator are unguarded (VERIDIAN_AI_CONSTITUTION.md itself names this gap).
4. **No knowledge graph** — confirmed absent again; `knowledgeBasePages` is plain markdown with ILIKE search, not a graph.
5. **No output verification / hallucination detection** — no confidence scoring, no "verify LLM output against a SQL fact" mechanism anywhere.
6. **No task-complexity-based model routing** — the 4-layer resolver picks a model by *config*, never by *estimated task difficulty*.

## Verdict on the two named external technologies

**`alibaba/zvec`** — already evaluated and rejected in Wave 99 (see `[[zvec_evaluation_wave99]]`). Native C++/embedded/local-file vector DB, no WASM target, fundamentally incompatible with Vercel Edge Runtime or even regular serverless (no shared local disk across ephemeral containers). Verdict stands: **rejected**. The pattern it would have provided (fast vector search) is already delivered by pgvector HNSW + `embedding_cache`.

**`TencentDB-Agent-Memory`** (this session) — same rejection class, verified independently:
- It's an **OpenClaw coding-agent plugin** (npm `@tencentdb-agent-memory/memory-tencentdb`), not a standalone API or SDK.
- Default backend is **local SQLite + `sqlite-vec`** (a native extension); the only alternative backend is Tencent's own proprietary TCVDB. **No Postgres option exists at all.**
- Depends on `node-llama-cpp` (native binding) and persistent local disk — incompatible with Vercel Edge Runtime, and awkward even on regular serverless Node (no durable filesystem across ephemeral invocations, same class of problem as zvec).
- MIT licensed, no Tencent Cloud account required for local mode — but adopting it would mean running a second, disk-backed subsystem alongside Supabase, or locking into TCVDB. Neither fits VERIDIAN's vendor-independence requirement.
- **Verdict: reject the tool, adopt the pattern.** Its genuinely valuable idea — a 4-tier progressive memory compression pipeline (L0 raw → L1 atomic facts → L2 scenario summaries → L3 persona profiles) plus BM25+vector hybrid retrieval via Reciprocal Rank Fusion — has no dependency on SQLite or Tencent Cloud and can be reimplemented directly on Postgres. This is exactly what Wave 110 (below) does, in a deliberately small first slice.

## On the "Capability Registry + ephemeral agents, not 10,000 permanent agents" proposal

The user's own critique of "thousands of agents" is directionally already how VERIDIAN works, not a design VERIDIAN needs correcting away from: Worker Agents are proposed, human-approved, and stored (a real, intentional governance choice from Wave 16 — approval-gated agent creation, not silent proliferation), but VERI FDE's actual *usage* model already matches the "search first, compose/reuse, don't duplicate" instinct — `findSimilarCapabilities()` runs before any new agent is ever proposed, and a strong match short-circuits with zero LLM call and zero new agent. The gap is narrower than "rebuild the agent model": it's "extend capability search to more surfaces" and "make the routing-before-LLM instinct general, not FDE-specific" — which is what the two closes below do.

## What Wave 110 actually implements (the minimal, non-duplicating closes)

Given the instruction to evaluate first and implement only what's missing, this wave closes exactly **two** of the six gaps above, scoped deliberately narrowly for safety in a multi-tenant system:

1. **LLM response cache** (`llm_response_cache` table + `callLLMCached()` in `llm-client.ts`) — closes gap #2, implements the master prompt's "cached answers" cascade step. Deliberately **opt-in**, not automatic at every call site: unlike `embedding_cache` (where identical text always embeds identically regardless of org, making a global cache always safe), an LLM *completion* for the same prompt text is not guaranteed safe to share across tenants — a system prompt can carry implicit per-org context, and a cached answer about one org's data must never leak to another. The cache key is therefore computed from `orgId + provider + model + systemPrompt + userMessage`, never a bare prompt hash, and every entry carries a 24-hour TTL (business data goes stale; embeddings of static text do not). Existing call sites are unchanged; only a caller that explicitly decides its input is likely to repeat (e.g., VERI FDE's task-similarity evaluation) opts in.
2. **Output-shape verification for `callLLMJson`** — a new optional `expectedKeys` param; if supplied and parsed JSON is missing any of them, throws a distinguishable `LLMVerificationError` instead of silently returning malformed data. Zero behavior change for the many existing callers that don't pass it. This is a first, honest, narrow step on gap #5 (output verification) — checking JSON *shape*, not checking a claim against a business fact, which is a much larger undertaking.

**Deferred, not silently dropped:**
- **Universal policy-gate wiring** (the rest of gap #3) — extending `policy-enforcement-engine.ts` beyond its current 3 call sites requires threading a `domain` parameter through every remaining LLM call site individually; doing that safely for ~35 more call sites is a dedicated wave of its own, not a same-session addition once this session was already this deep into other work.
- Gap #1 (general task-routing cascade), #4 (knowledge graph), #6 (task-complexity model routing) — each would require either a real NL→SQL/rules translation layer (itself circular — deciding "can a rule answer this" is often as hard as answering it) or a genuinely new data structure (a graph store) with no existing partial implementation to extend safely in one wave.
