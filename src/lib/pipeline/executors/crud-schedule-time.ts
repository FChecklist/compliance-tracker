// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the schedule and timesheet changes an AI could not make: archive_task,
// create_sprint, update_sprint, close_sprint, add_sprint_task, remove_sprint_task, update_time_entry and delete_time_entry.
//
// Each wraps the service the matching PROJEXA route calls (pms-issue-service.ts updateIssue with isArchived; pms-sprint-service.ts;
// pms-time-service.ts updateTimeEntry, deleteTimeEntry). The routes ask for the member rank, so every function here does too.
//   - archive_task hides a task from the schedule (isArchived true) or brings it back (false). It is the schedule's soft delete, so it is
//     a draft the person confirms (level 2); update_task still never takes archive;
//   - a sprint, and every task a sprint takes or drops, must be of THIS project (the services find them by id and organisation only);
//     a sprint's status is planned or active through update_sprint; "completed" only through close_sprint, which writes the close-time
//     snapshot once and is a draft the person confirms;
//   - removing a task from a sprint deletes no record (the task stays on the schedule), so it is a direct write like adding one;
//   - a time entry is the acting person's own: the service refuses anyone else's (403) and this executor does too, before anything is
//     written. update_time_entry keeps the service's draft-or-returned rule; delete_time_entry is STRICTER than the service, which deletes
//     an entry in any state: an AI may delete only a draft or returned entry, never a submitted or approved one (an approved entry has been
//     counted as cost). A delete is a draft the person confirms;
//   - a time entry's answer carries its billing rate snapshot and invoice line, null below the manager rank (money).
// Tests: src/lib/pipeline/coverage-crud-b2.test.ts.
import { updateIssue } from "@/lib/services/pms-issue-service";
import { addIssueToSprint, closeSprint, createSprint, removeIssueFromSprint, updateSprint } from "@/lib/services/pms-sprint-service";
import { deleteTimeEntry, RESUBMITTABLE_STATUSES, updateTimeEntry } from "@/lib/services/pms-time-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, notPermitted, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, optDate, optOneOf, projectExists, withholdFields } from "./record-scope";
import { recordInProject } from "./scope";
import { given, needClean, optClean, optId, optRange } from "./wave79-scope";
import { sprintOfProject, timeEntryOfProject } from "./crud-scope";

const WRITE = { write: true, minRank: RANK_MEMBER } as const;

/** An optional boolean: a boolean, or "true"/"false" (a link's GET /propose carries every value as a string). Absent is undefined. */
function optBool(task: ExecutableTask, key: string): boolean | undefined | typeof BAD {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return BAD;
}

/** The optional free-text field of a patch: BAD when given but not usable text (over the cap, not text, or blank after cleaning). */
function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

// -- tasks --------------------------------------------------------------------------------------------------------------------------

export async function executeArchiveTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId, actorId }) => {
    const issueId = needText(task, "issueId");
    if (issueId === BAD) return bad(task, "issueId");
    const archived = optBool(task, "isArchived");
    if (archived === BAD) return bad(task, "isArchived");
    if (!(await recordInProject(task, "issue", issueId, projectId))) return notFound(task, "issueId");
    const row = await updateIssue({ orgId: task.orgId, userId: actorId, dbUser: null as never }, issueId, { isArchived: archived ?? true });
    return created(String(row.id), "/schedule", row);
  });
}

// -- sprints ------------------------------------------------------------------------------------------------------------------------

export const SPRINT_EDIT_STATUSES = ["planned", "active"] as const;

/** start and end dates, each optional; an end before the start is BAD. */
function sprintDates(task: ExecutableTask): { startDate?: string; endDate?: string } | typeof BAD {
  const startDate = optDate(task, "startDate");
  const endDate = optDate(task, "endDate");
  if (startDate === BAD || endDate === BAD) return BAD;
  if (startDate && endDate && endDate < startDate) return BAD;
  return { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
}

export async function executeCreateSprint(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const name = needClean(task, "name");
    if (name === BAD) return bad(task, "name");
    const goal = patchText(task, "goal");
    if (goal === BAD) return bad(task, "goal");
    const dates = sprintDates(task);
    if (dates === BAD) return bad(task, "dates");
    if (!(await projectExists(task, projectId))) return notFound(task, "projectId");
    const row = await createSprint({ orgId: task.orgId }, projectId, { name, goal, ...dates });
    return created(row.id, "/schedule/sprints", row);
  });
}

export async function executeUpdateSprint(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const sprintId = needText(task, "sprintId");
    if (sprintId === BAD) return bad(task, "sprintId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const goal = patchText(task, "goal");
    if (goal === BAD) return bad(task, "goal");
    const dates = sprintDates(task);
    if (dates === BAD) return bad(task, "dates");
    const status = optOneOf(task, "status", SPRINT_EDIT_STATUSES);
    if (status === BAD) return bad(task, "status");
    const patch = { ...(name ? { name } : {}), ...(goal ? { goal } : {}), ...dates, ...(status ? { status } : {}) };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await sprintOfProject(task, sprintId, projectId))) return notFound(task, "sprintId");
    const row = await updateSprint({ orgId: task.orgId }, sprintId, patch);
    return created(row.id, "/schedule/sprints", row);
  });
}

export async function executeCloseSprint(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const sprintId = needText(task, "sprintId");
    if (sprintId === BAD) return bad(task, "sprintId");
    if (!(await sprintOfProject(task, sprintId, projectId))) return notFound(task, "sprintId");
    const row = await closeSprint({ orgId: task.orgId }, sprintId);
    return created(row.id, "/schedule/sprints", row);
  });
}

async function sprintAndTask(task: ExecutableTask, projectId: string): Promise<{ sprintId: string; issueId: string } | ExecutionOutcome> {
  const sprintId = needText(task, "sprintId");
  if (sprintId === BAD) return bad(task, "sprintId");
  const issueId = needText(task, "issueId");
  if (issueId === BAD) return bad(task, "issueId");
  if (!(await sprintOfProject(task, sprintId, projectId))) return notFound(task, "sprintId");
  if (!(await recordInProject(task, "issue", issueId, projectId))) return notFound(task, "issueId");
  return { sprintId, issueId };
}

export async function executeAddSprintTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const ids = await sprintAndTask(task, projectId);
    if ("success" in ids) return ids;
    const row = await addIssueToSprint({ orgId: task.orgId }, ids.sprintId, ids.issueId);
    return created(row.id, "/schedule/sprints", row);
  });
}

export async function executeRemoveSprintTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId }) => {
    const ids = await sprintAndTask(task, projectId);
    if ("success" in ids) return ids;
    const result = await removeIssueFromSprint({ orgId: task.orgId }, ids.sprintId, ids.issueId);
    return created(ids.sprintId, "/schedule/sprints", { ...result, sprintId: ids.sprintId, issueId: ids.issueId });
  });
}

// -- time entries -------------------------------------------------------------------------------------------------------------------

const TIME_MONEY = ["hourlyRateSnapshot", "invoiceItemId"] as const;

/** The entry when it is of this project and the acting person's own; otherwise the refusal. */
async function ownEntry(task: ExecutableTask, projectId: string, actorId: string): Promise<{ entryId: string; approvalStatus: string } | ExecutionOutcome> {
  const entryId = needText(task, "entryId");
  if (entryId === BAD) return bad(task, "entryId");
  const entry = await timeEntryOfProject(task, entryId, projectId);
  if (!entry) return notFound(task, "entryId");
  if (entry.userId !== actorId) return notPermitted("not_own_time_entry");
  return { entryId, approvalStatus: entry.approvalStatus };
}

export async function executeUpdateTimeEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId, actorId }) => {
    const hours = optRange(task, "hours", 0.01, 24);
    if (hours === BAD) return bad(task, "hours");
    const spentOn = optDate(task, "spentOn");
    if (spentOn === BAD) return bad(task, "spentOn");
    const activityType = patchText(task, "activityType");
    if (activityType === BAD) return bad(task, "activityType");
    const comments = patchText(task, "comments");
    if (comments === BAD) return bad(task, "comments");
    const issueId = optId(task, "issueId");
    if (issueId === BAD) return bad(task, "issueId");
    const patch = {
      ...(hours !== undefined ? { hours: String(hours) } : {}),
      ...(spentOn ? { spentOn } : {}),
      ...(activityType ? { activityType } : {}),
      ...(comments ? { comments } : {}),
      ...(issueId ? { issueId } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    const own = await ownEntry(task, projectId, actorId);
    if ("success" in own) return own;
    // a different task of the entry must also be on this project
    if (issueId && !(await recordInProject(task, "issue", issueId, projectId))) return notFound(task, "issueId");
    // updateTimeEntry() itself refuses anyone but the logging person (403) and anything but a draft or returned entry (400).
    const row = await updateTimeEntry({ orgId: task.orgId, userId: actorId }, own.entryId, patch);
    return created(row.id, "/timesheets", withholdFields(task, row, TIME_MONEY));
  });
}

export async function executeDeleteTimeEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, WRITE, async ({ projectId, actorId }) => {
    const own = await ownEntry(task, projectId, actorId);
    if ("success" in own) return own;
    // Stricter than the service: a submitted or approved entry is the manager's (or already counted as cost) and is never deleted by an AI.
    if (!(RESUBMITTABLE_STATUSES as readonly string[]).includes(own.approvalStatus)) return notPermitted("time_entry_not_draft");
    const result = await deleteTimeEntry({ orgId: task.orgId, userId: actorId }, own.entryId);
    return created(own.entryId, "/timesheets", { ...result, id: own.entryId });
  });
}
