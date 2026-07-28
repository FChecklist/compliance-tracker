# V2-12 — Serverless Resource-Limit Tradeoff Doc + Heavy-Workload Audit

**Task ID:** V2-12-SERVERLESS-LIMITS · **Closes:** CSV row #13 ("Vertical Scalability", C3 bucket, `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`)
**Status:** Doc + audit complete, docs-only, no code changed. One follow-up recommendation filed (see §5), not built here per this task's own constraint.
**Redispatch note:** this task was originally created ~2026-07-20 and blocked pre-flight by a spend-governance gate before any work started. A 2026-07-26 relevance-triage pass (`ai-os/TIER3_RELEVANCE_TRIAGE_REPORT_2026-07-26.md`) independently re-confirmed the gap was still real (no doc existed, `GAP_ANALYSIS_2026-07-20_HOLD.md` still listed it Low/open, no `maxDuration` config anywhere). Re-verified again live in this session (2026-07-26) before writing anything below — still accurate.

## 1. The tradeoff, stated explicitly

This app deploys as Next.js on Vercel — every API route is a Vercel Function (Node.js
serverless runtime), not a long-running process. That buys zero idle cost, zero
infrastructure ops, and automatic scaling, which is why `ai-os/MASTER-TRACKER.yaml`'s own
tech-stack review (2026-07-14) explicitly rejected adding a second parallel
worker/broker stack (Celery+FastAPI) as over-engineering for this team's current scale.
The tradeoff for that simplicity is a hard resource ceiling on *every single request*,
enforced by the platform, not configurable away by better code alone past a point.

**This repo is on the Vercel Hobby plan**, confirmed by an existing note in
`ai-os/MASTER-TRACKER.yaml:1891` ("this repo already hit the Vercel Hobby plan's
once-per-day cron limit"). Current Vercel Functions limits (fetched live from
`vercel.com/docs/functions/limitations`, last-updated snapshot 2026-07-01), Hobby column:

| Limit | Hobby (this repo, today) | Pro/Enterprise (if upgraded) |
|---|---|---|
| Max execution duration | **300s, fixed — no override possible** | 300s default, 800s configurable max, 1800s extended-max (beta) |
| Memory | 2 GB / 1 vCPU, fixed | 2 GB default, configurable up to 4 GB / 2 vCPU |
| Request/response body size | **4.5 MB, hard cap, same on every plan** | 4.5 MB (does not change with plan) |
| Deployment bundle size | 250 MB uncompressed (500 MB Python; 5 GB via opt-in "large functions") | same |
| Concurrency | auto-scales to 30,000 | auto-scales to 30,000 (100,000+ on Enterprise) |
| Cron cadence | once per day per cron (already hit, see above) | more flexible schedules |

The load-bearing fact for this audit: **on the current plan, `maxDuration` cannot buy any
extra time** — 300s is both the default and the hard ceiling. A route that occasionally
needs more than 5 minutes has exactly two real options: (a) make it provably fit inside
5 minutes (fix the algorithm/batch it), or (b) move it off the request/response cycle
entirely (background job / queue), which is genuinely a separate, larger piece of work.
There is no `vercel.json` `functions` block or per-route `export const maxDuration` /
`export const runtime` override anywhere in this codebase today (verified: grepped all of
`src/app/api` — the only two hits are `app/api/health/route.ts` and `app/api/mcp/route.ts`,
both `export const runtime = 'edge'`, unrelated to the workloads below). Every route in
this app runs on the platform default today.

## 2. Audit method

Read (not grep-matched) the actual route handler + its underlying service function for
every route in the three categories the original task's READ FIRST section named —
payroll runs, report generation, bulk ops — then widened the sweep to every route with a
`for` loop wrapping an `await` DB call anywhere under `src/app/api`/`src/lib/services`,
plus every file-upload route, since a payload-size limit is as real a "serverless
resource-limit" as a duration limit. For each: does it iterate per-record with an
*awaited DB call inside the loop* (N+1 — the pattern that turns "more rows" into "more
sequential round trips," the real way a route silently walks into the duration wall), or
does it push the aggregation into one SQL statement (the pattern that doesn't)? Severity
is about the *shape* of the code, not a load-tested number — no load test was run as part
of this task (out of scope; see `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`
C7/C8 → V2-16/V2-17 for the separate load-test-harness work already tracked elsewhere).
Every finding below was read directly (file + line) and independently re-verified in this
session, not taken on trust from a single pass.

## 3. Audit table

| Route / service function | What it does | Loop shape | Realistic scale | Severity |
|---|---|---|---|---|
| `POST /api/compliance/import` (route.ts, no service layer) | CSV bulk import of compliance items | **N+1, unbounded on both axes.** `await file.text()` reads the whole upload into memory with **no file-size cap at all** (every other upload route in this app sets a `MAX_FILE_SIZE` constant; this one has none), then `for (let i = 1; i < lines.length; i++)` does ~2–4 sequential `await`s per CSV row (a `LIKE` department lookup, a fallback department lookup, one `complianceItems` insert, one `logActivity` insert) | No row-count cap, no chunking — a large compliance-item CSV (plausibly thousands of rows for a firm onboarding its full compliance calendar) is exactly the intended use case | **HIGH — the single worst finding in this audit**: unbounded input size *and* unbounded per-row round trips together |
| `POST /api/gst-reconciliation/import/[batchId]/confirm` → `gst-reconciliation-service.ts`'s `confirmBatchCore` | Confirms a staged GST-invoice import batch | **N+1.** `for (const row of validRows)` with ~3–4 sequential `await`s per invoice row (canonical-invoice insert, optional line-items insert, optional GSTIN-checksum-cache lookup+insert) — the validation-engine step *after* the loop is correctly done in bulk (one `findMany` + one bulk insert), only the confirm loop itself isn't | GST reconciliation batches are monthly invoice sets per client — plausibly hundreds to low-thousands of rows per batch | **HIGH** |
| `POST /api/reports/definitions/[id]/run` (generic engine) — the `cost-overrun-report` formula → `report-engine-service.ts`'s `computeCostOverrunReport` | Cost-overrun report across every active project | **N+1 of an already-heavy call.** `for (const p of activeProjects) { const bva = await budgetVsActual(ctx, p.id) }` — `budgetVsActual` → `getProjectDashboard()` alone issues **~7 sequential queries per project** (project lookup, budget/revenue/expense sums, activity-ids fetch, a raw `db.execute` for latest progress, task-stats, photo-count) | This codebase's own comments describe the target scale as **~500 projects for a construction/interior-design firm** — that's ~8 sequential round trips × 500 = **~4,000 sequential DB calls in one request** at the platform's own documented target scale, not a hypothetical edge case | **HIGH** |
| `POST /api/erp/payroll/runs/[id]/process` (+ `v1/projexa` equivalent) → `erp-payroll-service.ts`'s `processPayrollRun` | Generates every payslip for a payroll run | **N+1.** `for (const structure of latestByEmployee.values())` with ~6–7 sequential `await`s per employee (3× `findActiveRule` for PF/ESI/professional-tax — re-queried per employee even though the org+date-scoped rule doesn't change across employees in the same run, 1× `employeeProfile` lookup, 1× `computeAnnualTds` which itself issues up to 3 more queries, 2× inserts) — no `Promise.all`, no chunking | Tens–low-hundreds of employees per org today; genuinely at risk as any org's headcount grows into the high hundreds/low thousands | **HIGH** |
| `POST /api/hr/attendance/bulk` → `hr-attendance-service.ts`'s `bulkMarkAttendance` | Bulk-marks one attendance status across many employees for one date | **N+1.** `for (const userId of input.userIds)` — `markAttendance` does ~3–4 sequential `await`s per user (user lookup, optional holiday lookup, existing-record lookup, upsert) | Bounded by caller-supplied `userIds` (typically one department/off-site day — tens to low-hundreds), no hard cap enforced on array length; same shape as payroll, smaller realistic blast radius | **HIGH** |
| `GET /api/internal/routing-accuracy-report/run` (weekly cron) | Weekly AI-routing-accuracy report | Not a loop — a single **unbounded `SELECT`** (no `LIMIT`) of every completed chat-reply execution platform-wide over 7 days, pulled fully into memory, then one linear (not quadratic) in-memory scan | Scales with total platform LLM chat volume across every org, not one tenant — grows independent of any single customer's size | MEDIUM |
| `GET /api/internal/report-schedules/run` (daily cron) → `report-schedule-service.ts`'s `runDueReportSchedules` | Delivers due scheduled reports, platform-wide | Outer `for` over **every** active `report_schedules` row platform-wide (cheaply skipped via `isScheduleDue()`/`matchesTimeOfDay()` before real work), nested `for` per recipient doing one `notifications` insert each — no batch insert | Currently low-volume (newer feature), but the code has no cap on schedule count × recipients and no batching — same N+1 shape as payroll/attendance, just smaller today | MEDIUM (HIGH-shaped — will need the same fix as the others if this feature grows) |
| `POST /api/erp/bank-reconciliation/import` → `erp-bank-reconciliation-service.ts`'s `importBankStatement` | Bank-statement CSV import | **No N+1** — one batch `db.insert(...).values(validRows.map(...))` for all parsed rows. Capped at `MAX_FILE_SIZE = 10 MB` | A 10 MB bank statement can still be tens of thousands of transaction rows in one single large `INSERT`/response | MEDIUM (payload/single-query size, not iteration count) |
| `POST /api/reports/ai-builder/analyze` → `ai-report-builder-service.ts`'s `proposeReportFromUpload` | AI-assisted report proposal from an uploaded file | No DB loop — makes a **synchronous LLM call** (vision or text) inside the request before responding; capped at app-level `MAX_FILE_SIZE = 10 MB` | LLM vision/document calls routinely take 10–30+ seconds; this stacks on the same fixed duration ceiling as every other route, with no override configured | MEDIUM–HIGH (duration risk from LLM latency, not row count) |
| `POST /api/reports/ai-builder/analyze`, `POST /api/erp/bank-reconciliation/import`, `POST /api/gst-reconciliation/import`, `POST /api/ingest` | File-upload routes (as a group) | **Payload-size mismatch**, distinct from the duration risk above: each independently declares its own app-level `MAX_FILE_SIZE = 10 * 1024 * 1024` (10 MB) — but Vercel's platform-enforced request-body ceiling is 4.5 MB **on every plan**, not just Hobby | A file between 4.5 MB and 10 MB never reaches any of these routes' own size check — it's rejected by the platform first with a generic `413 FUNCTION_PAYLOAD_TOO_LARGE`, not the route's friendlier `"File too large (max 10 MB)"` message | MEDIUM (real, but a mismatched constant/UX gap, not a hang risk) |
| `GET /api/internal/ai-performance-report`, `risk-trends-report`, `escalations-report`, `recommendations-report` (crons) | Platform-wide analytics reports | Single `SELECT`/`Promise.all` of a few queries + in-memory O(n) aggregation — no per-row DB call | Grows with total platform activity, not one tenant, but no N+1 | LOW–MEDIUM |
| `POST /api/v1/projexa/leads/bulk-reassign`, `.../opportunities/bulk-reassign` → `crm-service.ts` | Bulk owner reassignment | **Single SQL** `UPDATE ... WHERE id IN (...)` — no loop | Unbounded input array size, but one round trip regardless | LOW |
| `POST /api/v1/projexa/sales-orders/bulk-status` → `erp-selling-service.ts`'s `bulkUpdateSalesOrderStatus` | Bulk sales-order status transition | **Single query + single bulk `UPDATE`** — filters eligible/skipped/missing in memory after one `findMany`, no per-row DB call | Same as above | LOW |
| `GET /api/erp/reports/profit-and-loss`, `/balance-sheet`, `/trial-balance`, `/cash-flow` → `erp-financial-report-service.ts`'s `accountBalancesInRange` | Financial statements over a date range | **Single grouped SQL aggregation** (`SELECT ... SUM(...) GROUP BY account`) — no per-transaction loop regardless of journal-line volume | Whole org's journal history, pushed to Postgres, not Node | LOW |
| `POST /api/reports/definitions/[id]/run`, other formulas (not `cost-overrun-report`); `POST /api/reports/saved/[id]/run` | Most of the ~35-function generic report/custom-report engines | Single/few aggregate SQL queries, several via `Promise.all` — the correct pattern | DB-bound, not row-iteration-bound | LOW |
| `GET /api/construction/reports/[reportName]`, `GET /api/v1/projexa/reports/[reportName]` | Registry-dispatched per-project/per-run reports | Explicit whitelist dispatcher, each scoped to one `projectId` per call — the *same* `getProjectDashboard`/`budgetVsActual` code the cost-overrun report loops over above, but here invoked once per request, not fanned out | Single project's data per call | LOW (per-call — this is the function that becomes HIGH when `computeCostOverrunReport` loops it) |
| `GET /api/v1/projexa/payroll/payslips/[id]/pdf` | Single payslip PDF via `jsPDF` | One record rendered, one PDF | Single payslip | LOW |
| `POST /api/workspace-memory/export`, `/import` | Workspace-memory backup/restore | Loops exist but are explicitly capped (`MAX_CONVERSATIONS = 20`, `MAX_MESSAGES_PER_CONVERSATION = 200`), per-item work is local file writes, not extra DB calls | Bounded by the constants above — a genuinely well-designed contrast case to the uncapped routes above | LOW |

## 4. Findings summary

- **No route in this codebase sets `maxDuration` or a `functions` block override.** Every
  route runs on the platform default (300s, fixed on the current Hobby plan). This was a
  real, previously-undocumented gap — this doc is the first artifact recording that fact
  explicitly, closing CSV row #13's "document the tradeoff" half.
- **Five HIGH-severity N+1 routes were found**, not one — the initial READ FIRST sweep
  (payroll/reports/bulk-ops) surfaced `processPayrollRun` and `bulkMarkAttendance`; widening
  the sweep to every `for`-loop-wrapping-an-`await` pattern in `src/app/api`/`src/lib/services`
  surfaced three more, at least two of which (`compliance/import`'s CSV importer and the
  `cost-overrun-report` formula's per-project fan-out) are more severe than either payroll
  or attendance:
  - `POST /api/compliance/import` has **no file-size cap of any kind** (every sibling
    upload route sets one) *and* an unbounded per-row N+1 — the two failure modes compound
    rather than being independent, and CSV bulk-import of a firm's full compliance
    calendar is exactly the use case this route exists for, not an edge case.
  - `computeCostOverrunReport` (reachable via the generic report-definitions engine) loops
    `budgetVsActual` — itself ~7 sequential queries — once per active project, and this
    codebase's own comments describe the target scale as ~500 projects for a construction
    firm. That's ~4,000 sequential DB calls in one request *at the platform's documented
    target scale*, not a hypothetical.
  - `gst-reconciliation/import/[batchId]/confirm` does the same per-row N+1 shape against
    monthly GST invoice batches that plausibly run into the low thousands of rows.
- **The correct pattern is well-represented elsewhere**: every bulk-reassign/bulk-status
  route (leads, opportunities, sales-orders) and every financial-statement report (P&L,
  balance sheet, trial balance, cash flow) pushes the bulk work into a single SQL statement
  (`UPDATE ... WHERE id IN (...)`, `SELECT ... GROUP BY`) instead of looping with awaited
  calls — these are LOW risk regardless of row count and are the template the HIGH-severity
  routes above should be refactored toward, not a new pattern that needs inventing.
- **A genuine payload-size mismatch was found** (a resource-limit finding in its own right,
  distinct from duration): four upload routes each declare an app-level 10 MB cap when
  Vercel's actual platform ceiling is 4.5 MB on every plan tier, meaning files in the
  4.5–10 MB range never reach the app's own friendlier error.
- **Two cron routes (`routing-accuracy-report`, `report-schedules`) do unbounded
  platform-wide work** with no per-org scoping and no batching — currently low-risk at this
  platform's real activity volume, but architecturally the same shape that turns into a
  real problem as total platform activity (not any one tenant) grows.

## 5. Recommendation / follow-up (not built here, per this task's own constraint)

This task's own WHAT TO BUILD gates a queue-migration follow-up on a workload "genuinely"
exceeding the platform's limits. Being honest about what this audit actually found: no
route has been *observed* timing out in production (no load test was run, per §2), but
`compliance/import` and `computeCostOverrunReport` are the two where the code's own shape
— unbounded input × unbounded per-row round trips, at a scale this platform's own
documentation names as the real target — makes hitting the wall a matter of when a
customer's data grows large enough, not if. That's different from the original 2026-07-20
framing (this doc originally expected to find at most one borderline case); the honest
conclusion given what was actually found is:

1. **File a Tier1, no-schema/no-auth batching fix for all five HIGH-severity routes**
   (`processPayrollRun`, `bulkMarkAttendance`, `compliance/import`, `computeCostOverrunReport`,
   `gst-reconciliation` confirm) as the first, cheap escalation — in every case the fix is
   mechanical (hoist run-scoped lookups out of the per-item loop, `Promise.all` the
   genuinely-independent per-item work, batch-insert instead of insert-per-row) and does not
   require a queue. This is very likely sufficient for `processPayrollRun`,
   `bulkMarkAttendance`, and the GST confirm loop at realistic near-term scale.
2. **`compliance/import` additionally needs an explicit `MAX_FILE_SIZE`/row-count cap
   regardless of the batching fix** — it is the one route with no size ceiling of any kind
   today, and that half of the fix is a one-line addition, not a refactor.
3. **`computeCostOverrunReport` is the one workload worth flagging as a real
   queue/background-job candidate if the batching fix alone doesn't bring it comfortably
   under the duration ceiling** — 500 projects × even a batched 2-3 round trips is still
   1,000-1,500 sequential calls, plausibly still tight against a fixed 300s ceiling with no
   override available on this plan. Recommend: ship the batching fix first, and only escalate
   to a dedicated worker/queue (a genuinely separate, larger, Tier2-adjacent task — new infra
   dependency) if that's insufficient. Do not build the queue speculatively before that
   evidence exists.
4. **Upload `MAX_FILE_SIZE` correction (Tier1, additive-only):** lower the four existing
   upload routes' advertised limit to match Vercel's real 4.5 MB platform ceiling (accounting
   for multipart-encoding overhead, the safe advertised cap is a bit under 4.5 MB).
5. **Cron routes (`routing-accuracy-report`, `report-schedules`):** worth a `LIMIT`/batching
   pass whenever next touched, not urgent today given current platform activity volume.

None of the above is built in this PR — this task's own CONSTRAINTS scope it to docs +
audit; the batching fixes are ordinary Tier1 follow-up work (no schema/auth/RLS/payment/env
changes), and only item 3's queue escalation is conditionally Tier2-adjacent, and only if
the cheap fix first proves insufficient.

## 6. Row re-scoring

CSV row #13 ("Vertical Scalability") / `ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`'s
C3/V2-12 entry: **RE-SCORED CLOSED** — tradeoff documented against real, live-fetched Vercel
limits; heaviest workloads (payroll, reports, bulk ops) audited plus a widened sweep that
surfaced three additional HIGH-severity N+1 routes and a real upload payload-size mismatch.
Five HIGH-severity routes identified with a shared, cheap batching fix recommended as the
first escalation; one of those (`computeCostOverrunReport`) flagged as a real
queue-candidate *if* the batching fix proves insufficient, everything else LOW/MEDIUM. See
this doc.
