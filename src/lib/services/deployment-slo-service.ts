// VERIDIAN Review Framework gap-closure, Cloud Deployment / Deployment
// Automation (2026-08-07): "Production Deployment Reliability" was flagged
// with "No measured production reliability SLO." Re-checked live before
// writing this: `deploymentEvents` (schema.ts, GAP-D15-REMAINING-TRIGGERS)
// and its real receiver (src/app/api/webhooks/vercel-deployment/route.ts)
// already exist and have been recording every real
// deployment.created/succeeded/error delivery Vercel sends this app -- the
// review's own recommended approach ("build off Sentry + Vercel deployment
// webhook data, webhook already exists") was written with exactly this
// table in mind. This file is the "measured SLO" that was missing: a pure,
// unit-testable calculation over that already-real data, plus a
// best-effort Sentry issue-count overlay.
//
// Sentry overlay is a deliberate safe no-op until real credentials exist,
// same precedent as sentry.server.config.ts / docs/infra/
// TOOL_INTEGRATION_PLAN.md's Sentry backlog item (`Sentry.init({dsn:
// undefined})` disables the SDK rather than erroring) -- SENTRY_AUTH_TOKEN/
// SENTRY_ORG/SENTRY_PROJECT are not configured anywhere in this repo today
// (grepped fresh before writing this), so getSentryIssueSummary() honestly
// reports "not configured" instead of fabricating a number.
//
// PLATFORM-WIDE, no org scoping: deploymentEvents has no org_id column (a
// Vercel deployment belongs to this app's single Vercel project, not any
// one tenant -- see that table's own schema.ts comment), so this reads it
// directly via db.query, the same un-scoped pattern module-registry-
// service.ts and capability-tree-service.ts already use for other
// platform-wide tables.
import { db, deploymentEvents } from "@/lib/db"
import { gte } from "drizzle-orm"

// Target is intentionally modest and documented, not aspirational-and-
// unmeasurable: 95% of recorded production deployment.succeeded/
// deployment.error events in the trailing window should be successes. This
// is a starting SLO to track drift against, not a claim this number is
// industry-calibrated -- revisit once enough real windows have been
// measured to know if it's the right bar.
export const DEPLOYMENT_SLO_TARGET_SUCCESS_RATE_PCT = 95
export const DEFAULT_SLO_WINDOW_DAYS = 30

// ─── Pure calculation (no DB access -- kept separate and exported so it can
// be unit-tested directly against fixture data, matching this codebase's
// established convention, e.g. hr-attendance-service.ts's pure-helpers
// section) ──────────────────────────────────────────────────────────────
export type DeploymentEventLite = {
  eventType: string
  target: string | null
  receivedAt: Date
}

export type DeploymentSloResult = {
  windowDays: number
  totalOutcomes: number
  succeeded: number
  errored: number
  successRatePct: number | null
  targetSuccessRatePct: number
  meetsTarget: boolean | null
  lastEvent: { eventType: string; target: string | null; receivedAt: Date } | null
  daysSinceLastError: number | null
}

/**
 * Computes SLO stats from an already-fetched, already-window-filtered list
 * of deployment events (production `deployment.succeeded` /
 * `deployment.error` deliveries only -- `deployment.created` is a lifecycle
 * marker, not an outcome, and is deliberately excluded from the
 * success-rate denominator).
 */
export function computeSloFromEvents(
  events: DeploymentEventLite[],
  now: Date,
  windowDays: number = DEFAULT_SLO_WINDOW_DAYS
): DeploymentSloResult {
  const outcomes = events.filter((e) => e.eventType === "deployment.succeeded" || e.eventType === "deployment.error")
  const succeeded = outcomes.filter((e) => e.eventType === "deployment.succeeded").length
  const errored = outcomes.filter((e) => e.eventType === "deployment.error").length
  const totalOutcomes = outcomes.length

  const successRatePct = totalOutcomes > 0 ? Math.round((succeeded / totalOutcomes) * 1000) / 10 : null
  const meetsTarget = successRatePct === null ? null : successRatePct >= DEPLOYMENT_SLO_TARGET_SUCCESS_RATE_PCT

  const sorted = [...outcomes].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
  const lastEvent = sorted[0] ?? null

  const lastError = outcomes
    .filter((e) => e.eventType === "deployment.error")
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0]
  const daysSinceLastError = lastError
    ? Math.floor((now.getTime() - lastError.receivedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null

  return {
    windowDays,
    totalOutcomes,
    succeeded,
    errored,
    successRatePct,
    targetSuccessRatePct: DEPLOYMENT_SLO_TARGET_SUCCESS_RATE_PCT,
    meetsTarget,
    lastEvent: lastEvent ? { eventType: lastEvent.eventType, target: lastEvent.target, receivedAt: lastEvent.receivedAt } : null,
    daysSinceLastError,
  }
}

export type SentryIssueSummary =
  | { configured: false; note: string }
  | { configured: true; error: string }
  | { configured: true; issueCount: number; windowDays: number }

/**
 * Best-effort Sentry overlay. Returns `{configured: false, note}` (not a
 * thrown error) when SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT aren't set
 * -- honest about the real blocker (account creation is the repo owner's
 * step, see TOOL_INTEGRATION_PLAN.md §"Genuine new candidates") rather than
 * pretending Sentry data is part of the SLO today.
 */
export async function getSentryIssueSummary(windowDays: number = DEFAULT_SLO_WINDOW_DAYS): Promise<SentryIssueSummary> {
  const token = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  if (!token || !org || !project) {
    return {
      configured: false,
      note: "SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT not configured -- Sentry account creation is the repo owner's step (see docs/infra/TOOL_INTEGRATION_PLAN.md). SLO is computed from Vercel deployment events alone until then.",
    }
  }

  try {
    const res = await fetch(
      `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/?statsPeriod=${windowDays}d&query=is:unresolved`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      return { configured: true, error: `Sentry API returned ${res.status}` }
    }
    const issues = (await res.json()) as unknown[]
    return { configured: true, issueCount: Array.isArray(issues) ? issues.length : 0, windowDays }
  } catch (err) {
    return { configured: true, error: err instanceof Error ? err.message : "Sentry API request failed" }
  }
}

/**
 * Real entry point: queries production deployment.succeeded/deployment.error
 * events from the last `windowDays` days and combines the pure SLO
 * calculation with the best-effort Sentry overlay.
 */
export async function getDeploymentSlo(
  windowDays: number = DEFAULT_SLO_WINDOW_DAYS
): Promise<DeploymentSloResult & { sentry: SentryIssueSummary }> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const rows = await db.query.deploymentEvents.findMany({
    where: gte(deploymentEvents.receivedAt, cutoff),
    columns: { eventType: true, target: true, receivedAt: true },
  })
  // Production-only: staging/preview deployment noise (see
  // docs/infra/DEPLOYMENT_ENVIRONMENTS.md) shouldn't dilute the production
  // reliability number.
  const productionRows = rows.filter((r) => r.target === "production")

  const slo = computeSloFromEvents(productionRows, new Date(), windowDays)
  const sentry = await getSentryIssueSummary(windowDays)
  return { ...slo, sentry }
}
