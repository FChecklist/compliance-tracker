// PROJEXA-BUILD-002 -- the small helpers the executors under src/lib/pipeline/executors/ share.
//
// executor.ts keeps its own private copies of str(), num(), created() and missingRequiredParam(); these
// have the same behaviour, and exist so a new executor file does not have to import executor.ts's
// internals (which would make executor.ts and the file import each other). The types come from
// executor.ts with `import type`, which is erased at build time, so there is no import cycle.
import { codeForServiceError, pipelineFailure, type PipelineFailure } from "../error-codes";
import { functionSpec, requiredParamSatisfied } from "../function-registry";
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank";
import { ServiceError } from "@/lib/services/compliance-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function refuse(failure: PipelineFailure): ExecutionOutcome {
  return { success: false, failure };
}

export function created(id: string, route: string, record: unknown): ExecutionOutcome {
  return { success: true, result: { id, route, record } };
}

export function unidentifiedActor(): ExecutionOutcome {
  return refuse(pipelineFailure("NOT_PERMITTED", [], { reason: "unidentified_actor" }));
}

/** The person's rank, 0 for an absent or unknown role: an unknown role is never treated as allowed. */
export function rankOf(role?: string | null): number {
  return role ? (ROLE_RANK[role as UserRole] ?? 0) : 0;
}

export const RANK_MEMBER = ROLE_RANK.member;
export const RANK_MANAGER = ROLE_RANK.manager;

export function notPermitted(reason: string): ExecutionOutcome {
  return refuse(pipelineFailure("NOT_PERMITTED", [], { reason }));
}

/** The registry's own required parameters, checked again at the last moment before a write (executor.ts's missingRequiredParam). */
export function missingRequiredParam(task: ExecutableTask): PipelineFailure | null {
  const spec = functionSpec(task.functionId);
  if (!spec) return null;
  for (const required of spec.requiredParams) {
    const fallback = required.name === "projectId" ? task.projectId : undefined;
    if (!requiredParamSatisfied(required, task.params, fallback)) {
      return pipelineFailure(required.code, [required.field ?? required.name]);
    }
  }
  return null;
}

/** The task's own project. A params.projectId that names another project is refused, not dropped. */
export function pickProject(task: ExecutableTask): { projectId: string | null } | { failure: PipelineFailure } {
  const named = str(task.params.projectId);
  if (task.projectId && named && named !== task.projectId) {
    return { failure: pipelineFailure("PROJECT_NOT_REACHABLE", ["projectId"]) };
  }
  return { projectId: task.projectId ?? named ?? null };
}

/** A malformed request, in the shape a service's own 400 gets. `reason` is a short machine word, never prose for a person. */
export function badRequest(task: ExecutableTask, reason?: string): ExecutionOutcome {
  return refuse(pipelineFailure("REQUEST_REJECTED", [], { status: 400, functionId: task.functionId, ...(reason ? { reason } : {}) }));
}

/** Turns a service's own 4xx into the pipeline's failure; anything else is rethrown for executeTask() to classify. */
export function failureFromServiceError(task: ExecutableTask, error: unknown): ExecutionOutcome | null {
  if (error instanceof ServiceError && error.status < 500) {
    return refuse(pipelineFailure(codeForServiceError(error.status), [], { status: error.status, functionId: task.functionId }));
  }
  return null;
}
