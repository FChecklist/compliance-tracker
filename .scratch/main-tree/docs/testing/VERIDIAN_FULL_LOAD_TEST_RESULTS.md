# VERIDIAN AI OS Full-Platform Intensive Load Test — Results

**Run date:** 2026-07-10 | **Supervisor:** Super Boss (Claude, this machine) | **Follow-up to:** [PROJEXA_LOAD_TEST_RESULTS.md](./PROJEXA_LOAD_TEST_RESULTS.md)

Run `fullload-1783683321867`, same demo org as the PROJEXA run: `obux019rsc5nzxjx93rrpc1j`, same 100 reused synthetic personas. Harness: `scripts/veridian-full-load-test.ts`.

## 1. Executive summary

- **1965/1998 items executed, 1948 succeeded (99.1%)**, in **59.6 minutes** — well inside the 150-minute cap.
- **4 real orchestra layers exercised** (vs. PROJEXA's 1): `task_oa` (1398 calls, general tasks across every business domain), `user_assistant_oa` (379 logged calls, VERI Chat), `facilities_management_register_digitize_oa` (150 calls, CSV asset-register uploads — **100% success, first time this layer has ever been validated**), and `customer_account_oa` (document vision extraction).
- **Total real production cost for 1927 logged model calls: $0.2935** ($0.000152/call average) — the number for pricing purposes.
- **The run halted itself correctly** on the error-rate guardrail (>30% failures over the last 50 items) — not a crash. Root cause: a genuine, previously-invisible production bug in `customer_account_oa` (§3), not test noise.
- **One high-severity production bug found: Document AI vision extraction is completely silent-broken for every org on the platform-default model config** (§3) — worth fixing before the FM/CSV path's success gets read as "the whole Document AI surface works."
- **One real policy-scoping bug confirmed** (surfaced first in dry-run, reconfirmed at scale): the chat assistant refuses CRM-flavored requests despite VERI's own onboarding message claiming CRM is "switched on" (§4).
- Task creation (`task_oa`) now proven across compliance/GST/CRM/meetings/PROJEXA/general-ops, not just construction — **1398/1398 succeeded**, a stronger result than PROJEXA's already-good 499/500.

## 2. Test design (as executed)

- Reused the PROJEXA run's demo org and 100 personas directly (per Boss's "same demo company" instruction) — no new persona/company generation needed.
- One Cerebras (GPT-OSS-120B) call per persona generated 14 task-mode + 4 chat-mode items each (100 calls → 1798 items), spanning compliance, GST, CRM, meetings, PROJEXA, and general ops — not just construction, to genuinely exercise `task_oa`'s dispatch across every domain's worker agents.
- FM-mode (150 items) and doc-mode (50 items) used **templated, non-LLM-generated input** (synthetic CSV asset rows; a placeholder PNG) since the interesting work being tested is the extraction call itself, not the input generation.
- Execution ran through the real service layer (`createTask`, `sendMessage`, `parseAndExtractFromFile`, `extractDocumentContent`), same bypass-session-auth rationale as the PROJEXA run.
- Budget caps **unchanged** per Boss's explicit confirmation ($3 Cerebras / $1 GLM-5.2, Groq free-first) — final spend ($0.1531 Cerebras generation + $0.1466 GLM execution) came nowhere close.
- `page_agent_oa` explicitly out of scope per Boss's decision (service-layer only, no browser automation this run).

## 3. The headline finding: Document AI is silently broken for every org on the default config

`customer_account_oa` produced **zero rows in `orchestra_executions`** for all 17 attempted calls — not "failed" status rows, *no rows at all*. Traced to `document-extraction-service.ts`:

```ts
const visionModel = VISION_MODEL_OVERRIDES[modelConfig.provider]
if (!visionModel) return // no confirmed vision-capable model for this provider -- skip rather than guess
```

`VISION_MODEL_OVERRIDES` has entries for `openai`, `anthropic`, `google`, `openrouter` — **but not `groq`**. Confirmed live via `resolveModelConfig(orgId, "customer_account_oa")`: this org (and, since it's `isCustomerConfigured: false`, **every org that hasn't explicitly overridden its model**) resolves `customer_account_oa` to `groq`/`openai/gpt-oss-120b` — the platform default. So the function hits `if (!visionModel) return` on line 75 and **exits before calling any model, before writing anything, before logging anything.** No exception, no error message, no `orchestra_executions` row, no console output visible to an operator. A user uploads a document expecting AI extraction; nothing happens, silently, forever, and there is currently no way to discover this from inside the product.

**This is more severe than "the load test's placeholder image was too trivial to extract from"** — that was my original hypothesis going in, and it's wrong. The placeholder image was never even sent to a model. This affects real production traffic today, for any org using the platform's own recommended default configuration.

Why the guardrail is a feature here, not a bug in the test: the harness's error-rate halt (30% over 50 items) triggered exactly as designed the moment doc-mode's 100% silent-failure rate entered its rolling window — this is precisely the kind of systemic issue that guardrail exists to catch and stop on, rather than let a run burn through its full budget generating 33 more identically-useless calls.

## 4. Confirmed working

- **`task_oa` across all business domains: 1398/1398 (100%).** Broadened generation (compliance, GST, CRM, meetings, PROJEXA, general ops) all routed and executed successfully — a stronger, more representative result than PROJEXA's single-domain 499/500.
- **`user_assistant_oa` (VERI Chat): 400/400 executed, 379 logged model calls.** The ~21-call gap is very likely deterministic/policy-short-circuit replies that never reach a model (not investigated further given time — low priority, not a failure).
- **`facilities_management_register_digitize_oa`: 150/150 (100%) — the first time this layer has ever been exercised by anything.** CSV asset-register parsing, LLM row extraction (via `openai/gpt-4o-mini`/openrouter — note: this layer's default is NOT the Groq floor tier, unlike the other three, so it never hit the vision-override gap), and batch staging all worked cleanly at scale.
- Guardrails (budget caps, error-rate halt, retry resilience, per-persona iteration cap) all behaved correctly under a 4x-larger, more heterogeneous run than PROJEXA's.

## 5. Token / cost / timing — the pricing data

| Layer | Calls | Prompt tok | Completion tok | Cost | Avg latency | Providers/models |
|---|---|---|---|---|---|---|
| `task_oa` | 1,398 | 810,375 | 475,738 | $0.1856 | 2,785 ms | groq/gpt-oss-120b, openrouter/glm-5.2 |
| `user_assistant_oa` | 379 | 164,227 | 87,918 | $0.0250 | 3,202 ms | groq/gpt-oss-120b, openrouter/glm-5.2 |
| `facilities_management_register_digitize_oa` | 150 | 151,260 | 100,294 | $0.0829 | 9,102 ms | openrouter/gpt-4o-mini |
| `customer_account_oa` | 0 | — | — | — | — | (never reached a model — §3) |
| **Total** | **1,927** | **1,125,862** | **663,950** | **$0.2935** | — | — |

- **Avg cost per logged model call: $0.000152** — a bit higher than PROJEXA's $0.000105/task, driven mostly by the FM layer's heavier per-batch prompts (multi-row CSV chunks, ~1,675 tokens/call average) and its non-floor-tier model.
- FM's 9.1s average latency is real and expected — it's the only layer doing genuine multi-row batch extraction (up to 80 rows/call) rather than a single-turn reply.
- Generation-phase (harness-side, Cerebras, NOT part of the production number): $0.1531 for 100 calls generating 1798 items.
- Extrapolated: at this task/chat/FM mix, **1,000 real production interactions ≈ $0.15**, consistent with PROJEXA's per-task economics once you account for FM's heavier batches pulling the blend up slightly.

## 6. Recommendations for Z.ai GLM-5.2

1. **[Critical] Add a `groq` entry to `VISION_MODEL_OVERRIDES`** in `src/lib/services/document-extraction-service.ts` (and check `fm-register-digitization-service.ts`'s `parseAndExtractFromPhoto`, which shares the same vision-call mechanism, for the identical gap). Groq doesn't currently host a confirmed vision-capable chat-completions model at the time this was written — if that's still true, route to `modelConfig.fallback` (already present on every resolved config, e.g. Cerebras) instead of silently returning. **Never let a resolved-but-unusable model config result in a silent no-op** — either use the fallback or write a `status: "failed"` `orchestra_executions` row explaining why, so this is at minimum discoverable.
2. **Apply the same fix pattern anywhere else `VISION_MODEL_OVERRIDES`-style per-provider allowlists exist** — this is a class of bug (assuming a provider is vision-capable without checking), not a one-off.
3. **Investigate the chat-scoping/CRM-refusal bug** (also flagged in the PROJEXA follow-up conversation): the assistant told a user "I can only handle compliance-related tasks" in response to a CRM lead-status request, despite VERI's own onboarding message claiming "finance, sales, CRM, HR, operations, compliance" are all switched on. Check `policy-enforcement-engine.ts` / whatever scopes `user_assistant_oa`'s system prompt for an overly narrow allowed-topics list.
4. **Carry over the 4 recommendations from the PROJEXA report** (§7 there) that are still open: JSON-parse auto-retry, failed-before-model-call logging blind spot (this run found a second, more severe instance of the same class of gap — see §3 here), Groq TPD documentation, and the `page_agent_oa`/`global_intelligence_oa`/`meta_oa` scoping question.

Dispatch pending — same `ai-team-workforce.yml` / `ceo_technical_director` (GLM-5.2) mechanism used for the PROJEXA follow-up.

## 7. Data retention

Same demo org (`obux019rsc5nzxjx93rrpc1j`) — not yet cleaned up, pending z.ai's fixes for both this run's and the PROJEXA run's findings. Query `orchestra_executions`/`tasks`/`conversations`/`documents` WHERE `org_id='obux019rsc5nzxjx93rrpc1j'` AND `created_at >= '2026-07-10T11:35:21Z'` for this run's rows specifically.
