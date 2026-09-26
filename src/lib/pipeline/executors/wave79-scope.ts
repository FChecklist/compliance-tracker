// PROJEXA-BUILD-002 WP-05g and WP-05h (register rows AW-307, AW-308) -- the same-project checks and parameter readers the wave 7, 8 and 9
// executors share (claims.ts, approvals.ts, documents-wiki.ts, interior.ts).
//
// Every service these executors wrap finds a record by id and organisation only (GAP_A section 7.6): a claim, a KPI entry, a change order,
// a wiki page, a mood board, an FF&E item, a floor plan. An AI work link is bound to ONE project, so an id that names a record of another
// project of the same organisation, or of no record at all, must read as absent and nothing may be written (spec 9.10). Each check here is
// its own short transaction, run BEFORE the service opens its own (D-06: never nested). A record that does not exist and a record of another
// project give the same answer, so the check cannot be used to find out whether an id exists elsewhere.
//
// A customer is an organisation record, not a project record, so a claim may only be billed to one the PROJECT already names: the customer
// linked to the project's client, or the customer of an earlier claim on the same project (customerOfProject).
//
// Free text is cleaned and held to the link's 2,000-character cap here as well (ai-link-text.ts), so the internal pipeline and a link give
// the same answer; an item of a list (a signer's name) gets the same rule as a lone string.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import {
  constructionChangeOrders,
  constructionKpiDefinitions,
  constructionKpiEntries,
  constructionProgressClaims,
  documents,
  erpCustomers,
  interiorFfeItems,
  interiorFloorPlanRooms,
  interiorFloorPlans,
  interiorMoodBoards,
  pmsWikiPages,
  projects,
  users,
} from "@/lib/db/schema";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { notPermitted, str } from "./common";
import { cleanOneText } from "./scope";
import { BAD, type Bad } from "./record-scope";

export type Wave79Record = "claim" | "change_order" | "wiki_page" | "mood_board" | "ffe_item" | "floor_plan" | "kpi_definition" | "kpi_entry" | "document";

/**
 * True when the record exists on THIS project of the task's organisation. Absent, or on another project, is false.
 *   kpi_definition   the definition's own project; an organisation-wide KPI (no project) is no project's;
 *   kpi_entry        an entry has no project column: it belongs to the project of its definition;
 *   document         a document is a project's when it is linked to the project (linkedEntityType "project", the way permits and
 *                    create_document write it) or names it in its metadata (the way a drawing does);
 *   wiki_page        a page that has been archived reads as absent, as it does on the wiki screen.
 */
export async function recordOfProject(task: ExecutableTask, kind: Wave79Record, id: string, projectId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    switch (kind) {
      case "claim": {
        const row = await db.query.constructionProgressClaims.findFirst({ where: and(eq(constructionProgressClaims.id, id), eq(constructionProgressClaims.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "change_order": {
        const row = await db.query.constructionChangeOrders.findFirst({ where: and(eq(constructionChangeOrders.id, id), eq(constructionChangeOrders.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "wiki_page": {
        const row = await db.query.pmsWikiPages.findFirst({ where: and(eq(pmsWikiPages.id, id), eq(pmsWikiPages.orgId, task.orgId)), columns: { projectId: true, isArchived: true } });
        return row !== undefined && row.projectId === projectId && row.isArchived !== true;
      }
      case "mood_board": {
        const row = await db.query.interiorMoodBoards.findFirst({ where: and(eq(interiorMoodBoards.id, id), eq(interiorMoodBoards.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "ffe_item": {
        const row = await db.query.interiorFfeItems.findFirst({ where: and(eq(interiorFfeItems.id, id), eq(interiorFfeItems.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "floor_plan": {
        const row = await db.query.interiorFloorPlans.findFirst({ where: and(eq(interiorFloorPlans.id, id), eq(interiorFloorPlans.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "kpi_definition": {
        const row = await db.query.constructionKpiDefinitions.findFirst({ where: and(eq(constructionKpiDefinitions.id, id), eq(constructionKpiDefinitions.orgId, task.orgId)), columns: { projectId: true } });
        return row?.projectId === projectId;
      }
      case "kpi_entry": {
        const entry = await db.query.constructionKpiEntries.findFirst({ where: eq(constructionKpiEntries.id, id), columns: { kpiDefinitionId: true } });
        if (!entry) return false;
        const definition = await db.query.constructionKpiDefinitions.findFirst({ where: and(eq(constructionKpiDefinitions.id, entry.kpiDefinitionId), eq(constructionKpiDefinitions.orgId, task.orgId)), columns: { projectId: true } });
        return definition?.projectId === projectId;
      }
      case "document": {
        const row = await db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.orgId, task.orgId)), columns: { linkedEntityType: true, linkedEntityId: true, metadata: true } });
        if (!row) return false;
        const meta = (row.metadata ?? {}) as { projectId?: unknown };
        return (row.linkedEntityType === "project" && row.linkedEntityId === projectId) || meta.projectId === projectId;
      }
    }
  });
}

/** True when the room is a room of THIS floor plan (the service adds a placement to any room id it is given). */
export async function roomOfFloorPlan(task: ExecutableTask, roomId: string, floorPlanId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const row = await db.query.interiorFloorPlanRooms.findFirst({ where: and(eq(interiorFloorPlanRooms.id, roomId), eq(interiorFloorPlanRooms.floorPlanId, floorPlanId)), columns: { id: true } });
    return row !== undefined;
  });
}

/**
 * True when the customer is one this project bills: an active customer of the organisation that is linked to the project's client, or the
 * customer of a claim already on this project. Any other customer of the organisation reads as absent.
 */
export async function customerOfProject(task: ExecutableTask, projectId: string, customerId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const customer = await db.query.erpCustomers.findFirst({ where: and(eq(erpCustomers.id, customerId), eq(erpCustomers.orgId, task.orgId)), columns: { clientId: true, isActive: true } });
    if (!customer || customer.isActive === false) return false;
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, task.orgId)), columns: { clientId: true } });
    if (project?.clientId && customer.clientId === project.clientId) return true;
    const earlier = await db.query.constructionProgressClaims.findFirst({
      where: and(eq(constructionProgressClaims.orgId, task.orgId), eq(constructionProgressClaims.projectId, projectId), eq(constructionProgressClaims.customerId, customerId)),
      columns: { id: true },
    });
    return earlier !== undefined;
  });
}

/** The acting person as an active user of the task's organisation (a service that wants the user row as `dbUser`), or the refusal. */
export async function loadActor(task: ExecutableTask, actorId: string | null): Promise<{ actor: typeof users.$inferSelect } | { failure: ExecutionOutcome }> {
  if (!actorId) return { failure: notPermitted("unknown_actor") };
  const actor = await withTenantContext({ orgId: task.orgId }, (db) => db.query.users.findFirst({ where: and(eq(users.id, actorId), eq(users.orgId, task.orgId)) }));
  if (!actor || !actor.isActive) return { failure: notPermitted("unknown_actor") };
  return { actor };
}

// -- parameter readers (the BAD convention of record-scope.ts) ---------------------------------------------------------------------

/** A required free text: given, non-blank after cleaning and at most 2,000 characters, else BAD. */
export function needClean(task: ExecutableTask, key: string): string | Bad {
  const cleaned = cleanOneText(task.params[key]);
  return cleaned.ok && cleaned.text !== undefined ? cleaned.text : BAD;
}

/** An optional free text: absent or blank is undefined; a value that is not text, or over the cap, is BAD. */
export function optClean(task: ExecutableTask, key: string): string | undefined | Bad {
  const cleaned = cleanOneText(task.params[key]);
  return cleaned.ok ? cleaned.text : BAD;
}

/** True when the parameter was given at all (not absent, null or blank): an optional patch field the caller meant to set. */
export function given(task: ExecutableTask, key: string): boolean {
  const v = task.params[key];
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
}

/** An optional finite number within [min, max]: absent is undefined, anything else out of range or not a number is BAD. */
export function optRange(task: ExecutableTask, key: string, min: number, max: number): number | undefined | Bad {
  const v = task.params[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : BAD;
}

/** An optional whole number within [min, max]. */
export function optWhole(task: ExecutableTask, key: string, min: number, max: number): number | undefined | Bad {
  const n = optRange(task, key, min, max);
  return n === undefined || n === BAD ? n : Number.isInteger(n) ? n : BAD;
}

/**
 * A list parameter (signers, polygon points): an array, or a string that holds a JSON array (a link's GET /propose carries every value as a
 * string). Absent is undefined; anything else, and an array over `max` items, is BAD.
 */
export function listParam(task: ExecutableTask, key: string, max: number): unknown[] | undefined | Bad {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      return BAD;
    }
  }
  return Array.isArray(list) && list.length <= max ? list : BAD;
}

/** An optional id: absent is undefined, a non-string is BAD. */
export function optId(task: ExecutableTask, key: string): string | undefined | Bad {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? str(v) : BAD;
}
