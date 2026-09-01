// TET Engine (Task Execution Trace) increment 1: real Task Execution Trace
// core service. Logs each user-initiated action's lifecycle
// (started/step/completed/failed) to the real task_execution_traces table
// (schema.ts), scoped per-user/per-org via withTenantContext -- same tenant-
// isolation pattern as access-review-service.ts/erp-*-service.ts. See
// tet-shield-gate.ts for the security gate this wires every gated action
// through, and PROGRESS.md for the increment-1 gap-map against the full TET
// engine spec.
import { taskExecutionTraces } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { runTetShieldGate, type TetShieldGateOptions } from "./tet-shield-gate"
export { ServiceError }

export type TetTraceContext = { orgId: string; userId: string }

export type TraceStep = { name: string; detail?: string; at: string }

async function loadTrace(db: Parameters<Parameters<typeof withTenantContext>[1]>[0], ctx: TetTraceContext, traceId: string) {
  const trace = await db.query.taskExecutionTraces.findFirst({
    where: and(eq(taskExecutionTraces.id, traceId), eq(taskExecutionTraces.orgId, ctx.orgId)),
  })
  if (!trace) throw new ServiceError("Task execution trace not found", 404)
  return trace
}

function pushStep(existing: unknown, step: TraceStep): TraceStep[] {
  const steps = Array.isArray(existing) ? (existing as TraceStep[]) : []
  return [...steps, step]
}

/** Starts a new trace for a user-initiated TET action. Real DB write -- status='started'. */
export async function startTrace(ctx: TetTraceContext, input: { actionKey: string; input?: Record<string, unknown> }) {
  if (!input.actionKey?.trim()) throw new ServiceError("actionKey is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [trace] = await db.insert(taskExecutionTraces).values({
      orgId: ctx.orgId,
      userId: ctx.userId,
      actionKey: input.actionKey,
      status: "started",
      steps: [{ name: "started", at: new Date().toISOString() } satisfies TraceStep],
      input: input.input ?? null,
    }).returning()
    return trace
  })
}

/** Appends one lifecycle step to an in-flight trace without changing its status. */
export async function appendTraceStep(ctx: TetTraceContext, traceId: string, step: { name: string; detail?: string }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const trace = await loadTrace(db, ctx, traceId)
    const steps = pushStep(trace.steps, { name: step.name, detail: step.detail, at: new Date().toISOString() })
    const [updated] = await db.update(taskExecutionTraces).set({ steps }).where(eq(taskExecutionTraces.id, traceId)).returning()
    return updated
  })
}

/**
 * Records the shield gate's verdict as a step. A "block" verdict also
 * transitions the trace's terminal status to 'shield_blocked' -- the action
 * never executed, so this IS the trace's final state, not an intermediate
 * step followed by a separate failTrace() call.
 */
export async function recordShieldVerdict(ctx: TetTraceContext, traceId: string, gate: { verdict: "pass" | "block"; reason: string | null }) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const trace = await loadTrace(db, ctx, traceId)
    const steps = pushStep(trace.steps, {
      name: gate.verdict === "pass" ? "shield_pass" : "shield_block",
      detail: gate.reason ?? undefined,
      at: new Date().toISOString(),
    })

    const [updated] = await db.update(taskExecutionTraces).set({
      steps,
      shieldVerdict: gate.verdict,
      shieldBlockReason: gate.reason,
      ...(gate.verdict === "block" ? { status: "shield_blocked" as const, error: gate.reason, completedAt: new Date() } : {}),
    }).where(eq(taskExecutionTraces.id, traceId)).returning()
    return updated
  })
}

/** Marks a trace completed -- status='completed', completedAt=now(). */
export async function completeTrace(ctx: TetTraceContext, traceId: string, output?: Record<string, unknown>) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const trace = await loadTrace(db, ctx, traceId)
    const steps = pushStep(trace.steps, { name: "completed", at: new Date().toISOString() })
    const [updated] = await db.update(taskExecutionTraces).set({
      status: "completed", steps, output: output ?? null, completedAt: new Date(),
    }).where(eq(taskExecutionTraces.id, traceId)).returning()
    return updated
  })
}

/** Marks a trace failed -- status='failed', completedAt=now(), error recorded. */
export async function failTrace(ctx: TetTraceContext, traceId: string, error: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const trace = await loadTrace(db, ctx, traceId)
    const steps = pushStep(trace.steps, { name: "failed", detail: error, at: new Date().toISOString() })
    const [updated] = await db.update(taskExecutionTraces).set({
      status: "failed", steps, error, completedAt: new Date(),
    }).where(eq(taskExecutionTraces.id, traceId)).returning()
    return updated
  })
}

export async function getTrace(ctx: { orgId: string }, traceId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => loadTrace(db, ctx as TetTraceContext, traceId))
}

export async function listTraces(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.taskExecutionTraces.findMany({ where: eq(taskExecutionTraces.orgId, ctx.orgId), orderBy: (t, { desc }) => desc(t.createdAt) })
  )
}

export type ExecuteGatedTetActionInput = {
  actionKey: string
  actionText: string
  groqApiKey: TetShieldGateOptions["groqApiKey"]
  input?: Record<string, unknown>
}

export type ExecuteGatedTetActionResult<T> =
  | { blocked: true; trace: unknown; result?: never }
  | { blocked: false; trace: unknown; result: T }

/**
 * Wires the shield gate into the trace service: every gated TET action goes
 * started -> shield gate (pass/block, recorded as a step either way) ->
 * [blocked: stop here, trace is already terminal] -> executor() ->
 * completed/failed. This is what SCOPE item 3 ("wire the trace service so
 * every gated action records a trace entry") refers to -- callers (route
 * handlers, future TET action dispatchers) should call this rather than
 * hand-rolling the start/gate/complete sequence themselves.
 */
export async function executeGatedTetAction<T>(
  ctx: TetTraceContext,
  input: ExecuteGatedTetActionInput,
  executor: () => Promise<T>
): Promise<ExecuteGatedTetActionResult<T>> {
  const trace = await startTrace(ctx, { actionKey: input.actionKey, input: input.input })

  const gate = await runTetShieldGate({ text: input.actionText, groqApiKey: input.groqApiKey })
  const gatedTrace = await recordShieldVerdict(ctx, trace.id, { verdict: gate.verdict, reason: gate.reason })

  if (gate.verdict === "block") {
    return { blocked: true, trace: gatedTrace }
  }

  try {
    const result = await executor()
    const completedTrace = await completeTrace(ctx, trace.id, { result })
    return { blocked: false, trace: completedTrace, result }
  } catch (err) {
    await failTrace(ctx, trace.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}
