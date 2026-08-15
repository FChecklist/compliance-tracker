// PLATFORM_STRATEGY.md section 29.3 Phase 1: the MEETING_SCHEDULED/
// MEETING_COMPLETED slice of the ~28 remaining documented event types.
//
// `board_meetings` (schema.ts) has a real boardMeetingStatusEnum
// ('scheduled'|'held'|'cancelled') and a real planned `meetingDate`, but no
// dedicated "held at" column -- the transition to 'held' is timestamped only
// by `updatedAt` (src/app/api/board/[id]/route.ts's PATCH "hold" branch).
// The one real, deterministic rule available without inventing a column:
// was the meeting recorded as held within a reasonable window of its own
// planned meetingDate (not before-vs-after latency from scheduling, which
// would conflate "how far in advance was this meeting planned" -- an
// intentional, often-long, un-SLA'd gap -- with lateness itself).
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ServiceActor } from "@/lib/services/context"
import { resolveMonitorDef, runRuleEngineMonitor, type RuleEngineMonitorResult } from "./rule-engine-monitor"

export const BOARD_MEETING_HOLD_MONITOR_NAME = "board_meeting_hold_timeliness_monitor"

export type BoardMeetingHoldMonitorInput = {
  meetingId: string
  title: string
  meetingDate: Date
  heldAt: Date
}

export async function runBoardMeetingHoldMonitor(
  db: TenantDb,
  orgId: string,
  actor: ServiceActor,
  input: BoardMeetingHoldMonitorInput,
  request?: Request
): Promise<RuleEngineMonitorResult> {
  const { maxExecutionTimeMs } = await resolveMonitorDef(db, BOARD_MEETING_HOLD_MONITOR_NAME)

  const holdDelayMs = input.heldAt.getTime() - input.meetingDate.getTime()
  // A meeting recorded as held before/at its planned date is never late --
  // only a hold recorded well after the planned date is a rule violation.
  const withinRule = holdDelayMs <= maxExecutionTimeMs

  return runRuleEngineMonitor(db, orgId, actor, {
    monitorName: BOARD_MEETING_HOLD_MONITOR_NAME,
    entityType: "BoardMeeting",
    entityId: input.meetingId,
    worker: `BoardMeeting ${input.meetingId} ("${input.title}")`,
    check: { withinRule, protocol: `holdDelayMs(${holdDelayMs}) <= maxExecutionTimeMs(${maxExecutionTimeMs})` },
    request,
  })
}
