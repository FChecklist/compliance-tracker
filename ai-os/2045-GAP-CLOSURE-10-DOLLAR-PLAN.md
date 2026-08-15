# 2045-Row Gap Closure: $10 Execution Plan

Ready to fire the moment OpenRouter has real balance (`$40 credits / $40.07 usage` at time of writing — confirmed exhausted, live check, not the stale earlier number). Nothing in this plan has been dispatched — it's the watertight spec, not the dispatch itself.

## Audit, reconfirmed

- CSV (`VERIDIAN_Review_Framework_evaluated_2045rows.csv`): 2,045 data rows, confirmed by direct row count.
- Per `SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`'s live-code-verified count (not the stale CSV `Status` column, which is frozen at 2026-07-16): **~1,798 closed, ~170 genuinely open, ~15 more routed to execution from the deferred set = ~185 real remaining items.**
- Spot-checked directly tonight: pulled all 16 rows under `ERP & Finance Modules > General Ledger`. Confirms the staleness firsthand — one row's own `Gap Identified` text reads "No material gap" while its `Status` column still says "Evaluated - Gap Open." The live-verified ~185 figure, not the raw CSV `Status` column, is the number to plan against.

## Why $750-1,500 (unfixed) collapses toward $10-40 (fixed + batched)

Three multiplicative fixes, each already built and tested tonight (see `COST-CONTROL.md`):

1. **Stop paying per-row.** Rows cluster into ~15-row sub-category groups (General Ledger, Chart of Accounts, Accounts Payable, etc. each ~15-16 rows) that are different *quality parameters of the same feature* — one real fix plausibly closes most of a cluster at once. **~185 rows → ~10-15 dispatches**, not 185.
2. **Stop paying for repeated failure.** Circuit breaker stops an approach after 2 identical failures instead of the 12 retries that burned 2.3 hours on one task last night.
3. **Stop paying for redundant tokens.** Cache (exact-match, tested 36x faster on hit) + prompt-size fix (no more re-sending the full original prompt on every resume) cut the token volume per dispatch.

## Watertight prompt template applied — two real, concrete examples

Not generic placeholders — built from the actual CSV data pulled tonight.

### Example 1 — SOFTWARE_ONLY (never reaches AI)

```
INPUT: CSV rows where Main Category=ERP & Finance Modules, Sub Category=General Ledger, Gap Identified contains "No material gap" but Status="Evaluated - Gap Open".
OUTPUT: updated Status column value "Evaluated - No Gap" for each matched row, written back to the CSV.
GUARDRAILS: only rows where Gap Identified text is EXACTLY "No material gap" (case-sensitive substring match) qualify. No row's Gap Identified text may be reinterpreted or summarized to decide this — string match only.
FAILURE_DETECTION: any row updated where Gap Identified does not contain that exact string = failure, revert.
SUCCESS_DETECTION: CSV diff shows only Status column changed, only on qualifying rows, row count of change = count of qualifying rows found in INPUT.
CACHE_LAYERS_CHECKED: L1 (exact-match, unlikely to hit — this is a one-off script run, not a repeated prompt)
SOFTWARE_PCT: 100  AI_PCT: 0
```
Run via `software-request-analyzer.py "check if gap identified text matches no material gap and update status"` → routes `SOFTWARE_ONLY` correctly (verify by running it — this is exactly its designed use). This closes some real rows for **$0**, before any AI dispatch.

### Example 2 — batched AI dispatch (real remaining gap, e.g. "General Ledger: CRUD & Approval Workflow Correctness has a Score 4/5 gap")

```
INPUT: CSV rows for Sub Category=General Ledger with a real (non-"No material gap") Gap Identified after Example 1's software pass removes the false positives. Read prompt.txt once; do not restate it on resume (L5 context cache).
OUTPUT: one PR per sub-category cluster (not per row) closing the real gaps for that cluster; CSV rows re-scored with evidence (file:line of the fix) in a companion note, not just marked closed on trust.
GUARDRAILS: Tier1 only (docs/tests/additive, no schema/auth/RLS/payment/.env) may self-merge once CI is green. Tier2 holds for Owner sign-off, no exceptions. Do not touch rows outside this Sub Category. Do not exceed 2 retry attempts on an identical failure signature (circuit breaker enforces this regardless, but the task should self-stop first).
FAILURE_DETECTION: CI red after 2 auto-fix attempts = failure, checkpoint blocked, do not retry a 3rd time. Real OpenRouter cost for this invocation ≥ the per-task budget slice (see below) = failure, stop.
SUCCESS_DETECTION: PR open, CI green, CSV rows in this cluster show real evidence (not just a status flip), pushed to a real branch.
CACHE_LAYERS_CHECKED: L1 (exact-match), L5 (context — prompt.txt referenced not restated)
SOFTWARE_PCT: ~30 (schema/scaffolding, test running)  AI_PCT: ~70 (actual logic + evidence write-up)
```

## Budget allocation (mechanically enforced, not aspirational)

The proxy's hard ceiling (`PROXY_BUDGET_CAP_USD`, already deployed) is the actual enforcement mechanism — set it once, work stops the instant it's hit, no matter how many rows remain:

| If the ceiling is set to | What happens |
|---|---|
| $10.00 | Work stops at $10 exactly. Based on tonight's real per-dispatch costs (~$0.90-2/dispatch unfixed, likely well under $1/dispatch with caching+batching), this covers roughly **5-10 batched dispatches** — enough for several sub-category clusters, not all ~12-15. Honest expectation: a meaningful dent, not full closure. |
| $40.00 | Covers all ~10-15 batched dispatches at the *current-trajectory* per-dispatch cost with margin — the realistic number for actually finishing the real ~185-row scope, per the recalculated $20-40 estimate in `COST-CONTROL.md`. |

**Recommendation, stated plainly rather than telling you what's easiest to hear:** set the real ceiling at **$25** (comfortably inside the $20-40 fixed-and-batched range, well under the $750-1,500 unfixed number) as the honest target for actually finishing the ~185 rows, and treat $10 as a checkpoint — if the first 3-4 batched dispatches (covering the cheapest, most templated clusters like General Ledger/Chart of Accounts) come in under $10 total as tonight's numbers suggest they should, that's real evidence the fixed process works, and it's the moment to decide whether to extend the ceiling for the rest rather than guessing upfront.

## Dispatch order (cheapest/most templated clusters first, to prove the process before spending more)

1. General Ledger, Chart of Accounts, Journal Entries (financial-module clusters, ~15 rows each, structurally similar — proves the batching pattern cheaply)
2. Accounts Payable, Accounts Receivable, Banking, Cash Management, Cost Centers, Budgets (same family, same pattern)
3. Remaining clusters from `Project & Construction Modules (PROJEXA)`, `CRM & Sales Modules`, `HR & Workforce Modules`, `AI Architecture` — sized once step 1-2's real cost-per-cluster is known, not guessed in advance.

Not dispatched tonight — waiting on real OpenRouter balance, per the standing blocker in `COST-CONTROL.md`.
