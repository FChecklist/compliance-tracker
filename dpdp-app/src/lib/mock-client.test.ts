/// <reference types="bun-types" />
// The mock fixture is the spec's own job library (spec/veridian-dpdp.html,
// LIB.firm / LIB.institution). e2e/acceptance-70.spec.ts hardcodes the
// numbers that library produces -- 31 jobs, "5 of 30", 12 "required today"
// tags, the sign-off chain -- with a comment saying where each comes from.
// This test pins those derivations here, in the unit layer, so a change to
// the fixture that would silently break the browser suite fails `bun test`
// first, with the number that moved. No DOM, no browser: bun has no
// localStorage or window, and the mock treats both as optional.
import { describe, expect, test } from "bun:test"
import { LIBRARY, MOCK_MEMBERS, MOCK_OWNER, MOCK_PARTNER, MOCK_STAFF, createMockClient } from "./mock-client"
import type { CaClientWire, MyPagePayload } from "./rpc-types"
import { isToday } from "@/lib/dpdp-onepage/view-model"

async function page(scenario: string, orgId?: string): Promise<MyPagePayload> {
  const client = createMockClient(scenario)
  const { data, error } = await client.rpc("dpdp_my_page", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new Error(error.message)
  return data as MyPagePayload
}

describe("the library is the spec's, verbatim in shape", () => {
  test("31 firm jobs across 7 parts, 28 institution jobs", () => {
    expect(LIBRARY.firm).toHaveLength(31)
    expect(LIBRARY.institution).toHaveLength(28)
    const perPart = [1, 2, 3, 4, 5, 6, 7].map((p) => LIBRARY.firm.filter((x) => x.part === p).length)
    expect(perPart).toEqual([3, 7, 6, 5, 4, 3, 3]) // LAW-11 / FIRST-01 (wizard step 1)
  })
  test("12 firm jobs are required by today's law (an s: or a: code)", () => {
    expect(LIBRARY.firm.filter((x) => isToday(x.lawCodes)).length).toBe(12) // LAW-05
  })
  test("the sign-off chain runs owner -> CA manager -> CA partner", () => {
    const chain = LIBRARY.firm.filter((x) => x.part === 7).map((x) => [x.area, x.dep])
    expect(chain).toEqual([["OWNER", undefined], ["CAMGR", "Owner confirms all the answers are true"], ["CAPARTNER", "CA manager checks the proof"]]) // LAW-15..17
  })
})

describe("scenario owner-live (the set-up org, seen by the owner)", () => {
  test("the numbers the Seal, chips and part headers show", async () => {
    const p = await page("owner-live")
    expect(p.viewer).toMatchObject({ email: MOCK_OWNER, kind: "owner" })
    expect(p.viewer.firstVisitSeenAt).not.toBeNull()
    const rows = p.rows
    const live = rows.filter((r) => !r.na)
    expect(rows).toHaveLength(31) // chip "All 31"
    expect(live).toHaveLength(30) // Seal "N of 30"
    expect(live.filter((r) => r.yes)).toHaveLength(5) // Seal "5 of 30", "17% done"; chip "Done 5"
    expect(Math.round((5 / 30) * 100)).toBe(17)
    expect(live.filter((r) => !r.yes)).toHaveLength(25) // chip "Not done 25"
    expect(live.filter((r) => !r.by)).toHaveLength(1) // chip "Nobody named 1"; "1 job has nobody looking after it"
    expect(live.filter((r) => isToday(r.lawCodes) && !r.yes)).toHaveLength(9) // chip "Required today 9"
    expect(live.filter((r) => r.by === MOCK_OWNER && !r.yes)).toHaveLength(1) // chip "Mine 1"
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const late = live.filter((r) => !r.yes && new Date(r.due).getTime() < today.getTime())
    expect(late.map((r) => r.what)).toEqual([
      "Write down where it is kept, why you need it, and who can open it", // Customers, 6 days late (LAW-14)
      "Publish a privacy policy on the website", // 3 days late
      "Group company signs a data-sharing agreement", // 1 day late, nobody named
    ]) // chip "Late 3"
    const perPart = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const rs = live.filter((r) => r.part === n)
      return `${rs.filter((r) => r.yes).length} of ${rs.length}`
    })
    expect(perPart).toEqual(["2 of 3", "2 of 7", "0 of 6", "1 of 5", "0 of 3", "0 of 3", "0 of 3"]) // LAW-10 / LAW-12
  })
  test("who has what: the counts every welcome screen states", async () => {
    const p = await page("owner-live")
    const jobsOf = (email: string) => p.rows.filter((r) => r.by === email && !r.na).length
    expect(jobsOf(MOCK_STAFF)).toBe(4) // FIRST-16, ROLES-03/05
    expect(jobsOf("go@example.test")).toBe(4) // FIRST-17
    expect(jobsOf("coord@example.test")).toBe(1) // FIRST-18
    expect(jobsOf("manager@example.test")).toBe(1) // FIRST-19
    expect(jobsOf(MOCK_PARTNER)).toBe(1) // FIRST-10
    const group = p.rows.find((r) => r.isGroup)!
    expect(group.by).toBe("All staff")
    expect(group.groupTotal).toBe(MOCK_MEMBERS.length) // "0 of 3 answered"
    expect(group.viewerIsGroupMember).toBe(false) // the owner is not in the group
  })
  test("the group job is visible to a member and not to other staff", async () => {
    const member = await page("member")
    expect(member.viewer.kind).toBe("staff")
    expect(member.rows.find((r) => r.isGroup)!.viewerIsGroupMember).toBe(true)
    expect(member.rows.filter((r) => r.by === "member@example.test")).toHaveLength(0) // their only job is the group's
    const staff = await page("staff")
    expect(staff.rows.find((r) => r.isGroup)!.viewerIsGroupMember).toBe(false)
  })
  test("everyone but the owner is on their first visit", async () => {
    for (const s of ["staff", "member", "go", "coord", "manager", "partner"]) {
      const p = await page(s)
      expect(p.viewer.firstVisitSeenAt).toBeNull()
      expect(p.viewer.saidNotMeAt).toBeNull()
    }
    expect((await page("manager")).viewer).toMatchObject({ kind: "ca", caSub: "manager" })
    expect((await page("partner")).viewer).toMatchObject({ kind: "ca", caSub: "partner" })
  })
  test("the sign-off chain is wired and the manager's job waits on the owner's", async () => {
    const p = await page("owner-live")
    const owner = p.rows.find((r) => r.what === "Owner confirms all the answers are true")!
    const mgr = p.rows.find((r) => r.what === "CA manager checks the proof")!
    const partner = p.rows.find((r) => r.what === "CA partner signs the file")!
    expect(owner.by).toBe(MOCK_OWNER)
    expect(mgr).toMatchObject({ by: "manager@example.test", dependsOnObligationId: owner.id })
    expect(partner).toMatchObject({ by: MOCK_PARTNER, dependsOnObligationId: mgr.id })
    const client = createMockClient("manager")
    const refused = await client.rpc("dpdp_mark_done", { p_obligation_id: mgr.id })
    expect(refused.error?.message).toBe("Waiting — the step before this one isn't done yet")
  })
})

describe("scenario owner (a brand-new org) and client-owner (a CA set it up)", () => {
  test("owner: nothing named except the chain, first visit unseen", async () => {
    const p = await page("owner")
    expect(p.viewer.firstVisitSeenAt).toBeNull()
    expect(p.rows.filter((r) => r.by).map((r) => r.what)).toEqual(["Owner confirms all the answers are true", "CA manager checks the proof", "CA partner signs the file"])
    expect(p.rows.filter((r) => r.yes)).toHaveLength(0)
  })
  test("owner: the wizard saved with only the prefilled GO/coordinator leaves 22 jobs with nobody (FIRST-09)", async () => {
    // The GO area is 5 jobs (naming the GO, publishing their contact, the
    // leak plan, the requests page, the complaints clock) and the
    // coordinator area 1, so the prefilled owner holds 7 rows (with their
    // own sign-off) and the CA holds 2: 31 - 7 - 2 = 22 have nobody.
    const client = createMockClient("owner")
    const GO = "Grievance Officer (responsible for DPDP policy)"
    await client.rpc("dpdp_complete_owner_first_visit", { p_org_id: "org-mock", p_assignments: [{ area: GO, emails: [MOCK_OWNER], na: false }, { area: "DPDP coordinator", emails: [MOCK_OWNER], na: false }] })
    const p = (await client.rpc("dpdp_my_page")).data as MyPagePayload
    expect(p.rows.filter((r) => !r.by && !r.na)).toHaveLength(22)
    expect(p.rows.filter((r) => r.by === MOCK_OWNER)).toHaveLength(7)
  })
  test("a plain form sign-in as client-owner@ lands in the CA-set-up world (step5-by-role.spec.ts relies on it)", async () => {
    const client = createMockClient() // no scenario: the stored/fresh "owner" world
    await client.auth.signInWithOtp({ email: "client-owner@example.test" })
    const setup = (await client.rpc("dpdp_org_setup")).data as { setUpBy: { email: string } | null }
    expect(setup.setUpBy?.email).toBe(MOCK_PARTNER)
    const p = (await client.rpc("dpdp_my_page")).data as MyPagePayload
    expect(p.viewer).toMatchObject({ email: "client-owner@example.test", kind: "owner", firstVisitSeenAt: null })
  })
  test("client-owner: set up by the partner, not yet confirmed", async () => {
    const client = createMockClient("client-owner")
    const setup = (await client.rpc("dpdp_org_setup")).data as { setUpBy: { email: string } | null; ownerConfirmedAt: string | null }
    expect(setup.setUpBy?.email).toBe(MOCK_PARTNER)
    expect(setup.ownerConfirmedAt).toBeNull()
    const p = (await client.rpc("dpdp_my_page")).data as MyPagePayload
    expect(p.viewer).toMatchObject({ email: "client-owner@example.test", kind: "owner", firstVisitSeenAt: null })
    expect(p.rows.filter((r) => r.yes)).toHaveLength(2) // naming the GO and the coordinator is done by naming them
    expect(p.rows.filter((r) => !r.by && !r.na)).toHaveLength(1) // "1 job has nobody yet"
  })
})

describe("the CA's clients (dpdp_my_clients / whereItIs, drizzle/0609's labels)", () => {
  test("the partner and the manager both see Mehta Traders, each under their own label", async () => {
    for (const [s, sub] of [["partner", "partner"], ["manager", "manager"]] as const) {
      const clients = (await createMockClient(s).rpc("dpdp_my_clients")).data as CaClientWire[]
      expect(clients).toHaveLength(1)
      expect(clients[0]).toMatchObject({ org: { name: "Mehta Traders" }, caSub: sub, done: 4, total: 31, whereItIs: "In progress", setUpByMe: false })
    }
    expect((await createMockClient("owner-live").rpc("dpdp_my_clients")).data).toEqual([])
  })
  test("every client a CA creates waits for its owner to confirm (0609 records set_up_by whether or not an owner was named)", async () => {
    // drizzle/0609 dpdp_create_client_org:322 sets set_up_by_membership_id
    // on EVERY CA-created org, and whereItIs:221 puts "Waiting for the
    // owner to confirm" first -- so "Not started" is never what a CA sees
    // for an org they made; the v3 mock's "Not started when no owner named"
    // was the mock's own guess, not the SQL's.
    const client = createMockClient("partner")
    await client.rpc("dpdp_create_client_org", { p_name: "Joshi Motors", p_product: "firm", p_owner_email: null })
    await client.rpc("dpdp_create_client_org", { p_name: "Verma Textiles", p_product: "firm", p_owner_email: "suresh@vermatex.example" })
    const clients = (await client.rpc("dpdp_my_clients")).data as CaClientWire[]
    expect(clients.map((c) => [c.org.name, c.whereItIs, c.total, c.setUpByMe])).toEqual([
      ["Mehta Traders", "In progress", 31, false],
      ["Joshi Motors", "Waiting for the owner to confirm", 31, true],
      ["Verma Textiles", "Waiting for the owner to confirm", 31, true],
    ])
    // "Open" is a real page for that org, with the partner still the partner.
    const opened = (await client.rpc("dpdp_my_page", { p_org_id: clients[1].org.id })).data as MyPagePayload
    expect(opened.org.name).toBe("Joshi Motors")
    expect(opened.viewer).toMatchObject({ kind: "ca", caSub: "partner" })
  })
  test("FINDING, not fixed here: a SCHOOL client a CA creates never appears in My clients (no CAPARTNER row exists in the institution library)", async () => {
    // drizzle/0602's institution library (28 templates) has no CAMGR or
    // CAPARTNER template -- its Part 7 is only the OWNER's "Sign off all the
    // answers" -- so dpdp_create_client_org:327-330 assigns nothing to the
    // caller, and dpdp_my_clients:236-250 (ca_sub null -> filtered out)
    // drops the school the moment it is created. The v3 mock listed it
    // anyway; this mock follows the SQL. See e2e/ACCEPTANCE-70.md.
    const client = createMockClient("partner")
    await client.rpc("dpdp_create_client_org", { p_name: "Green Valley School", p_product: "institution", p_owner_email: "head@greenvalley.example" })
    const clients = (await client.rpc("dpdp_my_clients")).data as CaClientWire[]
    expect(clients.map((c) => c.org.name)).toEqual(["Mehta Traders"])
  })
})

describe("not me (drizzle/0604's dpdp_flag_not_me stamps both dates)", () => {
  test("after 'this isn't me', first_visit_seen_at and said_not_me_at are both set", async () => {
    const client = createMockClient("staff")
    await client.rpc("dpdp_flag_not_me", { p_org_id: "org-mock" })
    const p = (await client.rpc("dpdp_my_page")).data as MyPagePayload
    expect(p.viewer.firstVisitSeenAt).not.toBeNull()
    expect(p.viewer.saidNotMeAt).not.toBeNull()
  })
})
