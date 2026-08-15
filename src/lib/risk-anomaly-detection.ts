// VERIDIAN Review Framework gap-closure: "Checks & Balances / Risk, Fraud &
// Anomaly Detection". Pure, deterministic Tier-1 rule-engine functions --
// same discipline as monitoring-engine.ts/monitor-protocol.ts (no DB access,
// no LLM call) but for BUSINESS risk events, not AI-Ops dispatch health.
// Callers gather real counts/rows themselves (see risk-escalation-service.ts
// and each wired call site) and pass them in; this module only turns inputs
// into a verdict, matching computeGovernanceHealthScore's own established
// separation of "gather" from "decide".
//
// Covers the 3 highest-risk event types the finding named as the priority
// (bulk data export, after-hours high-impact actions, repeated failed auth)
// plus the 2 fraud-signal rules named for the separate Fraud & Abuse
// Detection finding (duplicate payment, round-number/threshold-avoidance) --
// deliberately not all ~30 of PLATFORM_STRATEGY.md #29's AI-Ops event list,
// which is a different registry for a different purpose (see this file's
// call sites' own header comments).

export type AnomalySeverity = "low" | "medium" | "high" | "critical"

export type AnomalyVerdict =
  | { anomaly: true; eventType: string; severity: AnomalySeverity; reason: string }
  | { anomaly: false }

const NO_ANOMALY: AnomalyVerdict = { anomaly: false }

// ─── Bulk data export ───────────────────────────────────────────────────
export const BULK_EXPORT_ROW_THRESHOLD = 200

export function evaluateBulkExportAnomaly(rowCount: number, threshold: number = BULK_EXPORT_ROW_THRESHOLD): AnomalyVerdict {
  if (rowCount <= threshold) return NO_ANOMALY
  return {
    anomaly: true,
    eventType: "bulk_export",
    severity: rowCount > threshold * 5 ? "high" : "medium",
    reason: `Export of ${rowCount} rows exceeds the ${threshold}-row bulk-export threshold`,
  }
}

// ─── After-hours high-impact action ─────────────────────────────────────
// No per-org timezone column exists in this schema yet -- business hours
// are evaluated against server-local time, a known, named limitation (an
// org in a different timezone will see this rule fire at the wrong local
// hour for them) rather than a silently wrong claim of per-org accuracy.
export type BusinessHoursWindow = { startHour: number; endHour: number }
export const DEFAULT_BUSINESS_HOURS: BusinessHoursWindow = { startHour: 7, endHour: 21 }

export function isAfterHours(when: Date, window: BusinessHoursWindow = DEFAULT_BUSINESS_HOURS): boolean {
  const day = when.getDay() // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return true
  const hour = when.getHours()
  return hour < window.startHour || hour >= window.endHour
}

export function evaluateAfterHoursHighImpactAction(actionLabel: string, when: Date, window?: BusinessHoursWindow): AnomalyVerdict {
  if (!isAfterHours(when, window)) return NO_ANOMALY
  return {
    anomaly: true,
    eventType: "after_hours_high_impact",
    severity: "high",
    reason: `High-impact action "${actionLabel}" performed outside business hours (${when.toISOString()})`,
  }
}

// ─── Repeated failed auth ────────────────────────────────────────────────
export const FAILED_AUTH_THRESHOLD = 5

export function evaluateRepeatedFailedAuth(recentFailureCount: number, threshold: number = FAILED_AUTH_THRESHOLD): AnomalyVerdict {
  if (recentFailureCount < threshold) return NO_ANOMALY
  return {
    anomaly: true,
    eventType: "repeated_failed_auth",
    severity: recentFailureCount >= threshold * 2 ? "critical" : "high",
    reason: `${recentFailureCount} failed login attempts against the same account within the rate-limit window`,
  }
}

// ─── Duplicate payment ───────────────────────────────────────────────────
// A payment counts as a likely duplicate when a recent payment to the SAME
// party, for the SAME amount (exact match -- this is a duplicate-entry
// check, not a similarity heuristic), was posted within DUPLICATE_WINDOW_DAYS.
export const DUPLICATE_PAYMENT_WINDOW_DAYS = 3

export type PaymentCandidate = { amount: number; postingDate: string }

export function evaluateDuplicatePayment(candidate: PaymentCandidate, recentSameParty: PaymentCandidate[], windowDays: number = DUPLICATE_PAYMENT_WINDOW_DAYS): AnomalyVerdict {
  const candidateTime = new Date(candidate.postingDate).getTime()
  const windowMs = windowDays * 24 * 60 * 60 * 1000
  const match = recentSameParty.find((p) => p.amount === candidate.amount && Math.abs(new Date(p.postingDate).getTime() - candidateTime) <= windowMs)
  if (!match) return NO_ANOMALY
  return {
    anomaly: true,
    eventType: "duplicate_payment",
    severity: "high",
    reason: `Payment of ${candidate.amount} matches another payment to the same party for the same amount within ${windowDays} days (posted ${match.postingDate})`,
  }
}

// ─── Round-number / threshold-avoidance ─────────────────────────────────
// Two distinct fraud-shaped patterns in one rule, per the finding's own
// recommendation: (a) a suspiciously round amount at meaningful size (round
// numbers are rare in genuine invoiced amounts, common in fabricated ones),
// (b) an amount sitting just under a mandatory-approval threshold (structured
// to dodge the gate rather than genuinely being that size).
export const ROUND_NUMBER_MIN_AMOUNT = 50_000
const ROUND_NUMBER_MODULUS = 10_000
const THRESHOLD_AVOIDANCE_BAND = 0.1 // within 10% below the threshold

export function evaluateRoundNumberThresholdAvoidance(amount: number, approvalThreshold: number): AnomalyVerdict {
  const isRoundNumber = amount >= ROUND_NUMBER_MIN_AMOUNT && amount % ROUND_NUMBER_MODULUS === 0
  const isThresholdAvoidance = amount < approvalThreshold && amount >= approvalThreshold * (1 - THRESHOLD_AVOIDANCE_BAND)

  if (isThresholdAvoidance) {
    return {
      anomaly: true,
      eventType: "threshold_avoidance",
      severity: "high",
      reason: `Amount ${amount} sits just below the ${approvalThreshold} approval threshold (within ${THRESHOLD_AVOIDANCE_BAND * 100}%)`,
    }
  }
  if (isRoundNumber) {
    return {
      anomaly: true,
      eventType: "threshold_avoidance",
      severity: "low",
      reason: `Amount ${amount} is a suspiciously round number for a genuine transaction`,
    }
  }
  return NO_ANOMALY
}
