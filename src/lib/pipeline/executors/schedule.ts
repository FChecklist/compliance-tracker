// PROJEXA-BUILD-002 WP-05f (register row AW-306) -- the schedule functions the link did not have:
// get_gantt_schedule, compare_schedule_baseline, capture_schedule_baseline and update_task.
//
// Each wraps the service the matching PROJEXA route calls (schedule-service.ts getGanttData, compareBaseline,
// captureBaseline; pms-issue-service.ts updateIssue). No second write path.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave6.test.ts:
//   - the two reads need the member rank (the link's floor for project data) and no person; the two writes need a named
//     person (task.actorUserId). capture_schedule_baseline needs the manager rank: it freezes the plan of record, and
//     the person confirms it signed in (link level 2). The route of the same action asks for the member rank; the link
//     asks for more, never less;
//   - a baseline or a task must be of THIS project: the services find them by id and organisation only, so the id is
//     checked first (another project's record reads as absent, nothing is read or written);
//   - update_task changes only the keys it lists (title, description, status, priority, dates, completion, assignees,
//     milestone). It never takes position, archive, assignedById or labels. A status must be a status of the organisation
//     (the service checks), a milestone one of this project's, and an assignee a person the project names;
//   - a task linked to a BOQ line takes its completion from the site's progress entries, so a typed completion is
//     refused there (the Timeline does not let a person edit those bars either);
//   - free text (title, description, baseline name) is cleaned and held to 2,000 characters here as well as at the link.
import { eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { pmsIssueBoqLinks, pmsIssuePriorityEnum } from "@/lib/db/schema";
import { captureBaseline, compareBaseline, getGanttData } from "@/lib/services/schedule-service";
import { updateIssue, type IssuePatch } from "@/lib/services/pms-issue-service";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, failureFromServiceError, num, RANK_MANAGER, RANK_MEMBER, refuse, str } from "./common";
import { allPeopleOfProject, cleanOneText, isCalendarDay, isOutcome, notFound, projectInOrg, recordInProject, scopeOf, type ScopeRules } from "./scope";

const READ_AS_MEMBER: ScopeRules = { minRank: RANK_MEMBER, reason: "role_below_member", needsActor: false };
const WRITE_AS_MEMBER: ScopeRules = { minRank: RANK_MEMBER, reason: "role_below_member", needsActor: true };
const WRITE_AS_MANAGER: ScopeRules = { minRank: RANK_MANAGER, reason: "manager_rank_required", needsActor: true };

const ok = (result: unknown): ExecutionOutcome => ({ success: true, result });

export async function executeGetGanttSchedule(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, READ_AS_MEMBER);
  if (isOutcome(scope)) return scope;
  if (!(await projectInOrg(task, scope.projectId))) return notFound(task);
  try {
    return ok(await getGanttData({ orgId: task.orgId }, scope.projectId));
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeCompareScheduleBaseline(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, READ_AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const baselineId = str(task.params.baselineId)!;
  if (!(await recordInProject(task, "baseline", baselineId, scope.projectId))) return notFound(task);
  try {
    return ok(await compareBaseline({ orgId: task.orgId }, baselineId));
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeCaptureScheduleBaseline(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, WRITE_AS_MANAGER);
  if (isOutcome(scope)) return scope;
  const name = cleanOneText(task.params.name);
  if (!name.ok) return badRequest(task, "name_text");
  if (name.text === undefined) return refuse(pipelineFailure("TITLE_REQUIRED", ["name"]));
  // captureBaseline() reads the project's tasks and does not look the project up.
  if (!(await projectInOrg(task, scope.projectId))) return notFound(task);
  try {
    const row = await captureBaseline({ orgId: task.orgId, userId: scope.actorId! }, scope.projectId, name.text);
    return created(row.id, "/schedule/baselines", row);
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

const PRIORITIES: readonly string[] = pmsIssuePriorityEnum.enumValues;
const MAX_ASSIGNEES = 25;

/** What one group of keys of update_task's patch came to: the keys it read, or the refusal. */
type PatchResult = { patch: IssuePatch } | { refused: ExecutionOutcome };
const refusedWith = (outcome: ExecutionOutcome): PatchResult => ({ refused: outcome });

/** A date the patch names: a real YYYY-MM-DD day, or null to clear it. `undefined` = not named. */
function dateKey(value: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || !isCalendarDay(value.trim())) return { ok: false };
  return { ok: true, value: value.trim() };
}

/** title and description: cleaned, capped, a title never empty; an empty description clears it. */
function textKeys(task: ExecutableTask): PatchResult {
  const patch: IssuePatch = {};
  if (task.params.title !== undefined) {
    const title = cleanOneText(task.params.title);
    if (!title.ok) return refusedWith(badRequest(task, "title_text"));
    if (title.text === undefined) return refusedWith(refuse(pipelineFailure("TITLE_REQUIRED", ["title"])));
    patch.title = title.text;
  }
  if (task.params.description !== undefined) {
    const description = cleanOneText(task.params.description);
    if (!description.ok) return refusedWith(badRequest(task, "description_text"));
    patch.description = description.text ?? null;
  }
  return { patch };
}

/** status, priority and milestone: the shapes only; the records they name are checked against the project afterwards. */
function choiceKeys(task: ExecutableTask): PatchResult {
  const p = task.params;
  const patch: IssuePatch = {};
  if (p.statusId !== undefined) {
    const statusId = str(p.statusId);
    if (!statusId) return refusedWith(badRequest(task, "statusId"));
    patch.statusId = statusId;
  }
  if (p.priority !== undefined) {
    const priority = str(p.priority);
    if (!priority || !PRIORITIES.includes(priority)) return refusedWith(badRequest(task, "priority"));
    patch.priority = priority;
  }
  if (p.milestoneId === null) patch.milestoneId = null;
  else if (p.milestoneId !== undefined) {
    const milestoneId = str(p.milestoneId);
    if (!milestoneId) return refusedWith(badRequest(task, "milestoneId"));
    patch.milestoneId = milestoneId;
  }
  return { patch };
}

/** start and due date, each a real day or null, the start not after the due date. */
function dateKeys(task: ExecutableTask): PatchResult {
  const start = dateKey(task.params.startDate);
  const due = dateKey(task.params.dueDate);
  if (!start.ok || !due.ok) return refusedWith(refuse(pipelineFailure("DATE_REQUIRED", ["date"])));
  if (typeof start.value === "string" && typeof due.value === "string" && start.value > due.value) {
    return refusedWith(refuse(pipelineFailure("VALUE_OUT_OF_RANGE", ["date"])));
  }
  const patch: IssuePatch = {};
  if (start.value !== undefined) patch.startDate = start.value;
  if (due.value !== undefined) patch.dueDate = due.value;
  return { patch };
}

/** completion (0 to 100) and the people (a short list of distinct ids). */
function measureKeys(task: ExecutableTask): PatchResult {
  const p = task.params;
  const patch: IssuePatch = {};
  if (p.completionPercentage !== undefined) {
    const percent = num(p.completionPercentage);
    if (percent === undefined || percent < 0 || percent > 100) return refusedWith(refuse(pipelineFailure("VALUE_OUT_OF_RANGE", ["value"])));
    patch.completionPercentage = percent;
  }
  if (p.assigneeIds !== undefined) {
    const ids = p.assigneeIds;
    if (!Array.isArray(ids) || ids.length > MAX_ASSIGNEES || ids.some((id) => typeof id !== "string" || id.trim() === "")) return refusedWith(badRequest(task, "assigneeIds"));
    patch.assigneeIds = [...new Set((ids as string[]).map((id) => id.trim()))];
  }
  return { patch };
}

/** The whole patch: only the listed keys, each checked. An empty patch is a refusal (nothing to change). */
function buildPatch(task: ExecutableTask): PatchResult {
  const patch: IssuePatch = {};
  for (const group of [textKeys, choiceKeys, dateKeys, measureKeys]) {
    const part = group(task);
    if ("refused" in part) return part;
    Object.assign(patch, part.patch);
  }
  if (Object.keys(patch).length === 0) return refusedWith(refuse(pipelineFailure("VALUE_REQUIRED", ["value"])));
  return { patch };
}

/** The records the patch names must be this project's, and a typed completion is refused where the site's entries decide it. Null = all fine. */
async function checkNamedRecords(task: ExecutableTask, projectId: string, issueId: string, patch: IssuePatch): Promise<ExecutionOutcome | null> {
  if (!(await recordInProject(task, "issue", issueId, projectId))) return notFound(task);
  if (typeof patch.milestoneId === "string" && !(await recordInProject(task, "milestone", patch.milestoneId, projectId))) {
    return refuse(pipelineFailure("RECORD_NOT_FOUND", ["value"], { status: 404, functionId: task.functionId, param: "milestoneId" }));
  }
  if (patch.assigneeIds && !(await allPeopleOfProject(task, projectId, patch.assigneeIds))) {
    return refuse(pipelineFailure("RECORD_NOT_FOUND", ["worker"], { status: 404, functionId: task.functionId, param: "assigneeIds" }));
  }
  if (patch.completionPercentage !== undefined) {
    const derived = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
      db.query.pmsIssueBoqLinks.findFirst({ where: eq(pmsIssueBoqLinks.issueId, issueId), columns: { id: true } })
    );
    if (derived) return badRequest(task, "progress_is_derived");
  }
  return null;
}

export async function executeUpdateTask(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, WRITE_AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const issueId = str(task.params.issueId)!;
  const built = buildPatch(task);
  if ("refused" in built) return built.refused;
  // Nothing is written before every record the patch names has been checked.
  const refused = await checkNamedRecords(task, scope.projectId, issueId, built.patch);
  if (refused) return refused;
  try {
    const row = await updateIssue({ orgId: task.orgId, userId: scope.actorId!, dbUser: null }, issueId, built.patch);
    return created(String(row.id), "/schedule", row);
  } catch (error) {
    const failed = failureFromServiceError(task, error);
    if (failed) return failed;
    throw error;
  }
}
