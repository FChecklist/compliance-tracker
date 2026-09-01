# Terminology Glossary — colliding names across unrelated systems

This codebase has a few short terms (`L0`/`L1`, `tier`, `ai_router`) that are
reused, on purpose, by genuinely unrelated systems. Grepping for one of these
terms can easily land you in the wrong system. This file exists so a future
engineer can tell them apart quickly, without re-deriving it from scratch.

Nothing here changes behavior — it's documentation only.

## "L0"–"L5" — two different ladders

| Term | File | What it actually means |
|---|---|---|
| `L0`–`L5` | `src/lib/ai-router/software-team-ladder.ts` | AI Dev Team escalation ladder (AIROUTER-01 Phase 2). `L0` = deterministic software path (`task-execution-engine.ts` / CI, no AI call). `L1`–`L4` = the existing `/api/ai/team/dispatch` → `classifyTask` → `runRole` pipeline (roster.ts roles doing coding/architecture/testing/docs work). `L5` = the Mother Router (`mother-router.ts`'s `resolveModel()`) plus Super Boss (human, per AGENTS.md). |
| `L0`, `L1` | `src/lib/pipeline/level0.ts`, `src/lib/pipeline/level1.ts` | Unrelated PROJEXA construction-BOQ chat-pill classification ladder (R53 Phase 6). `L0` (`classifyL0`) = deterministic phrase/structural matching, $0, no AI. A miss escalates to `L1`, the one AI call in this pipeline (DeepSeek V4 Flash via OpenRouter, one sentence → one function selection, output re-validated in code before use). |

These two ladders share level-number naming purely by convention (both follow
a "deterministic first, escalate to AI" shape) — they are different modules,
different domains (AI Dev Team vs. construction-BOQ chat), and neither calls
into the other.

## "tier" — compute location, not a model or an escalation level

| Term | File | What it actually means |
|---|---|---|
| `tier` (`BrowserExecutionTier`: `npu` / `builtin-ai` / `lite-llm` / `transformers` / `server`) | `src/lib/browser-execution/tier-orchestrator.ts` | Client-side compute-tier selection — **where** a task runs (on-device NPU, browser built-in AI, a small local model, Transformers.js, or escalated to the server), not **which model** answers it or how "smart" the response is. Picking the `server` tier is itself the escalation decision (VERIDIAN_Architecture_v2.0 phase_5's `engine-server-escalation`); it does not by itself mean an AI call happens server-side — see `model-tier-eligibility.ts` / `llm-client.ts` for that separate decision. |

Do not confuse this `tier` with the AI Dev Team's `L0`–`L5` ladder above, or
with `model-tier-eligibility.ts`'s own tier concept (task complexity /
model-eligibility gating, a different axis again).

## "ai_router" — a role key vs. a module

| Term | File | What it actually means |
|---|---|---|
| `"ai_router"` (roleKey) | `src/lib/ai-team/roster.ts` (roleKey defined here; used by `classifyTask()` in `src/lib/ai-team/team-service.ts`) | An AI Dev Team role: **AI Router / Task Classifier** — assigns an incoming internal task to one operational department role (Engineering, Data, Sales & Marketing, etc.). It is a task classifier, not a model/provider router. |
| Mother Router | `src/lib/ai-router/mother-router.ts` | A real, unifying AI model/provider registry + versioned routing policy + audit log (AIROUTER-01, Owner directive 2026-07-18), covering `software_team` / `end_user_org` / `sales_marketing` scopes. This is model/provider *resolution*, not task classification. |

`mother-router.ts` already carries its own header comment flagging this exact
collision:

> "roster.ts already has an unrelated role literally named `ai_router` ...
> That is a different concept from this file's Mother Router (model/provider
> resolution registry) — do not conflate them."

Per the R66 code-quality inspection this glossary responds to: the `ai_router`
roleKey is **not** being renamed here — it's a string-keyed value used across
dispatch call sites (`getRole("ai_router")`, `resolvePromptTemplate("ai_team.ai_router")`)
without test coverage that would catch a rename regression. Documenting the
collision is the low-risk fix; renaming the key is a separate, larger piece
of work if it's ever done.

---
*Added by the R66 code-quality inspection
(`public.code_quality_inspection_findings`, Supabase project
`pcrjmlpuqsbocqfwoxod`, inspection_run `r66_code_quality_inspection_2026-09-01`).*
