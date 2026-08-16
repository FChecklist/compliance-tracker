# Cost Guesstimate — VERIDIAN AI OS at 5 Orgs × 10 Users (50 Total), All Modules

**Date:** 2026-07-18
**Scope of the question:** what would it cost per month (infra + AI, combined and separate) to run this actual codebase — compliance-tracker, with PROJEXA as its construction/interiors alias layer — for 5 tenant organisations of 10 users each, assuming those 50 users actively exercise the real module/feature set that exists in the repo today.
**Status:** this is a **guesstimate with a stated uncertainty range**, not a bill. Every number below is either (a) pulled directly from this repo's own recorded production data, (b) a real, independently-verified current provider price, or (c) an explicitly-labeled usage assumption. Section 6 shows the confidence range and what would most change the answer.

---

## 1. Real scope enumerated from the repo (not assumed)

Before modeling cost, the actual feature surface was inventoried directly against the code (not inferred from marketing docs):

| Dimension | Count | Source |
|---|---|---|
| Authenticated feature areas (`src/app/(app)/*`) | 84 top-level, 138 `page.tsx` total | direct directory listing |
| API route groups (`src/app/api/*`) | 129 top-level, **878** `route.ts` files | direct directory listing |
| Database tables (`src/lib/db/schema.ts`) | **431** tables in the `compliance` Postgres schema | `grep -c` on `.table(` declarations |
| Largest DB family | `erp_*` = 106 tables (GL, AP/AR, fixed assets, payroll, inventory, contracts, RFQs...) | schema.ts |
| Largest API surface | `api/v1/projexa/*` = 164 route.ts files | directory listing |
| AI worker-agent roster | 198 roleKeys across 24 teams (`src/lib/ai-team/roster.ts`) | direct read |
| DB tables — construction/interiors vertical | 15 `construction_*` + 7 `interior_*` (BOQs, RFIs, submittals, punch-lists, change-orders, mood boards, FFE, floor plans) | schema.ts |

**Module families confirmed present and in-scope for "all modules":** ERP & Finance (GL, AP/AR, fixed assets, payroll, inventory, procurement, sales), CRM & Sales, HR & Workforce (attendance, leave, recruitment, payroll), PROJEXA construction/interior-design verticals, Project Management (PMS: issues/sprints/wiki/time), Compliance/Audit/Legal/Governance (the platform's original core), GST reconciliation, Facilities Management (register digitization), VERI Chat (AI assistant), Worker/Task Agent dispatch, Reports & Analytics, Document/OCR extraction, e-Signature, Company Secretarial, ESG, Training, VERI Rewards, and more.

**Important scope caveat found during enumeration:** the construction/interior-design DB tables and API routes (`construction_*`, `interior_*`, `api/construction/*`, `api/v1/construction/*`) are fully built server-side but have **no dedicated frontend page** in `src/app/(app)/` yet — RFIs, submittals, BOQ, punch-lists, change-orders, mood boards, FFE, and floor plans exist as data model + API only. "All modules and functionality that exist in this repository" is interpreted here as the real, live, callable surface (API + DB + backend service), which is the cost-relevant surface regardless of whether a given screen has shipped — a backend call still costs the same whether triggered from a finished UI or a partial one.

**PROJEXA confirmation:** `api/v1/projexa/*` (164 routes) is a genuine alias/branding layer over the same compliance-tracker services (`erp-*-service.ts`, `crm-service.ts`, `hr-service.ts`, etc.) — confirmed via `ai-os` tracker notes ("zero-duplication architecture principle") and by the shared `resolveModelConfig`/service-layer call sites. This estimate treats PROJEXA traffic and compliance-tracker traffic as the same underlying workload, not additive — the task description's framing ("they are the same codebase") is correct and is followed here.

---

## 2. Real recorded usage data found and used to ground the model

Per the task's own instruction to check for real data before guessing, two real sources were found and used:

### 2.1 Token Usage Ledger (the real mechanism, currently near-empty)
`src/lib/services/token-usage-service.ts` + `tokenUsageLedger` (schema.ts) is a real, live table logging every LLM call's `orgId`, `scope` (`ai_team_internal` vs `product_orchestra`), `roleKey`/`layerKey`, provider, model, prompt/completion tokens, and `estimatedCostUsd` (via `estimateCostUsd()` in `llm-client.ts`). `cost-guard.ts` reads this table to enforce an **opt-in, per-org** monthly spend cap (`organisations.monthlyCostCapUsd`, nullable, no default value is set — `costCapEnforcementEnabled` defaults to `true`, but with no cap configured this is a no-op for a fresh org). This confirms the mechanism for tracking real spend exists and is wired into the actual request path (`resolveModelConfig()` checks `canIncurCost()` before every product-orchestra call) — but there is no evidence of a production tenant with meaningful accumulated history in this environment; the ledger's real value today is architecture-correct and forward-looking, not a large historical dataset to average over.

### 2.2 Real production load-test data — `docs/testing/PROJEXA_LOAD_TEST_RESULTS.md` (2026-07-10)
This is genuine, non-synthetic production-path data (the harness's own synthetic-data-*generation* cost is explicitly reported separately and excluded here) for the `task_oa` orchestra layer, run through the real `createTask`/`task-execution-engine.ts` service code path:

| Provider/model | Calls | Prompt tokens | Completion tokens | Ledger's reported cost |
|---|---|---|---|---|
| Groq / openai/gpt-oss-120b (floor tier) | 482 | 284,787 | 178,906 | $0.0425 |
| OpenRouter / z-ai/glm-5.2 (escalated) | 17 | 8,708 | 4,859 | $0.0101 |
| **Total** | **499** | **293,495** | **183,765** | **$0.0525** |

This gives three real, load-bearing numbers used throughout this estimate instead of guessed ones:
- **Real average call size:** ≈591 prompt tokens / 371 completion tokens per floor-tier call (a task-creation/planning agentic call); ≈512/286 for escalated calls.
- **Real escalation rate:** 17/499 = **3.4%** of calls needed a stronger model than the floor tier.
- **Real escalation cost multiplier:** an escalated call costs ~13x a floor-tier call and takes ~3x longer (6.0s vs 2.0s latency) — consistent with escalation existing specifically for harder cases, not routine ones.

**A material finding while re-costing this data with current real prices (Section 3.3):** the ledger's own $0.0425 figure for the Groq portion was computed using this codebase's `MODEL_PRICING` constant for `openai/gpt-oss-120b`, which is **understated by ~3.3-4x** versus Groq's actual current published price (see Section 3.2). Re-priced with real current rates, that same 482-call/463,693-token workload would cost **≈$0.150**, not $0.0425. This is flagged, not silently corrected in the ledger — it means the platform's own admin-facing cost dashboard currently under-reports real Groq spend, which matters for anyone using it to budget. This estimate uses the **corrected, independently-verified** pricing throughout, not the ledger's own constant.

---

## 3. Which AI providers/models are actually wired in, and their real current pricing

Read directly from `src/lib/orchestra-model-resolver.ts` and `src/lib/llm-client.ts` (not assumed): every org gets a **platform-default floor tier** before configuring anything of its own —

1. **Floor tier (default for every org):** Groq, `openai/gpt-oss-120b` — cheap, fast, reasoning-capable open-weight model.
2. **Same-model failover:** Cerebras, same `gpt-oss-120b` model under a different model-id string, used only when Groq's own request fails (reliability backstop, not a cost-shopping alternative) — funded by a fixed $10 prepaid credit per the codebase's own comments, not metered per-org.
3. **Escalation target** (`escalatedPlatformConfig()`, fires on deterministic signals in `floor-tier-escalation.ts`, not used at random): OpenRouter, `z-ai/glm-5.2`, pinned to the DeepInfra upstream host.
4. **Vision / document-OCR override** (`SOURCE_TYPE_MODEL_OVERRIDES.vision_document_extraction`): Groq `meta-llama/llama-4-scout-17b-16e-instruct` as the floor-tier vision model (added 2026-07-17 to close a real gap where the floor tier had no vision entry at all).
5. **BYO / premium tier** (customer_model_config, opt-in per org): any of OpenAI/Anthropic/Google/OpenRouter, e.g. `gpt-4o`, `claude-sonnet-5`, `gemini-2.0-flash` — available but not the default; used here only in the "High/premium-mixed" scenario (Section 5).

### 3.1 Reachable orchestra layers (real, not all 5 "nominal" layers apply)
Per the load-test report's own §4.5 finding (confirmed by grepping every `resolveModelConfig`/`resolvePlatformModelConfig` call site in `src/`), only **3 of 5** nominal orchestra layers are actually reachable by real product usage today:
- `task_oa` — Worker/Task Agent dispatch (task creation/planning across every module).
- `user_assistant_oa` — VERI Chat (the conversational assistant).
- `customer_account_oa` — the broad bucket covering document/OCR extraction, GST AI review, report AI-builder, construction progress/risk AI, CRM/communication drafting, ticket/email intelligence, and most other module-specific AI touches (30 real call sites found across the codebase resolve through this layer or `task_oa`/`user_assistant_oa`).
- `page_agent_oa` and `global_intelligence_oa` are dormant/unwired for real product traffic — correctly excluded from this cost model.

### 3.2 Real current prices, independently verified 2026-07-18 (not carried over from training data)

| Model | Provider | Prompt $/1M tok | Completion $/1M tok | Source | vs. this repo's own constant |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` (floor tier) | Groq | **$0.15** | **$0.60** | groq.com/pricing, fetched live | Repo has $0.036 / $0.18 — **understated ~4.2x / ~3.3x**, flagged as a real finding |
| `gpt-oss-120b` (failover) | Cerebras | $0.35 | $0.75 | web search, cross-checked | Matches repo's constant |
| `z-ai/glm-5.2` (escalation) | OpenRouter/DeepInfra | $0.4088 | $1.285 | openrouter.ai/z-ai/glm-5.2, fetched live | Matches repo's constant ($0.42/$1.32) within ~3% |
| `meta-llama/llama-4-scout-17b-16e-instruct` (vision) | Groq | $0.11 | $0.34 | web search, cross-checked | Matches repo's constant exactly |
| `claude-sonnet-5` (BYO/premium) | Anthropic | $3.00 (standard; $2.00 intro until 2026-08-31) | $15.00 (standard; $10 intro) | platform.claude.com pricing, fetched live | Matches repo's constant exactly |

The one real, verified discrepancy (Groq floor-tier pricing) is used at its **corrected** value throughout this document. Everywhere else, this repo's own pricing table checks out against live provider pricing as of this week — a good sign for the other entries' trustworthiness, and useful confirmation this codebase's pricing constants are maintained with real verification, just not perfectly (see Section 6 for what this means for confidence).

### 3.3 Prompt/response caching — real, but narrow in effect
Two real caching layers exist and were checked rather than assumed:
- **Anthropic prompt caching** (`llm-client.ts`'s `callAnthropic`, "Prompt & Cache Management Framework Phase 1", 2026-07-14): a real `cache_control` breakpoint, wired into `chat-service.ts`'s `generateAiReply()` only, and **only takes effect when the resolved provider is Anthropic** (i.e., an org has BYO-configured Claude, or a `vision_document_extraction` override resolves to `claude-sonnet-5`). It gives no benefit on the default floor tier (Groq) or escalation tier (OpenRouter/GLM-5.2) call paths, which explicitly get "no special handling this slice" per the code's own comment. Since the floor tier is what every org gets by default, **caching does not reduce the bulk of this estimate's AI cost** — it's real, but its blast radius today is narrow (Anthropic-configured orgs' chat calls only).
- **`llm-response-cache.ts`** (org-scoped, 24h TTL, opt-in per call site): caches whole LLM responses keyed by `(org, provider, model, systemPrompt, userMessage)`. Per its own header comment this had **zero real callers** until closed 2026-07-09 for one intended consumer (VERI FDE task-similarity evaluation) — not a general-purpose cache hit on chat/task volume. Not assumed to meaningfully discount this estimate's headline numbers for that reason; noted as a real but currently narrow lever, same as the Anthropic cache.

**Net effect on this model:** no blanket caching discount is applied to the floor/escalation-tier volume (correctly, since neither cache reaches it today). This is a conservative (i.e., not artificially cost-lowering) choice, consistent with the instruction to ground assumptions in what's actually wired, not what could theoretically exist.

---

## 4. Per-user monthly AI interaction-volume model

No real per-user, steady-state production traffic exists in this environment to measure directly (Section 2.1) — this section is **explicitly assumption-driven**, built from the real per-call token sizes in Section 2.2 applied to a reasoned interaction count per category, per active user per month. Three usage intensities are modeled since "using all modules and functionality" is itself a range (a new team ramping up vs. a mature team touching all 84 feature areas routinely).

| Category (→ real orchestra layer) | Low (light) | Mid (typical) | High (all-modules-active) | Grounding |
|---|---|---|---|---|
| VERI Chat messages (`user_assistant_oa`) | 20/mo | 50/mo | 80/mo | ~1/business day (Low) to ~4/business day (High) |
| Task/Worker Agent dispatches (`task_oa`) | 8/mo | 15/mo | 40/mo | task creation/planning across ERP/CRM/HR/Construction workflows |
| Document/OCR extraction (`customer_account_oa`, vision) | 4/mo | 8/mo | 20/mo | invoices, receipts, contracts, site-diary photos, HR docs |
| Other module AI actions (`customer_account_oa`: reports, GST review, construction progress/risk AI, CRM drafting, ticket/email intelligence, etc.) | 10/mo | 20/mo | 60/mo | reflects the ~30 real call sites spread across the module set |
| **Total interactions/user/month** | **42** | **93** | **200** | |

Per-call blended cost (floor tier + real 3.4% escalation rate applied uniformly, current corrected pricing, token sizes anchored to Section 2.2's real measurements — chat/other assumed ~1.4-1.5x the measured task_oa token size to account for conversation history and reasoning-model overhead; vision calls sized at ~1,200 prompt / 500 completion tokens for a typical scanned document + instruction):

| Category | Per-call blended cost | Basis |
|---|---|---|
| VERI Chat | $0.000423 | 900 prompt / 450 completion tok, 3.4% esc. to GLM-5.2 |
| Task dispatch | $0.000320 | 591 / 371 tok (real, measured), 3.4% esc. |
| Document/OCR | $0.000320 | 1,200 / 500 tok, 90% floor vision / 10% escalated to gpt-4o-mini-class |
| Other module actions | $0.000353 | 650 / 400 tok, 3.4% esc. |

**Resulting AI cost per user per month (floor/escalation tier only, no premium mix):**

| Scenario | Interactions/user/mo | AI $/user/mo | AI $/mo for 50 users |
|---|---|---|---|
| Low | 42 | $0.016 | $0.80 |
| Mid | 93 | $0.036 | $1.78 |
| High (all-modules-active) | 200 | $0.074 | $3.71 |

These are genuinely small dollar figures — not an error. They follow directly from two real, verified facts: (a) the floor-tier model is priced at fractions of a cent per call even at current corrected Groq rates, and (b) the real load-test data shows individual interactions in this codebase (at least for `task_oa`) run only a few hundred tokens each, not the multi-thousand-token context windows a document-heavy RAG or long-agentic-loop system would carry.

---

## 5. Premium-mix sensitivity (the "don't assume floor tier forever" scenario)

`AGENTS.md` Rule 8 (the 90-day quality mandate) explicitly warns against defaulting to the cheapest model for judgment-sensitive work, and this platform's own role roster tiers work into `mechanical`/`integrative`/`judgment` categories. It's plausible that some real-world orgs — especially ones leaning on VERI Chat for compliance/audit judgment calls, or configuring their own BYO Claude/GPT-4o key for quality reasons — would route a meaningful share of interactions to a premium model rather than the floor tier. This is modeled as an explicit additional scenario, not folded into "High" above, since it's a *quality choice* orthogonal to *volume*:

- Assume 20% of all interactions (at the High/200-per-month volume) route to `claude-sonnet-5` (standard pricing, $3/$15 per 1M) instead of floor/escalation tier, at ~700 prompt/400 completion tokens per call.
  - Premium-call cost: (700/1e6)×$3 + (400/1e6)×$15 = **$0.0081/call**
  - 20% × 200 = 40 calls/user/mo × $0.0081 = **$0.324/user/mo**
  - Remaining 80% × 200 = 160 calls/user/mo at the blended floor/escalation rate (~$0.00037/call avg) = **$0.059/user/mo**
  - **Total premium-mixed AI cost: ≈$0.38/user/month → ≈$19.2/month for 50 users.**

Even in this heavier, premium-leaning scenario, total AI inference spend for the whole 50-user deployment stays under $20/month — because per-interaction token counts in this codebase's actual agentic/chat calls are small, and even 20% escalation to a frontier model doesn't move a 200-call/month/user baseline into serious money at these token sizes. AI cost only becomes a first-order concern if either (a) per-call context windows grow substantially (e.g., large-document RAG, long multi-turn chat histories retained in full every turn), or (b) interaction volume per user is an order of magnitude higher than modeled here (e.g., 2,000+/month), or (c) a much larger share of traffic routes to premium tiers than 20%.

---

## 6. Infrastructure cost — Vercel + Supabase, real current pricing

### 6.1 Why not Hobby/Free tier
- **Vercel Hobby** disallows commercial/production use in its own terms, and its usage caps (bandwidth, function invocations, no team seats) don't fit a real multi-tenant SaaS serving 5 paying orgs.
- **Supabase Free** caps at 500MB database and pauses inactive projects after a period of no traffic — incompatible with a 431-table, always-on multi-tenant production schema serving 50 real users across ERP/CRM/HR/Construction workloads with real query complexity (joins across GL/AP/AR, payroll runs, cross-project construction rollups, compliance reporting).

Both platforms require at least their **Pro** tier for this workload; this section reasons about what *above* Pro is actually needed given the app's real complexity.

### 6.2 Vercel — real current pricing (vercel.com/pricing, fetched live 2026-07-18)
- Pro: **$20/seat/month**, each seat includes $20 of usage credit; 1TB Fast Data Transfer + 10M Edge Requests included per team/month; overage $0.15/GB bandwidth, $2/1M edge requests, $0.60/1M function invocations, $0.128/hr Active CPU, $0.0106/GB-hr provisioned memory beyond inclusions.
- **Seats needed:** Vercel seats are for the engineering/ops team with dashboard/deploy access, not the 50 end-customer-users (who only hit the deployed app via browser/API, no Vercel account needed). Assume **2 seats** (a small operating/admin team) = $40/month base, with $40 pooled usage credit.
- **Usage reasoning at 50-user scale:** 878 API routes but modest real request volume for 50 users doing normal SaaS-dashboard usage (page loads, polling, form submissions) — bandwidth and function-invocation volume for this user count should stay well inside the 1TB/1000 GB-hour Pro inclusions in most months. Some buffer is prudent for report-generation/PDF-export spikes and document uploads (OCR).
- **Vercel estimate: $40-60/month** (2 seats + modest headroom for occasional overage).

### 6.3 Supabase — real current pricing (supabase.com/pricing + compute docs, fetched live 2026-07-18)
- Pro: **$25/month** base — includes 8GB database disk, 100GB file storage ($0.0213/GB over), 100,000 MAUs ($0.00325/MAU over), 250GB egress + 250GB cached egress ($0.09/$0.03 per GB over), and a $10/month compute credit (covers one Micro instance: 2-core shared ARM, 1GB RAM, 60 direct connections).
- **Compute tier reasoning:** Micro's 1GB RAM / 60 connections is thin for a 431-table schema with real ERP/CRM/HR/Construction query patterns (multi-table joins for trial balance/P&L/AR-aging/budget-vs-actual reports, cross-project construction rollups, RLS-scoped queries across every tenant-scoped table) serving 5 concurrent orgs — even at only 50 total users, report/dashboard queries against this many tables benefit from more working memory and headroom than Micro provides. **Recommend Small ($15/mo) as the floor and Medium ($60/mo) for comfortable headroom** — this repo's own real query complexity (not row count alone) is the reason to size up, consistent with the task's instruction not to assume the cheapest tier "fits" just because the user count is modest.
  - Small compute nets to $15 - $10 credit = **+$5/month** over base.
  - Medium compute nets to $60 - $10 credit = **+$50/month** over base.
- **Storage reasoning:** 8GB included database disk is plausibly sufficient for year-one transactional data at 50 users (order-of-magnitude: a few thousand rows/day across tasks/invoices/journal entries/audit logs/chat messages/orchestra_executions/token_usage_ledger — this platform already logs almost every action, so write volume is higher than row-count-per-user alone would suggest, but 50 users' worth is still modest in absolute terms). **File storage is the more likely early overage risk** — construction site-diary photos, floor plans, contracts, and OCR'd documents accumulate faster than transactional rows; even so, 100GB included is unlikely to be exceeded within the first year at this user count (50 users × ~20-30 docs/month × ~1-2MB average ≈ 1-3GB/month growth).
- **Supabase estimate: $25 base + $5-50 compute = $30-75/month**, plus a small buffer (~$10) for storage/egress overage as usage matures → **$30-85/month**, central estimate **~$75/month** (Pro + Medium compute, no meaningful overage yet).

### 6.4 Infra total

| Scenario | Vercel | Supabase | Total infra/mo |
|---|---|---|---|
| Low (lean tiers, Small compute) | $40 | $30 | **$70** |
| Mid (central estimate: 2 seats, Medium compute) | $50 | $75 | **$125** |
| High (headroom for growth/overage, Large compute) | $60 | $120 | **$180** |

*(Not itemized above but real: Sentry error tracking is already wired into this codebase — `sentry.server.config.ts`/`sentry.edge.config.ts` exist. A small team's Sentry usage is typically free-to-~$26/month at this scale; not counted in the Vercel/Supabase total per the task's explicit infra scope, but worth knowing it's a small additional real line item.)*

---

## 7. Combined total — per-user monthly cost

| Scenario | Infra/mo (total) | AI/mo (total) | Combined/mo (total) | Combined $/user/mo (÷50) |
|---|---|---|---|---|
| **Low** | $70 | $0.80 | $70.80 | **$1.42** |
| **Mid** (central estimate) | $125 | $1.78 | $126.78 | **$2.54** |
| **High** (all-modules-active volume) | $180 | $3.71 | $183.71 | **$3.67** |
| **High + premium-mix AI** (20% of calls on Claude Sonnet 5) | $180 | $19.20 | $199.20 | **$3.98** |

### Headline number
**≈$2.50–$4.00 per user per month** (combined infra + AI), central estimate **≈$2.54/user/month** (**≈$127/month total** for the 5-org/50-user deployment), with infra accounting for **~97-99%** of total cost at every modeled scenario and AI inference cost remaining a small, single-digit-dollar-per-month line item even under a heavier, premium-model-leaning usage assumption.

**Broken out separately (central/Mid estimate):**
- Infra: **$125/month total → $2.50/user/month**
- AI: **$1.78/month total → $0.036/user/month**

---

## 8. Confidence / uncertainty statement — read this before quoting a single number

This is a **guesstimate**, explicitly not a bill, for these reasons:

1. **No real steady-state per-user production traffic exists to measure** (Section 2.1) — the interaction-volume model (Section 4) is a reasoned assumption anchored to one real load-test's per-call token sizes, not a measured average across real users over a real month. Real usage could plausibly be 2-5x lower (a new deployment ramping up slowly) or higher (a genuinely power-user team hammering every module daily) than the "High" scenario models.
2. **The floor-tier Groq pricing correction (Section 3.2) is the single most consequential pricing fact found** — it alone changes the AI-cost portion by ~3.3-4x versus what this codebase's own admin dashboard would currently report. If Groq's real price were to change again (these are all "no live pricing API" manually-maintained constants per this repo's own `llm-client.ts` comment), the AI-cost line moves proportionally — but even a further 5x increase in AI cost would add only another ~$10-20/month to the total, not change the qualitative conclusion that infra dominates.
3. **Infra sizing (Supabase compute tier, Vercel seat count) is a judgment call**, not a measured requirement — actual query load depends on real usage patterns (how many concurrent report-generation/dashboard queries, how document-heavy the OCR/construction-photo workflows actually get) that can't be known without running the real deployment. The Low-High infra range ($70-$180/month) is intended to bound this uncertainty.
4. **PROJEXA vs. compliance-tracker are correctly treated as one workload**, per the task's own framing and this investigation's confirmation that PROJEXA is a thin alias layer — this estimate does not double-count infra or AI cost for "two products."
5. **Construction/interior-design modules have API+DB but no dedicated frontend UI yet** (Section 1) — if "using all modules" is interpreted strictly as UI-driven usage, real interaction volume for those specific modules today would be near-zero (no button exists to click yet), which would pull the "High" scenario toward "Mid." This estimate takes the more conservative-for-cost (i.e., higher-volume) reading that backend/API-level usage of every module counts, consistent with "all modules and functionality that exist in this repository" as literally written.
6. **What would most change this number:** (a) real measured per-user chat/task volume once the platform has actual production traffic and the Token Usage Ledger has meaningful history to query directly instead of extrapolating from one load test; (b) a decision about how much of real usage should route to premium/BYO models for quality reasons (Section 5) rather than staying on the floor tier; (c) actual database growth and query-latency data once the real 431-table schema is under real concurrent multi-tenant load, which would validate or correct the Supabase compute-tier recommendation.

**Bottom line, stated plainly:** at 50 total users, running this specific codebase's specific default architecture (Groq floor tier + rare GLM-5.2 escalation, Vercel + Supabase), the **infrastructure bill dominates and the AI-inference bill is genuinely small** — a few dollars a month total, not a few dollars per user. That conclusion is fairly robust across the scenario range modeled here; the *combined per-user number* (**$1.42–$3.98/month**, central **≈$2.54/month**) is soft and should be treated as an order-of-magnitude planning figure, not a quote.
