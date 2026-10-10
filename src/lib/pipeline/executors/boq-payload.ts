// PROJEXA-BUILD-002 WP-04 (register rows AW-202 to AW-205) -- add_boq_lines and seal_boq, and the money
// rule for the BOQ functions.
//
// create_boq (executor.ts) makes the BOQ, empty or with lines; add_boq_lines appends at most 25 lines
// to it per call; seal_boq closes it against the totals the caller read from its own source. The
// rules live in src/lib/services/construction-boq-payload-service.ts, which this file wraps. What is
// decided here is only what a task adds: who may call, which project, and the shape of the answer.
//
//   - both need a named person (task.actorUserId) and the same project as the task; a BOQ of another
//     project reads as absent (RECORD_NOT_FOUND);
//   - add_boq_lines needs the member rank and its answer carries NO money: ids, codes and counts;
//   - seal_boq needs the manager rank and is refused BEFORE anything is read below it, because its
//     answer and its refusals state amounts. A member-rank link cannot call it;
//   - TOTAL_MISMATCH, BOQ_SEALED and DUPLICATE_ITEM_CODE are their own codes (error-codes.ts); the
//     service's other 4xx keep the generic codes, with the service's message in context.detail so a
//     caller that is an AI can correct its payload without a person.
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import {
  appendBoqLines,
  BoqPayloadError,
  MAX_LINES_PER_BATCH,
  sealBoq,
  type ControlTotals,
} from "@/lib/services/construction-boq-payload-service";
import type { BoqLineItemInput } from "@/lib/services/construction-boq-service";
import { ServiceError } from "@/lib/services/compliance-service";
import { badRequest, created, missingRequiredParam, notPermitted, num, pickProject, rankOf, RANK_MANAGER, RANK_MEMBER, refuse, str, unidentifiedActor } from "./common";

/**
 * Every key of a BOQ row or its lines that carries money, in the camelCase the service returns. The
 * `boqs` and `boq_lines` record kinds hide the same values on a link (record-kinds.generated.json, kept
 * in step by executor-boq-redaction.test.ts), so a member-rank caller sees the same nulls whether it
 * reads the record kind or the answer of a write.
 */
export const BOQ_MONEY_KEYS: ReadonlySet<string> = new Set([
  "rate", "amount", "materialCost", "labourCost", "equipmentCost", "budgetPercentage", "vendorAmount", "materialAmount",
  "manpowerAmount", "rateProject", "rateContract", "contractValueOverride",
  // the cost breakdown behind a rate, money for the `boq_lines` record kind since drizzle/0643 (BUILD-002 WP-06, AW-321)
  "vendorId", "overheadPercent", "profitPercent",
  // computed on read by construction-boq-service.ts's withComputedRate() and getBoqRow()
  "computedRate", "computedBudget", "contractValue", "moneyView", "costCoverage",
]);

function nullKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(nullKeys);
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, BOQ_MONEY_KEYS.has(key) ? null : nullKeys(inner)]));
  }
  return value;
}

/** The BOQ row as the caller's role may see it: at the manager rank as it is, below it every money value is null. */
export function withholdBoqMoney<T>(role: string | null | undefined, row: T): T {
  if (rankOf(role) >= RANK_MANAGER) return row;
  return { ...(nullKeys(row) as object), financialsRedacted: true } as T;
}

/** A BoqPayloadError as its own failure, a service 4xx as the generic one with the message; anything else is null (rethrown). */
function payloadFailure(task: ExecutableTask, error: unknown): ExecutionOutcome | null {
  if (error instanceof BoqPayloadError) {
    return refuse(pipelineFailure(error.payloadCode, [], { status: error.status, functionId: task.functionId, ...error.context }));
  }
  if (error instanceof ServiceError && error.status === 400) {
    return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId, detail: error.message.slice(0, 300) }));
  }
  return null;
}

type Scope = { projectId: string; boqId: string; actorId: string };

/** The parts every call here needs, in the order a caller can fix them: parameters, project, person, rank. */
function scopeOf(task: ExecutableTask, minRank: number, reason: string): Scope | ExecutionOutcome {
  // The rank comes first for a money function: nothing below it is read or named to a caller who may not see money.
  if (rankOf(task.role) < minRank) return notPermitted(reason);
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (!task.actorUserId) return unidentifiedActor();
  return { projectId: pick.projectId, boqId: str(task.params.boqId)!, actorId: task.actorUserId };
}

const isScope = (s: Scope | ExecutionOutcome): s is Scope => "boqId" in s;

export async function executeAddBoqLines(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, RANK_MEMBER, "role_below_member");
  if (!isScope(scope)) return scope;

  const batchNo = num(task.params.batchNo);
  if (batchNo === undefined || !Number.isInteger(batchNo)) return badRequest(task, "batchNo_type");
  const lines = task.params.lines;
  if (!Array.isArray(lines)) return badRequest(task, "lines_type");
  if (lines.length > MAX_LINES_PER_BATCH) {
    return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId, reason: "batch_too_large", max: MAX_LINES_PER_BATCH, sent: lines.length }));
  }
  try {
    const outcome = await appendBoqLines(
      { orgId: task.orgId, userId: scope.actorId },
      { projectId: scope.projectId, boqId: scope.boqId, batchNo, lines: lines as BoqLineItemInput[] }
    );
    return created(scope.boqId, `/scope/${scope.boqId}`, outcome);
  } catch (error) {
    const failure = payloadFailure(task, error);
    if (failure) return failure;
    throw error;
  }
}

export async function executeSealBoq(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, RANK_MANAGER, "money_requires_manager");
  if (!isScope(scope)) return scope;

  const expectedLineCount = num(task.params.expectedLineCount);
  if (expectedLineCount === undefined) return badRequest(task, "expectedLineCount_type");
  try {
    const outcome = await sealBoq(
      { orgId: task.orgId, userId: scope.actorId },
      { projectId: scope.projectId, boqId: scope.boqId, controlTotals: task.params.controlTotals as ControlTotals, expectedLineCount }
    );
    return created(scope.boqId, `/scope/${scope.boqId}`, outcome);
  } catch (error) {
    const failure = payloadFailure(task, error);
    if (failure) return failure;
    throw error;
  }
}
