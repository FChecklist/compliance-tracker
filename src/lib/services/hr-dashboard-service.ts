// V2-17 (HR performance/error-handling + payroll rate audit, redispatch
// 2026-07-26): compliance-tracker's HR module (hr-service.ts,
// hr-attendance-service.ts, recruitment-service.ts, performance-service.ts)
// had no cross-module KPI summary at all -- every HR screen queries its own
// narrow slice, confirmed by a fresh grep for "kpi"/"dashboard" across
// src/lib/services and src/app/api/hr before writing this (zero hits). This
// aggregates the handful of numbers a real HR dashboard needs (headcount,
// pending leave, open requisitions/pipeline, today's attendance rate,
// pending reviews) behind an in-process TTL cache, following
// asset-registry-cache.ts's established convention (single Map, in-flight-
// load dedup so a burst of concurrent dashboard loads shares one query
// instead of each re-querying Postgres, explicit same-instance
// invalidation, TTL as the only cross-instance freshness mechanism -- same
// honest "per serverless instance, not global" limitation documented
// there). Reads go through withTenantContext (this codebase's RLS-aware
// query path, matching compliance-service.ts's getComplianceStats -- not
// asset-registry-cache.ts's own raw-`db` shortcut, since that file caches a
// platform-wide table with no per-org RLS policy to honor).
import { employeeProfiles, leaveRequests, jobOpenings, jobApplications, hrAttendanceRecords, performanceReviews } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, sql } from "drizzle-orm"

export type HrDashboardKpis = {
  headcount: number
  pendingLeaveRequests: number
  openJobOpenings: number
  candidatesInPipeline: number
  attendanceMarkedToday: number
  // null (not 0) when headcount is 0 -- a real 0-headcount org would
  // otherwise read as "0% attendance / everyone absent", which is
  // misleading rather than merely uninformative.
  attendanceRateToday: number | null
  pendingPerformanceReviews: number
  computedAt: string
}

// 60s, matching asset-registry-cache.ts's own CACHE_TTL_MS reasoning: short
// enough that a dashboard KPI is never meaningfully stale to a human
// looking at it, long enough that concurrent dashboard loads (multiple
// managers opening the page around the same time) share one computed
// result instead of each firing 6 fresh count queries.
export const HR_DASHBOARD_CACHE_TTL_MS = 60_000

// Stages that still represent an open, in-progress candidate -- 'hired' and
// 'rejected' are terminal and deliberately excluded (matches
// applicationStageEnum's own 6 values in schema.ts).
const OPEN_APPLICATION_STAGES = ["applied", "screening", "interview", "offer"] as const

// Pure, exported separately so it can be unit-tested directly without a DB
// -- matches hr-attendance-service.ts's established convention of pulling
// business-rule arithmetic out of the DB-touching function it's embedded in.
export function computeAttendanceRate(headcount: number, attendanceMarkedToday: number): number | null {
  if (headcount <= 0) return null
  return Math.round((attendanceMarkedToday / headcount) * 1000) / 10
}

type CacheEntry = { loadedAt: number; kpis: HrDashboardKpis }
const kpiCache = new Map<string, CacheEntry>()
const inFlightLoads = new Map<string, Promise<HrDashboardKpis>>()

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return entry !== undefined && Date.now() - entry.loadedAt < HR_DASHBOARD_CACHE_TTL_MS
}

async function computeHrDashboardKpis(orgId: string): Promise<HrDashboardKpis> {
  const today = new Date().toISOString().slice(0, 10)

  return withTenantContext({ orgId }, async (db) => {
    const orgFilter = { employeeProfiles: eq(employeeProfiles.orgId, orgId), leaveRequests: eq(leaveRequests.orgId, orgId), jobOpenings: eq(jobOpenings.orgId, orgId), jobApplications: eq(jobApplications.orgId, orgId), hrAttendanceRecords: eq(hrAttendanceRecords.orgId, orgId), performanceReviews: eq(performanceReviews.orgId, orgId) }

    const [headcount, pendingLeaveRequests, openJobOpenings, candidatesInPipeline, attendanceMarkedToday, pendingPerformanceReviews] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(employeeProfiles)
        .where(and(orgFilter.employeeProfiles, eq(employeeProfiles.employmentStatus, "active"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(leaveRequests)
        .where(and(orgFilter.leaveRequests, eq(leaveRequests.status, "pending"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(jobOpenings)
        .where(and(orgFilter.jobOpenings, eq(jobOpenings.status, "open"))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(jobApplications)
        .where(and(orgFilter.jobApplications, inArray(jobApplications.stage, [...OPEN_APPLICATION_STAGES]))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(hrAttendanceRecords)
        .where(and(orgFilter.hrAttendanceRecords, eq(hrAttendanceRecords.date, today))).then(r => r[0].count),
      db.select({ count: sql<number>`count(*)::int` }).from(performanceReviews)
        .where(and(orgFilter.performanceReviews, eq(performanceReviews.status, "pending"))).then(r => r[0].count),
    ])

    return {
      headcount, pendingLeaveRequests, openJobOpenings, candidatesInPipeline, attendanceMarkedToday,
      attendanceRateToday: computeAttendanceRate(headcount, attendanceMarkedToday),
      pendingPerformanceReviews,
      computedAt: new Date().toISOString(),
    }
  })
}

// The one read entry point HR dashboard callers use. Cache hit:
// synchronous-fast in-memory return. Cache miss or expired: computes once
// (deduplicated via inFlightLoads across concurrent callers), then serves
// from memory until the next expiry or explicit invalidation.
export async function getHrDashboardKpis(orgId: string): Promise<HrDashboardKpis> {
  const existing = kpiCache.get(orgId)
  if (isFresh(existing)) return existing.kpis

  const inFlight = inFlightLoads.get(orgId)
  if (inFlight) return inFlight

  const loadPromise = computeHrDashboardKpis(orgId)
    .then((kpis) => {
      kpiCache.set(orgId, { loadedAt: Date.now(), kpis })
      return kpis
    })
    .finally(() => {
      inFlightLoads.delete(orgId)
    })
  inFlightLoads.set(orgId, loadPromise)
  return loadPromise
}

// Best-effort same-instance invalidation for any future write path that
// wants immediate freshness (e.g. a leave-request decision or a job-opening
// status change could call this right after its write) -- not wired into
// any write path yet, since none of this wave's touched writes are on the
// hot dashboard-KPI path; exposed so the next HR write that cares about
// dashboard freshness doesn't have to invent this itself.
export function invalidateHrDashboardCache(orgId: string): void {
  kpiCache.delete(orgId)
}

// Observability -- same rationale as asset-registry-cache.ts's
// getCacheStats: concrete evidence the cache is doing something, not just
// an assertion.
export function getHrDashboardCacheStats(): { cachedOrgs: number; entries: Array<{ orgId: string; ageMs: number }> } {
  const now = Date.now()
  return {
    cachedOrgs: kpiCache.size,
    entries: Array.from(kpiCache.entries()).map(([orgId, entry]) => ({ orgId, ageMs: now - entry.loadedAt })),
  }
}
