// PROJEXA-BUILD-002 WP-05c (register row AW-303) -- create_site_diary.
//
// Wraps createSiteDiary() of construction-site-diary-service.ts, the service PROJEXA's site diary route calls. The service itself looks the
// project up (404) and refuses a second entry for the same project and day (409, ALREADY_RECORDED), so a retried call never makes a
// second diary. What this adds: the date and every text field are checked for type before the service is reached, labourCount must be
// a whole number of 0 or more, and the entry is recorded under the acting person.
import { createSiteDiary } from "@/lib/services/construction-site-diary-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { created, RANK_MEMBER } from "./common";
import { bad, BAD, guarded, needDate, optNumber, optText } from "./record-scope";

const TEXT_FIELDS = ["weather", "workDone", "visitors", "issues", "instructions", "materialReceived", "remarks"] as const;

export async function executeCreateSiteDiary(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId, actorId }) => {
    const diaryDate = needDate(task, "diaryDate");
    if (diaryDate === BAD) return bad(task, "diaryDate");
    const text: Partial<Record<(typeof TEXT_FIELDS)[number], string>> = {};
    for (const key of TEXT_FIELDS) {
      const v = optText(task, key);
      if (v === BAD) return bad(task, key);
      if (v !== undefined) text[key] = v;
    }
    const labourCount = optNumber(task, "labourCount");
    if (labourCount === BAD || (labourCount !== undefined && !Number.isInteger(labourCount))) return bad(task, "labourCount");

    const row = await createSiteDiary({ orgId: task.orgId, userId: actorId }, { projectId, diaryDate, ...text, labourCount });
    return created(row.id, `/site-diary/${row.id}`, row);
  });
}
