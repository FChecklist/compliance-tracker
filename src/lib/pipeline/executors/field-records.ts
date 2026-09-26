// PROJEXA-BUILD-002 WP-05c (register row AW-303) -- RFIs, submittals and punch list items.
//
// Eight functions, each a thin wrapper over the service PROJEXA's own routes call (construction-field-workflow-service.ts):
//   create_rfi        createRfi()                        answer_rfi                answerRfi()
//   close_rfi         closeRfi()                         create_submittal          createSubmittal()
//   review_submittal  reviewSubmittal()                  create_punch_list_item    createPunchListItem()
//   mark_punch_item_ready  markPunchListItemReadyForReview()   verify_punch_item_closed  verifyPunchListItemClosed()
// No second write path. What each adds around the call is in record-scope.ts's header (run order, same-project rule for an id):
//   - createRfi, createSubmittal and createPunchListItem never check that the project exists, so it is checked here;
//   - answerRfi, closeRfi, reviewSubmittal, the two punch list functions and getRfi find a record by id and organisation only, so the id
//     is held to the task's project first (RECORD_NOT_FOUND, nothing written);
//   - an assignee (assignedToId) is one of the project's people: its lead, a member of its team, or the acting person;
//   - a closed-list value (ballInCourt, submittal type, priority) that the service would cast without checking is checked here, so a
//     wrong word is a 400 and not a database error.
// The independent-reviewer rules stay in the service and reach the caller as they are: reviewSubmittal refuses the person who submitted
// (403) and verifyPunchListItemClosed refuses the assignee (403). The rows are recorded under the acting person, never under the API key.
import {
  answerRfi,
  closeRfi,
  createPunchListItem,
  createRfi,
  createSubmittal,
  markPunchListItemReadyForReview,
  reviewSubmittal,
  verifyPunchListItemClosed,
} from "@/lib/services/construction-field-workflow-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, isProjectPerson, needText, notFound, optDate, optOneOf, optText, projectExists, recordInProject } from "./record-scope";

const BALL_IN_COURT = ["contractor", "architect", "owner", "consultant"] as const;
const SUBMITTAL_TYPES = ["shop_drawing", "product_data", "sample", "other"] as const;
const SUBMITTAL_DECISIONS = ["approved", "approved_as_noted", "revise_resubmit", "rejected"] as const;
const PUNCH_PRIORITIES = ["low", "medium", "high"] as const;

/** The assignee named in params.assignedToId, held to the project's people. undefined when none was named. */
async function assignee(task: ExecutableTask, projectId: string): Promise<string | undefined | ExecutionOutcome> {
  const named = optText(task, "assignedToId");
  if (named === BAD) return bad(task, "assignedToId");
  if (named === undefined) return undefined;
  return (await isProjectPerson(task, projectId, named)) ? named : notFound(task, "assignedToId");
}

const isOutcome = (v: unknown): v is ExecutionOutcome => typeof v === "object" && v !== null && "success" in v;

// -- RFIs (R-97 indirect, EXC-05) ---------------------------------------------------------------------------------------------

export async function executeCreateRfi(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const subject = needText(task, "subject");
    const question = needText(task, "question");
    if (subject === BAD) return bad(task, "subject");
    if (question === BAD) return bad(task, "question");
    const dueDate = optDate(task, "dueDate");
    if (dueDate === BAD) return bad(task, "dueDate");
    const ballInCourt = optOneOf(task, "ballInCourt", BALL_IN_COURT);
    if (ballInCourt === BAD) return bad(task, "ballInCourt");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    const assignedToId = await assignee(task, projectId);
    if (isOutcome(assignedToId)) return assignedToId;

    const row = await createRfi({ orgId: task.orgId, userId: actorId }, { projectId, subject, question, assignedToId, dueDate, ballInCourt });
    return created(row.id, `/rfis/${row.id}`, row);
  });
}

export async function executeAnswerRfi(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const rfiId = needText(task, "rfiId");
    const answer = needText(task, "answer");
    if (rfiId === BAD) return bad(task, "rfiId");
    if (answer === BAD) return bad(task, "answer");
    if (!(await recordInProject(task, "rfi", rfiId, projectId))) return notFound(task, "rfiId");
    const row = await answerRfi({ orgId: task.orgId, userId: actorId }, rfiId, answer);
    return created(row.id, `/rfis/${row.id}`, row);
  });
}

export async function executeCloseRfi(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const rfiId = needText(task, "rfiId");
    if (rfiId === BAD) return bad(task, "rfiId");
    if (!(await recordInProject(task, "rfi", rfiId, projectId))) return notFound(task, "rfiId");
    const row = await closeRfi({ orgId: task.orgId }, rfiId);
    return created(row.id, `/rfis/${row.id}`, row);
  });
}

// -- submittals (EXC-05) ---------------------------------------------------------------------------------------------------------

export async function executeCreateSubmittal(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const title = needText(task, "title");
    if (title === BAD) return bad(task, "title");
    const specSection = optText(task, "specSection");
    if (specSection === BAD) return bad(task, "specSection");
    const type = optOneOf(task, "type", SUBMITTAL_TYPES);
    if (type === BAD) return bad(task, "type");
    const dueDate = optDate(task, "dueDate");
    if (dueDate === BAD) return bad(task, "dueDate");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");

    const row = await createSubmittal({ orgId: task.orgId, userId: actorId }, { projectId, title, specSection, type, dueDate });
    return created(row.id, `/submittals/${row.id}`, row);
  });
}

// A review is an approval decision: level 2 on a link (the person confirms) and the manager rank, although the route's floor is member.
export async function executeReviewSubmittal(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const submittalId = needText(task, "submittalId");
    const status = needText(task, "status");
    if (submittalId === BAD) return bad(task, "submittalId");
    if (status === BAD || !(SUBMITTAL_DECISIONS as readonly string[]).includes(status)) return bad(task, "status");
    const comments = optText(task, "comments");
    if (comments === BAD) return bad(task, "comments");
    if (!(await recordInProject(task, "submittal", submittalId, projectId))) return notFound(task, "submittalId");

    const row = await reviewSubmittal({ orgId: task.orgId, userId: actorId }, submittalId, status, comments);
    return created(row.id, `/submittals/${row.id}`, row);
  });
}

// -- punch list (EXC-24) ---------------------------------------------------------------------------------------------------------

export async function executeCreatePunchListItem(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const description = needText(task, "description");
    if (description === BAD) return bad(task, "description");
    const location = optText(task, "location");
    if (location === BAD) return bad(task, "location");
    const trade = optText(task, "trade");
    if (trade === BAD) return bad(task, "trade");
    const priority = optOneOf(task, "priority", PUNCH_PRIORITIES);
    if (priority === BAD) return bad(task, "priority");
    const dueDate = optDate(task, "dueDate");
    if (dueDate === BAD) return bad(task, "dueDate");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    const assignedToId = await assignee(task, projectId);
    if (isOutcome(assignedToId)) return assignedToId;

    const row = await createPunchListItem({ orgId: task.orgId, userId: actorId }, { projectId, description, location, trade, priority, assignedToId, dueDate });
    return created(row.id, `/punch-list/${row.id}`, row);
  });
}

export async function executeMarkPunchItemReady(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const itemId = needText(task, "itemId");
    if (itemId === BAD) return bad(task, "itemId");
    if (!(await recordInProject(task, "punch_item", itemId, projectId))) return notFound(task, "itemId");
    const row = await markPunchListItemReadyForReview({ orgId: task.orgId }, itemId);
    return created(row.id, `/punch-list/${row.id}`, row);
  });
}

// Sign-off that the work is closed: level 2 on a link and the manager rank; the service refuses the item's own assignee.
export async function executeVerifyPunchItemClosed(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const itemId = needText(task, "itemId");
    if (itemId === BAD) return bad(task, "itemId");
    if (!(await recordInProject(task, "punch_item", itemId, projectId))) return notFound(task, "itemId");
    const row = await verifyPunchListItemClosed({ orgId: task.orgId, userId: actorId }, itemId);
    return created(row.id, `/punch-list/${row.id}`, row);
  });
}
