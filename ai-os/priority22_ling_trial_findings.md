# Priority 22, Workstream 1: Ling-2.6-1T Trial Findings

**Date:** 2026-07-16
**Session:** Super Boss (Claude Desktop) -- see `ai-os/boss/ACTIVE-CLAIMS.yaml` active claim
**Scope:** CONTROLLER.yaml PRIORITY-22 workstream 1 only (Ling-2.6-1T trial). OfficeCLI (workstream 2) and Prompt Library (workstream 3) are not covered here.

## 0. Correction to the task brief before starting

The dispatching brief (CONTROLLER.yaml PRIORITY-22's `tightened_prompt`) states deepseek/deepseek-v4-pro is
"currently used by Senior Backend Engineer/DevOps/Architecture Compliance Reviewer roles" and that
deepseek/deepseek-r1-0528 is used by "QA Engineer/AI Response Validator." Both claims were checked
against the actual, freshly-read `src/lib/ai-team/roster.ts` (not assumed) and are **not accurate**:

- `senior_backend_engineer`, `devops_engineer`, and `architecture_compliance_reviewer` all run
  `z-ai/glm-5.2` (`GLM_52`), not DeepSeek.
- `deepseek/deepseek-r1-0528` does not appear anywhere in `roster.ts`. There is no QA
  Engineer/AI Response Validator role on a DeepSeek model today -- `qa_engineer` and
  `ai_response_validator` both also run `z-ai/glm-5.2`.
- The 3 roles that actually run `deepseek/deepseek-v4-pro` (`DEEPSEEK_V4_PRO` constant) are:
  `governance_backend_engineer` (ENGINEERING), `chief_audit_officer` (AUDIT_EXECUTIVE), and
  `chief_operating_officer` (EXECUTIVE_LADDER).

The comparison below is scoped against the real dispatch sites (`governance_backend_engineer`-shaped
backend/business-rule work and `chief_audit_officer`/`chief_operating_officer`-shaped judgment work),
not the roles named in the original brief.

## 1. OpenRouter slug confirmation and provider landscape

Confirmed live via `GET https://openrouter.ai/api/v1/models` (2026-07-16), not assumed from the
Owner's raw instruction:

- **Real OpenRouter model id: `inclusionai/ling-2.6-1t`** (canonical slug
  `inclusionai/ling-2.6-1t-20260423`). Context length 262,144 tokens,
  `max_completion_tokens` 32,768. There is also a smaller sibling `inclusionai/ling-2.6-flash`
  (104B total / 7.4B active params) -- not evaluated here, out of scope (the Owner named the 1T
  flagship specifically).

- **Provider count -- confirmed the single-provider risk directly, not assumed:**

  | Model | Providers on OpenRouter (`/models/{id}/endpoints`) |
  |---|---|
  | `inclusionai/ling-2.6-1t` | **1** (Novita only) |
  | `deepseek/deepseek-v4-pro` | **16** (DeepSeek, StreamLake, Baidu, GMICloud, Novita, DeepInfra, DigitalOcean, Alibaba, SiliconFlow, Venice, AtlasCloud, BaseTen, Parasail, WandB, Together, Fireworks) |
  | `z-ai/glm-5.2` (for context -- the model behind the 2026-07-10 DeepInfra rate-limit incident, `memory/veridian_veri_rebrand_and_ai_routing_2026-07-10.md`) | **28** |

  This makes Ling-2.6-1T's single-provider exposure structurally worse than the GLM-5.2 incident:
  GLM-5.2 had 28 real provider options available and the codebase's own
  `OPENROUTER_PROVIDER_PREFERENCE` in `src/lib/llm-client.ts` *chose* to pin to one of them
  (DeepInfra) for cost/consistency reasons -- that was a self-inflicted, reversible routing
  decision, and `allow_fallbacks` defaults to `true` so a real fallback to another of the 27
  remaining providers is possible even with a preference set. Ling-2.6-1T has **no such fallback
  available at all** -- Novita is not a preference, it is the only endpoint that exists. Any
  Novita-side outage or rate-limit is a hard, total outage for this model on OpenRouter, with zero
  fallback option, not a preference that can be overridden.

- Live pricing confirmed via the same API call: `prompt: $0.075/M tokens, completion: $0.625/M
  tokens`, carrying a `"discount": 0.75` flag on the Novita endpoint -- i.e. the low headline price
  is explicitly a promotional discount on OpenRouter's own listing, not a stable long-term price.
  Per CONTROLLER.yaml's own note, this is flagged, not used as a decision input.

## 2. Real API call comparison (OpenRouter, live calls, 2026-07-16)

Ran 3 representative backend-engineering prompts, framed directly on the real
`governance_backend_engineer`/`chief_audit_officer`/`chief_operating_officer`-shaped work these
models actually get dispatched for in this codebase (rate-limited API endpoint, an
approval-hierarchy business-rule function, and an idempotent-webhook-under-retry function). Both
models were called with identical system/user prompts, no provider pinning (default OpenRouter
routing), via `https://openrouter.ai/api/v1/chat/completions` using the real
`OPENROUTER_API_KEY` from this repo's `.env.local`.

| Prompt | Model | Latency (wall-clock) | Prompt/Completion tokens | Real cost (usage.\* x live pricing) | Provider OpenRouter routed to |
|---|---|---|---|---|---|
| P1: rate-limited Express endpoint | deepseek-v4-pro | 31,852 ms | 171 / 1,906 | $0.001733 | DeepSeek |
| P1: rate-limited Express endpoint | Ling-2.6-1T | 7,675 ms | 190 / 1,045 | $0.000667 | Novita |
| P2: approval-hierarchy business rule | deepseek-v4-pro | 43,702 ms | 203 / 2,342 | $0.002126 | Baidu |
| P2: approval-hierarchy business rule | Ling-2.6-1T | 7,937 ms | 212 / 782 | $0.000505 | Novita |
| P3: idempotent webhook processing | deepseek-v4-pro | 52,956 ms | 182 / 4,442 | $0.003944 | Fireworks |
| P3: idempotent webhook processing | Ling-2.6-1T | 10,705 ms | 191 / 1,063 | $0.000679 | Novita |
| **Totals** | deepseek-v4-pro | **128.5 s** | 556 / 8,690 | **$0.007803** | 3 different providers across 3 calls |
| **Totals** | Ling-2.6-1T | **26.3 s** | 593 / 2,890 | **$0.001851** | Novita (only option) every time |

**Speed:** Ling-2.6-1T is ~4.9x faster on average (this matches its billing as an "instant" model
optimized for fast agentic execution).
**Cost:** Ling-2.6-1T is ~4.2x cheaper (partly promotional pricing, partly genuinely producing
shorter completions).
**Notable real routing signal, unprompted:** with no provider preference set, OpenRouter's own
default routing sent deepseek-v4-pro's 3 calls to 3 *different* real providers (DeepSeek, Baidu,
Fireworks) -- concrete evidence this model naturally load-balances across its 16-provider pool
today, unlike Ling-2.6-1T which necessarily hit the same single provider every time.

## 3. Qualitative read of the actual outputs

All 6 outputs were read in full (not just skimmed for length). Both models produced working,
syntactically correct TypeScript for all 3 prompts. The real differences showed up in
completeness/correctness on the harder, judgment-adjacent tasks -- exactly the shape of work
`governance_backend_engineer`/`chief_audit_officer` are used for:

- **P1 (rate-limited endpoint):** Roughly comparable. Both correctly implemented a sliding-window
  limiter with proper pruning, zod validation, and correct status codes. DeepSeek's version added
  a periodic cleanup timer, an `express.json({limit:'1mb'})` body-size cap, and a global error
  handler that Ling's version omitted -- but DeepSeek also used less type-safe `(req as any)`
  casts where Ling used a cleaner `res.locals` pattern. Call this a wash.

- **P2 (approval-hierarchy business rule):** DeepSeek noticed that the prompt's own input type
  included a `requesterRole` field and used it meaningfully (added self-approval logic: if the
  requester's own role already has a sufficient limit, no further approval is needed). **Ling's
  implementation accepted `requesterRole` as an input parameter but never referenced it anywhere in
  the function body** -- a real completeness gap on a governance/audit-shaped task where an unused
  input silently ignored is exactly the kind of thing an auditor should catch.

- **P3 (idempotent webhook processing):** This is where the gap was clearest. DeepSeek's version
  (a) checked the actual Postgres unique-violation error code (`err.code === '23505'`) before
  treating an insert failure as "duplicate," and (b) explicitly handled the failure-recovery case:
  if `performBusinessLogic` throws, it deletes the claim row so a future retry can reclaim and
  reprocess the event. **Ling's version catches *any* insert error as "duplicate" (which would
  silently misclassify a genuine DB connection failure as a duplicate-event race), and has no
  failure-recovery path at all** -- if business logic throws after the claim-row insert succeeds,
  that event is permanently stuck in a claimed-but-never-processed state with no code path to ever
  reprocess it. For an idempotency mechanism, "the exactly-once claim can never be released or
  retried on failure" is a real, concrete correctness bug, not a style nitpick.

**Net read:** Ling-2.6-1T writes clean, working code fast and cheap, but on 2 of 3 tasks it missed
an edge case that changes real behavior (an ignored input field; a stuck-forever failure state) in
ways DeepSeek V4 Pro caught without being prompted to look for them. That is a meaningful quality
gap specifically on the governance/audit-adjacent task shape this trial was scoped against.

## 4. Failure-behavior test (single-provider stress test)

Two deliberate failure-mode tests were run against both models, per the task brief:

**Test A -- extreme `max_tokens` (5,000,000):** Both models failed identically and gracefully --
clean `400` errors within ~30-90ms citing the real context-length ceiling (1,048,576 for
deepseek-v4-pro; 262,144 for Ling-2.6-1T) and suggesting the context-compression plugin. No
differentiation here; both behaved well.

**Test B -- forced invalid provider, `allow_fallbacks: false` (simulating the exact failure class
that hit GLM-5.2/DeepInfra on 2026-07-10):**
- `deepseek-v4-pro` returned a clean `404`: `"No endpoints found for deepseek/deepseek-v4-pro."` --
  an accurate, well-formed error describing exactly what happened (the forced provider doesn't
  exist, fallback disabled, no valid endpoint).
- `Ling-2.6-1T` returned a `404` too, but with a **misleading, unrelated error message**:
  `"Ling-2.6-1T is no longer available as a free model. It has transitioned to a paid model."`
  This response has nothing to do with the forced-provider parameter that was actually sent -- it
  reads like a stale/cached error path left over from when this model may have had a free-tier
  listing. This is a real, concrete reliability finding independent of the 1-vs-16 provider count:
  **this model's error semantics on OpenRouter are not yet trustworthy enough to safely
  pattern-match on in retry/fallback logic** -- code written to distinguish "no fallback available"
  from "pricing tier changed" against this model's error text would get the wrong signal today.

## 5. Recommendation: DO NOT ADOPT (for the roles this trial was scoped against)

Per AGENTS.md Rule 8 (90-day quality mandate, in effect through ~2026-10-08): the deciding factor
is quality/correctness, not the ~4-5x cost/latency advantage Ling-2.6-1T showed. On that basis:

- **Do not add Ling-2.6-1T to `governance_backend_engineer`, `chief_audit_officer`, or
  `chief_operating_officer`** (the roles actually on `deepseek/deepseek-v4-pro` today). 2 of 3 test
  prompts surfaced real correctness/completeness gaps (an ignored input field on a business-rule
  task; a permanently-stuck failure state on a concurrency/idempotency task) that DeepSeek V4 Pro
  did not have -- exactly the failure mode Rule 8 exists to prevent shipping.
- **The single-provider risk is a second, independent reason to hold off even if quality had been
  a clean win.** 1 provider (Novita) vs. 16 for deepseek-v4-pro is a structurally worse version of
  the exact incident class already hit once (GLM-5.2/DeepInfra) -- and unlike that incident, there
  is no alternate-provider fallback to pin to if Novita has an outage or rate-limits, because none
  exists. The confusing error message surfaced in the forced-provider test adds a third,
  independent reliability concern (misleading error semantics), on top of the plain lack-of-redundancy
  risk.
- Per the task's own instruction: since quality does **not** clearly favor Ling-2.6-1T, **no change
  was made to `src/lib/ai-team/roster.ts` or `src/lib/model-tier-eligibility.ts`**. This memo alone
  is the complete, valid outcome of this trial.

**Not a permanent rejection.** Ling-2.6-1T's speed and cost profile is genuinely attractive for
high-volume, low-individual-stakes work (the shape this codebase already routes to
`GLM_5_TURBO` -- e.g. the ~100 `AUDIT_*` specialist-auditor roles). If a future task specifically
needs that tier's speed/cost profile and a fresh trial on *that* task shape shows no correctness
gap, it would be a reasonable candidate for `MECHANICAL`-tier-only work (never `INTEGRATIVE` or
`JUDGMENT`, and never for the 3 real deepseek-v4-pro roles evaluated here) -- but that is a
separate decision, not made in this pass, and would need its own real trial against that
task shape before being adopted, same discipline this trial applied.

## 6. Raw data

Full request/response JSON (including complete generated code for all 6 calls, both failure
tests, and the live `/models` + `/endpoints` API responses) was captured this session in the
session scratchpad and is not committed to this repo (raw LLM completions, not project source).
The summary tables above are the complete, non-cherry-picked numeric record of every call made.
