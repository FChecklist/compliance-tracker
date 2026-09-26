// PROJEXA-BUILD-002 WP-05c/WP-05d -- what the wave 3 and wave 4 executors share: the run order every one of them follows, the
// same-project rule for an id parameter (spec 9.10), the parameter readers, and the money rule for a result.
//
// Every executor of the two waves runs its checks in the same order, so a caller sees the same refusal for the same fault whichever
// function it called:
//   1. the registry's own required parameters (a missing one is a code and the field it names);
//   2. the task's project: a params.projectId that names another project is refused, not dropped;
//   3. for a write, the acting person (task.actorUserId): a task that names no person is refused before anything is read or written;
//   4. the role's rank against the function's minimum. The link and the pill both check it; this is the check that holds when the
//      executor is reached some other way. An absent or unknown role has rank 0 and is refused.
//   5. the executor's own parameter checks, then the id checks, then the one service call.
// The services these executors wrap find a record by id and organisation only (GAP_A 7.6), so every id parameter is looked up here on
// the task's own project first: a record of another project, or one that does not exist, reads as absent (RECORD_NOT_FOUND) and
// nothing is written. Each lookup is its own short transaction, closed before the service opens its own (D-06 forbids nesting).
import { and, eq, inArray } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import {
  constructionActivities,
  constructionBoqLineItems,
  constructionBoqs,
  constructionCategories,
  constructionLabourRoster,
  constructionMaterialReceipts,
  constructionMaterials,
  constructionPunchListItems,
  constructionRfis,
  constructionSubmittals,
  constructionWorkProgressEntries,
  projectTeamMembers,
  projects,
} from "@/lib/db/schema";
import { pipelineFailure } from "../error-codes";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, missingRequiredParam, notPermitted, pickProject, rankOf, RANK_MANAGER, refuse, str, unidentifiedActor } from "./common";

export type Scope = { projectId: string; actorId: string };

/** The run order above, then `run`. `write` functions need a person; `minRank` is the function's minimum role rank (2 member, 3 manager). */
export async function guarded(
  task: ExecutableTask,
  options: { write: boolean; minRank: number },
  run: (scope: Scope) => Promise<ExecutionOutcome>
): Promise<ExecutionOutcome> {
  const missing = missingRequiredParam(task);
  if (missing) return refuse(missing);
  const pick = pickProject(task);
  if ("failure" in pick) return refuse(pick.failure);
  if (!pick.projectId) return refuse(pipelineFailure("PROJECT_REQUIRED", ["projectId"]));
  if (options.write && !task.actorUserId) return unidentifiedActor();
  if (rankOf(task.role) < options.minRank) return notPermitted(`role_below_rank_${options.minRank}`);
  return run({ projectId: pick.projectId, actorId: task.actorUserId ?? "" });
}

/** A read's answer. */
export function ok(result: unknown): ExecutionOutcome {
  return { success: true, result };
}

/** A record that is absent, or that belongs to another project, reads the same way. `param` names the id that did not resolve. */
export function notFound(task: ExecutableTask, param?: string): ExecutionOutcome {
  return refuse(pipelineFailure("RECORD_NOT_FOUND", [], { status: 404, functionId: task.functionId, ...(param ? { param } : {}) }));
}

// -- parameters ---------------------------------------------------------------------------------------------------------------

/** Returned by a reader when a value was given but is the wrong type or shape: the caller answers with badRequest(). */
export const BAD = Symbol("bad parameter");
export type Bad = typeof BAD;

/** A required text: given and non-blank, else BAD. (The registry check has already refused a blank one; this refuses a non-string.) */
export function needText(task: ExecutableTask, key: string): string | Bad {
  return str(task.params[key]) ?? BAD;
}

/** An optional text: absent is undefined, a string is trimmed (blank is undefined), anything else is BAD. */
export function optText(task: ExecutableTask, key: string): string | undefined | Bad {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? str(v) : BAD;
}

/** True for a real calendar day written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

export function needDate(task: ExecutableTask, key: string): string | Bad {
  const v = str(task.params[key]);
  return v !== undefined && isIsoDate(v) ? v : BAD;
}

export function optDate(task: ExecutableTask, key: string): string | undefined | Bad {
  const v = optText(task, key);
  return v === undefined || v === BAD ? v : isIsoDate(v) ? v : BAD;
}

/** An optional value from a closed list. */
export function optOneOf(task: ExecutableTask, key: string, allowed: readonly string[]): string | undefined | Bad {
  const v = optText(task, key);
  return v === undefined || v === BAD ? v : allowed.includes(v) ? v : BAD;
}

/** An optional finite number of at least `min` (a number, or a string that is one). */
export function optNumber(task: ExecutableTask, key: string, min = 0): number | undefined | Bad {
  const v = task.params[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min ? n : BAD;
}

export const bad = (task: ExecutableTask, key: string): ExecutionOutcome => badRequest(task, `${key}_type`);

// -- the same-project rule ------------------------------------------------------------------------------------------------------

export type ScopedRecord = "rfi" | "activity" | "submittal" | "punch_item" | "progress_entry" | "roster" | "material" | "material_receipt" | "category";

// Every table below has the same three columns (id, org_id, project_id), so one lookup serves all of them. The cast to one table's
// type is only for the compiler: the query is built from the table that was asked for.
const TABLES: Record<ScopedRecord, unknown> = {
  rfi: constructionRfis,
  activity: constructionActivities,
  submittal: constructionSubmittals,
  punch_item: constructionPunchListItems,
  progress_entry: constructionWorkProgressEntries,
  roster: constructionLabourRoster,
  material: constructionMaterials,
  material_receipt: constructionMaterialReceipts,
  category: constructionCategories,
};

/** True when the record exists on THIS project of the task's organisation. Absent, or on another project, is false. */
export async function recordInProject(task: ExecutableTask, kind: ScopedRecord, id: string, projectId: string): Promise<boolean> {
  const table = TABLES[kind] as typeof constructionRfis;
  const rows = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.select({ projectId: table.projectId }).from(table).where(and(eq(table.id, id), eq(table.orgId, task.orgId)))
  );
  return rows.length > 0 && rows[0].projectId === projectId;
}

/** True when the project exists in the task's organisation. createRfi(), createSubmittal(), createPunchListItem() and createMaterial() never look it up. */
export async function projectExists(task: ExecutableTask, projectId: string): Promise<boolean> {
  const found = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { id: true } })
  );
  return found !== undefined;
}

/** True when the BOQ line exists and its BOQ is one of this project's. A line that is on another project, or nowhere, is false. */
export async function boqLineInProject(task: ExecutableTask, lineId: string, projectId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const line = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.id, lineId), columns: { boqId: true } });
    if (!line) return false;
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.id, line.boqId), eq(constructionBoqs.orgId, task.orgId)),
      columns: { projectId: true },
    });
    return boq?.projectId === projectId;
  });
}

/**
 * True when the person is one of the project's people: its lead or a member of its team, or the acting person. An RFI or a punch list
 * item is assigned to a person of the project, never to any user of the organisation.
 */
export async function isProjectPerson(task: ExecutableTask, projectId: string, userId: string): Promise<boolean> {
  if (task.actorUserId && userId === task.actorUserId) return true;
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { leadUserId: true } });
    if (!project) return false;
    if (project.leadUserId === userId) return true;
    const member = await db.query.projectTeamMembers.findFirst({
      where: and(eq(projectTeamMembers.orgId, task.orgId), eq(projectTeamMembers.projectId, projectId), eq(projectTeamMembers.userId, userId)),
      columns: { id: true },
    });
    return member !== undefined;
  });
}

/** The roster rows of this project among `ids`. */
export async function rosterInProject(task: ExecutableTask, ids: readonly string[], projectId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.constructionLabourRoster.findMany({
      where: and(eq(constructionLabourRoster.orgId, task.orgId), eq(constructionLabourRoster.projectId, projectId), inArray(constructionLabourRoster.id, [...ids])),
      columns: { id: true },
    })
  );
  return new Set(rows.map((r) => r.id));
}

// -- money ----------------------------------------------------------------------------------------------------------------------

function nullFields(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => nullFields(item, fields));
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fields.has(key) ? null : nullFields(inner, fields)]));
  }
  return value;
}

/**
 * The money rule for one result (U-01): a manager's result is returned as it is; below the manager rank, or with no known role, every
 * field named in `fields` is null at any depth and the result says so with `financialsRedacted: true`.
 */
export function withholdFields(task: ExecutableTask, result: object, fields: readonly string[]): object {
  if (rankOf(task.role) >= RANK_MANAGER) return result;
  return { ...(nullFields(result, new Set(fields)) as object), financialsRedacted: true };
}
