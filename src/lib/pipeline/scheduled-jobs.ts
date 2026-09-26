// PROJEXA-BUILD-002 WP-13 (register row AW-605): the jobs a schedule can name that are NOT registry functions.
//
// A schedule (compliance.pipeline_schedules, drizzle/0642) names a function_id. The bridge runs a registry function through the
// executor (a read) or turns it into a proposal (a write). A job in this file is a third kind: work the bridge does ITSELF, on a
// clock, for the schedule's owner, that neither answers a question nor writes a business record. Today there is one:
//
//   scan_connected_folder   the way-5 pull. Lists the new .xlsx files of the owner's connected mailbox or Drive folder, reads each
//                           one as a job keyed by its hash, and records a proposal per file for a person to approve. It creates no
//                           project and no BOQ (folder-watch-service.ts says how that is held).
//
// WHY IT IS NOT A REGISTRY FUNCTION. Every registry function is reachable from a person's chat, from the assistant, from a project
// link and from an API key. This job reads a mailbox or a shared folder without a person present, so it must be reachable from the
// scheduler alone: it is in no registry, on no link, and no chat sentence resolves to it. The bridge asks isScheduledJob() before it
// looks in the registry.
//
// THE CONTRACT. A job gets the organisation, the schedule, the owner (id and role, read by the bridge from compliance.users at run
// time), the schedule's params, and a deadline; it answers ok with numbers only, or a stable failure code and a reason word. The
// bridge stores the numbers in last_result and the audit row and nothing else: no file name, no sender, no content.
//
// The work itself is in scan-connected-folder-job.ts, loaded on first use so the bridge does not pull the extraction service, the
// workbook parser and the connector client into every run that has no such job.
import type { PipelineErrorCode } from "./error-codes"

export const SCAN_CONNECTED_FOLDER = "scan_connected_folder"
export const SCHEDULED_JOB_IDS: readonly string[] = [SCAN_CONNECTED_FOLDER]

export function isScheduledJob(functionId: string): boolean {
  return SCHEDULED_JOB_IDS.includes(functionId)
}

export type ScheduledJobContext = {
  orgId: string
  scheduleId: string
  /** Read from compliance.users now; never taken from the schedule row. */
  owner: { id: string; role: string | null }
  params: Record<string, unknown>
  /** Epoch milliseconds after which the job starts no new unit of work. */
  deadlineAt: number
}

export type ScheduledJobReport =
  | { ok: true; counts: Record<string, number>; /** a stable word, when the job stopped before it was done */ stopped?: string }
  | { ok: false; code: PipelineErrorCode; reason: string; counts?: Record<string, number> }

export async function runScheduledJob(functionId: string, ctx: ScheduledJobContext): Promise<ScheduledJobReport> {
  if (functionId === SCAN_CONNECTED_FOLDER) {
    const { runScanConnectedFolderJob } = await import("./scan-connected-folder-job")
    return runScanConnectedFolderJob(ctx)
  }
  return { ok: false, code: "FUNCTION_NOT_AVAILABLE", reason: "unknown_job" }
}
