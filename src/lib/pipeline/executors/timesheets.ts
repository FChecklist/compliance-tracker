// PROJEXA-BUILD-002 persona-run finding 3 -- submit_timesheet, a level-2 draft the person confirms.
//
// An entry an AI records with record_timesheet stays a DRAFT (approvalStatus "draft"): nothing on a link submitted it, so it never reached a
// manager's queue. This wraps the service PROJEXA's own route calls (pms-time-service.ts submitTimeEntry, then the reviewer's Task Master row,
// as app/api/v1/projexa/timesheets/[id]/submit/route.ts does). No second write path.
//
// Rules, each with a test in src/lib/pipeline/executor-submit-timesheet.test.ts:
//   - only the person's own entry: submitTimeEntry() refuses another person's entry (403) and an entry that is not a draft or returned (400);
//     the acting person is the link's user, never the API key;
//   - the entry must be on THIS project (an entry of another project reads as absent);
//   - level 2 on a link: the person confirms signed in, so an AI never submits hours by itself; member rank (the route has no role gate);
//   - submitting only sends the entry for review: it approves nothing (approve_timesheet stays the manager's own draft);
//   - the review row is minted AFTER the submit, in its own transaction (never nested); if it fails the entry IS submitted and the answer says so.
import { getTimeEntry, submitTimeEntry } from "@/lib/services/pms-time-service";
import { closeTimesheetReturnedTask, openTimesheetReviewTask } from "@/lib/services/timesheet-review-task-service";
import { ServiceError } from "@/lib/services/service-error";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needText, notFound } from "./record-scope";
import { loadActor } from "./wave79-scope";

export async function executeSubmitTimesheet(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const timeEntryId = needText(task, "timeEntryId");
    if (timeEntryId === BAD) return bad(task, "timeEntryId");
    const built = await loadActor(task, actorId);
    if ("failure" in built) return built.failure;

    let detail: Awaited<ReturnType<typeof getTimeEntry>>;
    try {
      detail = await getTimeEntry({ orgId: task.orgId }, timeEntryId);
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) return notFound(task, "timeEntryId");
      throw error;
    }
    if (detail.projectId !== projectId) return notFound(task, "timeEntryId");

    const ctx = { orgId: task.orgId, userId: built.actor.id };
    const entry = await submitTimeEntry(ctx, timeEntryId);

    let reviewTaskCreated = false;
    try {
      // a re-submit after a return closes the designer's own "Needs you" row first
      await closeTimesheetReturnedTask(ctx, timeEntryId);
      const opened = await openTimesheetReviewTask({ orgId: task.orgId }, {
        timeEntryId,
        projectId: detail.projectId,
        designerId: built.actor.id,
        designerName: built.actor.name,
        hours: entry.hours,
        issueNumber: detail.issue?.number ?? null,
        issueTitle: detail.issue?.title ?? null,
        spentOn: entry.spentOn,
      });
      reviewTaskCreated = opened.created;
    } catch (error) {
      console.error("[pipeline] submit_timesheet: the entry IS submitted, the review row was not created:", error);
    }
    return created(entry.id, "/timesheets", { ...entry, reviewTaskCreated });
  });
}
