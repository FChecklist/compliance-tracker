/// <reference types="bun-types" />
// Stage 10 (END_USER_ENGINE receptionist tier): the first real
// test for GET /api/v1/tasks/{id}/status. This route (Wave 11) is already
// the lightweight "is my task done" read the receptionist tier needs -- a
// direct, tenant-scoped Postgres read via getTaskStatus(), with zero import
// of task-execution-engine.ts/dispatchTool() or anything from the
// server-side AI-ops governed dispatch queue. It had no test coverage at
// all before this file (confirmed by grep: task-service.test.ts never
// references getTaskStatus). Following this repo's established precedent
// (see settings/branding/route.test.ts, task-service.test.ts's own header
// note) of never touching withTenantContext/a live DB from a .test.ts file:
// both @/lib/supabase/auth-guard and @/lib/services/task-service are
// mocked here, so this file proves the route's own wiring -- auth-guard
// enforcement, org-scoping pass-through, and honest 404-on-not-found
// behavior -- not the DB query itself (that's tenant-isolation.test.ts's
// job, against a real DB).
import { describe, test, expect, mock } from "bun:test"

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/tasks/task-1/status", { method: "GET" })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("GET /api/v1/tasks/[id]/status (receptionist-tier task-status read)", () => {
  test("unauthenticated caller gets the auth-guard's own response verbatim, task-service never called", async () => {
    const getTaskStatus = mock(async () => {
      throw new Error("getTaskStatus should not be called when auth fails")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: null,
        dbUser: null,
        apiKey: null,
        response: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
      })),
    }))
    mock.module("@/lib/services/task-service", () => ({
      getTaskStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("task-1") as any)
    expect(res.status).toBe(401)
    expect(getTaskStatus).not.toHaveBeenCalled()
  })

  test("authenticated caller with no resolvable org gets 400, task-service never called", async () => {
    const getTaskStatus = mock(async () => {
      throw new Error("getTaskStatus should not be called with no orgId")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: null, dbUser: null, apiKey: null, response: null })),
    }))
    mock.module("@/lib/services/task-service", () => ({
      getTaskStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("task-1") as any)
    expect(res.status).toBe(400)
    expect(getTaskStatus).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved returns the lightweight status shape, scoped to the caller's own org", async () => {
    const getTaskStatus = mock(async (ctx: { orgId: string; userId?: string }, id: string) => {
      expect(ctx.orgId).toBe("org-1")
      expect(id).toBe("task-42")
      return { id: "task-42", title: "File GSTR-3B for June", status: "in_progress", updatedAt: "2026-07-29T10:00:00.000Z" }
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: "org-1",
        dbUser: { id: "user-1" },
        apiKey: null,
        response: null,
      })),
    }))
    mock.module("@/lib/services/task-service", () => ({
      getTaskStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("task-42") as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: "task-42",
      title: "File GSTR-3B for June",
      status: "in_progress",
      updatedAt: "2026-07-29T10:00:00.000Z",
    })
    expect(getTaskStatus).toHaveBeenCalledTimes(1)
  })

  test("honest empty result: a non-existent (or cross-tenant, RLS-hidden) task id returns 404, not a 200 with null/empty data", async () => {
    class ServiceError extends Error {
      status: number
      constructor(message: string, status: number) {
        super(message)
        this.status = status
      }
    }
    const getTaskStatus = mock(async () => {
      throw new ServiceError("Task not found", 404)
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: "org-1",
        dbUser: { id: "user-1" },
        apiKey: null,
        response: null,
      })),
    }))
    mock.module("@/lib/services/task-service", () => ({ getTaskStatus, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("task-does-not-exist") as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Task not found")
  })

  test("an unexpected non-ServiceError failure is a 500 with a generic message, not a leaked internal error", async () => {
    const getTaskStatus = mock(async () => {
      throw new Error("connection reset by peer: some internal DB detail")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: "org-1",
        dbUser: { id: "user-1" },
        apiKey: null,
        response: null,
      })),
    }))
    mock.module("@/lib/services/task-service", () => ({
      getTaskStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("task-1") as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Failed to fetch task status")
  })
})
