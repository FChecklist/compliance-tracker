// lf-b2-ai-crud (owner order 2026-10-02, requirements R5-R7) -- the document, minutes, meeting and material changes an AI could not make:
// dispose_document, update_mom_details, delete_mom, update_meeting and update_material.
//
// Each wraps the service the matching PROJEXA route calls. No rule of a service is relaxed:
//   - dispose_document is the records manager's act (document-service.ts disposeDocument): the service refuses a document under legal
//     hold, one with no retention policy, one not yet past its disposal date and one already disposed. The document is marked disposed,
//     never removed. Level 2 at the manager rank, like POST /api/v1/projexa/documents/{id}/dispose;
//   - update_mom_details changes a draft MoM's title, type, time, attendees and agenda (veri-meeting-service.ts updateVeriMeetingDetails;
//     a published MoM is locked and the service refuses it, 409). delete_mom is the service's SOFT delete (status "deleted", draft only, 409
//     otherwise) and is a draft the person confirms. Both at the member rank, like the PATCH and DELETE of /api/v1/projexa/veri-meetings/{id};
//   - update_meeting reschedules a project meeting (pms-meeting-service.ts updateMeeting): title, time, duration. pms_meetings has no
//     status column, so there is no delete of a project meeting (the service has none either);
//   - update_material changes a material of the project (construction-materials-service.ts updateMaterial). Its unit cost is money, so it
//     is a draft the person confirms (the precedent is create_material) and the cost is null in the answer below the manager rank.
//     isActive false retires a material; nothing is removed;
//   - the document, the MoM, the meeting and the material must be of THIS project (the services find them by id and organisation only);
//   - free text is cleaned and held to 2,000 characters; a list (attendees, agenda) item by item (scope.ts cleanTextList).
// Tests: src/lib/pipeline/coverage-crud-b2.test.ts.
import { disposeDocument } from "@/lib/services/document-service";
import { updateMeeting } from "@/lib/services/pms-meeting-service";
import { deleteVeriMeeting, updateVeriMeetingDetails } from "@/lib/services/veri-meeting-service";
import { updateMaterial } from "@/lib/services/construction-materials-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MANAGER, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound, recordInProject as fieldRecordInProject, withholdFields } from "./record-scope";
import { cleanTextList, recordInProject } from "./scope";
import { given, loadActor, optClean, optRange, optWhole, recordOfProject } from "./wave79-scope";

/** The optional free-text field of a patch: BAD when given but not usable text (over the cap, not text, or blank after cleaning). */
function patchText(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = optClean(task, key);
  return v === BAD || (given(task, key) && v === undefined) ? BAD : v;
}

/** An optional instant (an ISO 8601 date-time the Date parser reads). */
function optInstant(task: ExecutableTask, key: string): string | undefined | typeof BAD {
  const v = task.params[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > 40 || !/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(new Date(v).getTime())) return BAD;
  return v;
}

/** An optional list of text (attendees, agenda): absent is undefined, a list over the caps or of non-text is BAD. */
function optList(task: ExecutableTask, key: string): string[] | undefined | typeof BAD {
  if (task.params[key] === undefined || task.params[key] === null) return undefined;
  let value = task.params[key];
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      value = JSON.parse(value);
    } catch {
      return BAD;
    }
  }
  const cleaned = cleanTextList(value);
  return cleaned.ok ? cleaned.items : BAD;
}

/** An optional boolean: a boolean, or "true"/"false". */
function optBool(task: ExecutableTask, key: string): boolean | undefined | typeof BAD {
  const v = task.params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return BAD;
}

// -- documents ----------------------------------------------------------------------------------------------------------------------

export async function executeDisposeDocument(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MANAGER }, async ({ projectId, actorId }) => {
    const documentId = needText(task, "documentId");
    if (documentId === BAD) return bad(task, "documentId");
    if (!(await recordOfProject(task, "document", documentId, projectId))) return notFound(task, "documentId");
    const row = await disposeDocument({ orgId: task.orgId, userId: actorId }, documentId);
    return created(row.id, `/documents/${row.id}`, { id: row.id, name: row.name, isDisposed: row.isDisposed, disposedAt: row.disposedAt, disposedById: row.disposedById });
  });
}

// -- minutes of meeting -------------------------------------------------------------------------------------------------------------

export async function executeUpdateMomDetails(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const meetingId = needText(task, "meetingId");
    if (meetingId === BAD) return bad(task, "meetingId");
    const title = patchText(task, "title");
    if (title === BAD) return bad(task, "title");
    const meetingType = patchText(task, "meetingType");
    if (meetingType === BAD) return bad(task, "meetingType");
    const scheduledAt = optInstant(task, "scheduledAt");
    if (scheduledAt === BAD) return bad(task, "scheduledAt");
    const attendees = optList(task, "attendees");
    if (attendees === BAD) return bad(task, "attendees");
    const agenda = optList(task, "agenda");
    if (agenda === BAD) return bad(task, "agenda");
    const patch = {
      ...(title ? { title } : {}),
      ...(meetingType ? { meetingType } : {}),
      ...(scheduledAt ? { scheduledAt } : {}),
      ...(attendees !== undefined ? { attendees } : {}),
      ...(agenda !== undefined ? { agenda } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await recordInProject(task, "veri_meeting", meetingId, projectId))) return notFound(task, "meetingId");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    const row = await updateVeriMeetingDetails({ orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor }, meetingId, patch);
    return created(row.id, `/moms/${row.id}`, row);
  });
}

export async function executeDeleteMom(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const meetingId = needText(task, "meetingId");
    if (meetingId === BAD) return bad(task, "meetingId");
    if (!(await recordInProject(task, "veri_meeting", meetingId, projectId))) return notFound(task, "meetingId");
    const loaded = await loadActor(task, actorId);
    if ("failure" in loaded) return loaded.failure;
    // A soft delete: the status becomes "deleted" and the record stays; a published MoM is refused by the service (409).
    const row = await deleteVeriMeeting({ orgId: task.orgId, userId: loaded.actor.id, dbUser: loaded.actor }, meetingId);
    return created(row.id, "/moms", { id: row.id, status: row.status });
  });
}

// -- project meetings ---------------------------------------------------------------------------------------------------------------

export async function executeUpdateMeeting(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const meetingId = needText(task, "meetingId");
    if (meetingId === BAD) return bad(task, "meetingId");
    const title = patchText(task, "title");
    if (title === BAD) return bad(task, "title");
    const scheduledAt = optInstant(task, "scheduledAt");
    if (scheduledAt === BAD) return bad(task, "scheduledAt");
    const durationMinutes = optWhole(task, "durationMinutes", 1, 1440);
    if (durationMinutes === BAD) return bad(task, "durationMinutes");
    const patch = { ...(title ? { title } : {}), ...(scheduledAt ? { scheduledAt } : {}), ...(durationMinutes !== undefined ? { durationMinutes } : {}) };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await recordInProject(task, "pms_meeting", meetingId, projectId))) return notFound(task, "meetingId");
    const row = await updateMeeting({ orgId: task.orgId }, meetingId, patch);
    return created(row.id, `/meetings/${row.id}`, row);
  });
}

// -- materials ----------------------------------------------------------------------------------------------------------------------

export async function executeUpdateMaterial(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const materialId = needText(task, "materialId");
    if (materialId === BAD) return bad(task, "materialId");
    const name = patchText(task, "name");
    if (name === BAD) return bad(task, "name");
    const unit = patchText(task, "unit");
    if (unit === BAD) return bad(task, "unit");
    const spec = patchText(task, "spec");
    if (spec === BAD) return bad(task, "spec");
    const unitCost = optRange(task, "unitCost", 0, 1e12);
    if (unitCost === BAD) return bad(task, "unitCost");
    const reorderLevel = optRange(task, "reorderLevel", 0, 1e12);
    if (reorderLevel === BAD) return bad(task, "reorderLevel");
    const isActive = optBool(task, "isActive");
    if (isActive === BAD) return bad(task, "isActive");
    const patch = {
      ...(name ? { name } : {}),
      ...(unit ? { unit } : {}),
      ...(spec ? { spec } : {}),
      ...(unitCost !== undefined ? { unitCost } : {}),
      ...(reorderLevel !== undefined ? { reorderLevel } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    };
    if (Object.keys(patch).length === 0) return bad(task, "empty_patch");
    if (!(await fieldRecordInProject(task, "material", materialId, projectId))) return notFound(task, "materialId");
    const row = await updateMaterial({ orgId: task.orgId }, materialId, patch);
    return created(row.id, "/materials", withholdFields(task, row, ["unitCost"]));
  });
}
