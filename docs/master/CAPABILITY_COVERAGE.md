# VERIDIAN — Capability Coverage (Mode Pills + Chain Selector deterministic dispatch)

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

## VCEL Computation Engines — 211 of 247 implemented, 127 now wired into Chain Selector dispatch (up from 26)

**Correction, 2026-07-18 (VERIDIAN Review Framework gap-closure, Calculation Engine / Formula Library & Customization):** the 12.3%/26-engine figure below was accurate when this file was started (2026-07-10) but had gone stale — waves 165-170 (PRs #164/#165 and follow-ons) wired 12 more engine categories end to end in the interim without this file being updated to match. Re-derived directly from source, not estimated: `Object.keys(WIRED_ENGINE_INPUT_FIELDS)` in `capability-tree-service.ts` (127 keys, verified by direct count) cross-checked against the `dispatchEngine()` switch in `task-execution-engine.ts`. One genuine small oversight found and fixed in the same pass: `loan_schedule_generator`/`amortization_engine` (2 registered engine_key rows computing the exact same thing as `emi_calculator`) were dispatch-ready since Wave 168 but had never been given a Chain Selector leaf — every other gap below is a deliberate, individually-documented deferral (array/grid input, or already-real-elsewhere), not an oversight; this was the one exception.

| Category | Implemented | Wired | % |
|---|---|---|---|
| **GST Engine** | 16 | **16** | **100%** (`gst_return_validation_engine` was the last holdout, closed 2026-07-10) |
| Income Tax Engine | 9 | **9** | **100%** |
| Fixed Asset Engine | 8 | **8** | **100%** |
| Data Quality Engine | 8 | **7** | **88%** (`data_duplicate_detection_engine` has no standalone pure function anywhere in the codebase — deferred) |
| Logistics Engine | 6 | **5** | **83%** |
| CRM Engine | 5 | **4** | **80%** |
| **Mathematical Computation Engine** | 13 | **10** | **77%** (3 deferred, see below) |
| Costing Engine | 8 | **6** | **75%** (2 array-input engines dispatch-only, no grid UI yet) |
| TDS/TCS Engine | 7 | **5** | **71%** (`tds_calculator` needs a DB-adapter, not a pure function; `pan_validation_engine` also reused under Data Quality) |
| Payroll Engine | 18 | **12** | **67%** (`pf_calculator`/`esi_calculator`/`professional_tax_calculator`/`salary_calculator` need a DB rule-lookup adapter, deferred) |
| HR Engine | 9 | **6** | **67%** |
| Banking Engine | 9 | **6** | **67%** (fixed this pass — see correction note above; `cash_flow_projection`/`outstanding_cheque_engine` are array-input, `bank_reconciliation_engine` is a real ERP service, both still deferred) |
| Procurement Engine | 7 | **4** | **57%** |
| Sales Engine | 7 | **4** | **57%** |
| Marketing Engine | 6 | **3** | **50%** |
| Project Management Engine | 6 | **3** | **50%** |
| Compliance Engine | 6 | **2** | **33%** (`due_date_calculator`/`compliance_calendar_engine` already implemented as core product features, not standalone) |
| Analytics Engine | 6 | **2** | **33%** |
| Security Engine | 7 | **2** | **29%** (encryption/decryption map narrowly to BYOK key storage, not a general engine; no standalone MFA/session validator exists to wire) |
| Audit Engine | 7 | **2** | **29%** |
| Accounting Computation Engine | 20 | **5** | **25%** (9 of the remaining 15 are already real, DB-backed ERP product functions in `erp-accounting-service.ts` — deliberately not re-dispatched as a second surface; the other 6 take array-of-objects input, no grid UI yet) |
| Inventory Engine | 15 | **6** | **40%** |
| AI Support Engine | 7 | **0** | **0%** (2 of 7 are dispatch-ready but array-input only — `tool_selector_engine`/`context_deduplicator_engine`; the other 5 are real infrastructure embedded in `prompt-os-resolver.ts`/`embeddings.ts`, not standalone) |
| Document Processing Engine | 1 | **0** | **0%** (dispatch-ready `duplicate_document_detection_engine` takes an array of documents — no grid UI yet) |
| Manufacturing Engine | 0 of 11 | — | Out of scope (2026-07-08 decision, unchanged) |
| **Total** | **211** | **127** | **60.2%** (up from 12.3%) |

### The 3 Mathematical engines deliberately left unwired
`matrix_computation_engine` (multiplyMatrices/invertMatrix), `linear_algebra_engine` (determinant/solveLinearSystem), `optimization_engine` (linear programming) all take a real matrix or a structured LP model as input — the Chain Selector's input-fields UI only supports single values and comma-separated lists today, not a grid or JSON editor. Forcing these into the existing field types would produce a bad UX and real transcription-error risk (a mistyped matrix is worse than an honest "not available yet"). Needs a richer input UI as its own piece of work, not a bad-fit shortcut.

## Roadmap — what closes this gap next, in priority order

The original roadmap here (wire Accounting, then Payroll, then Inventory/Income Tax) is **done** — Income Tax reached 100%, Payroll 67%, Accounting 25%, Inventory 40%, all across waves 165-170, well before this correction pass found the doc describing them as 0%. What's left, re-derived from the table above rather than assumed:

1. **A richer structured-input UI** (grid/table entry, at minimum a JSON-editor fallback) is now the single blocker behind nearly every remaining unwired engine: the 3 Mathematical engines, 6 of Accounting's remaining 15, 2 of Costing's, 2 of Banking's, both AI Support and the one Document Processing engine, plus several others across Data Quality/TDS. This is one piece of work, not per-category busywork — building it once unlocks roughly a dozen categories at once.
2. **New worker agents for the zero-agent product domains** (compliance, erp, hr, project_management, etc. — see the Worker Agents section above) remains separately tracked and untouched by this pass; it addresses a different finding (browsable non-calculation actions), not the Formula Library gap this section covers.
3. **Custom Formula Builder** (org-defined formula authored via a UI, not code) does not exist and, per the VERIDIAN Review Framework's own recommended approach for that finding, is intentionally lower priority than the Chain Selector wiring above — revisit only once a concrete customer need surfaces via FDE requests, not spec-built ahead of demand.

Each of these is genuinely multi-day-to-multi-week work at the same care level GST and Mathematical got here — deliberately not compressed into one pass, per the standing "an honest gap beats a wrong number in a financial calculation" principle this file itself exists to enforce.

## Re-verifying these numbers

```sql
-- Worker agents with a real codeReference, by domain
SELECT domain, count(*) FROM compliance.worker_agents WHERE tier='global' AND lifecycle_status IN ('approved','published') GROUP BY domain;

-- VCEL engines, implemented vs total, by category
SELECT category, count(*) FILTER (WHERE status='implemented') AS implemented, count(*) AS total FROM compliance.computation_engines GROUP BY category ORDER BY implemented DESC;
```
Cross-check the "wired" counts against `Object.keys(WIRED_ENGINE_INPUT_FIELDS)` in `src/lib/services/capability-tree-service.ts` and the `dispatchTool()`/`dispatchEngine()` switch statements in `src/lib/task-execution-engine.ts` — those two places are the actual source of truth this document summarizes, not the other way around.
