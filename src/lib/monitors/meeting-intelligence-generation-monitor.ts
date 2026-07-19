// PLATFORM_STRATEGY.md section 29.3 Phase 1: the MOM_GENERATED (Minutes of
// Meeting) slice of the ~28 remaining documented event types.
//
// veri-meeting-service.ts's generateMeetingIntelligence() is the one real
// generation call site (both the fire-and-forget after() call from
// publishVeriMeeting and the direct POST /api/veri-meetings/[id]/
// generate-intelligence route funnel through it) -- minutes themselves are
// human-typed, not AI-generated, so this monitor watches whether the AI
// SUMMARY/decisions/action-items extraction from those minutes succeeded,
// not the minutes themselves. Unlike the SLA-pair monitors elsewhere in
// this phase, there's no meaningful elapsed-time comparison here (the call
// either succeeds synchronously or throws) -- the deterministic rule is a
// plain success/failure check, the same shape webhook-delivery-outcome-
// monitor.ts uses for API_SUCCESS/API_FAILED.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ServiceActor } from "@/lib/services/context"
import { runRuleEngineMonitor, type RuleEngineMonitorResult } from "./rule-engine-monitor"

export const MEETING_INTELLIGENCE_GENERATION_MONITOR_NAME = "meeting_intelligence_generation_monitor"

export type MeetingIntelligenceGenerationMonitorInput = {
  meetingId: string
  title: string
  succeeded: boolean
  /** Present only when succeeded is false -- the real error message, not a placeholder. */
  failureReason?: string
}

export async function runMeetingIntelligenceGenerationMonitor(
  db: TenantDb,
  orgId: string,
  actor: ServiceActor,
  input: MeetingIntelligenceGenerationMonitorInput,
  request?: Request
): Promise<RuleEngineMonitorResult> {
  return runRuleEngineMonitor(db, orgId, actor, {
    monitorName: MEETING_INTELLIGENCE_GENERATION_MONITOR_NAME,
    entityType: "VeriMeeting",
    entityId: input.meetingId,
    worker: `VeriMeeting ${input.meetingId} ("${input.title}")`,
    check: {
      withinRule: input.succeeded,
      protocol: input.succeeded
        ? "generateMeetingIntelligence completed and wrote aiSummary/aiKeyDecisions/aiSuggestedActionItems"
        : `generateMeetingIntelligence failed: ${input.failureReason ?? "unknown error"}`,
    },
    request,
  })
}
