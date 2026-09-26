// PROJEXA-BUILD-002 AW-312 -- the five functions that record the facts eight owner exception items detect and nothing could write:
// set_progress_drawing (items 3, 4), record_vendor_dispute (10), record_customer_complaint (11, 12), record_customer_approval (15, 16)
// and link_roster_employee (21).
//
// Each wraps a function of src/lib/services/construction-exception-capture-service.ts, which holds the rules (the record must be of
// THIS project, one transaction, one audit row under the acting person). What is decided here is only what a task adds: who may
// call, the shape of the parameters, and the money rule for the answer.
//
//   - a named person acts (task.actorUserId); the rank floor is the member rank, and the manager rank for the two that state an
//     approval or reach HR data (record_customer_approval, link_roster_employee);
//   - every one is a level-2 function on a link (the person confirms it signed in) except link_roster_employee, which is on no link:
//     an employee id is an organisation-wide HR record, not project data, so it cannot be checked against a link's project. The
//     internal pipeline runs it for a manager;
//   - an organisation-level id (vendorId, customerId, employeeId) is not a link parameter: a supplier or a customer is not a project
//     record either. The executor still accepts them from the internal pipeline and the service checks they exist in the organisation;
//   - the disputed amount is money: it is null in the answer below the manager rank;
//   - free text (description, category) is cleaned and held to 2,000 characters here as well as at the link.
import { linkRosterEmployee, recordCustomerApproval, recordCustomerComplaint, recordVendorDispute, setProgressEntryDrawing } from "@/lib/services/construction-exception-capture-service";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, failureFromServiceError, num, rankOf, RANK_MANAGER, RANK_MEMBER, refuse, str } from "./common";
import { cleanOneText, isOutcome, scopeOf, type ScopeRules } from "./scope";

const AS_MEMBER: ScopeRules = { minRank: RANK_MEMBER, reason: "role_below_member", needsActor: true };
const AS_MANAGER: ScopeRules = { minRank: RANK_MANAGER, reason: "manager_rank_required", needsActor: true };

/** Runs a service call, turning its own 4xx into the pipeline's refusal; anything else is rethrown for executeTask() to classify. */
async function guarded<T>(task: ExecutableTask, run: () => Promise<T>): Promise<{ value: T } | { failure: ExecutionOutcome }> {
  try {
    return { value: await run() };
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return { failure: refused };
    throw error;
  }
}

const orNothing = (value: unknown): string | undefined => str(value);

export async function executeSetProgressDrawing(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const confirmedRaw = task.params.confirmed;
  if (confirmedRaw !== undefined && confirmedRaw !== null && typeof confirmedRaw !== "boolean") return badRequest(task, "confirmed");
  const done = await guarded(task, () =>
    setProgressEntryDrawing(
      { orgId: task.orgId, userId: scope.actorId! },
      { projectId: scope.projectId, progressEntryId: str(task.params.progressEntryId)!, drawingDocumentId: str(task.params.drawingDocumentId)!, confirmed: confirmedRaw === false ? false : undefined }
    )
  );
  if ("failure" in done) return done.failure;
  return created(done.value.id, "/work-progress", done.value);
}

export async function executeRecordVendorDispute(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const description = cleanOneText(task.params.description);
  if (!description.ok) return badRequest(task, "description_text");
  if (description.text === undefined) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
  const rawAmount = task.params.amountDisputed;
  const amount = rawAmount === undefined || rawAmount === null ? undefined : num(rawAmount);
  if (rawAmount !== undefined && rawAmount !== null && amount === undefined) return badRequest(task, "amountDisputed");
  const done = await guarded(task, () =>
    recordVendorDispute(
      { orgId: task.orgId, userId: scope.actorId! },
      { projectId: scope.projectId, description: description.text!, vendorId: orNothing(task.params.vendorId), boqLineItemId: orNothing(task.params.boqLineItemId), amountDisputed: amount }
    )
  );
  if ("failure" in done) return done.failure;
  const row = done.value;
  // The disputed amount is money: below the manager rank it is null and the answer says why.
  const shown = rankOf(task.role) >= RANK_MANAGER ? row : { ...row, amountDisputed: null, financialsRedacted: true };
  return created(row.id, "/disputes", shown);
}

export async function executeRecordCustomerComplaint(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const description = cleanOneText(task.params.description);
  if (!description.ok) return badRequest(task, "description_text");
  if (description.text === undefined) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
  const category = cleanOneText(task.params.category);
  if (!category.ok) return badRequest(task, "category_text");
  const severity = task.params.severity;
  if (severity !== undefined && severity !== null && typeof severity !== "string") return badRequest(task, "severity");
  const done = await guarded(task, () =>
    recordCustomerComplaint(
      { orgId: task.orgId, userId: scope.actorId! },
      { projectId: scope.projectId, description: description.text!, category: category.text, severity: str(severity), customerId: orNothing(task.params.customerId) }
    )
  );
  if ("failure" in done) return done.failure;
  return created(done.value.id, "/complaints", done.value);
}

export async function executeRecordCustomerApproval(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MANAGER);
  if (isOutcome(scope)) return scope;
  const approvedOn = task.params.approvedOn;
  if (approvedOn !== undefined && approvedOn !== null && typeof approvedOn !== "string") return refuse(pipelineFailure("DATE_REQUIRED", ["date"]));
  const done = await guarded(task, () =>
    recordCustomerApproval(
      { orgId: task.orgId, userId: scope.actorId! },
      { projectId: scope.projectId, boqId: str(task.params.boqId)!, evidenceDocumentId: str(task.params.evidenceDocumentId)!, approvedOn: str(approvedOn) }
    )
  );
  if ("failure" in done) return done.failure;
  return created(done.value.id, `/scope/${done.value.id}`, done.value);
}

export async function executeLinkRosterEmployee(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MANAGER);
  if (isOutcome(scope)) return scope;
  const done = await guarded(task, () =>
    linkRosterEmployee({ orgId: task.orgId, userId: scope.actorId! }, { projectId: scope.projectId, rosterId: str(task.params.rosterId)!, employeeId: str(task.params.employeeId)! })
  );
  if ("failure" in done) return done.failure;
  return created(done.value.id, "/labour-roster", done.value);
}
