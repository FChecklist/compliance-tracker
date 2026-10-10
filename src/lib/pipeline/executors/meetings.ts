// PROJEXA-BUILD-002 WP-05e (register row AW-305) -- the minutes-of-meeting functions the link did not have:
// update_mom_minutes, add_meeting_action_item, add_meeting_outcome and publish_mom.
//
// Each wraps the service the matching PROJEXA route calls (veri-meeting-service.ts for the minutes and their action
// items, pms-meeting-service.ts for a project meeting's outcome). No second write path.
//
// Rules, each with a test in src/lib/pipeline/coverage-wave5.test.ts:
//   - a named person acts (task.actorUserId) and needs at least the member rank; publish_mom needs the manager rank
//     (the cookie route of the same action asks for it);
//   - the meeting must be a meeting of THIS project: the services find a meeting by id and organisation only, so the id
//     is checked first (a meeting of another project reads as absent and nothing is written);
//   - an action item may only be given to a person the project names (scope.ts allPeopleOfProject): the service checks
//     the organisation only;
//   - free text (minutes, title, notes) is cleaned and held to 2,000 characters here as well as at the link, so the
//     internal pipeline and a link give the same answer;
//   - the link never runs a model (spec F-2): publish_mom locks the minutes WITHOUT the best-effort intelligence pass
//     publishVeriMeeting() would start, and add_meeting_action_item records the item WITHOUT handing its title to the task
//     execution engine (both options are off switches of the services, default on for every other caller);
//   - a published meeting cannot be edited: the service's own 409 comes back as a refusal, nothing is changed.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { users } from "@/lib/db/schema";
import { addMeetingOutcome } from "@/lib/services/pms-meeting-service";
import { addMeetingActionItem, publishVeriMeeting, updateMeetingMinutes, type VeriMeetingContext } from "@/lib/services/veri-meeting-service";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, failureFromServiceError, notPermitted, rankOf, RANK_MANAGER, RANK_MEMBER, refuse, str } from "./common";
import { allPeopleOfProject, cleanOneText, isOutcome, notFound, recordInProject, scopeOf, type ScopeRules } from "./scope";

const MOM_ROUTE = "/moms";

const AS_MEMBER: ScopeRules = { minRank: RANK_MEMBER, reason: "role_below_member", needsActor: true };
const AS_MANAGER: ScopeRules = { minRank: RANK_MANAGER, reason: "manager_rank_required", needsActor: true };

/** The acting person as an active user of the task's org: createVeriMeeting's family of services takes the row as `dbUser`. */
async function meetingContext(task: ExecutableTask, actorId: string | null): Promise<{ ctx: VeriMeetingContext } | { failure: ExecutionOutcome }> {
  if (!actorId) return { failure: notPermitted("unknown_actor") };
  const actor = await withTenantContext({ orgId: task.orgId }, (db) => db.query.users.findFirst({ where: and(eq(users.id, actorId), eq(users.orgId, task.orgId)) }));
  if (!actor || !actor.isActive) return { failure: notPermitted("unknown_actor") };
  return { ctx: { orgId: task.orgId, userId: actor.id, dbUser: actor } };
}

export async function executeUpdateMomMinutes(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const minutes = cleanOneText(task.params.minutes);
  if (!minutes.ok) return badRequest(task, "minutes_text");
  if (minutes.text === undefined) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
  const meetingId = str(task.params.meetingId)!;
  if (!(await recordInProject(task, "veri_meeting", meetingId, scope.projectId))) return notFound(task);
  const built = await meetingContext(task, scope.actorId);
  if ("failure" in built) return built.failure;
  try {
    // updateMeetingMinutes() keeps the earlier text in minutesHistory (amend, never overwrite) and refuses a published meeting with a 409.
    const row = await updateMeetingMinutes(built.ctx, meetingId, minutes.text);
    return created(row.id, `${MOM_ROUTE}/${row.id}`, row);
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeAddMeetingActionItem(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const title = cleanOneText(task.params.title);
  if (!title.ok) return badRequest(task, "title_text");
  if (title.text === undefined) return refuse(pipelineFailure("TITLE_REQUIRED", ["title"]));
  const meetingId = str(task.params.meetingId)!;
  if (!(await recordInProject(task, "veri_meeting", meetingId, scope.projectId))) return notFound(task);
  // Work may only be given to a person the project names. Without an assignee the item is the acting person's own.
  const assigneeUserId = str(task.params.assigneeUserId);
  if (assigneeUserId && !(await allPeopleOfProject(task, scope.projectId, [assigneeUserId]))) {
    return refuse(pipelineFailure("RECORD_NOT_FOUND", ["worker"], { status: 404, functionId: task.functionId, param: "assigneeUserId" }));
  }
  const built = await meetingContext(task, scope.actorId);
  if ("failure" in built) return built.failure;
  try {
    // autoExecute false: the item is recorded and nothing hands its title to the task execution engine, which can run a model.
    const row = await addMeetingActionItem(built.ctx, meetingId, { title: title.text, assigneeUserId, dueDate: str(task.params.dueDate) }, { autoExecute: false });
    return created(row.id, `${MOM_ROUTE}/${meetingId}`, row);
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executeAddMeetingOutcome(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MEMBER);
  if (isOutcome(scope)) return scope;
  const notes = cleanOneText(task.params.notes);
  if (!notes.ok) return badRequest(task, "notes_text");
  if (notes.text === undefined) return refuse(pipelineFailure("VALUE_REQUIRED", ["value"]));
  const meetingId = str(task.params.meetingId)!;
  // The outcome belongs to a project meeting (pms_meetings), the kind create_meeting makes.
  if (!(await recordInProject(task, "pms_meeting", meetingId, scope.projectId))) return notFound(task);
  try {
    const row = await addMeetingOutcome({ orgId: task.orgId }, meetingId, notes.text);
    return created(row.id, `/meetings/${meetingId}`, row);
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}

export async function executePublishMom(task: ExecutableTask): Promise<ExecutionOutcome> {
  const scope = scopeOf(task, AS_MANAGER);
  if (isOutcome(scope)) return scope;
  const meetingId = str(task.params.meetingId)!;
  if (!(await recordInProject(task, "veri_meeting", meetingId, scope.projectId))) return notFound(task);
  const built = await meetingContext(task, scope.actorId);
  if ("failure" in built) return built.failure;
  // The person's own row decides as well as task.role: publishing locks the record, it is not a read.
  if (rankOf(built.ctx.dbUser?.role) < RANK_MANAGER) return notPermitted("manager_rank_required");
  try {
    // generateIntelligence false: the minutes are locked and no model runs (the link never runs one).
    const row = await publishVeriMeeting(built.ctx, meetingId, { generateIntelligence: false });
    return created(row.id, `${MOM_ROUTE}/${row.id}`, row);
  } catch (error) {
    const refused = failureFromServiceError(task, error);
    if (refused) return refused;
    throw error;
  }
}
