/// <reference types="bun-types" />
// Stage 11 (END_USER_ENGINE receptionist tier, 2026-07-29): the first real
// test for GET /api/v1/notices/{id}/status, added alongside the route
// itself so this tier never repeats Stage 10's gap (GET /api/v1/tasks/{id}/
// status shipping with zero test coverage). This route is the lightweight
// "has our notice been replied to yet" read -- a direct, tenant-scoped
// Postgres read via getNoticeStatus(), with no joins and no import of
// task-execution-engine.ts/dispatchTool() or anything from the server-side
// AI-ops governed dispatch queue. Following this repo's established
// precedent (see tasks/[id]/status/route.test.ts, settings/branding/
// route.test.ts) of never touching withTenantContext/a live DB from a
// .test.ts file: both @/lib/supabase/auth-guard and
// @/lib/services/notice-service are mocked here, so this file proves the
// route's own wiring -- auth-guard enforcement, org-scoping pass-through,
// and honest 404-on-not-found behavior -- not the DB query itself (that's
// tenant-isolation.test.ts's job, against a real DB).
import { describe, test, expect, mock } from "bun:test"

function makeRequest(): Request {
  return new Request("http://localhost/api/v1/notices/notice-1/status", { method: "GET" })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("GET /api/v1/notices/[id]/status (receptionist-tier notice-status read)", () => {
  test("unauthenticated caller gets the auth-guard's own response verbatim, notice-service never called", async () => {
    const getNoticeStatus = mock(async () => {
      throw new Error("getNoticeStatus should not be called when auth fails")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: null,
        dbUser: null,
        apiKey: null,
        response: new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
      })),
    }))
    mock.module("@/lib/services/notice-service", () => ({
      getNoticeStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("notice-1") as any)
    expect(res.status).toBe(401)
    expect(getNoticeStatus).not.toHaveBeenCalled()
  })

  test("authenticated caller with no resolvable org gets 400, notice-service never called", async () => {
    const getNoticeStatus = mock(async () => {
      throw new Error("getNoticeStatus should not be called with no orgId")
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: null, dbUser: null, apiKey: null, response: null })),
    }))
    mock.module("@/lib/services/notice-service", () => ({
      getNoticeStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("notice-1") as any)
    expect(res.status).toBe(400)
    expect(getNoticeStatus).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved returns the lightweight status shape, scoped to the caller's own org", async () => {
    const getNoticeStatus = mock(async (ctx: { orgId: string }, id: string) => {
      expect(ctx.orgId).toBe("org-1")
      expect(id).toBe("notice-42")
      return {
        id: "notice-42",
        noticeNumber: "GST/2026/0042",
        authority: "GST Department",
        status: "in_progress",
        replyDeadline: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-07-29T10:00:00.000Z",
      }
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: "org-1",
        dbUser: { id: "user-1" },
        apiKey: null,
        response: null,
      })),
    }))
    mock.module("@/lib/services/notice-service", () => ({
      getNoticeStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("notice-42") as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      id: "notice-42",
      noticeNumber: "GST/2026/0042",
      authority: "GST Department",
      status: "in_progress",
      replyDeadline: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
    })
    expect(getNoticeStatus).toHaveBeenCalledTimes(1)
  })

  test("honest empty result: a non-existent (or cross-tenant, RLS-hidden) notice id returns 404, not a 200 with null/empty body", async () => {
    class ServiceError extends Error {
      status: number
      constructor(message: string, status: number) {
        super(message)
        this.status = status
      }
    }
    const getNoticeStatus = mock(async () => {
      throw new ServiceError("Notice not found", 404)
    })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({
        orgId: "org-1",
        dbUser: { id: "user-1" },
        apiKey: null,
        response: null,
      })),
    }))
    mock.module("@/lib/services/notice-service", () => ({ getNoticeStatus, ServiceError }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("notice-does-not-exist") as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Notice not found")
  })

  test("an unexpected non-ServiceError failure is a 500 with a generic message, not a leaked internal error", async () => {
    const getNoticeStatus = mock(async () => {
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
    mock.module("@/lib/services/notice-service", () => ({
      getNoticeStatus,
      ServiceError: class ServiceError extends Error {
        status: number
        constructor(message: string, status: number) {
          super(message)
          this.status = status
        }
      },
    }))

    const { GET } = await import("./route")
    const res = await GET(makeRequest() as any, makeParams("notice-1") as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Failed to fetch notice status")
    expect(body.error).not.toContain("connection reset")
  })
})
