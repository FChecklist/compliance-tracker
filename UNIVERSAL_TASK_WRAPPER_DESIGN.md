# Universal Task Wrapper -- Design (not implemented)

**2026-07-11. Design-only, per Boss's own instruction: this is architecture-level and needs review before code.** Closes the remaining two of `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`'s eight confirmation items that Wave 159's guardrail-gap-closure pass deliberately left open: "every activity classified as a Task" and "every task mandatorily follows the Universal Task Lifecycle."

## The problem, concretely

Today, five genuinely different things happen in VERIDIAN and none of them share an identity:

| Activity | Where it lives today | Has a lifecycle? |
|---|---|---|
| A customer creates a compliance task | `tasks` table | 5 states (`pending→completed/failed/cancelled`) |
| A customer's task gets AI-planned/executed | `taskExecutionPlan` + `taskAgentExecutions`, FK'd to `tasks` | per-step `status`, no overarching stage concept |
| Any LLM call across any Orchestra Layer (chat, FDE, CRM scoring, GST review, ...) | `orchestraExecutions` | `pending`/`completed`/`denied`/`failed` -- closest thing to universal today, but framed as "one LLM call," not "one task" |
| An AI Dev Team dispatch (`/api/ai/team/dispatch`) | **nothing -- not persisted at all** | none |
| A background loop run (`src/lib/loops/*.ts`, `api/internal/loops/run`, Vercel cron) | loop-specific, no shared row | none |

Asking "show me every task in the system, in what stage, owned by whom" is not answerable today -- you'd have to query 4+ tables with incompatible shapes, and one activity type (AI Dev Team dispatch) leaves no record at all.

## Two options considered

### Option A -- promote `orchestraExecutions` into the universal Task

Add a `lifecycleStage` column to `orchestraExecutions`, treat every row as one Task instance, make the 2 currently-unpersisted activity types (AI Dev Team dispatch, loop runs) start writing rows there too.

- **Pro**: reuses proven, already-indexed, already-RLS'd infrastructure. Smallest migration.
- **Con**: `orchestraExecutions` is semantically "one LLM call," not "one task" -- a customer task that goes through planning + 3 worker-agent steps is *already* 1 `tasks` row + 1 `taskExecutionPlan` row + N `taskAgentExecutions` rows + potentially N `orchestraExecutions` rows (one per LLM call inside execution). Forcing "the Task" to mean "the LLM call" would either duplicate the task-level concept that already exists in `tasks`, or require `tasks` itself to be deprecated in favor of a lower-level table -- a much bigger, riskier migration than it looks at first.

### Option B (recommended) -- a thin `activity_log` envelope, existing tables stay the detail layer

A new table, additive, non-replacing:

```
activity_log
  id
  orgId, clientId, userId          -- same tenant columns every table already has
  activityType   enum: 'customer_task' | 'orchestra_call' | 'ai_team_dispatch' | 'loop_run'
  detailTable    text               -- 'tasks' | 'orchestra_executions' | null (ai_team_dispatch/loop_run have no detail row yet)
  detailId       text nullable      -- FK-by-convention (not a real FK -- detailTable varies), points at the rich row
  lifecycleStage enum (see below)
  objective      text nullable      -- populated for AI-dispatch activity types via task-tightening.ts's TightTask; null for legacy/unclassified activity
  createdAt, updatedAt
```

- **Pro**: every existing table keeps working exactly as-is -- this is purely additive, zero risk to `tasks`/`orchestraExecutions`/the AI Dev Team. "Show me every task in the system" becomes one query against `activity_log`. The 2 currently-unpersisted activity types (AI Dev Team dispatch, loop runs) get a real row for the first time, closing a genuine observability gap independent of the "universal Task" framing.
- **Con**: real, non-trivial write-path plumbing -- every one of the ~15+ real entry points (task creation, task execution engine, every `recordOrchestraExecution` call site, the AI Dev Team dispatch route, every loop) needs one additional insert. Two rows to keep in sync (`activity_log` + the detail table) instead of one, until/unless a later phase collapses them.

**Recommendation: Option B.** Option A's apparent simplicity is a trap -- it either quietly redefines what "task" means in a system that already has a working, real `tasks` concept, or it leaves `tasks` as a second, uncoordinated "Task-like" table forever, which is worse than today's honestly-separate tables.

## Lifecycle stage mapping

The source Constitution's 18 stages, collapsed to what's actually distinguishable in this codebase today -- inventing finer stages than the system can actually tell apart would be enforcement theater, not enforcement:

| Constitution stage(s) | `activity_log.lifecycleStage` | Real signal it maps to |
|---|---|---|
| Task Request | `requested` | row created |
| Classification, Risk Assessment | `classified` | `classifyTask()` (AI Team) / `detectHighImpactAction()` (customer tasks) result attached |
| Instruction Validation | `validated` | `task-tightening.ts` / `validateTaskBrief()` passed |
| Resource Allocation, Execution, Continuous Monitoring | `executing` | detail-table status = `in_progress`/`pending` with a real provider/model attached |
| Self Validation, Peer Validation, Escalation | `reviewing` | only reachable for activity types with a real review step (Guardrail Team levels, doer/auditor) -- most activity types skip straight to `completed` |
| Completion | `completed` / `failed` | detail-table terminal status |
| Documentation, Learning Capture, Process Improvement, Knowledge Update, Performance Scoring, Directory Update, Continuous Loop Engineering | *(not a stage -- see below)* | |
| Closed | `closed` | explicit, separate from `completed` -- see below |

**Deliberate simplification, stated honestly**: the source document's stages 12-18 (Documentation through Continuous Loop Engineering) are treated as *side effects of reaching `completed`*, not sequential stages every row must visibly pass through one at a time -- forcing 7 more literal status transitions per activity for stages this codebase can't yet independently verify (no automated "was this documented" check exists) would be exactly the "documentation theater" this whole framework exists to avoid, per `VERIDIAN_AI_CONSTITUTION.md`'s own stated discipline. `completed` triggers (where applicable) the existing CLEE feed (`proposeLoopImprovement`); `closed` is reserved for the explicit human/Owner sign-off some activity types will require before considering the loop truly shut (mirroring the Constitution's "No task closes until [an improvement] report exists" -- for AI-dispatch activity specifically, not universally, since most customer tasks have no improvement report to wait for).

## Phasing (each phase independently shippable and auditable, matching this repo's own wave discipline)

1. **Phase 1 -- schema + write path for NEW activity only.** Migration adds `activity_log` (RLS matching `orchestra_executions`'s existing tenant pattern exactly). No backfill of historical rows -- a backfill script is its own separate, lower-priority effort (historical data has real gaps, e.g. AI Dev Team dispatches before this phase have no source data to backfill from at all). Wire the write path into the 2 currently-unpersisted activity types first (AI Dev Team dispatch, loop runs) -- highest marginal value, zero risk of touching already-working code.
2. **Phase 2 -- wire the remaining, already-persisted activity types.** `tasks`/`taskExecutionPlan` and `orchestraExecutions`'s `recordOrchestraExecution()` both gain a paired `activity_log` insert. Read-only additions to existing, working functions -- no behavior change to what they already do.
3. **Phase 3 -- a real query surface.** `GET /api/internal/activity-log` (or similar), a dashboard view. This is where "show me every task in the system, in what stage" actually becomes answerable, and where the value of Phases 1-2 is realized rather than just latent.
4. **Phase 4 -- recursive-delegation/circular-dependency/deadlock detection** (Constitution Guardrail #20's remaining, currently-undetectable half). Only possible once `activity_log` rows can reference a parent activity (a `parentActivityId` column, deferred to this phase rather than added speculatively in Phase 1) -- the dependency graph this needs doesn't exist before Phase 1-2 ship.

**Not phased in, and why**: retroactively making `tasks` *itself* obsolete in favor of `activity_log` (i.e., migrating away from the existing table rather than wrapping it). No evidence this is needed -- `tasks` works, is RLS'd, is UI-wired, and Option B's whole premise is that wrapping is lower-risk than replacing.

## What this does and doesn't close, honestly

Shipping all 4 phases would make "every activity classified as a Task" **true** for the first time and would give the 18-stage lifecycle a real (if collapsed) enforcement surface instead of documentation describing an aspiration. It would **not**, on its own, close Guardrail #9 (numeric confidence thresholds) or the Three-Hour Governance Cycle (still cron-based automation with a real reviewer behind it, a separate, unrelated gap) -- those remain in `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`'s "Deliberately Deferred" list regardless of this design shipping.

## Recommendation

Approve Option B, Phase 1 only, as the next concrete wave -- smallest real slice, zero risk to existing tables, closes the most acute gap (AI Dev Team dispatches currently leave no record at all). Phases 2-4 should each get their own go/no-go rather than being pre-approved as a bundle, consistent with how Phases 1-4 of the earlier VERIDIAN.docx joint implementation plan were sequenced and individually signed off.
