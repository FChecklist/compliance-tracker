// PROJEXA-BUILD-002 WP-05h (register row AW-308, wave 7, owner decision PMD-41) -- progress claims as DRAFTS the person confirms:
// create_progress_claim, draft_progress_claim, submit_progress_claim and reject_progress_claim.
//
// Each wraps the service PROJEXA's own billing routes call (construction-billing-workflow-service.ts). No second write path.
//   create_progress_claim   createProgressClaim()   a new claim, "milestone achieved", against one BOQ of the project and one customer it bills
//   draft_progress_claim    draftClaim()            milestone achieved -> drafted
//   submit_progress_claim   submitClaim()           drafted -> submitted (the claim goes to the customer; this step sends nothing)
//   reject_progress_claim   rejectClaim()           submitted -> rejected, with the customer's reason
//
// PMD-41: an AI link may PROPOSE a billing claim; it is written only when a signed-in person confirms it, so all four are level 2 on a link
// (the link refuses them on the direct path). Money: a claim states a retention and is billed money, so each is money sensitive and needs the
// manager rank (the routes ask for the member rank; the link asks for more, never less). NOT here, on purpose: approving a claim (it records the
// customer's own decision, which an AI could invent) and invoicing one (it posts an invoice); neither has an executor.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave7.test.ts:
//   - the claim id is held to the task's project (the service finds a claim by id and organisation only); the BOQ must be a BOQ of the project
//     and the customer one the project bills (createProgressClaim checks neither); the state machine of the service stays the only judge of
//     a transition (a claim in the wrong state is its own 409);
//   - the acting person is recorded (createdById), never the API key;
//   - free text (the milestone, the rejection reason) is cleaned and held to 2,000 characters.
import { createProgressClaim, draftClaim, rejectClaim, submitClaim } from "@/lib/services/construction-billing-workflow-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER } from "./common";
import { bad, BAD, guarded, needDate, needText, notFound, optNumber, projectExists } from "./record-scope";
import { recordInProject } from "./scope";
import { customerOfProject, needClean, optClean, recordOfProject } from "./wave79-scope";

const CLAIM_ROUTE = "/billing-milestones";

export async function executeCreateProgressClaim(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const boqId = needText(task, "boqId");
    if (boqId === BAD) return bad(task, "boqId");
    const customerId = needText(task, "customerId");
    if (customerId === BAD) return bad(task, "customerId");
    const milestoneDescription = needClean(task, "milestoneDescription");
    if (milestoneDescription === BAD) return bad(task, "milestoneDescription");
    const scheduledDate = needDate(task, "scheduledDate");
    if (scheduledDate === BAD) return bad(task, "scheduledDate");
    const retentionPercent = optNumber(task, "retentionPercent");
    if (retentionPercent === BAD || (retentionPercent !== undefined && retentionPercent > 100)) return bad(task, "retentionPercent");

    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    if (!(await recordInProject(task, "boq", boqId, projectId))) return notFound(task, "boqId");
    if (!(await customerOfProject(task, projectId, customerId))) return notFound(task, "customerId");

    const row = await createProgressClaim({ orgId: task.orgId, userId: actorId }, { projectId, boqId, customerId, milestoneDescription, scheduledDate, retentionPercent });
    return created(row.id, `${CLAIM_ROUTE}/${row.id}`, row);
  });
}

/** The claim id, held to the task's project. */
async function ownClaim(task: ExecutableTask, projectId: string): Promise<string | ExecutionOutcome> {
  const claimId = needText(task, "claimId");
  if (claimId === BAD) return bad(task, "claimId");
  if (!(await recordOfProject(task, "claim", claimId, projectId))) return notFound(task, "claimId");
  return claimId;
}

const isOutcome = (v: unknown): v is ExecutionOutcome => typeof v === "object" && v !== null && "success" in v;

export async function executeDraftProgressClaim(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const claimId = await ownClaim(task, projectId);
    if (isOutcome(claimId)) return claimId;
    const row = await draftClaim({ orgId: task.orgId, userId: actorId }, claimId);
    return created(row.id, `${CLAIM_ROUTE}/${row.id}`, row);
  });
}

export async function executeSubmitProgressClaim(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const claimId = await ownClaim(task, projectId);
    if (isOutcome(claimId)) return claimId;
    const row = await submitClaim({ orgId: task.orgId, userId: actorId }, claimId);
    return created(row.id, `${CLAIM_ROUTE}/${row.id}`, row);
  });
}

export async function executeRejectProgressClaim(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const reason = optClean(task, "rejectionReason");
    if (reason === BAD) return bad(task, "rejectionReason");
    const claimId = await ownClaim(task, projectId);
    if (isOutcome(claimId)) return claimId;
    const row = await rejectClaim({ orgId: task.orgId, userId: actorId }, claimId, reason);
    return created(row.id, `${CLAIM_ROUTE}/${row.id}`, row);
  });
}
