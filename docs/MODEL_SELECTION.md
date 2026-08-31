# Model Selection Record

**R46 P9 seq37** (platform.r43_queue, ref K.4). Two distinct things go by
"model selection" in this codebase, and this doc keeps them separate rather
than conflating them:

- **Part 1** — the product's own real, live, current model-routing record
  (`src/lib/orchestra-model-resolver.ts`, `src/lib/ai-team/roster.ts`,
  `platform.ai_model_registry`) — what the work order's own `where_to`
  points at, confirmed current as of this doc.
- **Part 2** — the R43/R46 work-order's own phase-by-phase record of which
  *Claude Code CLI model* (the tool executing this work order itself, not
  the product) ran each phase — what the queue row's own `how` text
  literally asks for ("Sonnet High for analysis... UltraCode for code
  generation..."). **This is honestly reported as not trackable from any
  real artifact found**, not fabricated — see Part 2 below for exactly what
  was checked.

## Part 1 — the product's real model-routing record (current, live-checked)

### 1a. Customer-facing product features — `orchestra-model-resolver.ts`

A named-role failover chain, resolved from `platform.ai_model_registry`
first (a DB row change takes effect live, no deploy — `orchestra-model-resolver.ts:21-34`),
falling back to hardcoded literals only when the registry lookup errors or
has no active row for that role. **Live-queried** (`platform.ai_model_registry`,
2026-08-25):

| Role | Provider | Model | `updated_at` |
|---|---|---|---|
| `platform_default` | groq | `openai/gpt-oss-120b` | 2026-07-19 |
| `platform_fallback` | openrouter | `meta-llama/llama-3.3-70b-instruct:free` | 2026-07-19 |
| `cerebras_failover` | cerebras | `gpt-oss-120b` | 2026-07-19 |
| `escalated_default` | openrouter | `z-ai/glm-5.2` | 2026-07-19 |

Real, documented reasoning for each (`orchestra-model-resolver.ts`
file comments, cited so a reader can verify directly):
- `platform_default` — the floor every org gets before configuring anything
  of their own (line 37-46): GPT-OSS-120B on Groq, chosen 2026-07-10 as
  "meaningfully stronger than llama-3.3-70b while staying just as fast/cheap."
- `cerebras_failover` — same model, different (paid) infra, only when the
  free Groq primary is actually down (line 62-71) — Groq's free tier has a
  real, load-test-confirmed 200K-tokens/day cap (line 49-60,
  `PROJEXA_LOAD_TEST_RESULTS.md §5 Incident 4`).
- `escalated_default` — what a floor-tier call upgrades TO when
  `floor-tier-escalation.ts`'s deterministic signals fire (line 73-82):
  GLM-5.2, pinned to OpenRouter provider "DeepInfra."
- **Staleness check**: every row's `updated_at` is 2026-07-19, ~5 weeks
  before this doc. Not itself evidence of drift — the design (line 88-90)
  is explicitly a rarely-touched registry meant to be picked up live only
  when a real routing decision changes, not edited on a cadence — but
  flagged here honestly rather than asserted "current" without the actual
  date shown.

### 1b. Platform's own internal AI Dev Team — `roster.ts`

A ~30-role company org chart (`roster.ts:1-60`), separate from 1a — this is
who builds/runs VERIDIAN itself, not a customer-facing feature.

**A real, documented mid-course model switch, with its real trigger**
(exactly what seq37 asks for — "record any phase where the model was
switched... and what triggered it," found here against the product's own
roster, not the work-order phases):

> "UPDATE (same day): the 9 roles originally reserved for Claude Sonnet 5
> ('judgment-critical' tier) were moved to GLM-5.2 by explicit founder
> decision, after real OpenRouter billing data showed Claude Sonnet 5
> accounted for \$11.44 of \$12.34 total spend (93%) from just 3 real
> dispatches -- a conversation-history-growth cost bug in
> `scripts/ai-workforce-agent.mjs` ... hit hardest on exactly these long,
> multi-file-read tasks." (`roster.ts:20-33`)

Current real assignment, by role class:
| Role class | Model | Why |
|---|---|---|
| Most operational roles (post-switch) | `z-ai/glm-5.2` | Cost-driven switch above; "proven in production" per `roster.ts:15-16` |
| Vision roles | `z-ai/glm-5v-turbo` | Needs to read designs/screenshots |
| High-volume/low-stakes work | `z-ai/glm-5-turbo` | |
| Research Analyst | `google/gemini-2.5-pro` | Unchanged by the switch — never was Claude |
| The two "independent second opinion" roles | `openai/gpt-5.5` | Deliberately a different vendor from the primary reviewer, not for cost reasons (`roster.ts:30-33`) |
| `founder_ceo` / `executive_advisor` / `super_boss` | Human / Claude Desktop, interactive only | Never dispatched via `team-service.ts` — see `AGENTS.md`'s own "Super Boss (Claude Desktop, Sonnet 5.0, local machine)" entry |
| `cost_policy_engine`, `user_permission_manager` | `isCodeOnly: true` — no LLM call at all | Deterministic code (`cost-policy.ts`, `auth-guard.ts`) |

**Tier eligibility gate** (`src/lib/model-tier-eligibility.ts`, cross-checked
against `AGENTS.md` Rule 10, current as of 2026-07-14): a model must be
`judgment`-tier-trusted to receive `judgment`-tier work (architecture/
security/audit); today that's `z-ai/glm-5.2` only — `openai/gpt-5.5` was
explicitly removed from the judgment tier 2026-07-14 (`AGENTS.md` Rule 10,
`ai-os/CONSTITUTION.yaml`'s `ai_orchestra_tiers.levels[TIER-3]`). Enforced
at all three real dispatch surfaces per that same rule, not just documented
as a preference.

## Part 2 — the R43/R46 work-order's own P0-P4 phase record: not trackable, reported honestly

The queue row's own text asks for "which Claude Code model was used and
why" per phase (P0-CARRY, P1-TESTENV, P2-PERF, P3-AI, P4-CLOSE — the real
phase names, confirmed via `audit/R1_R45_OPEN_ITEMS.md`, R46 P9 seq44),
citing "Sonnet High for analysis, audit, classification, documentation;
UltraCode for code generation, migrations, testing, deployment" as the
intended policy.

**What was actually checked, to try to verify this against real evidence:**
- `platform.dispatch_outcomes.model_used` — the one real column in the
  live schema shaped for exactly this — **0 rows**. Confirmed via direct
  `count(*)`. This table is unused/stub, not a real record.
- `git log --all --format='%an'` across this repo's full history, looking
  for a per-phase or per-commit model tag — the only Claude-related author
  identities that appear anywhere are generic (`Claude`, `Claude Code`,
  `Claude Sonnet 5`), none scoped to a phase, and no `UltraCode`-named
  author or trailer appears anywhere in this repo's history.
- No PR body, commit message, or `ai-os/` doc found that records "phase X
  ran on model Y" as a queryable fact rather than a stated intention.

**Honest conclusion**: which specific Claude Code model executed each
historical R43/R44/R45 phase is not reconstructable from any artifact this
repo or its DB actually contains. Asserting a specific model per phase here
would be fabrication, which this work order's own instructions explicitly
prohibit.

**What IS real and directly checkable**: this session (R46 P9, seq33-37,
2026-08-25) ran entirely on `Claude Sonnet 5` (`noreply@anthropic.com`) —
every commit this session made across both repos carries that exact
`Co-Authored-By` trailer, with **zero mid-session model switch**: `git log`
on every `r46-p9-seq3*` branch this session created shows a single,
consistent author identity throughout. This is the one row of real,
first-hand "phase → model" evidence available; a fuller P0-P4 table would
need each of those phases to have been run by a session that itself
recorded which model it was, going forward from here (the standard's own
`docs/DOCUMENTATION_STANDARDS.md`, R46 P9 seq36, already establishes the
header-comment convention that would make this checkable next time).

## What this PR does and does not do

Does: add this one documentation file, combining a live DB query (`platform.ai_model_registry`),
direct reads of `roster.ts`/`orchestra-model-resolver.ts`/`model-tier-eligibility.ts`,
and a real check of `dispatch_outcomes` + git history for the P0-P4 claim
(reported as a genuine gap, not filled in). Does not: touch any runtime
code, schema, or test file.
