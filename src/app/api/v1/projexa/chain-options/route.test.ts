/// <reference types="bun-types" />
// R67 lane B (B-11) -- ROUTE TESTS FOR EACH LEVEL of GET
// /api/v1/projexa/chain-options.
//
// The service's own test proves the ladder; this proves the ROUTE: that the
// query string the composer actually builds (`segments=work-progress,record`
// plus one query param per resolved field, named in the D-03 vocabulary)
// reaches the resolver, that the answer carries {level, missing, options,
// done}, and that the read gate is the same one tasks/route.ts applies.
//
// Only two things are mocked, following this repo's own established route-
// test pattern (see src/app/api/v1/projexa/accounts/route.test.ts, studied
// before writing this file): requireAuthOrApiKey, to control the session's
// role without a database, and makeChainOptionsRepo, to hand the REAL
// resolveChainLevel a fixture project. The role primitives
// (requireRoleOrScope/ROLE_RANK) and the whole resolver run for real.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"
import type { users } from "@/lib/db"
import type { UserRole } from "@/lib/supabase/auth-guard"
import type { BoqLineRow, ChainOptionsRepo } from "@/lib/services/chain-options-service"

// The route pulls in schema.ts (a very large module) through the service on
// the first dynamic import; 5000 ms is not always enough on a cold disk.
setDefaultTimeout(20000)

type DbUser = typeof users.$inferSelect

const PROJECT = "project_cedar"

const LINES: BoqLineRow[] = [
  { id: "l_parent", itemCode: "EX-00", description: "Earthwork", unit: "cum", quantity: 120, childCount: 2 },
  { id: "l_child_1", itemCode: "EX-01", description: "Excavation in ordinary soil", unit: "cum", quantity: 80, childCount: 0 },
  { id: "l_doors", itemCode: "R66-1009b", description: "Flush door shutters", unit: "nos", quantity: 5, childCount: 0 },
]

const REPO: ChainOptionsRepo = {
  latestBoqLines: async () => ({ boqId: "boq_1", version: 2, lines: LINES }),
  boqVersions: async () => [{ id: "boq_2", version: 2, title: "Cedar Heights Villa BOQ", status: "approved" }],
  roster: async () => [{ id: "w1", name: "Ramesh", trade: "Civil", employeeCode: "C-01" }],
  projects: async () => [{ id: PROJECT, name: "Cedar Heights Villa - Phase 1" }],
}

async function mockAuth(role: UserRole) {
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: "org-1",
      dbUser: { role } as unknown as DbUser,
      apiKey: null,
      response: null,
    })),
  }))
}

/** Replaces ONLY the database seam; resolveChainLevel itself stays real. */
async function mockRepo() {
  const actual = await import("@/lib/services/chain-options-service")
  const makeChainOptionsRepo = mock(() => REPO)
  mock.module("@/lib/services/chain-options-service", () => ({ ...actual, makeChainOptionsRepo }))
  return makeChainOptionsRepo
}

function req(query: string) {
  return new NextRequest(`http://localhost/api/v1/projexa/chain-options?${query}`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

async function get(query: string) {
  await mockAuth("member")
  await mockRepo()
  const { GET } = await import("./route")
  const res = await GET(req(query) as never)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe("GET chain-options -- the read gate is the same one tasks/route.ts applies", () => {
  test("a rank-1 role (external_auditor) is refused before any read", async () => {
    await mockAuth("external_auditor")
    const makeChainOptionsRepo = await mockRepo()
    const { GET } = await import("./route")
    const res = await GET(req("segments=work-progress,record") as never)
    expect(res.status).toBe(403)
    expect(makeChainOptionsRepo).not.toHaveBeenCalled()
  })

  test("member -- the floor tasks/route.ts uses -- is allowed through", async () => {
    const { status } = await get("segments=work-progress,record&projectId=" + PROJECT)
    expect(status).toBe(200)
  })
})

describe("GET chain-options -- one call per level", () => {
  test("no segments: the module level", async () => {
    const { body } = await get("")
    expect(body.level).toBe("module")
    expect(body.missing).toEqual(["module"])
    expect(body.done).toBe(false)
  })

  test("a module alone: the verb level", async () => {
    const { body } = await get("segments=work-progress")
    expect(body.level).toBe("verb")
    expect(body.missing).toEqual(["verb"])
  })

  test("no project: the project level, listing the org's real projects", async () => {
    const { body } = await get("segments=work-progress,record")
    expect(body.level).toBe("project")
    expect(body.missing).toEqual(["project"])
    expect((body.options as Array<{ label: string }>).map((o) => o.label)).toEqual(["Cedar Heights Villa - Phase 1"])
  })

  // ── B-11's acceptance, exercised through the real URL ───────────────────
  test("segments=work-progress,record + projectId: missing ['boqLine'] with the project's own lines", async () => {
    const { status, body } = await get(`segments=work-progress,record&projectId=${PROJECT}`)
    expect(status).toBe(200)
    expect(body.missing).toEqual(["boqLine"])
    expect(body.done).toBe(false)
    expect(body.legend).toBe("Which BOQ line?")
    const options = body.options as Array<{ label: string; kind: string }>
    expect(options.some((o) => o.label.startsWith("R66-1009b"))).toBe(true)
    expect(options.every((o) => o.kind === "boqLine")).toBe(true)
  })

  test("+ boqLine=<id>: missing ['value'] with '2 nos' and '40 %'", async () => {
    const { body } = await get(`segments=work-progress,record&projectId=${PROJECT}&boqLine=l_doors`)
    expect(body.missing).toEqual(["value"])
    const labels = (body.options as Array<{ label: string }>).map((o) => o.label)
    expect(labels).toContain("2 nos")
    expect(labels).toContain("40 %")
    expect(body.allowsFreeText).toBe(true)
  })

  test("+ value: done true, the card schema and the params tasks POST receives", async () => {
    const { body } = await get(`segments=work-progress,record&projectId=${PROJECT}&boqLine=l_doors&value=40%20%25`)
    expect(body.done).toBe(true)
    expect(body.missing).toEqual([])
    expect(body.level).toBe("confirm")
    expect((body.card as { primaryLabel: string }).primaryLabel).toBe("Save progress")
    expect(body.functionId).toBe("record_work_progress")
    expect(body.params).toEqual({
      projectId: PROJECT,
      boqLineItemId: "l_doors",
      itemCode: "R66-1009b",
      percent: 40,
    })
    expect(body.chain).toBe("Work Progress > New entry")
  })

  test("the attendance ladder: worker, then date, then done", async () => {
    const worker = await get(`segments=manpower,mark-attendance&projectId=${PROJECT}`)
    expect(worker.body.missing).toEqual(["worker"])
    expect(worker.body.multi).toBe(true)

    const date = await get(`segments=manpower,mark-attendance&projectId=${PROJECT}&worker=w1`)
    expect(date.body.missing).toEqual(["date"])

    const done = await get(`segments=manpower,mark-attendance&projectId=${PROJECT}&worker=w1&date=2026-09-02`)
    expect(done.body.done).toBe(true)
    expect((done.body.card as { primaryLabel: string }).primaryLabel).toBe("Save attendance")
  })

  test("the revision ladder ends on the real revise route", async () => {
    const version = await get(`segments=scope,new-revision&projectId=${PROJECT}`)
    expect(version.body.missing).toEqual(["boqVersion"])

    const done = await get(`segments=scope,new-revision&projectId=${PROJECT}&boqVersion=boq_2`)
    expect(done.body.done).toBe(true)
    expect(done.body.route).toBe("/scope/boq_2/revise")
  })

  test("the report ladder ends on the run route", async () => {
    const period = await get(`segments=reports,work_progress_report&projectId=${PROJECT}`)
    expect(period.body.missing).toEqual(["date"])

    const done = await get(`segments=reports,work_progress_report&projectId=${PROJECT}&date=this_month`)
    expect(done.body.done).toBe(true)
    expect(String(done.body.route)).toContain("/work-progress?tab=report")
  })

  test("B-03's `path` spelling still answers, and now carries the B-11 clause too", async () => {
    const { body } = await get(`path=${encodeURIComponent(JSON.stringify(["work_progress", "record_progress"]))}&projectId=${PROJECT}`)
    expect(body.legend).toBe("Which BOQ line?")
    expect(body.missing).toEqual(["boqLine"])
    expect(body.segments).toEqual(["work_progress", "record_progress"])
  })

  test("a line from another project is asked again, with the code and no internals", async () => {
    const { body } = await get(`segments=work-progress,record&projectId=${PROJECT}&boqLine=l_elsewhere&value=40%20%25`)
    expect(body.done).toBe(false)
    expect(body.missing).toEqual(["boqLine"])
    expect(body.code).toBe("BOQ_LINE_NOT_FOUND")
    // Nothing in the payload names a host, a port or a driver message.
    expect(JSON.stringify(body)).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/)
  })
})
