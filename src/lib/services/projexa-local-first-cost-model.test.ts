// Arithmetic of scripts/verify/projexa-local-first-cost-model.mjs (package lf-b4-runbook). Hand-computed expectations, no network.
import { describe, expect, test } from "bun:test"
// @ts-expect-error plain ESM script without types
import { DEFAULT_ASSUMPTIONS, DEFAULT_LIMITS, estimate, parseArgs, perUserMonthly } from "../../../scripts/verify/projexa-local-first-cost-model.mjs"

const base = { ...DEFAULT_ASSUMPTIONS }
// a quiet laptop: one session, no polling, no pushes, no peers, no repair
const quiet = { ...base, users: 10, sessionsPerDay: 1, sessionHoursPerDay: 0, syncIntervalMin: 10, changedRowsPerDay: 0, idsRepairsPerDay: 0, jobsPollSec: 0, pushOpsPerDay: 0, peerShare: 0, newUserShare: 0, releasesPerMonth: 0 }

describe("perUserMonthly edge invocations", () => {
  test("a quiet user costs only the app-open calls: (release/current + manifest) x sessions + 1 attest, per active day", () => {
    expect(perUserMonthly(quiet).edgeInvocations).toBe(22 * 3)
  })
  test("/ids repair is P x K x ceil(rows/5000) a day", () => {
    const u = perUserMonthly({ ...quiet, idsRepairsPerDay: 1, projectsPerUser: 3, kinds: 28, rowsPerKind: 200 })
    expect(u.breakdownPerDay.idsRepair).toBe(84)
    expect(u.edgeInvocations).toBe(22 * (3 + 84))
    expect(perUserMonthly({ ...quiet, idsRepairsPerDay: 1, rowsPerKind: 5001 }).breakdownPerDay.idsRepair).toBe(3 * 28 * 2)
  })
  test("/changes polls the polled projects every tick: hours x 60 / interval x polled", () => {
    expect(perUserMonthly({ ...quiet, sessionHoursPerDay: 6, syncIntervalMin: 10, projectsPolledPerTick: 2 }).breakdownPerDay.changes).toBe(72)
  })
  test("every push op also invokes ai-work-link-exec: ceil(ops/batch) + ops", () => {
    const b = perUserMonthly({ ...quiet, pushOpsPerDay: 30, pushBatchOps: 5 }).breakdownPerDay
    expect(b.pushCalls).toBe(6)
    expect(b.execCalls).toBe(30)
  })
  test("a batch larger than the 50-op protocol cap is clamped to 50", () => {
    expect(perUserMonthly({ ...quiet, pushOpsPerDay: 100, pushBatchOps: 500 }).breakdownPerDay.pushCalls).toBe(2)
  })
  test("jobs polling is sessionHours x 3600 / interval, and 0 turns it off", () => {
    expect(perUserMonthly({ ...quiet, sessionHoursPerDay: 1, jobsPollSec: 600 }).breakdownPerDay.jobs).toBe(6)
    expect(perUserMonthly({ ...quiet, sessionHoursPerDay: 1, jobsPollSec: 0 }).breakdownPerDay.jobs).toBe(0)
  })
  test("peer share removes pull-by-ids calls but never /changes polls", () => {
    const a = { ...quiet, sessionHoursPerDay: 6, changedRowsPerDay: 40, kindsTouchedPerDay: 4 }
    expect(perUserMonthly({ ...a, peerShare: 0 }).breakdownPerDay.pullIds).toBe(4)
    const full = perUserMonthly({ ...a, peerShare: 1 })
    expect(full.breakdownPerDay.pullIds).toBe(0)
    expect(full.breakdownPerDay.changes).toBe(36)
  })
  test("first full sync (new users) adds P x K x ceil(rows/500) + P calls once", () => {
    const u = perUserMonthly({ ...quiet, newUserShare: 1, rowsPerKind: 600 })
    expect(u.edgeInvocations - 22 * 3).toBe(3 * 28 * 2 + 3)
  })
})

describe("egress, realtime and vercel", () => {
  test("pulled rows cost (avgRowBytes + sigOverhead) each and peers take their share", () => {
    const a = { ...quiet, sessionsPerDay: 0, changedRowsPerDay: 10, kindsTouchedPerDay: 1, avgRowBytes: 1000, sigOverheadBytes: 0, smallCallBytes: 0, manifestBytes: 0, changeBytes: 0 }
    expect(perUserMonthly({ ...a, peerShare: 0 }).egressBytes).toBe(22 * 10 * 1000)
    expect(perUserMonthly({ ...a, peerShare: 0.5 }).egressBytes).toBe(22 * 5 * 1000)
  })
  test("realtime messages count sent + delivered copies; no peers means no connections", () => {
    const u = perUserMonthly({ ...quiet, peerShare: 0.5, changedRowsPerDay: 10, sessionsPerDay: 1, peersOnline: 5 })
    expect(u.realtimeMessages).toBe(22 * (10 * 0.5 + 2) * 5)
    expect(u.realtimeConcurrent).toBe(0.5)
    expect(perUserMonthly({ ...quiet, peerShare: 0 }).realtimeConcurrent).toBe(0)
  })
  test("vercel functions are zero by default", () => {
    expect(perUserMonthly(base).vercelFunctions).toBe(0)
  })
})

describe("estimate", () => {
  test("binding constraint is the resource with the smallest break-even user count, and the verdict follows the ratios", () => {
    const e = estimate({ ...quiet, users: 10 }, { ...DEFAULT_LIMITS, supabaseEdgeInvocations: 330 })
    // 66 invocations per user -> 5 users fit in 330
    expect(e.binding.key).toBe("supabaseEdgeInvocations")
    expect(e.binding.maxUsers).toBe(5)
    expect(e.withinFreeTier).toBe(false)
    expect(estimate({ ...quiet, users: 5 }, { ...DEFAULT_LIMITS, supabaseEdgeInvocations: 330 }).withinFreeTier).toBe(true)
  })
  test("usage is linear in users", () => {
    const one = estimate({ ...base, users: 1 }).rows[0].total
    expect(estimate({ ...base, users: 40 }).rows[0].total).toBeCloseTo(one * 40, 6)
  })
  test("the default 50-user scenario is inside the free tier and the Edge invocation limit binds", () => {
    const e = estimate(base)
    expect(e.withinFreeTier).toBe(true)
    expect(e.binding.key).toBe("supabaseEdgeInvocations")
  })
})

describe("parseArgs", () => {
  test("assumptions and limits are routed to their own objects", () => {
    const p = parseArgs(["--users", "7", "--supabaseEgressGB", "9", "--json"])
    expect(p.assumptions.users).toBe(7)
    expect(p.limits.supabaseEgressGB).toBe(9)
    expect(p.json).toBe(true)
  })
  test("unknown or invalid options are refused", () => {
    expect(() => parseArgs(["--nope", "1"])).toThrow()
    expect(() => parseArgs(["--users", "-3"])).toThrow()
    expect(() => parseArgs(["--users", "abc"])).toThrow()
  })
})
