# PROGRESS -- task-20260807-071557-retry-ai-cost-governance-finops-cost-vis

Redispatch of `task-20260718-062003` (sub-task of `UMR-20260801-170930-2080`; original attempt
blocked by the OpenRouter/Cerebras balance hard-stop, since removed from `preflight-guard.py`,
commit `7ff5be8`). Full disposition record: `ai-os/AI_COST_GOVERNANCE_FINOPS_2026-08-07.md`.

## Completed
- [x] Read real current implementation before writing code (per SPEC instruction): confirmed
      `getTokenUsageSummary()`/`token-usage-service.ts` and `/api/ai/team/token-usage` already do
      real per-org/scope/role/model cost aggregation from `token_usage_ledger` -- but no page in
      `src/app/(app)/` consumed that endpoint (`git grep` confirmed). Finding 1's gap description
      was accurate.
- [x] Finding 1 (Low, per-tenant visibility): built `src/app/(app)/ai-cost-governance/page.tsx`,
      a new veridian_admin-gated Finance dashboard consuming `/api/ai/team/token-usage` (total
      cost, cache savings, monthly forecast, cost-by-org/scope/role/model). Wired into nav
      (`AppSidebar.tsx` Admin section), i18n (`messages/en.json`/`hi.json`), and
      `protected-routes.generated.ts`. Honest partial-coverage limitation disclosed on the page
      itself (per-org ledger rows currently only written by 2 of N call sites; full per-call cost
      is captured elsewhere in `orchestra_executions`) rather than silently implied as complete.
- [x] Findings 2+3 (Medium, invoice reconciliation / cost-per-action measurability): confirmed no
      existing mechanism reconciles the *product's* provider spend (the only `reconcil` hit,
      `ai-os/scripts/cost-reconciliation.py`, covers the AI-OS's own agent-execution dev cost, a
      separate concern). Built the framework's own recommended fix (manual monthly reconciliation
      first): `ai_cost_reconciliation` table (`schema.ts` + hand-written
      `drizzle/0313_ai_cost_reconciliation.sql`, migration-drift-avoidance rationale in its own
      header), `cost-reconciliation-service.ts` (`recordActualInvoice`/`listReconciliations`,
      drift computed live against `token_usage_ledger`, never a stale snapshot),
      `GET/POST /api/ai/team/cost-reconciliation` (veridian_admin-gated, does NOT touch
      `permission-service.ts`'s `ERP_ACTION_ROLES` -- follows the existing direct-role-check
      pattern `/api/ai/team/token-usage` already uses), and a "Provider Invoice Reconciliation"
      section on the new Finance page (entry form + drift-highlighted table).
- [x] Finding 4 (Low, cross-repo unified spend): reconfirmed via `ai-os/CONSTITUTION.yaml`'s
      `control_model` (`status: CONFIRMED_TRUE`) that PROJEXA has zero local LLM client -- all its
      AI calls route through this repo's `/api/v1/projexa/*`, so the combined figure is real today
      but was an architectural byproduct, not a guarded invariant. Built the framework's own
      recommended fix: `ai-os/registry/provider-key-usage-allowlist.yaml` (every `src/` file
      referencing a raw provider-key env var, with a reason) + `scripts/check-provider-key-usage.mjs`
      (full-repo allow-list gate, same enforcement class as `check-guardrail-presence.mjs`) +
      `ai-os/AI_COST_GOVERNANCE_FINOPS_2026-08-07.md` (the documentation half). Verified locally:
      `node scripts/check-provider-key-usage.mjs` passes (2018 files scanned, 17 real references,
      all accounted for).
- [x] CI workflow for the check above staged at
      `ai-os/registry/PENDING-MANUAL-APPLICATION-provider-key-usage-check.yml.txt` rather than a
      live `.github/workflows/*.yml` -- this session's `gh auth status` confirmed scopes `gist`,
      `read:org`, `repo` only, no `workflow` scope, so GitHub itself rejects the push. Same
      precedent as the two existing `PENDING-MANUAL-APPLICATION-*` files in that directory. Needs
      one manual `git mv` into `.github/workflows/` by whoever next has workflow-scope push access.
- [x] `ai-os/OS.yaml` index entries added for the 3 new `ai-os/` governance files (additive only).
- [x] `ai-os/registry/asset-registry-coverage.yaml` exemption entry added for the new
      `ai_cost_reconciliation` table (platform-wide by design, no display-name column).
- [x] Verified locally: `node scripts/check-provider-key-usage.mjs` passes,
      `node scripts/check-governance-yaml-parse.mjs` passes (5 governance YAMLs parse clean),
      all new imports/exports resolve (`aiCostReconciliation`/`tokenUsageLedger` via
      `db/index.ts`'s `export * from './schema'`, `daysInMonthUtc` in `spend-forecast.ts`,
      `Wallet` icon already imported in `AppSidebar.tsx`, all referenced `ui/*` components exist).
      Full-project `tsc --noEmit` OOMs in this sandbox regardless of these changes (known
      environment memory constraint on this large a codebase, not something introduced here) --
      relying on CI's own typecheck job for the full-project pass.
- [x] Confirmed no conflict with other in-flight AI Cost Governance & FinOps sessions in
      `ai-os/boss/ACTIVE-CLAIMS.yaml` (anomaly-detection/spend-forecast and cost-ceiling-alert
      entries cover different findings/files).
- [x] Did not touch `permission-service.ts`'s `ERP_ACTION_ROLES` table (per SPEC instruction).

## Remaining
- [ ] None -- all 4 findings closed. Two items explicitly deferred by design, not oversight (both
      documented above and in the gap-closure doc): (a) widening `token_usage_ledger` per-org write
      coverage to every Orchestra Layer -- out of Finding 1's own ("Low") scope; (b) activating the
      staged CI workflow -- blocked on real `workflow`-scope push access, not on this session.
