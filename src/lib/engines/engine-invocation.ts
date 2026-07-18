// VCEL Calculation Auditability + Version Control (VERIDIAN Review
// Framework gap closure, 2026-07-18).
//
// Before this file: task-execution-engine.ts's executeEngineDispatch()
// called dispatchEngine() directly and wrote only a human-readable JSON
// string into taskChatMessages -- no dedicated, queryable audit row, and
// no record of which engineVersion was authoritative when the calculation
// ran. Any future direct (non-Chain-Selector) service-code call to an
// engine function would get no audit trail at all, since logging lived at
// the caller, not the engine boundary.
//
// invokeEngine() moves both guarantees into the invocation layer itself:
// wrap ANY engine call (the dispatchEngine() switch today; a direct
// service-code call to a single engine function tomorrow) with this
// function and it is unconditionally: (a) stamped with the engineVersion
// that was current in computationEngines at call time, and (b) written to
// calculationInvocations, success or failure, before the result/error is
// returned to the caller. This is deliberately NOT run inside its own
// nested transaction -- callers already run inside a withTenantContext
// transaction (see task-execution-engine.ts's executeEngineDispatch), and
// the audit row should commit/rollback atomically with whatever else that
// transaction does.
import { eq } from "drizzle-orm"
import { computationEngines, calculationInvocations } from "@/lib/db"
import type { TenantDb } from "@/lib/db/tenant-scoped"

export type InvokeEngineContext = {
  orgId: string
  userId?: string | null
  taskId?: string | null
}

export async function invokeEngine<TInput, TOutput>(
  db: TenantDb,
  ctx: InvokeEngineContext,
  engineKey: string,
  fn: (input: TInput) => TOutput | Promise<TOutput>,
  input: TInput
): Promise<TOutput> {
  const engineRow = await db.query.computationEngines.findFirst({
    where: eq(computationEngines.engineKey, engineKey),
    columns: { engineVersion: true },
  })
  const engineVersion = engineRow?.engineVersion ?? "unknown"

  try {
    const output = await fn(input)
    await db.insert(calculationInvocations).values({
      engineKey, engineVersion, orgId: ctx.orgId, userId: ctx.userId ?? null, taskId: ctx.taskId ?? null,
      status: "success", input: input as object, output: output as object,
    })
    return output
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error"
    await db.insert(calculationInvocations).values({
      engineKey, engineVersion, orgId: ctx.orgId, userId: ctx.userId ?? null, taskId: ctx.taskId ?? null,
      status: "failed", input: input as object, errorMessage: message,
    })
    throw err
  }
}
