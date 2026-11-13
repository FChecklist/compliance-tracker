/// <reference types="bun-types" />
// The browser's copy of the ICP rules (src/lib/icp.ts) and the offline mock that runs them (src/lib/icp-mock.ts). The database decides; the same rules are
// compared with the real SQL functions in src/lib/services/dpdp-icp-identify-classify.pglite.test.ts (repo root).
import { describe, expect, test } from "bun:test"
import { addDaysISO, FLAG_TEXT, itemFlags, looksLikePerson, mondayOf, retentionLine, weekLine, type IcpItem } from "./icp"
import { CHILDREN_JOB_INDEXES, icpRpc, icpStatus, type IcpMockHost } from "./icp-mock"

const base: Parameters<typeof itemFlags>[0] = {
  kind: "data_set", status: "active", principalType: "staff", children: false, purpose: "Payroll", lawfulBasis: "employment", retentionDays: 2555, retentionNote: null,
  agreementStatus: null, firstSeenWeek: "2026-11-09", lastConfirmedWeek: "2026-11-09",
}
const W = "2026-11-09"

describe("weeks", () => {
  test("the Monday of any day, in UTC", () => {
    expect(mondayOf(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09")
    expect(mondayOf(new Date("2026-11-15T23:59:59Z"))).toBe("2026-11-09")
    expect(mondayOf(new Date("2026-11-16T00:00:01Z"))).toBe("2026-11-16")
    expect(addDaysISO("2026-11-09", -21)).toBe("2026-10-19")
    expect(weekLine("2026-11-09")).toBe("Monday 9 Nov")
  })
})

describe("the name guard: the register holds things, not people", () => {
  test.each(["asha@example.com", "Call 9876543210", "98765 43210 office", "Phone 98-7654-3210"])("%s is refused", (n) => expect(looksLikePerson(n)).toBe(true))
  test.each(["Student admission files", "Class 10 marks", "CCTV recordings", "School ERP v2"])("%s is accepted", (n) => expect(looksLikePerson(n)).toBe(false))
})

describe("the derived flags (the same rules as dpdp.icp_item_flags)", () => {
  test("a complete adult line has no flags", () => expect(itemFlags(base, W, false)).toEqual([]))
  test.each([
    ["principal type", { principalType: null }], ["children answer", { children: null }], ["purpose", { purpose: null }], ["basis", { lawfulBasis: null }],
  ] as const)("missing %s -> unclassified", (_n, patch) => expect(itemFlags({ ...base, ...patch }, W, false)).toEqual(["unclassified"]))
  test("retention may be a number or a note; neither -> unclassified", () => {
    expect(itemFlags({ ...base, retentionDays: null, retentionNote: "Until the student leaves" }, W, false)).toEqual([])
    expect(itemFlags({ ...base, retentionDays: null, retentionNote: null }, W, false)).toEqual(["unclassified"])
  })
  test("children: no basis or 'not sure' -> basis missing; consent with no parent answer -> not collected; an answer clears it; other bases are not asked for consent", () => {
    const kid = { ...base, children: true, principalType: "student" as const }
    expect(itemFlags({ ...kid, lawfulBasis: "not_sure" }, W, false)).toEqual(["children_basis_missing"])
    expect(itemFlags({ ...kid, lawfulBasis: "consent" }, W, false)).toEqual(["children_consent_not_collected"])
    expect(itemFlags({ ...kid, lawfulBasis: "consent" }, W, true)).toEqual([])
    expect(itemFlags({ ...kid, lawfulBasis: "legal_obligation" }, W, false)).toEqual([])
  })
  test("a vendor needs a signed agreement; systems and groups of people do not", () => {
    expect(itemFlags({ ...base, kind: "vendor" }, W, false)).toEqual(["vendor_agreement_missing"])
    expect(itemFlags({ ...base, kind: "vendor", agreementStatus: "requested" }, W, false)).toEqual(["vendor_agreement_missing"])
    expect(itemFlags({ ...base, kind: "vendor", agreementStatus: "signed" }, W, false)).toEqual([])
    expect(itemFlags({ ...base, kind: "system" }, W, false)).toEqual([])
  })
  test("stale only after more than three weeks since the last confirmation (or first seen)", () => {
    expect(itemFlags({ ...base, lastConfirmedWeek: "2026-10-19" }, W, false)).toEqual([])
    expect(itemFlags({ ...base, lastConfirmedWeek: "2026-10-12" }, W, false)).toEqual(["stale"])
    expect(itemFlags({ ...base, lastConfirmedWeek: null, firstSeenWeek: "2026-10-05" }, W, false)).toEqual(["stale"])
  })
  test("a retired line has no flags; every flag has a plain sentence", () => {
    expect(itemFlags({ ...base, status: "retired", purpose: null }, W, false)).toEqual([])
    for (const k of ["unclassified", "children_basis_missing", "children_consent_not_collected", "vendor_agreement_missing", "stale"]) expect(FLAG_TEXT[k].length).toBeGreaterThan(20)
  })
  test("nothing in the wording claims compliance", () => {
    const all = Object.values(FLAG_TEXT).join(" ").toLowerCase()
    for (const w of ["compliant", "certified", "guarantee"]) expect(all).not.toContain(w)
  })
  test("retention reads in years when it can", () => {
    expect(retentionLine({ retentionDays: 365, retentionNote: null })).toBe("1 year")
    expect(retentionLine({ retentionDays: 2555, retentionNote: null })).toBe("7 years")
    expect(retentionLine({ retentionDays: 400, retentionNote: null })).toBe("400 days")
    expect(retentionLine({ retentionDays: null, retentionNote: "Until exit" })).toBe("Until exit")
  })
})

function host(product: "firm" | "institution" = "institution"): IcpMockHost & { events: string[] } {
  const events: string[] = []
  const rows = [
    { libIndex: 4, part: 2, dataSet: "Students", na: false, yes: false, due: "2099-01-01T00:00:00Z" },
    { libIndex: 5, part: 2, dataSet: "Staff records", na: false, yes: false, due: "2099-01-01T00:00:00Z" },
    { libIndex: 6, part: 2, dataSet: "Parents", na: true, yes: false, due: "2099-01-01T00:00:00Z" },
    { libIndex: 11, part: 3, dataSet: "", na: true, yes: false, due: "2099-01-01T00:00:00Z" },
    { libIndex: 14, part: 3, dataSet: "", na: true, yes: false, due: "2099-01-01T00:00:00Z" },
  ]
  return { product, rows, eventsThisWeek: 0, events, log: (k) => { events.push(k) } }
}
const call = (h: IcpMockHost, fn: string, args: Record<string, unknown> = {}, canWrite = true, now = new Date("2026-11-11T10:00:00Z")) => icpRpc(h, fn, args, canWrite, now)!
const data = <T,>(r: ReturnType<typeof call>) => { expect(r.error).toBeNull(); return r.data as T }

describe("the offline mock follows the database's rules", () => {
  test("a staff view can read but not change; a new line has the same guards", () => {
    const h = host()
    expect(call(h, "dpdp_icp_save_item", { p_item: { kind: "data_set", name: "Fees" } }, false).error?.message).toContain("Only the people who see the whole organisation")
    expect(call(h, "dpdp_icp_register", {}, false).error).toBeNull()
    expect(call(h, "dpdp_icp_save_item", { p_item: { kind: "data_set", name: "a@b.in" } }).error?.message).toContain("not a person")
    expect(call(h, "dpdp_icp_save_item", { p_item: { kind: "nope", name: "Fees" } }).error?.message).toContain("Say whether")
    data(call(h, "dpdp_icp_save_item", { p_item: { kind: "data_set", name: "Fees" } }))
    expect(call(h, "dpdp_icp_save_item", { p_item: { kind: "data_set", name: " fees " } }).error?.message).toContain("already in your register")
  })
  test("the starter list reads the Part 2 data sets of jobs that are switched on, once", () => {
    const h = host()
    expect(data<{ added: number }>(call(h, "dpdp_icp_starter")).added).toBe(2)
    expect(data<{ added: number }>(call(h, "dpdp_icp_starter")).added).toBe(0)
    const reg = data<IcpItem[]>(call(h, "dpdp_icp_register"))
    expect(reg.map((i) => i.name)).toEqual(["Staff records", "Students"])
    expect(reg.every((i) => i.flags.some((f) => f.key === "unclassified"))).toBe(true)
  })
  test("the status counts steps; 'nothing new' is a recorded sign-off; the score is not a legal rating", () => {
    const h = host()
    let s = icpStatus(h, new Date("2026-11-11T10:00:00Z"))
    expect([s.identify.total, s.classify.total, s.prove.total, s.total]).toEqual([3, 4, 3, 10])
    expect(s.notALegalRating).toBe(true)
    expect(s.weekStart).toBe("2026-11-09")
    expect(s.identify.steps.find((x) => x.key === "anything_new")!.done).toBe(false)
    call(h, "dpdp_icp_log", { p_stage: "identify", p_note: "Nothing new this week" })
    s = icpStatus(h, new Date("2026-11-11T10:00:00Z"))
    expect(s.identify.steps.find((x) => x.key === "anything_new")!.done).toBe(true)
    // a sign-off in LAST week does not count for this week
    expect(icpStatus(h, new Date("2026-11-18T10:00:00Z")).identify.steps.find((x) => x.key === "anything_new")!.done).toBe(false)
  })
  test("children listed -> the children's jobs flagged until switched on; the rule switches on, never off, and touches nothing else", () => {
    const h = host()
    expect(data<{ reopened: number }>(call(h, "dpdp_icp_apply_rules")).reopened).toBe(0)
    data(call(h, "dpdp_icp_save_item", { p_item: { kind: "person_group", name: "Enrolled students", principalType: "student", children: true } }))
    expect(icpStatus(h, new Date("2026-11-11T10:00:00Z")).classify.steps.find((x) => x.key === "jobs_follow_register")!.done).toBe(false)
    expect(data<{ reopened: number }>(call(h, "dpdp_icp_apply_rules")).reopened).toBe(1)
    expect(h.rows.find((r) => r.libIndex === 11)!.na).toBe(false)
    expect(h.rows.find((r) => r.libIndex === 14)!.na).toBe(true) // not a children's job
    expect(h.rows.find((r) => r.libIndex === 6)!.na).toBe(true)
    expect(CHILDREN_JOB_INDEXES).toEqual([11, 12, 13, 21, 25, 27])
  })
  test("History lines never carry the line's own name", () => {
    const h = host()
    call(h, "dpdp_icp_save_item", { p_item: { kind: "vendor", name: "Acme Software" } })
    expect(h.events).toEqual(["icp_item_added"])
  })
})
