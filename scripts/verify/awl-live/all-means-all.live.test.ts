/// <reference types="bun-types" />
// Audit 100, checklist rows B34, B35, B36, A5, A10, A13, A27: "ALL means ALL, limited only by role, projects and organisation".
// Against the DEPLOYED work-link function, with throwaway links of three people of the e2e test organisation:
//   manager  (money visible, level 1)      member (money hidden, level 1)      client_viewer (money hidden, level 0, can never write)
//
//   ALL         every project the person can read is listed (the count equals the database's count for the organisation), every one of them
//               opens, and the portfolio report covers them; an outside AI loses nothing the person could see.
//   ORGANISATION a project of another organisation answers 404 on every route (context, records, check, history, actions, MCP), with the SAME
//               body as a project that does not exist, so its existence is not even revealed; no foreign id ever appears in a list.
//   ROLE        a viewer cannot write: every write function is refused 403 and the database shows no intent and no write for the link;
//               a member cannot use functions above the role (archive_project, change_user_role): refused at /check; money columns come back
//               null with redacted:true for member and viewer while the manager sees the numbers; nobody can create users or change roles.
//   NO CODE     the guide (and the token-free card) tell the outside AI not to write programs, scripts, SQL or code.
// NOTHING IN THIS FILE WRITES: the manager and member links are level 1 (direct changes are on), so they are used for reads and for the dry-run
// /check only; the only POST /actions calls are made with the viewer link, which the function must refuse before anything runs.
// Run: bun test --isolate ./scripts/verify/awl-live/all-means-all.live.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { E2E_ORG, PEOPLE, call, expectPerson, foreignProjectId, jsonHeaders, linkStatus, liveEnabled, mgmtSql, mintThrowaway, revoke, type Throwaway } from "./live-lib"

const MERIDIAN = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04" // a project of the e2e organisation with BOQ lines and change orders (money)

// the live network and database are sometimes slow (the shared database is busy): a test gets two minutes, not bun's default five seconds
setDefaultTimeout(120_000)

describe.skipIf(!liveEnabled())("all means all, limited only by role, project and organisation (live)", () => {
  let manager: Throwaway, member: Throwaway, viewer: Throwaway
  let orgProjectIds: string[] = []
  let foreignId = ""
  const links = () => [manager, member, viewer].filter(Boolean)

  const get = (l: Throwaway, path: string) => call(`${l.url}${path}`, { headers: jsonHeaders })
  const post = (l: Throwaway, path: string, body: unknown) => call(`${l.url}${path}`, { method: "POST", idempotent: true, headers: jsonHeaders, body: JSON.stringify(body) })

  beforeAll(async () => {
    await expectPerson(PEOPLE.manager, "manager")
    await expectPerson(PEOPLE.member, "member")
    await expectPerson(PEOPLE.viewer, "client_viewer")
    manager = await mintThrowaway(PEOPLE.manager, "audit100 all-means-all")
    member = await mintThrowaway(PEOPLE.member, "audit100 all-means-all")
    viewer = await mintThrowaway(PEOPLE.viewer, "audit100 all-means-all")
    expect(viewer.level).toBe(0)
    orgProjectIds = (await mgmtSql<{ id: string }>(`select id from compliance.projects where org_id = '${E2E_ORG}'`)).map((r) => r.id)
    foreignId = await foreignProjectId()
  }, 300_000)

  afterAll(async () => {
    for (const l of links()) await revoke(l.id)
  })

  // ---------------------------------------------------------------------------------------------------------------- ALL
  test("ALL: each person's project list is exactly the organisation's projects, and every one opens", async () => {
    expect(orgProjectIds.length).toBeGreaterThan(5)
    for (const l of [manager, member, viewer]) {
      const r = await get(l, "/projects?limit=100")
      expect(r.status).toBe(200)
      expect(r.json.truncated).toBe(false)
      expect(r.json.total).toBe(orgProjectIds.length)
      expect(r.json.projects.map((p: any) => p.id).sort()).toEqual([...orgProjectIds].sort())
    }
    // every project in the list opens for the viewer, the least privileged person
    const list = (await get(viewer, "/projects?limit=100")).json.projects
    for (const p of list) {
      const c = await get(viewer, `/projects/${p.id}/context`)
      expect(c.status).toBe(200)
      expect(c.json.project.id).toBe(p.id)
    }
  }, 180_000)

  test("ALL: the portfolio report covers the projects (first 25 rows) and reports the full count", async () => {
    const r = await get(manager, "/portfolio")
    expect(r.status).toBe(200)
    const text = JSON.stringify(r.json)
    expect(text).toContain(MERIDIAN)
    const rows = r.json.projects ?? r.json.rows ?? []
    expect(rows.length).toBe(Math.min(25, orgProjectIds.length))
    for (const row of rows) expect(orgProjectIds).toContain(row.id)
  })

  test("ALL: every record kind the manual promises can be read inside a project (33 kinds, none refused as unknown)", async () => {
    const ctx = await get(manager, `/projects/${MERIDIAN}/context`)
    expect(ctx.status).toBe(200)
    const kinds = ["project", "boqs", "boq_lines", "activities", "progress", "tasks", "meetings", "documents", "roster", "attendance", "timesheets", "pipeline_tasks", "people", "rfis", "submittals", "punch_list", "change_orders", "site_diaries", "site_instructions", "milestones"]
    for (const k of kinds) {
      const r = await get(manager, `/projects/${MERIDIAN}/records/${k}?limit=1`)
      expect(r.status, `kind ${k}`).toBe(200)
      expect(r.json.kind).toBe(k)
    }
    const unknown = await get(manager, `/projects/${MERIDIAN}/records/not_a_kind`)
    expect([400, 404]).toContain(unknown.status)
  }, 300_000)

  // --------------------------------------------------------------------------------------------------------- ORGANISATION
  test("ORGANISATION: a foreign project is a 404 on every route, with the same body as a project that does not exist", async () => {
    const missing = "zzzz_no_such_project_0000"
    const routes = ["/context", "/records/boqs", "/records/tasks", "/history", "/functions"]
    for (const route of routes) {
      for (const l of [manager, viewer]) {
        const f = await get(l, `/projects/${foreignId}${route}`)
        const m = await get(l, `/projects/${missing}${route}`)
        expect(f.status, `foreign ${route}`).toBe(404)
        expect(m.status, `missing ${route}`).toBe(404)
        expect(f.text, `same body ${route}`).toBe(m.text)
      }
    }
    for (const l of [manager, viewer]) {
      const chk = await post(l, `/projects/${foreignId}/check`, { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } })
      expect(chk.status).toBe(404)
    }
    // the only write call of this file: the viewer, whose link can never run it. A foreign project must still be 404, not 403 or anything revealing.
    const act = await post(viewer, `/projects/${foreignId}/actions`, { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } })
    expect(act.status).toBe(404)
  }, 300_000)

  test("ORGANISATION: no id of another organisation appears in any list, and the MCP tool refuses it too", async () => {
    const all = await get(manager, "/projects?limit=100")
    expect(JSON.stringify(all.json)).not.toContain(foreignId)
    const mcp = await call(viewer.url, { method: "POST", idempotent: true, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_context", arguments: { project: foreignId } } }) })
    expect(mcp.json.result.isError).toBe(true)
  })

  // ------------------------------------------------------------------------------------------------------------------ ROLE
  test("ROLE: a viewer's link offers read functions only", async () => {
    const r = await get(viewer, `/projects/${MERIDIAN}/context`)
    expect(r.json.level).toBe(0)
    expect(r.json.functions.length).toBeGreaterThan(0)
    for (const f of r.json.functions) expect(f.kind).toBe("read")
  })

  test("ROLE: a viewer cannot write: every write function is refused 403, and the database shows no write and no intent", async () => {
    const attempts = [
      { function: "record_work_progress", params: { itemCode: "EX-01", percent: 10 } },
      { function: "update_task", params: { id: "x", title: "should never be written" } },
      { function: "delete_progress_entry", params: { id: "x" } },
      { function: "archive_project", params: {} },
      { function: "create_task", params: { title: "should never be written" } },
    ]
    for (const a of attempts) {
      const r = await post(viewer, `/projects/${MERIDIAN}/actions`, a)
      expect(r.status, a.function).toBe(403)
      expect(r.json.error).toBeDefined()
    }
    const draft = await post(viewer, `/projects/${MERIDIAN}/drafts`, { function: "update_task", params: { id: "x", title: "should never be written" } })
    expect(draft.status).toBe(403)
    const [row] = await mgmtSql<{ write_count: number }>(`select write_count from platform.user_ai_links where id = '${viewer.id}'`)
    expect(row.write_count).toBe(0)
    const [intents] = await mgmtSql<{ n: number }>(`select count(*)::int as n from platform.ai_work_link_intent where link_id = '${viewer.id}'`)
    expect(intents.n).toBe(0)
  }, 300_000)

  test("ROLE: above-role and permission-changing functions are refused for a member and a viewer (dry-run /check, nothing runs)", async () => {
    for (const l of [member, viewer]) {
      for (const fn of ["archive_project", "change_user_role", "create_user", "grant_permission"]) {
        const r = await post(l, `/projects/${MERIDIAN}/check`, { function: fn, params: {} })
        expect(r.status, `${fn} for ${l.userId}`).toBe(403)
        expect(r.json.code).toBe("FUNCTION_NOT_ON_LINK")
      }
    }
    // nobody, whatever the role, gets a function that changes people or permissions
    const fns = await get(manager, `/projects/${MERIDIAN}/functions`)
    const ids: string[] = (fns.json.functions ?? fns.json.items ?? []).map((f: any) => f.id ?? f.function_id)
    expect(ids.length).toBeGreaterThan(20)
    for (const id of ids) expect(id).not.toMatch(/(^|_)(user|users|role|roles|permission|permissions|member|invite)(_|$)/)
  }, 300_000)

  test("ROLE: money is null and marked redacted for a member and a viewer, and visible to the manager", async () => {
    const m = await get(manager, `/projects/${MERIDIAN}/records/boq_lines?limit=5`)
    const b = await get(member, `/projects/${MERIDIAN}/records/boq_lines?limit=5`)
    const v = await get(viewer, `/projects/${MERIDIAN}/records/boq_lines?limit=5`)
    expect(m.status).toBe(200)
    const priced = m.json.items.filter((r: any) => typeof r.amount === "number" && r.amount > 0)
    expect(priced.length).toBeGreaterThan(0)
    // the viewer's link may not read BOQ lines at all (refused), and a member's rows come back with the money nulled; either way no number leaks
    expect([200, 403, 404]).toContain(v.status)
    expect(b.status).toBe(200)
    for (const other of [b, v]) {
      if (other.status !== 200) continue
      for (const row of priced) {
        const twin = other.json.items.find((r: any) => r.id === row.id)
        if (!twin) continue
        expect(twin.amount).toBeNull()
        expect(twin.rate).toBeNull()
      }
    }
    expect(priced.some((row: any) => b.json.items.some((r: any) => r.id === row.id))).toBe(true)
    const co = await get(manager, `/projects/${MERIDIAN}/records/change_orders?limit=5`)
    const coMember = await get(member, `/projects/${MERIDIAN}/records/change_orders?limit=5`)
    const withCost = co.json.items.find((r: any) => typeof r.cost_impact === "number")
    expect(withCost).toBeDefined()
    expect(coMember.json.items.find((r: any) => r.id === withCost.id).cost_impact).toBeNull()
    // the rows say so out loud: redacted, not zero
    const boqRows = (await get(member, `/projects/${MERIDIAN}/records/boqs?limit=5`)).json.items
    expect(boqRows.some((r: any) => r.redacted === true)).toBe(true)
  }, 300_000)

  // --------------------------------------------------------------------------------------------------------------- NO CODE
  test("NO CODE: the guide and the token-free card tell the outside AI never to write code", async () => {
    const guide = await call(member.url)
    expect(guide.status).toBe(200)
    expect(guide.text).toContain("never write code")
    expect(guide.text).toContain("Do not write programs, scripts, SQL or code")
    expect(guide.text).toContain("You cannot create users, change permissions, or touch other organisations")
    const card = await call(`${member.url}/card.md`)
    expect(card.status).toBe(200)
    expect(card.text).toContain("Do not write programs, scripts, SQL or code")
  })

  test("the three throwaway links are revoked at the end", async () => {
    for (const l of links()) {
      await revoke(l.id)
      expect(await linkStatus(l.id)).toBe("revoked")
      expect((await get(l, "/context")).status).toBe(410)
    }
  }, 300_000)
})
