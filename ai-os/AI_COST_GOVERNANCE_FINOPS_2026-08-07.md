# AI Cost Governance & FinOps / Cost Visibility & Attribution -- gap-closure record (2026-08-07)

Redispatch of `task-20260718-062003` (blocked at first invocation by the OpenRouter/Cerebras
balance hard-stop, since removed from `preflight-guard.py`, commit `7ff5be8`). Sub-task of
`UMR-20260801-170930-2080`. Closes 4 VERIDIAN Review Framework findings under "AI Cost
Governance & FinOps." Real-code investigation first, per this task's own instruction --
each finding's disposition below states what was actually found, not what the finding
description assumed.

## Finding 1 (Low): Per-tenant AI cost visibility available to Finance

**Investigation finding:** the gap description was accurate. `getTokenUsageSummary()`
(`src/lib/services/token-usage-service.ts`) and its route (`GET /api/ai/team/token-usage`,
veridian_admin-gated) already compute a real, per-org (`byOrg`) breakdown from
`token_usage_ledger` -- confirmed via direct code read. No page in `src/app/(app)/` fetched
`/api/ai/team/token-usage` (confirmed via `git grep`) -- the API/service-level visibility was
real, the Finance-facing UI was not.

**Fix:** `src/app/(app)/ai-cost-governance/page.tsx` -- a new veridian_admin-gated page
(nav: Admin > AI Cost Governance) consuming that exact endpoint: total cost, cache savings,
platform monthly forecast, cost-by-org (per-tenant, bar chart), cost-by-scope, cost-by-role,
cost-by-model.

**Honest limitation disclosed on the page itself, not fixed here:** `token_usage_ledger`'s
`orgId`-bearing (`product_orchestra`-scope) rows are currently written only by the two call
sites that also call `recordPromptCacheMetric()` (`chat-service.ts` / VERI Chat,
`src/app/api/help/ask/route.ts`), not by every Orchestra Layer -- confirmed via
`git grep -n "insert(tokenUsageLedger"` (exactly one call site,
`token-usage-service.ts:logTokenUsage`) and its 3 real callers. Every real per-call cost
IS captured, in full, across every layer, in `orchestra_executions`
(`orchestra-execution-logger.ts`, no coverage gap there) -- surfaced today by the existing
AI Observability and Orchestra Analytics pages. The Finance-specific per-org rollup this
page adds is real but partial-coverage; widening `token_usage_ledger` write coverage to
every Orchestra Layer is a separate, larger change, out of this Low-priority finding's own
scope ("check for and confirm/build the consuming UI page").

## Findings 2 + 3 (Medium): cost reconciled against real invoices / cost-per-report,
## cost-per-action measured not estimated

Both share one root cause and one recommended fix (framework rows 79/80: "manual monthly
reconciliation first, low effort; automate later if drift is significant/recurring").
`estimateCostUsd()` (`src/lib/llm-client.ts`) computes cost from a static per-token pricing
table -- real, but never checked against what the provider actually billed. Confirmed no
existing reconciliation mechanism for the *product's* provider spend (`git grep -n
"reconcil"` found `ai-os/scripts/cost-reconciliation.py`, which reconciles the AI-OS's own
*agent-execution* dev cost against `glm-proxy-calls.jsonl` -- a real, separate concern,
documented in `ai-os/COST-CONTROL.md`, not the product's OpenRouter/provider invoice).

**Fix:** deliberately the smallest real thing that makes "reconciled against actual
invoices" true, not an automated invoice-import pipeline:
- `ai_cost_reconciliation` table (`src/lib/db/schema.ts`, migration
  `drizzle/0313_ai_cost_reconciliation.sql`) -- one row per (period month, provider),
  hand-entered.
- `src/lib/services/cost-reconciliation-service.ts` -- `recordActualInvoice()` (Finance
  pastes in the real total from the provider's own billing dashboard for a closed month)
  and `listReconciliations()`, which pairs every entry with a **live-computed** (never a
  stale snapshot) estimated `token_usage_ledger` total for that same period+provider, plus
  drift $ and drift %.
- `GET/POST /api/ai/team/cost-reconciliation` (veridian_admin-gated).
- The "Provider Invoice Reconciliation" section on the new Finance page: entry form +
  table with drift highlighted.

This directly answers "cost-per-report and cost-per-AI-action are measurable, not
estimated" the same way: per-action cost figures already exist (one row per LLM call in
`orchestra_executions` and `token_usage_ledger`) -- what was missing was any way to check
whether those per-call estimates track real billing at all. The reconciliation mechanism
above is that check; if a future recorded month shows large recurring drift, that is the
signal (per the framework's own recommended approach) to invest in the heavier automated
integration -- not assumed necessary today.

## Finding 4 (Low): Cross-repo (compliance-tracker + projexa) AI spend visible as one figure

**Investigation finding:** the gap description was accurate and independently reconfirmed:
`ai-os/CONSTITUTION.yaml`'s `control_model` already states, `status: CONFIRMED_TRUE`,
that `FChecklist/projexa` has "zero local domain data, zero local LLM client -- all
reads/writes via `src/lib/veridian-client.ts` calling compliance-tracker's
`/api/v1/projexa/*`." That means every real AI call PROJEXA makes already flows through
this repo's `llm-client.ts`/`orchestra-model-resolver.ts`/`token_usage_ledger` -- so the
combined-figure visibility described in the finding is real today, but exactly as the
finding says, as an *architectural byproduct* of PROJEXA never having its own key, not a
deliberately engineered/tested invariant with anything protecting it from silently
regressing.

**Fix, per the framework's own recommended approach ("documentation + a
guardrail-presence-style CI check flagging any new provider-API-key usage added to
projexa"):**
- `ai-os/registry/provider-key-usage-allowlist.yaml` -- every `src/` file in
  compliance-tracker that references a raw LLM-provider API key env var
  (`OPENROUTER_API_KEY`/`ANTHROPIC_API_KEY`/etc.), with a stated reason per file.
- `scripts/check-provider-key-usage.mjs` -- full-repo scan (allow-list gate, same
  enforcement class as `check-guardrail-presence.mjs`), confirmed passing locally
  (`node scripts/check-provider-key-usage.mjs` -- 2018 files scanned, 17 real references,
  all accounted for).
- Staged (not yet CI-active -- see honest limitation below):
  `ai-os/registry/PENDING-MANUAL-APPLICATION-provider-key-usage-check.yml.txt`.
- This document, as the "documentation" half of the recommended fix.

**Honest limitation, stated plainly, not oversold:** this task has no access to the
`FChecklist/projexa` repository or its CI -- the check above can only see
compliance-tracker's own files. What it DOES guarantee: the one repo that has ever held a
real provider key (per `control_model`'s own `verification_rule`) cannot silently grow a
second, unlogged one. Confirming PROJEXA itself still has zero local LLM client requires
either porting this same check into that repo's own CI in a follow-up PR there, or
periodic manual verification (documented as the fallback in the registry file's own
header) -- not something this repo's tooling can do on its own.

**Separate, real, disclosed platform constraint:** the GitHub token available to this
session has scopes `gist`, `read:org`, `repo` only (`gh auth status`, confirmed live) --
no `workflow` OAuth scope, so it cannot push a change to a real
`.github/workflows/*.yml` file. Same precedent as
`PENDING-MANUAL-APPLICATION-sec07-ocid-lock-check.yml.txt` /
`-reviewer-not-author-check.yml.txt`: the workflow is staged, real, and ready, but needs
one manual `git mv` by whoever next has `workflow`-scope push access.

## Real file changes

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | +`aiCostReconciliation` table (additive) |
| `drizzle/0313_ai_cost_reconciliation.sql` | new migration (hand-written -- see its own header for why, migration-drift avoidance) |
| `src/lib/services/cost-reconciliation-service.ts` | new |
| `src/app/api/ai/team/cost-reconciliation/route.ts` | new |
| `src/app/(app)/ai-cost-governance/page.tsx` | new |
| `src/components/AppSidebar.tsx`, `messages/en.json`, `messages/hi.json` | +1 nav item (Admin section) |
| `src/lib/protected-routes.generated.ts` | regenerated (`node scripts/generate-protected-routes.mjs`) |
| `scripts/check-provider-key-usage.mjs` | new |
| `ai-os/registry/provider-key-usage-allowlist.yaml` | new |
| `ai-os/registry/PENDING-MANUAL-APPLICATION-provider-key-usage-check.yml.txt` | new, staged (not yet CI-active) |
| `ai-os/OS.yaml` | +index entries for the 3 new `ai-os/` governance files above |

No changes to `src/lib/services/permission-service.ts` -- the new route follows the
existing `dbUser.role !== "veridian_admin"` direct-check pattern already used by
`/api/ai/team/token-usage`, not `ERP_ACTION_ROLES`.
