/// <reference types="bun-types" />
// src/lib/visit-link.ts: the signed-in app's two small calls. The visitor id comes only from what the public pages kept; a privacy signal or no id means no call at all; the link is
// remembered for the tab only once the server could name an identity; and the call carries the person's own access token, nothing else about them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { DpdpClient } from "./client"
import { linkVisitToPerson, noteSignInStart, readVisitorId } from "./visit-link"

const VID = "ab".repeat(12), SID = "cd".repeat(8)
const mem = (init: Record<string, string> = {}) => { const m = { ...init }; return { getItem: (k: string) => (k in m ? m[k]! : null), setItem: (k: string, v: string) => { m[k] = v }, _m: m } }
const client = (token: string | null = "jwt-1") => ({ accessToken: async () => token }) as unknown as DpdpClient
type Call = { url: string; init: RequestInit }
const recorder = (answer: unknown = { linked: true, identity: true }, ok = true) => {
  const calls: Call[] = []
  const f = async (url: string, init?: RequestInit) => { calls.push({ url, init: init! }); return { ok, json: async () => answer } as unknown as Response }
  return { calls, f }
}
const g = globalThis as { document?: unknown; localStorage?: unknown; navigator?: unknown }
const saved = { document: g.document, localStorage: g.localStorage, navigator: g.navigator }
beforeEach(() => { g.document = { cookie: "" }; g.localStorage = mem(); g.navigator = {} })
afterEach(() => { g.document = saved.document; g.localStorage = saved.localStorage; g.navigator = saved.navigator })

describe("readVisitorId", () => {
  test("cookie first, then local storage; anything not hex is ignored", () => {
    expect(readVisitorId(`a=1; dpdp_vid=${VID}; b=2`, mem())).toBe(VID)
    expect(readVisitorId("", mem({ dpdp_vid: VID }))).toBe(VID)
    expect(readVisitorId("dpdp_vid=priya@acme.in", mem({ dpdp_vid: "<script>" }))).toBeNull()
    expect(readVisitorId("", null)).toBeNull()
  })
})

describe("noteSignInStart", () => {
  test("one step on the EXISTING visit, to our own /api/visit, with no e-mail", async () => {
    const { calls, f } = recorder()
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    await noteSignInStart(f, mem({ dpdp_sid: SID }))
    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toBe("/api/visit")
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ sid: SID, vid: VID, p: "/", e: [{ k: "step", n: "sign_in_start" }] })
  })
  test("no visitor id, no visit on record, or a privacy signal: no call", async () => {
    const a = recorder(); await noteSignInStart(a.f, mem({ dpdp_sid: SID })); expect(a.calls.length).toBe(0)
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    const b = recorder(); await noteSignInStart(b.f, mem()); expect(b.calls.length).toBe(0)
    for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: "1" }]) { g.navigator = nav; const c = recorder(); await noteSignInStart(c.f, mem({ dpdp_sid: SID })); expect(c.calls.length).toBe(0) }
  })
  test("a network failure is swallowed", async () => {
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    await noteSignInStart(async () => { throw new Error("offline") }, mem({ dpdp_sid: SID }))
  })
})

describe("linkVisitToPerson", () => {
  test("sends the visitor id with the person's own token to dpdp-track/link, then a page view named app:home; remembers it once an identity was named", async () => {
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    const { calls, f } = recorder({ linked: true, identity: true })
    const session = mem({ dpdp_sid: SID })
    await linkVisitToPerson(client(), f, session)
    expect(calls[0]!.url).toContain("/functions/v1/dpdp-track/link")
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1")
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ vid: VID })
    expect(calls[1]!.url).toBe("/api/visit")
    expect(JSON.parse(String(calls[1]!.init.body)).e).toEqual([{ k: "pv", p: "app:home" }])
    expect(session._m.dpdp_visit_linked).toBe(VID)
    const again = recorder(); await linkVisitToPerson(client(), again.f, session); expect(again.calls.length).toBe(0)
  })
  test("while the server could not name an identity yet (a brand-new person) it is NOT remembered, so the next page load tries again", async () => {
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    const { f } = recorder({ linked: true, identity: false })
    const session = mem()
    await linkVisitToPerson(client(), f, session)
    expect(session._m.dpdp_visit_linked).toBeUndefined()
  })
  test("nothing is sent without a visitor id, without a token, or with a privacy signal", async () => {
    const a = recorder(); await linkVisitToPerson(client(), a.f, mem()); expect(a.calls.length).toBe(0)
    ;(g.localStorage as ReturnType<typeof mem>).setItem("dpdp_vid", VID)
    const b = recorder(); await linkVisitToPerson(client(null), b.f, mem()); expect(b.calls.length).toBe(0)
    g.navigator = { globalPrivacyControl: true }
    const c = recorder(); await linkVisitToPerson(client(), c.f, mem()); expect(c.calls.length).toBe(0)
  })
})
