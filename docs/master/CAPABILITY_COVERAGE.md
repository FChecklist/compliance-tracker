# VERIDIAN — Capability Coverage (Mode Pills + Chain Selector deterministic dispatch)

> **⚠️ Numbers below are a stale 2026-07-09/10 snapshot.** VERIDIAN Review
> Framework gap-closure (2026-07-18, "Calculation Auditability") re-read
> `capability-tree-service.ts`'s `WIRED_ENGINE_INPUT_FIELDS` and
> `task-execution-engine.ts`'s `dispatchEngine()` switch directly (this
> doc's own advice, below) and found ~160-170 distinct engineKeys wired
> across ~22 categories today, not the "26 of 211" this page still states
> -- several waves (167+) wired Payroll/Inventory/HR/Accounting/Banking/etc.
> after this page was last regenerated and never came back to update it.
> Re-run this doc's own SQL query before trusting any specific number
> below; treat the category-by-category table as directionally outdated,
> not current state. See PROGRESS.md in the repo root (task
> `task-20260718-084003-calculation-engine--calculation-governan`) for the
> full re-verification trail.

**Purpose:** the honest, always-verifiable answer to "how much of what a user can click is guaranteed to run as real software, not an AI guess." Every number here is a live query against production, re-run each time coverage changes — not an estimate. Started 2026-07-10, per Boss directive: *"Options selected via Mode Pills and Chain Selector is very important for the completion of the work... the worker agent should just execute it like a software."*

## How dispatch actually works today (confirmed by reading the real code, not assumed)

When a Chain Selector leaf carries a real `codeReference` (a worker agent) or `engineKey` (a VCEL calculator), `task-service.ts`'s `createTask()` re-verifies it server-side against the real `worker_agents`/`computation_engines` tables (never trusts the client), and `task-execution-engine.ts`'s `executeTask()` skips the LLM planning step entirely — it calls the real function directly, records the real result, and posts it to the task's chat. **Zero AI calls, zero cost, zero interpretation risk**, for any leaf marked `deterministic: true` (see `capability-tree-service.ts`'s `markDeterministic()`, mirrored in the Chain Selector UI as a ⚡ marker — CRITICAL_GAPS #1 gap-closure, 2026-07-10). Any leaf without one of those two ids still degrades to the free-text AI-planning path, and now says so explicitly in the composer before the user sends.

Every dispatched result is also checked by `dispatch-output-validator.ts` before being shown — a `NaN`/`Infinity` anywhere in the output marks the step failed with a clear message instead of posting a broken number as fact.

## Worker Agents — 22 registered, 22 of 22 now have a real dispatcher (100%, up from 20/22)

| codeReference | Domain | Status |
|---|---|---|
| get_compliance_stats, get_overdue_items, list_departments, list_compliance_items, list_notices, get_task_status, update_compliance_status, create_compliance_item | Cross-Cutting | ✅ wired |
| confirm_gst_batch, run_gst_reconciliation, generate_gst_return, generate_gst_ai_review, list_gst_import_batches, list_gst_returns | Finance > GST Reconciliation | ✅ wired |
| get_construction_project_dashboard, list_delayed_activities, get_construction_budget_status, list_over_budget_projects, get_construction_kpi_status, generate_construction_progress_summary, detect_construction_budget_schedule_risk | Construction > Project Intelligence | ✅ wired |
| get_penalty_estimate | India Compliance > Penalty Calculation | ✅ wired (2026-07-10 — previously registered with zero implementation) |

`create_compliance_item` was also previously registered with zero implementation; both are now real, following the exact same "structured inputs, never LLM-guessed" discipline the rest of this file uses (a real department picked by click, real typed fields validated server-side).

## The real gap: 99 product modules, only 4 domains have any worker agent at all

| Domain | Active modules | Worker agents | Chain Selector leaves for these modules |
|---|---|---|---|
| compliance | 40 | 0 | Plain labels, no `codeReference` — falls back to free-text AI |
| erp | 20 | 0 | Same |
| hr | 9 | 0 | Same |
| project_management | 7 | 0 | Same |
| the_firm | 5 | 0 | Same |
| facilities_management | 5 | 0 | Same |
| communication | 3 | 0 | Same (VERI Chat/Minutes/To Do have their own dedicated UI instead) |
| crm | 2 | 0 | Same |
| reporting, platform, ticketing, automation, knowledge_base, ai_governance | 1 each | 0 | Same |
| **Cross-Cutting, Finance>GST, Construction, India Compliance>Penalty** | n/a | **22** | ✅ Deterministic |

**This is the largest remaining piece of work**, not a bug — building a real worker agent for even one of these domains means reading its real service functions, deciding the right dispatcher and Chain Selector shape, and testing it, the same care every agent above got. Not something to rubber-stamp-register in bulk.

## VCEL Computation Engines — 211 of 247 implemented, 26 now wired into Chain Selector dispatch (up from 15)

| Category | Implemented | Wired | % |
|---|---|---|---|
| **GST Engine** | 16 | **16** | **100%** (completed 2026-07-10 — `gst_return_validation_engine` was the last holdout) |
| **Mathematical Computation Engine** | 13 | **10** | **77%** (completed 2026-07-10; 3 deferred below) |
| Accounting Computation Engine | 20 | 0 | 0% |
| Payroll Engine | 18 | 0 | 0% |
| Inventory Engine | 15 | 0 | 0% |
| Income Tax Engine | 9 | 0 | 0% |
| Banking Engine | 9 | 0 | 0% |
| HR Engine | 9 | 0 | 0% |
| Fixed Asset Engine | 8 | 0 | 0% |
| Costing Engine | 8 | 0 | 0% |
| Data Quality Engine | 8 | 0 | 0% |
| Procurement Engine | 7 | 0 | 0% |
| Sales Engine | 7 | 0 | 0% |
| Security Engine | 7 | 0 | 0% |
| AI Support Engine | 7 | 0 | 0% |
| Audit Engine | 7 | 0 | 0% |
| TDS/TCS Engine | 7 | 0 | 0% |
| Logistics Engine | 6 | 0 | 0% |
| Marketing Engine | 6 | 0 | 0% |
| Analytics Engine | 6 | 0 | 0% |
| Project Management Engine | 6 | 0 | 0% |
| Compliance Engine | 6 | 0 | 0% (has `calculateComplianceInterest`, now the engine behind `get_penalty_estimate` above — reached via a worker agent, not a Calculator leaf) |
| CRM Engine | 5 | 0 | 0% |
| Document Processing Engine | 1 | 0 | 0% |
| Manufacturing Engine | 0 of 11 | — | Out of scope (2026-07-08 decision) |
| **Total** | **211** | **26** | **12.3%** (up from 7.1%) |

### The 3 Mathematical engines deliberately left unwired
`matrix_computation_engine` (multiplyMatrices/invertMatrix), `linear_algebra_engine` (determinant/solveLinearSystem), `optimization_engine` (linear programming) all take a real matrix or a structured LP model as input — the Chain Selector's input-fields UI only supports single values and comma-separated lists today, not a grid or JSON editor. Forcing these into the existing field types would produce a bad UX and real transcription-error risk (a mistyped matrix is worse than an honest "not available yet"). Needs a richer input UI as its own piece of work, not a bad-fit shortcut.

## Roadmap — what closes this gap next, in priority order

1. **Accounting Computation Engine (20 implemented)** — highest count, and `erp` already has 20 real modules with zero agents; closing both together is the natural next wave.
2. **Payroll Engine (18)** — `hr` domain currently has zero agents; payroll is the highest-stakes calculation category left unwired (real money, real compliance deadlines).
3. **Inventory Engine (15)** and **Income Tax Engine (9)** — next-largest, real product surfaces.
4. **New worker agents for the 10 zero-agent domains**, starting with `compliance` (40 modules — the platform's original core) and `the_firm`/`facilities_management` (both live product branches with real users today, wave 108/107).
5. **A richer structured-input UI** (grid/table entry, at minimum) to unlock the 3 deferred Mathematical engines plus the many Accounting/Inventory engines that will also need multi-row input (e.g. journal entry lines).

Each of these is genuinely multi-day-to-multi-week work at the same care level GST and Mathematical got here — deliberately not compressed into one pass, per the standing "an honest gap beats a wrong number in a financial calculation" principle this file itself exists to enforce.

## Re-verifying these numbers

```sql
-- Worker agents with a real codeReference, by domain
SELECT domain, count(*) FROM compliance.worker_agents WHERE tier='global' AND lifecycle_status IN ('approved','published') GROUP BY domain;

-- VCEL engines, implemented vs total, by category
SELECT category, count(*) FILTER (WHERE status='implemented') AS implemented, count(*) AS total FROM compliance.computation_engines GROUP BY category ORDER BY implemented DESC;
```
Cross-check the "wired" counts against `Object.keys(WIRED_ENGINE_INPUT_FIELDS)` in `src/lib/services/capability-tree-service.ts` and the `dispatchTool()`/`dispatchEngine()` switch statements in `src/lib/task-execution-engine.ts` — those two places are the actual source of truth this document summarizes, not the other way around.
