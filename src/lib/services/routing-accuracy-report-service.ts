// VERIDIAN Review Framework remediation (AI Orchestra routing accuracy gap,
// 2026-07-18): "No measured routing-accuracy metric exists at all." This
// builds one entirely from data this codebase already collects -- zero new
// tracking infrastructure, same discipline as ai-performance-report-
// service.ts's own header. Every real chat.ai_thread_reply orchestra
// execution already carries the model/provider actually routed to
// (recordOrchestraExecution, chat-service.ts) plus a real escalation
// decision + signals (floor-tier-escalation.ts, logged in input.escalation).
// byo-model-audit.ts's detectMissedEscalations() (this same wave) adds the
// one outcome-quality signal that wasn't already captured anywhere: replies
// that were NOT escalated at call time but should have been, judged by the
// user's own next message.
//
// "Routing accuracy" is defined narrowly and honestly here: the fraction of
// routing decisions with NO negative outcome signal attached -- escalated
// (the floor-tier route was judged inadequate at call time and retried on a
// stronger model), gated (ai-reply-gate.ts blocked a hallucinated claim
// before the user ever saw it), or missed-escalated (the audit judged,
// after the fact, that a non-escalated reply should have escalated). This is
// a real, falsifiable, deterministic metric computed from real rows -- not a
// claim that "the objectively best model" was chosen in some deeper sense
// no data available here could prove.
//
// No persistence layer -- same honestly-disclosed scope limit as
// ai-performance-report-service.ts/metric-alert-service.ts's own /run
// routes: this computes and returns the report on each cron invocation.
// Vercel Cron's own invocation log is the historical record for now; a
// report-snapshots table is a small additive migration layered on top of
// this function later if the Owner wants queryable history, not a rewrite.
import { db, orchestraExecutions } from "@/lib/db"
import { eq, and, gte, sql } from "drizzle-orm"
import { detectMissedEscalations, type ChatReplyRow } from "@/lib/loops/byo-model-audit"

export type RoutingAccuracyReport = {
  cadence: "weekly"
  periodStart: string
  periodEnd: string
  totalRoutingDecisions: number
  escalatedCount: number
  gatedCount: number
  failedCount: number
  missedEscalationCount: number
  missedEscalationEligiblePairs: number
  /** 1 - (negative signals / total), clamped to [0, 1]; defined as 1 (not NaN) when there were zero routing decisions in the period -- no data is not the same as "0% accurate". */
  routingAccuracyRate: number
  /**
   * F6 (Predictive/ML-based model selection -- the review framework's own
   * recommendation was "no action needed unless escalation accuracy proves
   * inadequate"). This flag makes that trigger condition real and
   * automatically re-evaluated every week instead of a one-time static
   * decision that goes stale silently. True when there's enough volume to
   * be a real signal AND the negative-signal rate crosses the same bar
   * byo-model-audit.ts's own ESCALATION_RATE_THRESHOLD uses for a single
   * org -- deliberately the SAME threshold, not a new one invented for this
   * report, so "high" means the same thing in both places.
   */
  recommendPredictiveModelSelectionReview: boolean
}

const MIN_DECISIONS_FOR_REVIEW_SIGNAL = 20
const NEGATIVE_SIGNAL_RATE_THRESHOLD = 0.2

/** Pure: the actual accuracy arithmetic, extracted for direct unit testing (same split as ai-performance-report-service.ts's computeFailureRate). total=0 -> rate=1 (no data is not "0% accurate"), never NaN. */
export function computeRoutingAccuracy(input: { total: number; escalatedCount: number; gatedCount: number; missedEscalationCount: number }): { routingAccuracyRate: number; negativeSignalRate: number } {
  const negativeSignals = input.escalatedCount + input.gatedCount + input.missedEscalationCount
  const negativeSignalRate = input.total > 0 ? negativeSignals / input.total : 0
  const routingAccuracyRate = input.total > 0 ? Math.max(0, 1 - negativeSignalRate) : 1
  return { routingAccuracyRate, negativeSignalRate }
}

/** Pure: F6's "no action needed unless escalation accuracy proves inadequate" trigger, made a real re-evaluated condition instead of a one-time static call. */
export function shouldRecommendPredictiveModelSelectionReview(total: number, negativeSignalRate: number): boolean {
  return total >= MIN_DECISIONS_FOR_REVIEW_SIGNAL && negativeSignalRate >= NEGATIVE_SIGNAL_RATE_THRESHOLD
}

export async function generateRoutingAccuracyReport(days = 7): Promise<RoutingAccuracyReport> {
  const periodEndDate = new Date()
  const periodStartDate = new Date(periodEndDate.getTime() - days * 86_400_000)

  const [statusCounts] = await db
    .select({
      total: sql<number>`count(*) filter (where ${orchestraExecutions.eventType} = 'chat.ai_thread_reply')`,
      escalated: sql<number>`count(*) filter (where ${orchestraExecutions.eventType} = 'chat.ai_thread_reply' and (${orchestraExecutions.input}->'escalation'->>'escalated')::boolean = true)`,
      gated: sql<number>`count(*) filter (where ${orchestraExecutions.eventType} = 'chat.ai_thread_reply' and ${orchestraExecutions.status} = 'gated')`,
      failed: sql<number>`count(*) filter (where ${orchestraExecutions.eventType} = 'chat.ai_thread_reply' and ${orchestraExecutions.status} = 'failed')`,
    })
    .from(orchestraExecutions)
    .where(gte(orchestraExecutions.createdAt, periodStartDate))

  // Same query shape as byo-model-audit.ts's own missed-escalation sample
  // (status='completed' only -- a gated or failed reply was never a real
  // completed answer to judge against the user's next message).
  const chatReplyRows: ChatReplyRow[] = await db
    .select({
      id: orchestraExecutions.id,
      orgId: orchestraExecutions.orgId,
      conversationId: sql<string | null>`${orchestraExecutions.input}->>'conversationId'`,
      escalated: sql<boolean>`coalesce((${orchestraExecutions.input}->'escalation'->>'escalated')::boolean, false)`,
      signals: sql<string[]>`coalesce(${orchestraExecutions.input}->'escalation'->'signals', '[]'::jsonb)`,
    })
    .from(orchestraExecutions)
    .where(and(
      eq(orchestraExecutions.eventType, "chat.ai_thread_reply"),
      eq(orchestraExecutions.status, "completed"),
      gte(orchestraExecutions.createdAt, periodStartDate)
    ))
    .orderBy(sql`${orchestraExecutions.input}->>'conversationId'`, orchestraExecutions.createdAt)

  const missedEscalationAudit = detectMissedEscalations(chatReplyRows)

  const total = Number(statusCounts?.total ?? 0)
  const escalatedCount = Number(statusCounts?.escalated ?? 0)
  const gatedCount = Number(statusCounts?.gated ?? 0)
  const failedCount = Number(statusCounts?.failed ?? 0)
  const missedEscalationCount = missedEscalationAudit.missed.length

  // failedCount deliberately excluded from the accuracy formula -- an LLM
  // call erroring is a reliability/failover concern already tracked by
  // ai-performance-report-service.ts's own failureRate, not a routing
  // decision quality signal (the routing choice may have been fine; the
  // provider call itself failed). Kept on the report for visibility only.
  const { routingAccuracyRate, negativeSignalRate } = computeRoutingAccuracy({ total, escalatedCount, gatedCount, missedEscalationCount })

  return {
    cadence: "weekly",
    periodStart: periodStartDate.toISOString(),
    periodEnd: periodEndDate.toISOString(),
    totalRoutingDecisions: total,
    escalatedCount,
    gatedCount,
    failedCount,
    missedEscalationCount,
    missedEscalationEligiblePairs: missedEscalationAudit.eligiblePairs,
    routingAccuracyRate,
    recommendPredictiveModelSelectionReview: shouldRecommendPredictiveModelSelectionReview(total, negativeSignalRate),
  }
}
