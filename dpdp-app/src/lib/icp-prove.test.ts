/// <reference types="bun-types" />
// PROVE (drizzle/0762) in the offline mock (src/lib/icp-prove-mock.ts) and the pure helpers (src/lib/icp-prove.ts). The database decides; the same rules are
// run against the real SQL in src/lib/services/dpdp-icp-prove.pglite.test.ts (repo root).
import { describe, expect, test } from "bun:test"
import type { IcpItem } from "./icp"
import { icpRpc, icpStatus, type IcpMockHost } from "./icp-mock"
import { niceDate, packToHtml, sha256Hex, shortHash, type BreachWire, type EvidencePack, type ProveOverview } from "./icp-prove"

const NOW = new Date("2026-11-11T10:00:00Z")
const HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" // SHA-256 of "abc"

function host(): IcpMockHost & { events: string[] } {
  const events: string[] = []
  const rows = [{ libIndex: 4, part: 2, dataSet: "Students", na: false, yes: false, due: "2099-01-01T00:00:00Z" }]
  return { product: "institution", rows, eventsThisWeek: 0, events, log: (k) => { events.push(k) } }
}
const call = (h: IcpMockHost, fn: string, args: Record<string, unknown> = {}, canWrite = true, now = NOW) => icpRpc(h, fn, args, canWrite, now)!
const data = <T,>(r: ReturnType<typeof call>) => { expect(r.error).toBeNull(); return r.data as T }
const step = (h: IcpMockHost, key: string, now = NOW) => icpStatus(h, now).prove.steps.find((x) => x.key === key)!

describe("PROVE: evidence", () => {
  test("a record needs a title and either a fingerprint or a place; no contact details; the fingerprint is 64 hex", () => {
    const h = host()
    expect(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "x" } }).error?.message).toContain("short title")
    expect(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "Privacy policy" } }).error?.message).toContain("fingerprint")
    expect(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "Policy", reference: "mail asha@example.com" } }).error?.message).toContain("e-mail address or phone")
    expect(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "Policy", sha256: "xyz" } }).error?.message).toContain("64 letters")
    expect(call(h, "dpdp_icp_evidence_add", { p: { kind: "nope", title: "Policy", sha256: HASH } }).error?.message).toContain("Pick what kind")
    data(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "Privacy policy", sha256: HASH, filename: "policy.pdf" } }))
    expect(h.events).toEqual(["icp_evidence_recorded"])
  })

  test("this week's record ticks the step, so does 'nothing to attach'; a withdrawn record stays on the list but no longer counts", () => {
    const h = host()
    expect(step(h, "evidence_this_week").done).toBe(false)
    const id = data<{ id: string }>(call(h, "dpdp_icp_evidence_add", { p: { kind: "training", title: "Staff briefing", reference: "Hall register" } })).id
    expect(step(h, "evidence_this_week").done).toBe(true)
    expect(call(h, "dpdp_icp_evidence_withdraw", { p_evidence_id: id, p_reason: "x" }).error?.message).toContain("3 to 200")
    data(call(h, "dpdp_icp_evidence_withdraw", { p_evidence_id: id, p_reason: "Wrong date" }))
    expect(step(h, "evidence_this_week").done).toBe(false)
    expect(data<ProveOverview>(call(h, "dpdp_icp_prove_overview")).evidence[0].withdrawn).toBe(true)
    expect(call(h, "dpdp_icp_evidence_withdraw", { p_evidence_id: id, p_reason: "Again" }).error?.code).toBe("P0002")
    data(call(h, "dpdp_icp_log", { p_stage: "prove", p_outcome: "skipped", p_note: "Nothing to attach this week" }))
    expect(step(h, "evidence_this_week").done).toBe(true)
  })

  test("a signed agreement attached to an outside helper marks it signed; a 'signed' helper with no record attached is flagged until one is", () => {
    const h = host()
    const v = data<{ item: IcpItem }>(call(h, "dpdp_icp_save_item", { p_item: { kind: "vendor", name: "Acme Software", agreementStatus: "signed" } })).item
    expect(step(h, "agreements_on_record").done).toBe(false)
    data(call(h, "dpdp_icp_evidence_add", { p: { kind: "agreement", title: "Acme agreement", sha256: HASH, itemId: v.id, evidenceOn: "2026-11-01" } }))
    expect(step(h, "agreements_on_record").done).toBe(true)
    const w = data<{ item: IcpItem }>(call(h, "dpdp_icp_save_item", { p_item: { kind: "vendor", name: "Beta Fees" } })).item
    expect(w.agreementStatus).toBeNull()
    data(call(h, "dpdp_icp_evidence_add", { p: { kind: "agreement", title: "Beta agreement", reference: "Office file", itemId: w.id } }))
    expect(data<ProveOverview>(call(h, "dpdp_icp_prove_overview")).vendors.every((x) => x.agreementStatus === "signed" && x.hasEvidence)).toBe(true)
  })
})

describe("PROVE: breach, requests, erasure", () => {
  test("a breach starts a 72-hour clock and a 6-hour CERT-In clock; the step goes red when the detailed report is late and green when sent; a timestamp is set once", () => {
    const h = host()
    expect(call(h, "dpdp_icp_breach_log", { p: { description: "no" } }).error?.message).toContain("few sentences")
    expect(call(h, "dpdp_icp_breach_log", { p: { description: "Lost a pen drive, owner asha@example.com" } }).error?.message).toContain("not who")
    const r = data<{ id: string; boardDetailDueAt: string; certInDueAt: string }>(call(h, "dpdp_icp_breach_log", { p: { description: "A staff laptop with marks was lost", becameAwareAt: "2026-11-05T00:00:00Z", peopleAffected: 40 } }))
    expect(r.boardDetailDueAt).toBe("2026-11-08T00:00:00Z")
    expect(r.certInDueAt).toBe("2026-11-05T06:00:00Z")
    expect(step(h, "breach_clocks").done).toBe(false) // 5 Nov + 72h = 8 Nov, now is 11 Nov
    expect(step(h, "breach_clocks", new Date("2026-11-07T00:00:00Z")).done).toBe(true) // still inside the clock
    data(call(h, "dpdp_icp_breach_update", { p_breach_id: r.id, p: { boardNotified: true } }))
    expect(step(h, "breach_clocks").done).toBe(false) // the first intimation does not stand in for the 72-hour report
    data(call(h, "dpdp_icp_breach_update", { p_breach_id: r.id, p: { boardDetailed: true } }))
    expect(step(h, "breach_clocks").done).toBe(true)
    const b = (): BreachWire => data<ProveOverview>(call(h, "dpdp_icp_prove_overview")).breaches[0]
    const first = b().boardNotifiedAt
    data(call(h, "dpdp_icp_breach_update", { p_breach_id: r.id, p: { boardNotified: true } }, true, new Date("2026-11-12T00:00:00Z")))
    expect(b().boardNotifiedAt).toBe(first)
    data(call(h, "dpdp_icp_breach_update", { p_breach_id: r.id, p: { closed: true } }))
    expect(call(h, "dpdp_icp_breach_update", { p_breach_id: r.id, p: { individualsNotified: true } }).error?.code).toBe("55000")
  })

  test("a request or grievance is due 90 days after it arrived and is past due only after that day; a plain request keeps no free text", () => {
    const h = host()
    expect(call(h, "dpdp_icp_request_log", { p: { type: "grievance", receivedOn: "2026-11-01" } }).error?.message).toContain("what it is about")
    expect(call(h, "dpdp_icp_request_log", { p: { type: "grievance", receivedOn: "2026-11-01", summary: "Asha 98765 43210 wrote" } }).error?.code).toBe("22023")
    expect(call(h, "dpdp_icp_request_log", { p: { type: "access", receivedOn: "2099-01-01" } }).error?.message).toContain("looks wrong")
    const r = data<{ ref: string; dueOn: string }>(call(h, "dpdp_icp_request_log", { p: { type: "access", arrivedVia: "email", receivedOn: "2026-08-14" } }))
    expect(r.ref.startsWith("RR-")).toBe(true)
    expect(r.dueOn).toBe("2026-11-12")
    expect(step(h, "requests_on_time").done).toBe(true) // 11 Nov: the 90th day is 12 Nov
    expect(step(h, "requests_on_time", new Date("2026-11-12T23:00:00Z")).done).toBe(true) // the due day itself is still in time
    expect(step(h, "requests_on_time", new Date("2026-11-13T00:30:00Z")).done).toBe(false)
    const g = data<{ ref: string }>(call(h, "dpdp_icp_request_log", { p: { type: "grievance", receivedOn: "2026-11-10", summary: "Fee receipt not received" } }))
    expect(g.ref.startsWith("GR-")).toBe(true)
    expect(call(h, "dpdp_icp_request_close", { p_ref: r.ref, p_outcome: "nonsense" }).error?.message).toContain("Pick how")
    data(call(h, "dpdp_icp_request_close", { p_ref: r.ref, p_outcome: "provided" }))
    expect(call(h, "dpdp_icp_request_close", { p_ref: r.ref, p_outcome: "provided" }).error?.code).toBe("P0002")
    expect(step(h, "requests_on_time", new Date("2026-11-13T00:30:00Z")).done).toBe(true)
    const o = data<ProveOverview>(call(h, "dpdp_icp_prove_overview"))
    expect(JSON.stringify(o.requests.filter((x) => x.type !== "grievance"))).not.toContain("summary")
  })

  test("an erasure has a due date; late until closed; 'not needed' needs a reason; the scope must not be a person", () => {
    const h = host()
    expect(call(h, "dpdp_icp_erasure_log", { p: { scope: "asha@example.com" } }).error?.message).toContain("not a person")
    const e = data<{ id: string }>(call(h, "dpdp_icp_erasure_log", { p: { scope: "Admission forms of 2019", trigger: "retention_ended", dueOn: "2026-11-01" } }))
    expect(step(h, "erasures_on_time").done).toBe(false)
    expect(call(h, "dpdp_icp_erasure_close", { p_erasure_id: e.id, p: { state: "not_needed" } }).error?.message).toContain("why")
    data(call(h, "dpdp_icp_erasure_close", { p_erasure_id: e.id, p: { state: "done", method: "Shredded" } }))
    expect(step(h, "erasures_on_time").done).toBe(true)
    expect(call(h, "dpdp_icp_erasure_close", { p_erasure_id: e.id, p: { state: "done" } }).error?.code).toBe("P0002")
  })

  test("the whole Prove area is closed to a staff view", () => {
    const h = host()
    for (const fn of ["dpdp_icp_evidence_add", "dpdp_icp_breach_log", "dpdp_icp_request_log", "dpdp_icp_erasure_log", "dpdp_icp_evidence_pack", "dpdp_icp_prove_overview"]) expect(call(h, fn, {}, false).error?.code).toBe("42501")
  })
})

describe("PROVE: the pack and its page", () => {
  test("the pack leaves out a breach description and a grievance summary; the page escapes everything and carries no script", () => {
    const h = host()
    data(call(h, "dpdp_icp_breach_log", { p: { description: "Laptop lost <script>alert(1)</script>" } }))
    data(call(h, "dpdp_icp_evidence_add", { p: { kind: "policy", title: "Policy <b>x</b>", sha256: HASH } }))
    const pack = data<EvidencePack>(call(h, "dpdp_icp_evidence_pack"))
    expect(JSON.stringify(pack.breaches)).not.toContain("Laptop")
    const html = packToHtml(pack)
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain("not a rating of legal position")
    expect(/compliant|certified|guarantee/i.test(html.replace(/not a certificate/gi, ""))).toBe(false)
  })

  test("helpers: the SHA-256 of 'abc' is the published one; dates read plainly", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(HASH)
    expect(shortHash(HASH)).toBe(`${HASH.slice(0, 10)}…${HASH.slice(-6)}`)
    expect(niceDate("2026-11-09")).toBe("9 Nov 2026")
    expect(niceDate(null)).toBe("not recorded")
  })
})
