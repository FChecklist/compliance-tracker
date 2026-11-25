import { describe, expect, test } from "bun:test"
import { ageBucket, ageingDays, clientItem, firmRow, firmTotals, sortFirmRows, withWhom } from "./dashboard-rules"
import type { CaClientWire } from "./rpc-types"
import type { ObligationRow } from "./dpdp-onepage/view-model"

const NOW = new Date("2026-11-24T12:00:00Z")
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe("ageing", () => {
  test("bucket boundaries 7, 8, 14, 15, 30, 31", () => {
    const b = (d: number) => ageBucket(ageingDays(ago(d), NOW))
    expect([0, 7].map(b)).toEqual(["green", "green"])
    expect([8, 14].map(b)).toEqual(["amber", "amber"])
    expect([15, 30].map(b)).toEqual(["orange", "orange"])
    expect([31, 90].map(b)).toEqual(["red", "red"])
  })
  test("no data or a bad date gives none", () => {
    expect(ageingDays(null, NOW)).toBeNull()
    expect(ageingDays(undefined, NOW)).toBeNull()
    expect(ageingDays("not a date", NOW)).toBeNull()
    expect(ageBucket(null)).toBe("none")
  })
  test("a future date is 0 days, never negative", () => {
    expect(ageingDays(new Date(NOW.getTime() + 5 * 86_400_000), NOW)).toBe(0)
  })
  test("with whom: a named person wins, else the role of that step", () => {
    expect(withWhom("do", " asha@x.in ")).toBe("asha@x.in")
    expect(withWhom("discover")).toBe("Client")
    expect(withWhom("decide", "")).toBe("Client owner")
    expect(withWhom("do", null)).toBe("Client team")
  })
})

const wire = (o: Partial<CaClientWire> & { pendingSince?: string; nextActor?: string }, name = "A"): CaClientWire => ({
  org: { id: name, name, product: "firm" }, caSub: "manager", done: 0, total: 10, whereItIs: "x", dataLocations: 0, ownerConfirmedAt: null, setUpByMe: false, ...o,
})

describe("firm rows", () => {
  test("states, who is next and age", () => {
    const r = firmRow(wire({ dataLocations: 2, pendingSince: ago(9), nextActor: "raj@c.in" }), NOW)
    expect(r.steps).toEqual({ discover: "done", decide: "pending", do: "pending" })
    expect(r.firstPending).toBe("decide")
    expect(r.withWhom).toBe("raj@c.in")
    expect([r.ageDays, r.bucket]).toEqual([9, "amber"])
  })
  test("no pending date: pending work with no age, not invented", () => {
    const r = firmRow(wire({}), NOW)
    expect([r.ageDays, r.bucket, r.withWhom]).toEqual([null, "none", "Client"])
  })
  test("everything done", () => {
    const r = firmRow(wire({ dataLocations: 1, ownerConfirmedAt: ago(3), done: 10 }), NOW)
    expect([r.firstPending, r.withWhom, r.bucket]).toEqual([null, null, "green"])
  })
  test("a client with no jobs is not done", () => {
    expect(firmRow(wire({ total: 0, dataLocations: 1, ownerConfirmedAt: ago(1) }), NOW).steps.do).toBe("pending")
  })
  test("sort: oldest first, undated next, done last; totals", () => {
    const rows = ["old", "new", "undated", "fin"].map((n) => firmRow(wire(
      n === "old" ? { pendingSince: ago(40) } : n === "new" ? { pendingSince: ago(2) } : n === "fin" ? { dataLocations: 1, ownerConfirmedAt: ago(1), done: 10 } : {}, n), NOW))
    expect(sortFirmRows(rows).map((r) => r.name)).toEqual(["old", "new", "undated", "fin"])
    expect(firmTotals(rows)).toEqual({ clients: 4, done: 1, pending: 3, oldestPending: 40 })
    expect(firmTotals([]).oldestPending).toBeNull()
  })
})

const item = (o: Partial<ObligationRow>): ObligationRow => ({
  id: "1", part: 1, what: "w", dataSet: null, dataTypes: null, lawCodes: null, by: null, isGroup: false, due: new Date(NOW.getTime() + 86_400_000),
  yes: false, na: false, dependsOnObligationId: null, sent: 0, ...o,
})

describe("client items", () => {
  test("step placement", () => {
    expect(clientItem(item({}), NOW).step).toBe("discover")
    expect(clientItem(item({ dataSet: "HR" }), NOW)).toMatchObject({ step: "decide", withWhom: "Client owner" })
    expect(clientItem(item({ dataSet: "HR", by: "a@b.in" }), NOW)).toMatchObject({ step: "do", state: "pending", withWhom: "a@b.in" })
    expect(clientItem(item({ yes: true }), NOW)).toMatchObject({ step: "do", state: "done" })
  })
  test("age is days past due, 0 when not yet due", () => {
    expect(clientItem(item({ dataSet: "x", by: "a@b.in" }), NOW).ageDays).toBe(0)
    const late = clientItem(item({ dataSet: "x", by: "a@b.in", due: new Date(ago(16)) }), NOW)
    expect([late.ageDays, late.bucket]).toEqual([15, "orange"]) // whole days by the list's own rule (daysLate)
  })
})
