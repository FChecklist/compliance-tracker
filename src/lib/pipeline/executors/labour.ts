// PROJEXA-BUILD-002 WP-05d (register row AW-304) -- record_attendance_batch and update_roster_entry.
//
// Both wrap construction-labour-service.ts (recordAttendanceBatch, updateRosterEntry), the service PROJEXA's attendance sheet and roster
// routes call.
//   - record_attendance_batch marks one day for many workers in one transaction. Every worker named is held to the task's project before
//     the service is reached (the service checks it too, and writes nothing when one is missing). Re-sending the same sheet corrects the
//     rows and does not duplicate them (the service's upsert). A row's day cost is a money figure: it, and the sheet's total, are null in
//     the answer below the manager rank.
//   - update_roster_entry changes a worker's name, trade, skill level, daily rate or active flag, and nothing else (employeeCode and the
//     vendor are not in the patch). updateRosterEntry() finds the worker by id and organisation only, so the id is held to the project
//     first. A daily rate is money: the function is a draft on a link, and the rate is null in the answer below the manager rank.
import { ATTENDANCE_STATUSES, isAttendanceStatus, recordAttendanceBatch, updateRosterEntry } from "@/lib/services/construction-labour-service";
import type { ExecutableTask, ExecutionOutcome } from "../executor";
import { badRequest, created, RANK_MEMBER, str } from "./common";
import { bad, BAD, guarded, needDate, needText, notFound, optNumber, optText, recordInProject, rosterInProject, withholdFields } from "./record-scope";

/** The most workers one sheet may name: a site of 200 is already an unusual roster, and the limit keeps one call one small transaction. */
export const MAX_SHEET_ROWS = 200;
const MAX_HOURS = 24;

type Row = { rosterId: string; status: (typeof ATTENDANCE_STATUSES)[number]; hoursWorked?: number };

/** The hours of one row: absent is undefined, a number (or a string that is one) from 0 to a day, anything else BAD. */
function readHours(hours: unknown): number | undefined | typeof BAD {
  if (hours === undefined || hours === null || hours === "") return undefined;
  const n = typeof hours === "number" ? hours : typeof hours === "string" && hours.trim() !== "" ? Number(hours) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_HOURS ? n : BAD;
}

function readRows(value: unknown): Row[] | typeof BAD {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SHEET_ROWS) return BAD;
  const rows: Row[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return BAD;
    const entry = item as Record<string, unknown>;
    const rosterId = str(entry.rosterId);
    if (!rosterId) return BAD;
    const status = entry.status === undefined || entry.status === null ? "present" : entry.status;
    if (!isAttendanceStatus(status)) return BAD;
    const hoursWorked = readHours(entry.hoursWorked);
    if (hoursWorked === BAD) return BAD;
    rows.push(hoursWorked === undefined ? { rosterId, status } : { rosterId, status, hoursWorked });
  }
  return rows;
}

export async function executeRecordAttendanceBatch(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const date = needDate(task, "date");
    if (date === BAD) return bad(task, "date");
    const rows = readRows(task.params.entries);
    if (rows === BAD) return bad(task, "entries");

    const known = await rosterInProject(task, rows.map((r) => r.rosterId), projectId);
    if (rows.some((r) => !known.has(r.rosterId))) return notFound(task, "rosterId");

    const sheet = await recordAttendanceBatch({ orgId: task.orgId }, { projectId, attendanceDate: date, rows });
    return created(sheet.attendance[0]?.id ?? date, "/labour?tab=attendance", withholdFields(task, sheet, ["dailyCost", "totalCost"]));
  });
}

export async function executeUpdateRosterEntry(task: ExecutableTask): Promise<ExecutionOutcome> {
  return guarded(task, { write: true, minRank: RANK_MEMBER }, async ({ projectId }) => {
    const rosterId = needText(task, "rosterId");
    if (rosterId === BAD) return bad(task, "rosterId");
    const name = optText(task, "name");
    if (name === BAD) return bad(task, "name");
    if (task.params.name !== undefined && task.params.name !== null && name === undefined) return bad(task, "name");
    const trade = optText(task, "trade");
    if (trade === BAD) return bad(task, "trade");
    const skillLevel = optText(task, "skillLevel");
    if (skillLevel === BAD) return bad(task, "skillLevel");
    const dailyRate = optNumber(task, "dailyRate");
    if (dailyRate === BAD) return bad(task, "dailyRate");
    const flag = task.params.isActive;
    if (flag !== undefined && flag !== null && typeof flag !== "boolean") return bad(task, "isActive");

    const patch = Object.fromEntries(
      Object.entries({ name, trade, skillLevel, dailyRate, isActive: typeof flag === "boolean" ? flag : undefined }).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(patch).length === 0) return badRequest(task, "no_fields");

    if (!(await recordInProject(task, "roster", rosterId, projectId))) return notFound(task, "rosterId");
    const row = await updateRosterEntry({ orgId: task.orgId }, rosterId, patch);
    return created(row.id, `/labour/${row.id}`, withholdFields(task, row, ["dailyRate"]));
  });
}
