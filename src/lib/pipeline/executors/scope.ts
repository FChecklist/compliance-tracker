// PROJEXA-BUILD-002 WP-05e/05f -- the same-project checks the wave 5 and 6 executors share.
//
// Most services these executors wrap find a record by id and organisation only (GAP_A section 7.6): a meeting, a
// baseline, a time entry, a progress entry, a task. An AI work link is bound to ONE project, so an id that names a
// record of another project of the same organisation must read as absent and nothing may be written (spec 9.10).
// Each check here is its own short transaction, run BEFORE the service opens its own (D-06: never nested).
//
// A record that does not exist and a record of another project give the same answer, so the check cannot be used to
// find out whether an id exists elsewhere.
//
// It also holds the people rule (GAP_A section 7.5): a task or action item may only be given to a person the project
// already names (its lead, its team, the people on its tasks). assertAssigneesInOrg() of the meeting service checks the
// organisation only, which would let a link assign work to anyone in the company.
//
// And the list rule for free text: the link caps a string parameter at 2,000 characters (spec 9.11), but a list of
// strings (attendees, agenda) is not a string, so its items are cleaned and capped here.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import {
  constructionBoqs,
  erpBudgets,
  erpCostCenters,
  MEETING_DELETED_STATUS,
  pmsIssues,
  pmsMeetings,
  pmsMilestones,
  pmsScheduleBaselines,
  projectTeamMembers,
  projects,
  veriMeetings,
} from "@/lib/db/schema";
import { cleanLinkText, AI_LINK_TEXT_MAX } from "../ai-link-text";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { pipelineFailure } from "../error-codes";
import { missingRequiredParam, notPermitted, pickProject, rankOf, refuse, unidentifiedActor } from "./common";

export type ProjectRecordKind =
  | "veri_meeting"
  | "pms_meeting"
  | "issue"
  | "baseline"
  | "milestone"
  | "budget"
  | "boq";

/**
 * True when the record exists AND belongs to this project of this organisation.
 * A budget belongs to a project through its cost centre (erp_cost_centers.project_id); one with no cost centre is the
 * organisation's and is not any project's.
 */
export async function recordInProject(task: ExecutableTask, kind: ProjectRecordKind, id: string, projectId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    switch (kind) {
      case "veri_meeting": {
        const row = await db.query.veriMeetings.findFirst({
          where: and(eq(veriMeetings.id, id), eq(veriMeetings.orgId, task.orgId)),
          columns: { contextEntityType: true, contextEntityId: true, status: true },
        });
        return row !== undefined && row.status !== MEETING_DELETED_STATUS && row.contextEntityType === "project" && row.contextEntityId === projectId;
      }
      case "pms_meeting": {
        const row = await db.query.pmsMeetings.findFirst({ where: and(eq(pmsMeetings.id, id), eq(pmsMeetings.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "issue": {
        const row = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, id), eq(pmsIssues.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "baseline": {
        const row = await db.query.pmsScheduleBaselines.findFirst({ where: and(eq(pmsScheduleBaselines.id, id), eq(pmsScheduleBaselines.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "milestone": {
        const row = await db.query.pmsMilestones.findFirst({ where: and(eq(pmsMilestones.id, id), eq(pmsMilestones.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "budget": {
        const budget = await db.query.erpBudgets.findFirst({ where: and(eq(erpBudgets.id, id), eq(erpBudgets.orgId, task.orgId)), columns: { costCenterId: true } });
        if (!budget?.costCenterId) return false;
        const centre = await db.query.erpCostCenters.findFirst({ where: and(eq(erpCostCenters.id, budget.costCenterId), eq(erpCostCenters.orgId, task.orgId)), columns: { projectId: true } });
        return centre?.projectId === projectId;
      }
      case "boq": {
        const row = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, id), eq(constructionBoqs.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
    }
  });
}

/**
 * The ids of the people this project names: its lead, its team members and the assignees and authors of its tasks
 * (the set the `people` record kind lists, ai_work_link__project_people), and the acting person, who may always give work to
 * themselves (a link's person can read the project, and an action item with no assignee is the acting person's own anyway).
 * Read in one transaction.
 */
export async function projectPersonIds(task: ExecutableTask, projectId: string): Promise<Set<string>> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const ids = new Set<string>();
    if (task.actorUserId) ids.add(task.actorUserId);
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { leadUserId: true } });
    if (project?.leadUserId) ids.add(project.leadUserId);
    const team = await db.query.projectTeamMembers.findMany({
      where: and(eq(projectTeamMembers.projectId, projectId), eq(projectTeamMembers.orgId, task.orgId)),
      columns: { userId: true },
    });
    for (const m of team) ids.add(m.userId);
    const issues = await db.query.pmsIssues.findMany({
      where: and(eq(pmsIssues.projectId, projectId), eq(pmsIssues.orgId, task.orgId)),
      columns: { assigneeId: true, createdById: true },
    });
    for (const i of issues) {
      if (i.assigneeId) ids.add(i.assigneeId);
      if (i.createdById) ids.add(i.createdById);
    }
    return ids;
  });
}

/** True when every id in `wanted` is a person of this project (an empty list is). */
export async function allPeopleOfProject(task: ExecutableTask, projectId: string, wanted: readonly string[]): Promise<boolean> {
  if (wanted.length === 0) return true;
  const people = await projectPersonIds(task, projectId);
  return wanted.every((id) => people.has(id));
}

export const MAX_TEXT_LIST_ITEMS = 50;

export type CleanTextList = { ok: true; items: string[] } | { ok: false; reason: "too_many" | "text_too_long" | "not_text" };

/**
 * A string or a list of strings as a cleaned list: control characters out, backtick runs neutralised (ai-link-text.ts), each
 * item at most 2,000 characters, at most 50 items, empty items dropped. Longer text is refused, never cut short. Absent is an
 * empty list. A value that is neither a string nor a list of strings is refused.
 */
export function cleanTextList(value: unknown): CleanTextList {
  if (value === undefined || value === null) return { ok: true, items: [] };
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length > MAX_TEXT_LIST_ITEMS) return { ok: false, reason: "too_many" };
  const items: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return { ok: false, reason: "not_text" };
    if (entry.trim().length === 0) continue;
    const cleaned = cleanLinkText(entry.trim());
    if (!cleaned.ok) return { ok: false, reason: "text_too_long" };
    if (cleaned.text.trim().length > 0) items.push(cleaned.text.trim());
  }
  return { ok: true, items };
}

/** One free-text value, cleaned and capped like a list item. Absent or blank is undefined; text over the cap is refused. */
export function cleanOneText(value: unknown): { ok: true; text: string | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, text: undefined };
  if (typeof value !== "string") return { ok: false };
  if (value.trim().length === 0) return { ok: true, text: undefined };
  const cleaned = cleanLinkText(value.trim());
  if (!cleaned.ok) return { ok: false };
  const text = cleaned.text.trim();
  return { ok: true, text: text.length > 0 ? text : undefined };
}

/** True for an absolute https URL: the only kind of link a drawing or a document may store from a task (it is never fetched). */
export function isHttpsUrl(value: string): boolean {
  if (value.length > AI_LINK_TEXT_MAX) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * An executor that first asks for a minimum rank of the person (task.role, ROLE_RANK). An absent or unknown role has rank 0 and is
 * refused: an unknown role is never treated as allowed. The link filters its function list by the same rank; this is the same floor
 * held again where the write happens, so the internal pipeline cannot do what a link of that person could not.
 */
export function withMinRank(
  minRank: number,
  reason: string,
  executor: (task: ExecutableTask) => Promise<ExecutionOutcome>
): (task: ExecutableTask) => Promise<ExecutionOutcome> {
  return async (task) => (rankOf(task.role) < minRank ? notPermitted(reason) : executor(task));
}

/** True when the project exists in the task's organisation. Its own short transaction, closed before a service opens one (D-06). */
export async function projectInOrg(task: ExecutableTask, projectId: string): Promise<boolean> {
  const found = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { id: true } })
  );
  return found !== undefined;
}

/** True for a YYYY-MM-DD string that names a real calendar day: it must read back unchanged, so "2026-02-30" and "2026-9-22" are not one. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export type Scope = { projectId: string; actorId: string | null };

export type ScopeRules = {
  /** The lowest rank (ROLE_RANK) of task.role that may call. An absent or unknown role has rank 0. */
  minRank: number;
  /** The reason word given when the rank is too low. */
  reason: string;
  /** True for a write: a named person (task.actorUserId) is required. */
  needsActor: boolean;
  /** True for a function whose answer or refusals state money: the rank is judged before anything else is read or named. */
  rankFirst?: boolean;
};

/** True for the outcome branch of scopeOf()'s answer. */
export const isOutcome = (v: Scope | ExecutionOutcome): v is ExecutionOutcome => "success" in v;

/** A record that is absent, or that belongs to another project, reads the same way. */
export const notFound = (task: ExecutableTask): ExecutionOutcome => refuse(pipelineFailure("RECORD_NOT_FOUND", [], { status: 404, functionId: task.functionId }));

/**
 * The parts every call of the wave 5 and 6 executors needs, in the order a caller can fix them: (rank, for a money function),
 * the registry's required parameters, the project (the task's own; a params.projectId naming another is refused), the person, the rank.
 */
export function scopeOf(task: ExecutableTask, rules: ScopeRules): Scope | ExecutionOutcome {
  if (rules.rankFirst && rankOf(task.role) < rules.minRank) return notPermitted(rules.reason);
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (rules.needsActor && !task.actorUserId) return unidentifiedActor();
  if (rankOf(task.role) < rules.minRank) return notPermitted(rules.reason);
  return { projectId: pick.projectId, actorId: task.actorUserId ?? null };
}
