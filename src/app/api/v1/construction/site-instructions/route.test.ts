/// <reference types="bun-types" />
// R-C14: A site instruction can be POSTed with fields (projectId, issueDate,
// toContractor, description, drawingRef, costImpact, timeImpact, boqId) and
// retrieved via GET filtered by projectId.
//
// Exercises the REAL route.ts exports (GET + POST) end-to-end, with only
// construction-site-instruction-service.ts and the auth guard mocked --
// same convention as the sibling v1/projexa/timesheets/route.test.ts. Proves
// (a) every one of the eight fields on the POST body reaches
// createSiteInstruction() as the caller sent it, under the right {orgId,
// userId} context, (b) the created row comes back with HTTP 201, and (c) GET
// reads the `projectId` query param and forwards exactly that value to
// listSiteInstructions(), returning it under `siteInstructions` with 200.
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
  }))
}

describe("POST + GET /api/v1/construction/site-instructions -- R-C14", () => {
  test("a site instruction is POSTed with the full field set and retrieved via GET filtered by its projectId", async () => {
    mockAuth({ orgId: "org-1" })

    const body = {
      projectId: "proj-1",
      issueDate: "2026-09-05",
      toContractor: "Skyline Builders",
      description: "Change the door swing on Level 3 per revised drawing",
      drawingRef: "A-204-Rev-C",
      costImpact: true,
      timeImpact: false,
      boqId: "boq-1",
    }

    const createdRow = {
      id: "si-1", orgId: "org-1", siNumber: 1, issuedBy: "user-1",
      createdAt: "2026-09-05T00:00:00.000Z", ...body,
    }

    const createSiteInstruction = mock(async () => createdRow)
    const listSiteInstructions = mock(async () => [createdRow])
    mock.module("@/lib/services/construction-site-instruction-service", () => ({
      createSiteInstruction,
      listSiteInstructions,
      ServiceError,
    }))

    const { POST, GET } = await import("./route")

    // --- create ---
    const postRes = await POST({
      nextUrl: new URL("http://localhost/api/v1/construction/site-instructions"),
      json: async () => body,
    } as any)

    expect(postRes.status).toBe(201)
    expect(await postRes.json()).toEqual(createdRow)
    expect(createSiteInstruction).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, body)

    // --- retrieve, filtered by projectId ---
    const getRes = await GET({
      nextUrl: new URL("http://localhost/api/v1/construction/site-instructions?projectId=proj-1"),
    } as any)

    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual({ siteInstructions: [createdRow] })
    expect(listSiteInstructions).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
  })
})
