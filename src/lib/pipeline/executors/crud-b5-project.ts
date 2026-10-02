// lf-b5-ai-crud (owner order 2026-10-02, requirement R7) -- the eight project edits and deletes that had no service until this package:
// update_activity, update_progress_category, update_attendance, delete_attendance, update_change_order, cancel_change_order,
// update_boq_line and delete_meeting. Each service is NEW, in the existing service file of its module, with its own conservative rules
// (each file's header says them; ai-os/AI_CRUD_COVERAGE.md lists them for the owner to veto). The executor adds nothing to a service's
// rules: it checks the run order (record-scope.ts guarded), the parameters, and that every id is a record of THIS project of this
// organisation -- an id of another project, of another organisation or of no record is RECORD_NOT_FOUND and nothing is written.
//   update_activity            name, unit, planned quantity, category      level 1, member   construction-progress-service.ts updateActivity
//   update_progress_category   name, parent category                       level 1, member   construction-progress-service.ts updateCategory
//   update_attendance          status, hours (cost recomputed)             level 2, manager  construction-labour-service.ts updateAttendance
//   delete_attendance          one row, audited                            level 2, manager  construction-labour-service.ts deleteAttendance
//   update_change_order        a draft's terms (cost impact is money)      level 2, member   construction-change-order-service.ts updateChangeOrder
//   cancel_change_order        draft or pending; voids its e-signature     level 2, member   construction-change-order-service.ts cancelChangeOrder
//   update_boq_line            description and unit of a draft BOQ's line  level 1, member   construction-boq-service.ts updateLineItemDetails
//   delete_meeting             soft delete of a project meeting            level 2, member   pms-meeting-service.ts deleteMeeting
// Money: a daily cost in an attendance answer and a cost impact in a change order answer are null below the manager rank.
// Tests: src/lib/pipeline/coverage-crud-b5.test.ts.
import { and, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { constructionAttendance } from "@/lib/db/schema";
import { updateActivity, updateCategory } from "@/lib/services/construction-progress-service";
import { ATTENDANCE_STATUSES, deleteAttendance, updateAttendance, type AttendanceStatus } from "@/lib/services/construction-labour-service";
import { cancelChangeOrder, updateChangeOrder } from "@/lib/services/construction-change-order-service";
import { updateLineItemDetails } from "@/lib/services/construction-boq-service";
import { deleteMeeting } from "@/lib/services/pms-meeting-service";
import { bustProjectDashboardCache } from "@/lib/services/project-dashboard-cache";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, boqLineInProject, guarded, needText, notFound, optOneOf, recordInProject as fieldRecordInProject, withholdFields } from "./record-scope";
import { recordInProject } from "./scope";
import { given, loadActor, optClean, optId, optRange, optWhole, recordOfProject } from "./wave79-scope";

/** The optional free-text field of a patch: BAD when given but not usable text (over the cap, not text, or blank after cleaning). */
function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

/** True when the attendance row is one of THIS project of this organisation. */
async function attendanceOfProject(task: ExecutableTask, id: string, projectId: string): Promise<boolean> {
  const row = await withTenantContext({ orgId: task.orgId, userId: task.userId }, (db) =>
    db.query.constructionAttendance.findFirst({ where: and(eq(constructionAttendance.id, id), eq(constructionAttendance.orgId, task.orgId)), columns: { projectId: true } })
  );
  return row?.projectId === projectId;
}

// -- work progress: activity and category --------------------------------------------------------------------------------------------

export async function executeUpdateActivity(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const activityId = needText(task, "activityId");
    if (activityId === BAD) return bad(task, "activityId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const unit = patchText(task, "unit");
    if (unit === BAD) return bad(task, "unit");
    const plannedQuantity = optRange(task, "plannedQuantity", 0, 1e12);
    if (plannedQuantity === BAD) return bad(task, "plannedQuantity");
    const categoryId = optId(task, "categoryId");
    if (categoryId === BAD) return bad(task, "categoryId");
    const patch = {
      ...(name ? { name } : {}),
      ...(unit ? { unit } : {}),
      ...(plannedQuantity !== undefined ? { plannedQuantity } : {}),
      ...(categoryId ? { categoryId } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await fieldRecordInProject(task, "activity", activityId, projectId))) return notFound(task, "activityId");
    if (categoryId && !(await fieldRecordInProject(task, "category", categoryId, projectId))) return notFound(task, "categoryId");
    // the service refuses a unit change once progress is recorded (409)
    const row = await updateActivity({ orgId: task.orgId }, activityId, patch);
    return created(row.id, "/work-progress", row);
  });
}

export async function executeUpdateProgressCategory(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const categoryId = needText(task, "categoryId");
    if (categoryId === BAD) return bad(task, "categoryId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const parentCategoryId = optId(task, "parentCategoryId");
    if (parentCategoryId === BAD) return bad(task, "parentCategoryId");
    const patch = { ...(name ? { name } : {}), ...(parentCategoryId ? { parentCategoryId } : {}) };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await fieldRecordInProject(task, "category", categoryId, projectId))) return notFound(task, "categoryId");
    if (parentCategoryId && !(await fieldRecordInProject(task, "category", parentCategoryId, projectId))) return notFound(task, "parentCategoryId");
    // the service refuses a parent that is the category itself or one of its own sub-categories (400)
    const row = await updateCategory({ orgId: task.orgId }, categoryId, patch);
    return created(row.id, "/work-progress", row);
  });
}

// -- labour attendance ----------------------------------------------------------------------------------------------------------------

export async function executeUpdateAttendance(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId }) => {
    const attendanceId = needText(task, "attendanceId");
    if (attendanceId === BAD) return bad(task, "attendanceId");
    const status = optOneOf(task, "status", ATTENDANCE_STATUSES);
    if (status === BAD) return bad(task, "status");
    const hoursWorked = optRange(task, "hoursWorked", 0, 24);
    if (hoursWorked === BAD) return bad(task, "hoursWorked");
    if (status === undefined && hoursWorked === undefined) return bad(task, "empty_patch");
    if (!(await attendanceOfProject(task, attendanceId, projectId))) return notFound(task, "attendanceId");
    // the service refuses a row older than its edit window (409) and recomputes the daily cost from the roster's rate
    const row = await updateAttendance({ orgId: task.orgId }, attendanceId, {
      ...(status ? { status: status as AttendanceStatus } : {}),
      ...(hoursWorked !== undefined ? { hoursWorked } : {}),
    });
    return created(row.id, "/labour", withholdFields(task, row, ["dailyCost"]));
  });
}

export async function executeDeleteAttendance(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const attendanceId = needText(task, "attendanceId");
    if (attendanceId === BAD) return bad(task, "attendanceId");
    if (!(await attendanceOfProject(task, attendanceId, projectId))) return notFound(task, "attendanceId");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    // a hard delete of the row with an audit row in the same transaction; refused outside the edit window (409)
    const result = await deleteAttendance({ orgId: task.orgId, dbUser: loaded.actor }, attendanceId);
    return created(attendanceId, "/labour", result);
  });
}

// -- change orders ----------------------------------------------------------------------------------------------------------------------

export async function executeUpdateChangeOrder(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const changeOrderId = needText(task, "changeOrderId");
    if (changeOrderId === BAD) return bad(task, "changeOrderId");
    const title = patchText(task, "title");
    if (title === BAD) return bad(task, "title");
    const description = patchText(task, "description");
    if (description === BAD) return bad(task, "description");
    const reason = patchText(task, "reason");
    if (reason === BAD) return bad(task, "reason");
    const trade = patchText(task, "trade");
    if (trade === BAD) return bad(task, "trade");
    const costImpact = optRange(task, "costImpact", -1e12, 1e12);
    if (costImpact === BAD) return bad(task, "costImpact");
    const scheduleImpactDays = optWhole(task, "scheduleImpactDays", -3650, 3650);
    if (scheduleImpactDays === BAD) return bad(task, "scheduleImpactDays");
    const patch = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(reason ? { reason } : {}),
      ...(trade ? { trade } : {}),
      ...(costImpact !== undefined ? { costImpact } : {}),
      ...(scheduleImpactDays !== undefined ? { scheduleImpactDays } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await recordOfProject(task, "change_order", changeOrderId, projectId))) return notFound(task, "changeOrderId");
    // the service edits a DRAFT only (409 otherwise: a pending one is under a live e-signature)
    const row = await updateChangeOrder({ orgId: task.orgId }, changeOrderId, patch);
    return created(row.id, `/change-orders/${row.id}`, withholdFields(task, row, ["costImpact"]));
  });
}

export async function executeCancelChangeOrder(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const changeOrderId = needText(task, "changeOrderId");
    if (changeOrderId === BAD) return bad(task, "changeOrderId");
    if (!(await recordOfProject(task, "change_order", changeOrderId, projectId))) return notFound(task, "changeOrderId");
    // draft or pending approval only; its pending e-signature requests are voided in the same transaction
    const result = await cancelChangeOrder({ orgId: task.orgId }, changeOrderId);
    return created(changeOrderId, `/change-orders/${changeOrderId}`, {
      id: result.changeOrder.id, number: result.changeOrder.number, status: result.changeOrder.status, signatureRequestsVoided: result.signatureRequestsVoided,
    });
  });
}

// -- BOQ line text ----------------------------------------------------------------------------------------------------------------------

export async function executeUpdateBoqLine(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const lineItemId = needText(task, "lineItemId");
    if (lineItemId === BAD) return bad(task, "lineItemId");
    const description = patchText(task, "description");
    if (description === BAD) return bad(task, "description");
    const unit = patchText(task, "unit");
    if (unit === BAD) return bad(task, "unit");
    const patch = { ...(description ? { description } : {}), ...(unit ? { unit } : {}) };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await boqLineInProject(task, lineItemId, projectId))) return notFound(task, "lineItemId");
    // a draft, never-confirmed BOQ only (409 otherwise); quantity, rate and amount are never taken
    const row = await updateLineItemDetails({ orgId: task.orgId }, lineItemId, patch);
    bustProjectDashboardCache(task.orgId, projectId);
    return created(row.id, `/scope/${row.boqId}`, { id: row.id, boqId: row.boqId, itemCode: row.itemCode, description: row.description, unit: row.unit });
  });
}

// -- project meetings ---------------------------------------------------------------------------------------------------------------------

export async function executeDeleteMeeting(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const meetingId = needText(task, "meetingId");
    if (meetingId === BAD) return bad(task, "meetingId");
    if (!(await recordInProject(task, "pms_meeting", meetingId, projectId))) return notFound(task, "meetingId");
    // a soft delete: deleted_at is set, the meeting and its minutes stay, and it reads as absent afterwards
    const row = await deleteMeeting({ orgId: task.orgId }, meetingId);
    return created(row.id, "/meetings", { id: row.id, title: row.title, deletedAt: row.deletedAt });
  });
}
