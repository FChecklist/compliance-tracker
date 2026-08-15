import { describe, expect, test } from "bun:test"
import { buildCorrelation, detectFailureClusters, MIN_CLUSTER_SIZE, CLUSTER_GAP_MINUTES } from "./provider-outage-service"

describe("buildCorrelation", () => {
  test("no rows in either window -> empty result", () => {
    expect(buildCorrelation([], [])).toEqual([])
  })

  test("failure rate spikes during the outage window relative to baseline", () => {
    const during = [
      { roleKey: "role_a", status: "failure" },
      { roleKey: "role_a", status: "failure" },
      { roleKey: "role_a", status: "success" },
    ]
    const baseline = [
      { roleKey: "role_a", status: "success" },
      { roleKey: "role_a", status: "success" },
      { roleKey: "role_a", status: "success" },
      { roleKey: "role_a", status: "failure" },
    ]
    const [entry] = buildCorrelation(during, baseline)
    expect(entry.roleKey).toBe("role_a")
    expect(entry.duringFailureRate).toBeCloseTo(2 / 3)
    expect(entry.baselineFailureRate).toBeCloseTo(1 / 4)
    expect(entry.failureRateDelta).toBeCloseTo(2 / 3 - 1 / 4)
  })

  test("a role with zero dispatches in a window gets a null rate, not a fabricated 0", () => {
    const during = [{ roleKey: "role_a", status: "failure" }]
    const baseline: { roleKey: string; status: string }[] = [] // role_a had no dispatches at all in the baseline window
    const [entry] = buildCorrelation(during, baseline)
    expect(entry.baselineTotal).toBe(0)
    expect(entry.baselineFailureRate).toBeNull()
    expect(entry.failureRateDelta).toBeNull() // undefined comparison, not silently treated as +100%
  })

  test("unions roles present in only one of the two windows", () => {
    const during = [{ roleKey: "only_during", status: "failure" }]
    const baseline = [{ roleKey: "only_baseline", status: "success" }]
    const roleKeys = buildCorrelation(during, baseline).map((e) => e.roleKey).sort()
    expect(roleKeys).toEqual(["only_baseline", "only_during"])
  })

  test("sorts worst-affected role (largest positive delta) first", () => {
    const during = [
      { roleKey: "mild", status: "failure" }, { roleKey: "mild", status: "success" }, { roleKey: "mild", status: "success" }, { roleKey: "mild", status: "success" },
      { roleKey: "severe", status: "failure" }, { roleKey: "severe", status: "failure" }, { roleKey: "severe", status: "success" },
    ]
    const baseline = [
      { roleKey: "mild", status: "success" }, { roleKey: "mild", status: "success" }, { roleKey: "mild", status: "success" }, { roleKey: "mild", status: "success" },
      { roleKey: "severe", status: "success" }, { roleKey: "severe", status: "success" }, { roleKey: "severe", status: "success" },
    ]
    const entries = buildCorrelation(during, baseline)
    expect(entries.map((e) => e.roleKey)).toEqual(["severe", "mild"])
  })
})

describe("detectFailureClusters", () => {
  const minutesApart = (baseMs: number, minutes: number) => new Date(baseMs + minutes * 60_000)
  const base = Date.parse("2026-08-15T10:00:00.000Z")

  test("no failures -> no candidates", () => {
    expect(detectFailureClusters([])).toEqual([])
  })

  test("an isolated single failure is never a candidate (below MIN_CLUSTER_SIZE)", () => {
    expect(MIN_CLUSTER_SIZE).toBeGreaterThan(1)
    const candidates = detectFailureClusters([{ model: "m1", dispatchedAt: new Date(base) }])
    expect(candidates).toEqual([])
  })

  test("MIN_CLUSTER_SIZE failures within CLUSTER_GAP_MINUTES of each other form one candidate window", () => {
    const failures = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m1", dispatchedAt: minutesApart(base, i * 2) }))
    const candidates = detectFailureClusters(failures)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].model).toBe("m1")
    expect(candidates[0].failureCount).toBe(MIN_CLUSTER_SIZE)
  })

  test("a gap larger than CLUSTER_GAP_MINUTES splits into two separate clusters", () => {
    const firstCluster = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m1", dispatchedAt: minutesApart(base, i) }))
    const secondClusterStart = base + (CLUSTER_GAP_MINUTES + 30) * 60_000
    const secondCluster = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m1", dispatchedAt: minutesApart(secondClusterStart, i) }))
    const candidates = detectFailureClusters([...firstCluster, ...secondCluster])
    expect(candidates).toHaveLength(2)
  })

  test("different models are clustered independently", () => {
    const failuresM1 = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m1", dispatchedAt: minutesApart(base, i) }))
    const failuresM2 = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m2", dispatchedAt: minutesApart(base, i) }))
    const candidates = detectFailureClusters([...failuresM1, ...failuresM2])
    expect(candidates.map((c) => c.model).sort()).toEqual(["m1", "m2"])
  })

  test("unsorted input is still clustered correctly (function sorts internally)", () => {
    const failures = Array.from({ length: MIN_CLUSTER_SIZE }, (_, i) => ({ model: "m1", dispatchedAt: minutesApart(base, i * 2) })).reverse()
    const candidates = detectFailureClusters(failures)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].startedAt.getTime()).toBe(base)
  })
})
