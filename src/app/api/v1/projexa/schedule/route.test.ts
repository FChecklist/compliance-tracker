/// <reference types="bun-types" />
// R-C10: proves a real, live endpoint exists under /api/v1/projexa for
// creating and retrieving a project schedule. GET/POST here are thin
// wrappers (via withRouteTiming, itself real and side-effect-free) around
// pms-issue-service's listIssues()/schedule-service's createScheduleActivity()
// -- see this route's own header comment (Priority 16 Part 2). This test
// exercises the REAL route.ts exports end-to-end with only the service layer
// and auth guard mocked, following the same convention as the sibling
// v1/projexa/timesheets/route.test.ts in this directory.
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
    // GET_impl calls requireOrg(ctx)! when ctx.orgId is falsy -- the route
    // module import fails at load time if this export is missing, even
    // though this test's fixture always supplies an orgId and never
    // actually invokes it.
    requireOrg: mock((c: { orgId: string | null }) =>
      c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 })
    ),
  }))
}

describe("POST + GET /api/v1/projexa/schedule -- R-C10: a project schedule can be created and retrieved", () => {
  test("POST creates a schedule activity for a project and the subsequent GET (filtered by that projectId) returns it", async () => {
    mockAuth({ orgId: "org-1" })

    const createdTask = {
      id: "task-1",
      projectId: "proj-1",
      title: "Pour foundation slab",
      startDate: "2026-09-10",
      durationDays: 5,
    }

    const createScheduleActivity = mock(async () => createdTask)
    mock.module("@/lib/services/schedule-service", () => ({
      createScheduleActivity,
      ServiceError,
    }))

    const resolveDefaultIssueTypeId = mock(async () => "type-task")
    mock.module("@/lib/services/pms-taxonomy-service", () => ({
      resolveDefaultIssueTypeId,
    }))

    const listIssues = mock(async () => [createdTask])
    mock.module("@/lib/services/pms-issue-service", () => ({
      listIssues,
      ServiceError,
    }))

    const { POST, GET } = await import("./route")

    // --- create ---
    const postRes = await POST({
      nextUrl: new URL("http://localhost/api/v1/projexa/schedule"),
      json: async () => ({ projectId: "proj-1", title: "Pour foundation slab", startDate: "2026-09-10", durationDays: 5 }),
    } as any)

    expect(postRes.status).toBe(201)
    expect(await postRes.json()).toEqual(createdTask)
    expect(createScheduleActivity).toHaveBeenCalledTimes(1)
    const [, createInput] = createScheduleActivity.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(createInput.projectId).toBe("proj-1")
    expect(createInput.title).toBe("Pour foundation slab")

    // --- retrieve, filtered by the same projectId ---
    const getRes = await GET({
      nextUrl: new URL("http://localhost/api/v1/projexa/schedule?projectId=proj-1"),
    } as any)

    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual({ tasks: [createdTask] })
    expect(listIssues).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1", { statusId: undefined, assigneeId: undefined })
  })
})
