# AI Cost Governance & FinOps

VERIDIAN Review Framework gap-closure, "AI Cost Governance & FinOps" (2026-08-01). Covers the 4 findings under that heading: per-tenant cost visibility, invoice reconciliation, per-action cost measurement, and cross-repo spend visibility. Read this alongside `src/lib/db/schema.ts`'s `tokenUsageLedger`/`aiCostReconciliations` comments and `src/lib/services/token-usage-service.ts` / `cost-reconciliation-service.ts` -- this doc explains *why*, those explain *how*.

## §1. Per-tenant AI cost visibility (Finding: Low)

Real per-tenant spend has been queryable since 2026-07-18 via `GET /api/ai/team/token-usage` (`getTokenUsageSummary()`), grouped by org/scope/role/model. What was missing was a UI page that actually consumed it -- the data existed at the API/service level, but Finance had no page to look at. **Closed**: `src/app/(app)/ai-cost-governance/page.tsx` (nav: Tools → "AI Cost & FinOps", `veridian_admin`-gated same as the API route). The per-tenant table resolves `org_id` to the org's real name via a join added to `getTokenUsageSummary()`'s `byOrg` query (previously only the raw id was returned).

## §2. Cross-repo (compliance-tracker + projexa) AI spend visibility (Finding: Low)

**Status: real today, but was an architectural byproduct, not an engineered guarantee -- now enforced.**

PROJEXA (`FChecklist/projexa`) carries zero local domain data and zero local LLM client. Every AI-adjacent call PROJEXA makes goes through `src/lib/veridian-client.ts`'s `callVeridian()`, which calls back into *this* repo's `/api/v1/projexa/*` surface with a bearer API key (see `ai-os/CONSTITUTION.yaml` §2 `control_model`, `repo: FChecklist/projexa`, `status: CONFIRMED_TRUE`). Those `/api/v1/projexa/*` routes run the same `llm-client.ts` / `logTokenUsage()` path every other AI call in this repo uses. **The practical consequence: cross-repo AI spend is already unified into one figure today** -- `token_usage_ledger` in this repo is genuinely the combined total, because there is no second ledger anywhere for PROJEXA's own AI usage to have landed in instead.

The gap was that nothing *enforced* this stayed true. If a future PROJEXA change added a direct provider API key (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, etc.) or called a provider endpoint directly, AI spend would silently fragment into two disconnected ledgers with no CI signal.

**Closed**: `FChecklist/projexa#68` adds `scripts/check-no-provider-api-keys.mjs` -- a guardrail-presence-style check (same honest-limitation framing as this repo's own `scripts/check-guardrail-presence.mjs`: a deterministic text-presence scan, not a runtime-unbypassable lock) that scans `projexa/src/` for forbidden provider API-key env names and forbidden provider endpoints, and asserts `veridian-client.ts` still has its `callVeridian`/`VERIDIAN_API_BASE` markers intact. **Not yet wired into `projexa`'s CI** as of this writing -- the session that authored it lacked the `workflow` OAuth scope needed to push a `.github/workflows/ci.yml` change; the exact job to add is in that PR's description, pending someone with `workflow` scope (or the GitHub web UI).

If PROJEXA ever legitimately needs its own provider key (meaning it would stop routing AI through this repo), add the key to `ALLOWED_KEY_ENV` in that script **and** update this section explaining why -- same "manifest update + justification" discipline this repo's Operating Rule 9 requires for guardrail changes.

## §3. Cost attribution reconciles against actual provider invoices (Finding: Medium)

`token_usage_ledger.estimated_cost_usd` is, honestly, an estimate: `(promptTokens/1000) * pricing.promptPer1k + (completionTokens/1000) * pricing.completionPer1k` against a manually-maintained `MODEL_PRICING` table in `llm-client.ts` -- never checked against what OpenRouter/Groq/Cerebras/Anthropic actually billed.

**Recommended approach (per the finding's own gap-analysis row): manual monthly reconciliation first, automate later only if drift proves significant or recurring.** No provider in this stack exposes a "get me exactly what I was billed, in real time, reconcilable against my own request logs" API cheaply enough to justify automating this before it's known to matter.

**Closed**: `compliance.ai_cost_reconciliations` (migration `drizzle/0304`), `src/lib/services/cost-reconciliation-service.ts`, `GET`/`POST /api/finance/ai-cost-reconciliation`, surfaced in the reconciliation table on the AI Cost & FinOps page. Finance enters the real invoice total for a `(provider, calendar month)` once the bill arrives; the service snapshots what the ledger's own estimate said for that same provider+month at record time, and stores `variance_usd`/`variance_pct`. This is a real, standing measurement of estimate accuracy -- not a one-time check.

**If drift turns out to be significant or recurring** (the trigger condition this finding's own recommended approach names for automating further): the next step would be a scheduled job pulling each provider's billing API where one exists, rather than waiting for a human to type in a number monthly. Not built now because there's no recorded drift yet to justify it -- building it speculatively would be exactly the kind of premature automation the recommended approach was written to avoid.

## §4. Cost-per-report and cost-per-AI-action are measurable, not estimated (Finding: Medium)

**Honest limitation, stated directly rather than worked around: none of OpenRouter/Groq/Cerebras/Anthropic expose per-request billing granularity at all.** Their invoices are monthly aggregates. There is no provider-side "here is exactly what request #4471 cost you" figure to reconcile individual actions against -- building an *exact* per-action measurement isn't achievable with real data from any wired provider, not a scope choice made here.

The finding's own recommended approach for this row is the same as §3's ("see row 79"): manual monthly reconciliation, which is what was built. What that buys per-action figures: every per-action/per-report cost shown in the AI Cost & FinOps UI (cost/request in each breakdown table) is a token-count estimate exactly as before, but now sits next to a real, standing "Estimate Accuracy" figure (`±X%`, from `getReconciliationDriftSummary()`) computed from actual invoice reconciliations. Finance sees a measured confidence bound on the estimate instead of an unqualified number presented as fact. Once reconciliation history exists across enough months to show whether drift is concentrated in specific providers/models, that's the trigger to consider a provider-specific correction factor applied to per-action figures -- not built speculatively now, same reasoning as §3.
