// PROJEXA-BUILD-001 U-40 (register rows BR-515, BR-517; PMD-05, PMD-33, PMD-35, PMD-39): the scheduler bridge. A schedule
// (compliance.pipeline_schedules, drizzle/0642) names one registry function, its parameters, a cron cadence and an OWNER, a
// compliance.users id. This file runs the due ones, always as that owner and never as an API key.
//
// THE CHAIN. pg_cron (job projexa-scheduler-bridge, every 5 minutes, created inactive) -> pg_net -> the Edge Function
// projexa-scheduler-bridge (supabase/functions/projexa-scheduler-bridge) -> POST /api/internal/scheduler-bridge/run ->
// runDueSchedules() below. Vercel runs only the last hop, so it is the last thing switched on at go-live (PMD-39).
//
// WHAT ONE RUN DOES, for each due schedule (a bounded batch, oldest first, one after another):
//   1. CLAIM. One UPDATE moves next_run_at on to the next slot of the cadence and stamps last_run_at, but only where the row is
//      still active and still due. Two overlapping runs read the same due row; the database lets exactly one UPDATE match it, so
//      one schedule never runs twice. A claimed schedule whose run fails is already moved on, so it does not run again at the
//      next five-minute tick. A cadence that cannot be read deactivates the schedule instead of running it.
//   2. OWNER. The owner row is read from compliance.users NOW: its role is the role the run uses, and an owner who is missing,
//      deactivated or now in another organisation is not an active user of the schedule's organisation (PMD-33): the schedule
//      is skipped and deactivated, and its audit row says why.
//   3. RUN, by what the function does:
//        a WRITE function (executor.ts functionWrites) is never run. The run stores one PROPOSAL, the same row shape the approval
//        list reads (U-29, prepared-proposals.ts): a compliance.submissions row, status in_progress, selected_chain
//        { source: "scheduler_bridge", functionId, params, note, scheduleId }, the owner as user_id. A person approves it on the
//        approval list; nothing is written until then (PMD-05). The proposal and its audit row are one transaction.
//        ONE WAITING PROPOSAL PER SCHEDULE. When the schedule already has a proposal that is still in_progress (no person has
//        acted on it), the run stores no second one: it is recorded as already_pending, with the waiting proposal's id, and
//        the schedule stays active and moves on to its next slot. A frequent cadence therefore cannot pile copies of one
//        proposal onto the approval list. The check and the insert are one transaction. While a proposal waits, the schedule
//        proposes nothing new; once it is approved, rejected or otherwise leaves in_progress, the next due tick proposes again.
//        a READ function runs through the executor registry (executeTask) as the owner: userId and actorUserId are the owner, role
//        is the owner's role (the construction money figures are redacted against it), and the call carries no API key. Reads
//        run unattended (PMD-05). Only a summary of the result is kept (its shape and size), never the body: last_result is
//        readable by the whole organisation and a manager-owned read can hold figures other roles may not see.
//        NO MODEL IS EVER ASKED. The schedule already names its function, so no words are resolved. proposeSubmission() and
//        runSubmission() resolve words to a function and may reach Level 1; a job that fires every five minutes must not (PMD-40).
//   4. AUDIT. One compliance.audit_logs row per claimed run: user_id is the owner, api_key_id is null, surface is
//      s1_one_page_ai_prepared, details is JSON with trigger "scheduler_bridge" (BR-517 reads exactly that).
//      This holds for a run that throws too: when the proposal transaction fails, its own audit row is rolled back with it, so the
//      failure is audited afterwards in a transaction of its own (outcome failed, failureCode INTERNAL_ERROR).
//      The one exception is a run whose owner row no longer exists (or could not be read): there is no person to name, so that
//      row has user_id null and the actor is the bridge itself (role "system").
//   5. RECORD. last_result gets the run's outcome and code; a departed owner also sets is_active false.
//
// SURFACE. s1_one_page_ai_prepared is the surface a system-prepared proposal is recorded under: the AI prepared it, and the person
// reads it and presses Approve on the approval list, which is surface 1 of ai-os/projexa-build-001/FOUR_SURFACE_CONTRACT.md. No
// other surface fits: s2 is a screen the person fills, s3 is the person's own AI calling in, s4 is inbound mail.
//
// DEPENDENCY ON U-29 (feat/build-001-u29-approvals, not on main when this was written): the approval list shows a stored proposal
// only when readPreparedChain() accepts its source. Add "scheduler_bridge" to PREPARED_SOURCES in prepared-proposals.ts; until
// then a scheduler proposal is stored and audited but not listed. The list also approves only the functions in
// S1_APPROVABLE_FUNCTION_IDS (create_boq today), so a proposal for another write function waits for that list to widen.
//
// CROSS-ORGANISATION ACCESS. The due read and the claim go through the plain db client (the table owner, which bypasses RLS, as
// every cross-organisation cron route does); the owner lookup does too. Everything a run writes for an organisation (the proposal,
// the audit row) goes through withTenantContext for that schedule's organisation.
import { and, asc, eq, lte, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { auditLogs, pipelineSchedules, submissions, users } from "@/lib/db/schema"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logActivity, type AuditSurface } from "@/lib/audit"
import { classifySubmission } from "./classify"
import { missingParamsFor } from "./dry-run"
import { executeTask, functionWrites, hasExecutor } from "./executor"
import { functionLabel, functionSpec } from "./function-registry"
import { nextCronRun } from "./cron-next"

/** details.trigger of every audit row a run writes, and the source of every proposal it stores. */
export const SCHEDULER_BRIDGE_TRIGGER = "scheduler_bridge" as const
export const SCHEDULER_BRIDGE_SOURCE = "scheduler_bridge" as const
/** The audit surface of a system-prepared proposal (see SURFACE above). */
export const SCHEDULER_BRIDGE_SURFACE = "s1_one_page_ai_prepared" as const satisfies AuditSurface
export const SCHEDULER_BRIDGE_RUN_ACTION = "pipeline_schedule.run"
export const SCHEDULER_BRIDGE_SKIP_ACTION = "pipeline_schedule.deactivated"
export const SCHEDULER_BRIDGE_ENTITY_TYPE = "pipeline_schedule"
/** The actor of the one audit row that has no person: the owner row was gone at run time (see auditRun). */
export const SCHEDULER_BRIDGE_SYSTEM_ACTOR = { name: "Scheduler bridge", role: "system" } as const

/** The most schedules one run claims. The rest stay due for the next tick. */
export const DEFAULT_BATCH_SIZE = 10
export const MAX_BATCH_SIZE = 50
/** A run starts no new schedule after this long; what is left stays due. Well inside the Edge Function's wait for the app. */
export const DEFAULT_TIME_BUDGET_MS = 45_000
/** The most characters of the note that travels with a proposal (the same limit the approval list applies). */
const NOTE_MAX_LENGTH = 500

type ScheduleRow = typeof pipelineSchedules.$inferSelect
type OwnerRow = typeof users.$inferSelect

export type BridgeOutcome =
  | "proposed"
  | "already_pending"
  | "read_ok"
  | "failed"
  | "owner_not_active"
  | "invalid_cadence"
  | "claimed_elsewhere"

export type BridgeSummary = {
  ranAt: string
  /** due schedules read this run (at most the batch size) */
  checked: number
  /** schedules this run claimed */
  claimed: number
  proposed: number
  /** write schedules that stored nothing because their earlier proposal is still waiting for a person */
  alreadyPending: number
  readsRun: number
  failed: number
  /** owner not an active user of the organisation, or a cadence that cannot be read: deactivated, not run */
  skipped: number
  /** due schedules left for the next tick because the batch or the time budget ended first */
  deferred: number
  results: Array<{ scheduleId: string; outcome: BridgeOutcome }>
}

export type RunDueInput = {
  now?: Date
  batchSize?: number
  timeBudgetMs?: number
}

type RunOutcome = Exclude<BridgeOutcome, "claimed_elsewhere">
type RunReport = { outcome: RunOutcome; detail: Record<string, unknown>; deactivate?: boolean }

/** Which BridgeSummary counter a claimed run's outcome adds to. */
const SUMMARY_COUNTER: Record<RunOutcome, "proposed" | "alreadyPending" | "readsRun" | "failed" | "skipped"> = {
  proposed: "proposed",
  already_pending: "alreadyPending",
  read_ok: "readsRun",
  failed: "failed",
  owner_not_active: "skipped",
  invalid_cadence: "skipped",
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function summariseResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return { kind: "empty" }
  if (Array.isArray(result)) return { kind: "list", count: result.length }
  if (isPlainObject(result)) return { kind: "object", keys: Object.keys(result).length }
  return { kind: typeof result }
}

/** Why the owner cannot act for this schedule's organisation, or null when they can (PMD-33). */
export function ownerProblem(owner: OwnerRow | undefined, orgId: string): "owner_missing" | "owner_inactive" | "owner_other_org" | null {
  if (!owner) return "owner_missing"
  if (!owner.isActive) return "owner_inactive"
  if (owner.orgId !== orgId) return "owner_other_org"
  return null
}

function auditDetails(schedule: ScheduleRow, report: RunReport, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    trigger: SCHEDULER_BRIDGE_TRIGGER,
    scheduleId: schedule.id,
    functionId: schedule.functionId,
    outcome: report.outcome,
    ...report.detail,
    ...extra,
  })
}

/**
 * The one audit row of a claimed run. The owner is the actor. When the owner row no longer exists (undefined) there is no person
 * to name, and logActivity() takes a person or an API key and nothing else, so that row is written directly: user_id and
 * api_key_id both null, the actor is the bridge itself. It carries the same action, entity, surface and details as any other row.
 * In production the owner row is missing only in a race: owner_user_id references compliance.users ON DELETE CASCADE, so the
 * owner's deletion also deletes the schedule, and this is reached only when that delete commits between the claim and the owner read.
 */
async function auditRun(tx: TenantDb, owner: OwnerRow | undefined, schedule: ScheduleRow, report: RunReport, extra: Record<string, unknown> = {}): Promise<void> {
  const action = report.outcome === "owner_not_active" || report.outcome === "invalid_cadence" ? SCHEDULER_BRIDGE_SKIP_ACTION : SCHEDULER_BRIDGE_RUN_ACTION
  const details = auditDetails(schedule, report, extra)
  if (!owner) {
    await tx.insert(auditLogs).values({
      action,
      entityType: SCHEDULER_BRIDGE_ENTITY_TYPE,
      entityId: schedule.id,
      userId: null,
      apiKeyId: null,
      actorName: SCHEDULER_BRIDGE_SYSTEM_ACTOR.name,
      actorRole: SCHEDULER_BRIDGE_SYSTEM_ACTOR.role,
      orgId: schedule.orgId,
      details,
      surface: SCHEDULER_BRIDGE_SURFACE,
    })
    return
  }
  await logActivity({
    tx,
    orgId: schedule.orgId,
    // The owner is the actor. No apiKey is passed, so api_key_id is written as null.
    dbUser: owner,
    action,
    entityType: SCHEDULER_BRIDGE_ENTITY_TYPE,
    entityId: schedule.id,
    details,
    surface: SCHEDULER_BRIDGE_SURFACE,
  })
}

/**
 * The audit row of a run that stored no proposal, in its own transaction. A failure to write it is logged and recorded in
 * last_result (auditFailed) and does not replace the run's own outcome.
 */
async function auditOnly(owner: OwnerRow | undefined, schedule: ScheduleRow, report: RunReport): Promise<RunReport> {
  try {
    await withTenantContext({ orgId: schedule.orgId, userId: owner?.id }, (tx) => auditRun(tx, owner, schedule, report))
    return report
  } catch (error) {
    console.error(`scheduler-bridge: the audit row of schedule ${schedule.id} could not be written:`, error)
    return { ...report, detail: { ...report.detail, auditFailed: true } }
  }
}

/**
 * Store one proposal and its audit row in one transaction, and return the report of the run. When a proposal this schedule
 * stored earlier is still waiting (status in_progress, selected_chain.scheduleId equal to the schedule's id), nothing new is
 * stored: the report is already_pending and names the waiting proposal. The check and the insert share the transaction, and one
 * schedule is claimed by one run at a time, so two copies cannot be stored side by side.
 */
async function storeProposal(owner: OwnerRow, schedule: ScheduleRow, params: Record<string, unknown>, projectId: string | null, missing: string[]): Promise<RunReport> {
  const note = `Prepared by a schedule (${schedule.cadence} UTC) to run as ${owner.name}: ${functionLabel(schedule.functionId)}. Nothing is written until a person approves it.`.slice(0, NOTE_MAX_LENGTH)
  return withTenantContext({ orgId: schedule.orgId, userId: owner.id }, async (tx) => {
    const [waiting] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.orgId, schedule.orgId), eq(submissions.status, "in_progress"), sql`${submissions.selectedChain}->>'scheduleId' = ${schedule.id}`))
      .orderBy(asc(submissions.createdAt), asc(submissions.id))
      .limit(1)
    if (waiting) {
      const pending: RunReport = { outcome: "already_pending", detail: { pendingSubmissionId: waiting.id } }
      await auditRun(tx, owner, schedule, pending)
      return pending
    }
    const [row] = await tx
      .insert(submissions)
      .values({
        orgId: schedule.orgId,
        projectId,
        mode: "Projects",
        selectedChain: { source: SCHEDULER_BRIDGE_SOURCE, functionId: schedule.functionId, params, note, scheduleId: schedule.id },
        rawInput: functionLabel(schedule.functionId).toLowerCase(),
        userId: owner.id,
        status: "in_progress",
        classification: classifySubmission(["task"]),
      })
      .returning({ id: submissions.id })
    const proposed: RunReport = { outcome: "proposed", detail: { missing, submissionId: row.id } }
    await auditRun(tx, owner, schedule, proposed)
    return proposed
  })
}

async function runClaimed(schedule: ScheduleRow, owner: OwnerRow | undefined): Promise<RunReport> {
  const problem = ownerProblem(owner, schedule.orgId)
  if (problem || !owner) {
    const report: RunReport = { outcome: "owner_not_active", detail: { reason: problem ?? "owner_missing" }, deactivate: true }
    return auditOnly(owner, schedule, report)
  }

  const functionId = schedule.functionId
  if (!functionSpec(functionId) || !hasExecutor(functionId)) {
    return auditOnly(owner, schedule, { outcome: "failed", detail: { failureCode: "FUNCTION_NOT_AVAILABLE" } })
  }

  const params = isPlainObject(schedule.params) ? schedule.params : {}
  const projectId = typeof params.projectId === "string" && params.projectId.trim() !== "" ? params.projectId : null

  if (functionWrites(functionId)) {
    // PMD-05: a write is a proposal for a person to approve. It is never run from here.
    const missing = missingParamsFor(functionId, params, projectId).map((m) => m.name)
    return storeProposal(owner, schedule, params, projectId, missing)
  }

  let report: RunReport
  try {
    const outcome = await executeTask({
      orgId: schedule.orgId,
      userId: owner.id,
      projectId,
      functionId,
      params,
      // Read now, from compliance.users, never taken from the schedule row or a key.
      role: owner.role,
      actorUserId: owner.id,
    })
    report = outcome.success
      ? { outcome: "read_ok", detail: { result: summariseResult(outcome.result) } }
      : { outcome: "failed", detail: { failureCode: outcome.failure.code, missing: outcome.failure.missing } }
  } catch (error) {
    // executeTask turns its own failures into a value; a throw is something unexpected. Recorded like any other failed run.
    console.error(`scheduler-bridge: reading ${functionId} for schedule ${schedule.id} threw:`, error)
    report = { outcome: "failed", detail: { failureCode: "INTERNAL_ERROR" } }
  }
  return auditOnly(owner, schedule, report)
}

async function loadOwner(ownerUserId: string): Promise<OwnerRow | undefined> {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId)).limit(1)
  return owner
}

/**
 * Everything one claimed schedule does after the claim: read the owner, then run (or skip) it. It never throws. Anything that
 * does throw (the proposal transaction, the owner read) is recorded as a failed run with code INTERNAL_ERROR, and that failed
 * run gets its own audit row here: the transaction that threw rolled back its audit row with it, and "one audit row per claimed
 * run" must hold for a run that fails as much as for one that succeeds. When the throw came from the owner read itself there is no
 * person to name (the row goes out as the bridge's own, see auditRun) and the detail says why.
 */
async function runOneClaimed(schedule: ScheduleRow, cadenceReadable: boolean): Promise<RunReport> {
  let owner: OwnerRow | undefined
  let ownerRead = false
  try {
    owner = await loadOwner(schedule.ownerUserId)
    ownerRead = true
    if (!cadenceReadable) {
      const skipped: RunReport = { outcome: "invalid_cadence", detail: { reason: "cadence_not_readable" }, deactivate: true }
      return await auditOnly(owner, schedule, skipped)
    }
    return await runClaimed(schedule, owner)
  } catch (error) {
    // The claim already moved next_run_at on, so a failure here is recorded once and not retried at the next tick.
    console.error(`scheduler-bridge: schedule ${schedule.id} failed:`, error)
    const failed: RunReport = { outcome: "failed", detail: { failureCode: "INTERNAL_ERROR", ...(ownerRead ? {} : { reason: "owner_lookup_failed" }) } }
    return auditOnly(owner, schedule, failed)
  }
}

async function finish(schedule: ScheduleRow, ranAt: Date, report: RunReport): Promise<void> {
  const lastResult = { trigger: SCHEDULER_BRIDGE_TRIGGER, ranAt: ranAt.toISOString(), outcome: report.outcome, functionId: schedule.functionId, ...report.detail }
  await db
    .update(pipelineSchedules)
    .set({ lastResult, updatedAt: ranAt, ...(report.deactivate ? { isActive: false } : {}) })
    .where(eq(pipelineSchedules.id, schedule.id))
}

/**
 * Run every due schedule once, as its owner (see the file header). The route calls this with no arguments; the arguments exist so
 * a test can pin the clock, the batch and the time budget.
 */
export async function runDueSchedules(input: RunDueInput = {}): Promise<BridgeSummary> {
  const now = input.now ?? new Date()
  const batchSize = Math.min(Math.max(Math.trunc(input.batchSize ?? DEFAULT_BATCH_SIZE), 1), MAX_BATCH_SIZE)
  const timeBudgetMs = input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const startedAt = Date.now()

  const due = await db
    .select()
    .from(pipelineSchedules)
    .where(and(eq(pipelineSchedules.isActive, true), lte(pipelineSchedules.nextRunAt, now)))
    .orderBy(asc(pipelineSchedules.nextRunAt), asc(pipelineSchedules.id))
    .limit(batchSize)

  const summary: BridgeSummary = { ranAt: now.toISOString(), checked: due.length, claimed: 0, proposed: 0, alreadyPending: 0, readsRun: 0, failed: 0, skipped: 0, deferred: 0, results: [] }

  for (const [index, schedule] of due.entries()) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      summary.deferred = due.length - index
      break
    }

    // 1. CLAIM. next_run_at moves on in the same statement that claims, so a second run finds the row no longer due.
    const next = nextCronRun(schedule.cadence, now)
    const claimed = await db
      .update(pipelineSchedules)
      .set(next ? { nextRunAt: next, lastRunAt: now, updatedAt: now } : { isActive: false, lastRunAt: now, updatedAt: now })
      .where(and(eq(pipelineSchedules.id, schedule.id), eq(pipelineSchedules.isActive, true), lte(pipelineSchedules.nextRunAt, now)))
      .returning({ id: pipelineSchedules.id })
    if (claimed.length === 0) {
      summary.results.push({ scheduleId: schedule.id, outcome: "claimed_elsewhere" })
      continue
    }
    summary.claimed++

    const report = await runOneClaimed(schedule, next !== null)

    try {
      await finish(schedule, now, report)
    } catch (error) {
      console.error(`scheduler-bridge: could not record the result of schedule ${schedule.id}:`, error)
    }

    summary.results.push({ scheduleId: schedule.id, outcome: report.outcome })
    summary[SUMMARY_COUNTER[report.outcome]]++
  }

  return summary
}
