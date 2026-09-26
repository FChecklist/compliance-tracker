// PROJEXA-BUILD-002 WP-05d (register row AW-304) -- create_progress_category, update_progress_entry, get_daily_progress_report.
//
// The three wrap construction-progress-service.ts (createCategory, updateProgressEntry, getDailyProgressReport), the service PROJEXA's
// work progress routes call. create_activity, the fourth progress function of the wave, is WP-07's (executors/activity.ts).
//   - create_progress_category: the parent category, when named, must be one of this project's (createCategory stores it as given);
//   - update_progress_entry: corrects a mis-keyed entry. updateProgressEntry() finds the entry by id and organisation only, so the entry
//     is held to the task's project first, and so are the activity and the BOQ line the patch names. Only the fields of the card and the
//     two ids are read (an entry never moves between projects, and the recording person is never rewritten). The answer carries the
//     line's contract rate and amount, which are null below the manager rank;
//   - get_daily_progress_report: one day's entries of the project and the documents filed against that day. The documents are named,
//     not linked: a storage path is not something an AI needs.
import { createCategory, getDailyProgressReport, updateProgressEntry } from "@/lib/services/construction-progress-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, RANK_MEMBER } from "./common";
import { bad, BAD, boqLineInProject, guarded, needDate, needText, notFound, ok, optDate, optNumber, optText, recordInProject, withholdFields } from "./record-scope";

const ENTRY_MONEY_FIELDS = ["boqLineRate", "boqLineAmount"] as const;

export async function executeCreateProgressCategory(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const name = needText(task, "name");
    if (name === BAD) return bad(task, "name");
    const parentCategoryId = optText(task, "parentCategoryId");
    if (parentCategoryId === BAD) return bad(task, "parentCategoryId");
    if (parentCategoryId !== undefined && !(await recordInProject(task, "category", parentCategoryId, projectId))) {
      return notFound(task, "parentCategoryId");
    }
    // createCategory() looks the project up itself (404).
    const row = await createCategory({ orgId: task.orgId }, { projectId, name, parentCategoryId });
    return created(row.id, "/work-progress", row);
  });
}

export async function executeUpdateProgressEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const entryId = needText(task, "entryId");
    if (entryId === BAD) return bad(task, "entryId");
    const quantityDone = optNumber(task, "quantityDone");
    if (quantityDone === BAD) return bad(task, "quantityDone");
    const percentComplete = optNumber(task, "percentComplete");
    if (percentComplete === BAD) return bad(task, "percentComplete");
    const entryDate = optDate(task, "entryDate");
    if (entryDate === BAD) return bad(task, "entryDate");
    const remarks = optText(task, "remarks");
    if (remarks === BAD) return bad(task, "remarks");
    const activityId = optText(task, "activityId");
    if (activityId === BAD) return bad(task, "activityId");
    const boqLineItemId = optText(task, "boqLineItemId");
    if (boqLineItemId === BAD) return bad(task, "boqLineItemId");

    const patch = Object.fromEntries(
      Object.entries({ quantityDone, percentComplete, entryDate, remarks, activityId, boqLineItemId }).filter(([, v]) => v !== undefined)
    );
    // The service answers a patch that names nothing with a 400 of its own; refusing it here keeps the entry lookup out of it.
    if (Object.keys(patch).length === 0) return badRequest(task, "no_fields");

    if (!(await recordInProject(task, "progress_entry", entryId, projectId))) return notFound(task, "entryId");
    if (activityId !== undefined && !(await recordInProject(task, "activity", activityId, projectId))) return notFound(task, "activityId");
    if (boqLineItemId !== undefined && !(await boqLineInProject(task, boqLineItemId, projectId))) return notFound(task, "boqLineItemId");

    const row = await updateProgressEntry({ orgId: task.orgId }, entryId, patch);
    return created(row.id, "/work-progress", withholdFields(task, row, ENTRY_MONEY_FIELDS));
  });
}

export async function executeGetDailyProgressReport(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: false, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const date = needDate(task, "date");
    if (date === BAD) return bad(task, "date");
    const report = await getDailyProgressReport({ orgId: task.orgId }, projectId, date);
    return ok({
      projectId: report.projectId,
      date: report.date,
      entries: report.entries,
      photos: report.photos.map((d) => ({ id: d.id, name: d.name, fileType: d.fileType, createdAt: d.createdAt })),
    });
  });
}
