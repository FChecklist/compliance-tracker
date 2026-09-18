/// <reference types="bun-types" />
// Sumeet requirement #2: proves a real, live endpoint exists under
// /api/v1/projexa for creating and retrieving a project's milestones (a
// distinct entity from the Timeline's activities -- pms_milestones, not
// pms_issues). GET/POST here are thin wrappers (via withRouteTiming) around
// pms-taxonomy-service's listMilestones()/createMilestone(). This test
// exercises the REAL route.ts exports end-to-end with only the service layer
// and auth guard mocked, same convention as the sibling
// v1/projexa/schedule/route.test.ts.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null; dbUser?: unknown }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.dbUser ?? (ctx.orgId ? { id: "user-1" } : null),
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    requireOrg: mock((c: { orgId: string | null }) =>
      c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 })
    ),
  }))
}

describe("POST + GET /api/v1/projexa/milestones -- a project's milestones can be created and retrieved", () => {
  test("POST creates a milestone for a project and the subsequent GET (filtered by that projectId) returns it", async () => {
    mockAuth({ orgId: "org-1" })

    const createdMilestone = {
      id: "ms-1",
      projectId: "proj-1",
      name: "Foundation complete",
      targetDate: "2026-10-01",
      status: "planned",
      completionPercentage: 0,
    }

    const createMilestone = mock(async () => createdMilestone)
    const listMilestones = mock(async () => [createdMilestone])
    mock.module("@/lib/services/pms-taxonomy-service", () => ({
      createMilestone,
      listMilestones,
      ServiceError,
    }))

    const { POST, GET } = await import("./route")

    const postRes = await POST({
      nextUrl: new URL("http://localhost/api/v1/projexa/milestones"),
      json: async () => ({ projectId: "proj-1", name: "Foundation complete", targetDate: "2026-10-01" }),
    } as any)

    expect(postRes.status).toBe(201)
    expect(await postRes.json()).toEqual(createdMilestone)
    expect(createMilestone).toHaveBeenCalledTimes(1)
    const [, createdProjectId, createInput] = createMilestone.mock.calls[0] as [unknown, string, Record<string, unknown>]
    expect(createdProjectId).toBe("proj-1")
    expect(createInput.name).toBe("Foundation complete")

    const getRes = await GET({
      nextUrl: new URL("http://localhost/api/v1/projexa/milestones?projectId=proj-1"),
    } as any)

    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual({ milestones: [createdMilestone] })
    expect(listMilestones).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
  })

  test("POST without a name is refused before reaching the service layer", async () => {
    mockAuth({ orgId: "org-1" })
    const createMilestone = mock(async () => ({}))
    mock.module("@/lib/services/pms-taxonomy-service", () => ({ createMilestone, listMilestones: mock(async () => []), ServiceError }))

    const { POST } = await import("./route")
    const res = await POST({
      nextUrl: new URL("http://localhost/api/v1/projexa/milestones"),
      json: async () => ({ projectId: "proj-1" }),
    } as any)

    expect(res.status).toBe(400)
    expect(createMilestone).not.toHaveBeenCalled()
  })

  test("GET without projectId is refused with a clear 400, not a silent empty list", async () => {
    mockAuth({ orgId: "org-1" })
    const listMilestones = mock(async () => [])
    mock.module("@/lib/services/pms-taxonomy-service", () => ({ createMilestone: mock(async () => ({})), listMilestones, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/milestones") } as any)

    expect(res.status).toBe(400)
    expect(listMilestones).not.toHaveBeenCalled()
  })
})
