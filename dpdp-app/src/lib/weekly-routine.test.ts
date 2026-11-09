import { describe, expect, test } from "bun:test"
import { cadence, checkCounts, runsToEntries, STAGES, stageLog, weekStart, type HistoryLike } from "./weekly-routine"

const at = (iso: string) => new Date(iso)
const e = (kind: string, iso: string): HistoryLike => ({ kind, summary: `did ${kind}`, actorLabel: "Asha", occurredAt: at(iso) })
const NOW = at("2026-11-11T09:00:00Z") // a Wednesday

describe("weekly routine rules", () => {
  test("three stages, each with numbered steps by a person, the device or the helper", () => {
    expect(STAGES.map((s) => s.name)).toEqual(["Discover", "Act", "Confirm"])
    for (const s of STAGES) expect(s.steps.map((x) => x.n)).toEqual([1, 2, 3])
  })
  test("a week starts on Monday", () => {
    expect(weekStart(NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z")
    expect(weekStart(at("2026-11-15T23:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z") // Sunday
    expect(weekStart(at("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z")
  })
  test("stage log: newest entry of that stage's kinds; other kinds are ignored", () => {
    const h = [e("obligation_accepted", "2026-11-10T08:00:00Z"), e("obligation_assigned", "2026-11-03T08:00:00Z"), e("payment_confirmed", "2026-11-11T08:00:00Z"), e("ai_link_created", "2026-11-02T08:00:00Z")]
    const act = stageLog("act", h, NOW)
    expect(act.lastWhat).toBe("A job was updated") // never the History sentence itself
    expect(act.thisWeek).toBe(true)
    expect(act.countThisWeek).toBe(1)
    const know = stageLog("know", h, NOW)
    expect(know.thisWeek).toBe(false) // 2 Nov is last week
    expect(know.lastAt?.toISOString()).toBe("2026-11-02T08:00:00.000Z")
    expect(stageLog("check", h, NOW).lastAt).toBeNull()
  })
  test("cadence: four weeks, missed counts only finished weeks with nothing, next run is next Monday", () => {
    const h = [e("obligation_accepted", "2026-11-10T08:00:00Z"), e("ai_link_created", "2026-10-28T08:00:00Z")]
    const c = cadence(h, NOW)
    expect(c.weeks.map((w) => w.ran)).toEqual([false, true, false, true]) // weeks of 19 Oct, 26 Oct, 2 Nov, 9 Nov
    expect(c.weeks[3].current).toBe(true)
    expect(c.missed).toBe(2)
    expect(c.nextRun.toISOString()).toBe("2026-11-16T00:00:00.000Z")
    expect(c.lastRun?.toISOString()).toBe("2026-11-10T08:00:00.000Z")
    expect(cadence([], NOW).lastRun).toBeNull()
    expect(cadence([], NOW).missed).toBe(3)
  })
  test("check counts: not-applicable jobs are left out; late = open and past due", () => {
    const rows = [
      { yes: true, na: false, due: at("2026-11-01T00:00:00Z") },
      { yes: false, na: false, due: at("2026-11-05T00:00:00Z") },
      { yes: false, na: false, due: at("2026-11-20T00:00:00Z") },
      { yes: false, na: true, due: at("2026-11-01T00:00:00Z") },
    ]
    expect(checkCounts(rows, NOW)).toEqual({ done: 1, open: 2, late: 1, total: 3 })
  })
  test("the server's weekly record is read like History: stage, who, outcome, and the person's sign-off line", () => {
    const runs = runsToEntries([
      { id: "1", stage: "discover", weekStart: "2026-11-09", ranAt: "2026-11-09T04:00:00Z", byKind: "software", actorLabel: "Automatic helper", outcome: "ok", note: "Monday reading" },
      { id: "2", stage: "confirm", weekStart: "2026-11-09", ranAt: "2026-11-10T10:00:00Z", byKind: "person", actorLabel: null, outcome: "failed", note: null },
    ])
    const know = stageLog("know", runs, NOW)
    expect(know.lastWho).toBe("Automatic helper")
    expect(know.lastWhat).toBe("Discover finished (Monday reading)")
    expect(know.thisWeek).toBe(true)
    expect(stageLog("check", runs, NOW).lastWhat).toBe("Confirm did not finish")
    expect(stageLog("check", [e("weekly_run_logged", "2026-11-10T08:00:00Z")], NOW).thisWeek).toBe(true) // a sign-off also in History
    expect(cadence(runs, NOW).weeks[3].ran).toBe(true)
  })
})
