// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the same-project checks the AI create/update/delete executors need that
// scope.ts, record-scope.ts and wave79-scope.ts do not already have: a sprint, a time entry, a mood board item and a furniture placement.
//
// The services these executors wrap find a sprint, a time entry or an item by id and organisation only (or, for an item and a placement,
// by id and its parent only, and a delete of an id that is not there succeeds silently). An AI work link is bound to ONE project, so an id
// that names a record of another project, or no record, must read as absent and nothing may be written (spec 9.10). Each check is its
// own short transaction, run BEFORE the service opens its own (D-06: never nested). A record that does not exist and a record of another
// project give the same answer.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { interiorFurniturePlacements, interiorMoodBoardItems, pmsIssues, pmsSprints, pmsTimeEntries } from "@/lib/db/schema";
import type { ExecutableTask } from "../executor";

/** True when the sprint exists on THIS project of the task's organisation. */
export async function sprintOfProject(task: ExecutableTask, sprintId: string, projectId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const row = await db.query.pmsSprints.findFirst({ where: and(eq(pmsSprints.id, sprintId), eq(pmsSprints.orgId, task.orgId)), columns: { projectId: true } });
    return row?.projectId === projectId;
  });
}

export type TimeEntryFacts = { userId: string; approvalStatus: string };

/**
 * The time entry when it exists in the task's organisation AND its task (pms_issues) is on THIS project; null otherwise. A time entry has
 * no project column: it belongs to the project of its task.
 */
export async function timeEntryOfProject(task: ExecutableTask, entryId: string, projectId: string): Promise<TimeEntryFacts | null> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const entry = await db.query.pmsTimeEntries.findFirst({ where: and(eq(pmsTimeEntries.id, entryId), eq(pmsTimeEntries.orgId, task.orgId)) });
    if (!entry) return null;
    const issue = await db.query.pmsIssues.findFirst({ where: and(eq(pmsIssues.id, entry.issueId), eq(pmsIssues.orgId, task.orgId)), columns: { projectId: true } });
    if (issue?.projectId !== projectId) return null;
    return { userId: entry.userId, approvalStatus: entry.approvalStatus };
  });
}

/** True when the item is an item of THIS mood board (the board itself is checked against the project first). */
export async function itemOfMoodBoard(task: ExecutableTask, itemId: string, moodBoardId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const row = await db.query.interiorMoodBoardItems.findFirst({ where: and(eq(interiorMoodBoardItems.id, itemId), eq(interiorMoodBoardItems.moodBoardId, moodBoardId)), columns: { id: true } });
    return row !== undefined;
  });
}

/** True when the placement is a placement on THIS floor plan (the plan itself is checked against the project first). */
export async function placementOfFloorPlan(task: ExecutableTask, placementId: string, floorPlanId: string): Promise<boolean> {
  return withTenantContext({ orgId: task.orgId, userId: task.userId }, async (db) => {
    const row = await db.query.interiorFurniturePlacements.findFirst({
      where: and(eq(interiorFurniturePlacements.id, placementId), eq(interiorFurniturePlacements.floorPlanId, floorPlanId)),
      columns: { id: true },
    });
    return row !== undefined;
  });
}
