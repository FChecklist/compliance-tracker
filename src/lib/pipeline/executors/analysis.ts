// PROJEXA-BUILD-002 WP-05f (register row AW-306) -- the analysis reads the link did not have:
// get_project_exceptions, compare_boq_revisions and get_project_budget_variance.
//
// Each wraps the service the matching PROJEXA route calls (construction-exceptions-service.ts getProjectExceptions,
// construction-boq-service.ts compareBoq, erp-budget-service.ts getBudgetVariance). No second computation.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave6.test.ts:
//   - all three state amounts (the exception details quote them, a BOQ comparison is rates and values, a variance is the
//     budget against the ledger), so all three need the manager rank, and that is judged BEFORE anything is read or named
//     to a caller below it. The exceptions route asks for the manager rank itself; the two others have no role gate on their
//     routes and the link asks for more, never less;
//   - the BOQs and the budget must be of THIS project. compareBoq() finds a BOQ by id and organisation and only checks that
//     the two BOQs share a project with each other, so both ids are checked against the task's project first. A budget
//     belongs to a project through its cost centre; an organisation-wide budget (no cost centre) is no project's and reads as
//     absent;
//   - the BOQ comparison is passed through the same cost-visibility rule the compare route applies (applyCostVisibility), so
//     the project-side cost fields are removed for a role the organisation has not granted them to;
//   - get_project_exceptions is the heaviest read here (24 detectors over one transaction). It is a plain read of one
//     project; the Edge executor's CPU budget is a spike-S-1 question, not a rule of this file.
import { applyCostVisibility } from "@/lib/services/cost-visibility-service";
import { compareBoq } from "@/lib/services/construction-boq-service";
import { getProjectExceptions } from "@/lib/services/construction-exceptions-service";
import { getBudgetVariance } from "@/lib/services/erp-budget-service";
import type { UserRole } from "@/lib/supabase/role-rank";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, failureFromServiceError, RANK_MANAGER, refuse, str } from "./common";
import { isCalendarDay, isOutcome, notFound, recordInProject, scopeOf, type ScopeRules } from "./scope";

const MANAGER_READ: ScopeRules = { minRank: RANK_MANAGER, reason: "manager_rank_required", needsActor: false, rankFirst: true };

const ok = (result: unknown): ExecutionOutcome => ({ success: true, result });

export async function executeGetProjectExceptions(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, MANAGER_READ);
  if (isOutcome(scope)) return scope;
  try {
    // The service checks the project itself (a project of another organisation is a 404).
    return ok({ checks: await getProjectExceptions({ orgId: task.orgId }, scope.projectId) });
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeCompareBoqRevisions(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, MANAGER_READ);
  if (isOutcome(scope)) return scope;
  const boqId = str(task.params.boqId)!;
  // `againstBoqId` is the declared name (an id, so the link's id rule lists it); `against` is what the route calls it.
  const rawAgainst = task.params.againstBoqId ?? task.params.against;
  if (rawAgainst !== undefined && rawAgainst !== null && typeof rawAgainst !== "string") return badRequest(task, "againstBoqId");
  const against = str(rawAgainst);
  if (!(await recordInProject(task, "boq", boqId, scope.projectId))) return notFound(task);
  if (against && !(await recordInProject(task, "boq", against, scope.projectId))) {
    return refuse(pipelineFailure("RECORD_NOT_FOUND", ["boqVersion"], { status: 404, functionId: task.functionId, param: "againstBoqId" }));
  }
  try {
    const comparison = await compareBoq({ orgId: task.orgId }, boqId, { against });
    return ok(await applyCostVisibility({ orgId: task.orgId }, (task.role as UserRole | null | undefined) ?? null, comparison));
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeGetProjectBudgetVariance(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, MANAGER_READ);
  if (isOutcome(scope)) return scope;
  const budgetId = str(task.params.budgetId)!;
  // A blank as-of date is no date (the service then reads to the end of the fiscal year); anything else must be a real YYYY-MM-DD day.
  const asOfRaw = task.params.asOfDate;
  const asOfDate = typeof asOfRaw === "string" && asOfRaw.trim() !== "" ? asOfRaw.trim() : undefined;
  if (asOfRaw !== undefined && asOfRaw !== null && (typeof asOfRaw !== "string" ? true : asOfDate !== undefined && !isCalendarDay(asOfDate))) {
    return refuse(pipelineFailure("DATE_REQUIRED", ["date"]));
  }
  if (!(await recordInProject(task, "budget", budgetId, scope.projectId))) return notFound(task);
  try {
    return ok(await getBudgetVariance({ orgId: task.orgId }, budgetId, asOfDate));
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}
