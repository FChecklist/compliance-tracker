/// <reference types="bun-types" />
// PROJEXA-E2E-001 actor-misattribution sweep: createdById feeds
// construction-boq-service.ts's approveBoq() isSelfApproval() check --
// before this fix, a real (non-dry-run) import always attributed
// createdById to the shared PROJEXA API key row
// (ctx.dbUser?.id ?? ctx.apiKey!.id), never the real logged-in person,
// defeating that self-approval gate.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const PARSED = {
  lineItems: [{ code: "1.1", description: "Excavation", quantity: 10, rate: 500, parentItemCode: null }],
  warnings: [] as string[],
  issues: [] as unknown[],
  totalRows: 1,
  mapping: {},
  headers: [],
}

function mockAuth(ctx: {
  orgId: string | null
  roleErr?: Response | null
  resolveWriteActorId?: () => Promise<{ actorId: string | null; error: Response | null }>
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: "shared-api-key-1" } : null,
      response: null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    resolveWriteActorId: ctx.resolveWriteActorId ?? mock(async () => ({ actorId: "shared-api-key-1", error: null })),
  }))
}

function mockImportService() {
  mock.module("@/lib/services/construction-boq-import-service", () => ({
    parseBoqSpreadsheet: mock(async () => PARSED),
    toPreviewRows: mock(() => []),
    analyseBoqPreview: mock(() => ({ rows: [], willImport: 1, totalParsed: 1 })),
    ServiceError,
  }))
}

function mockBoqService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/construction-boq-service", () => ({
    createBoq: mock(async () => ({ id: "boq-1" })),
    createBoqRevision: mock(async () => ({ id: "boq-1-rev-2" })),
    ...overrides,
  }))
}

function importRequest() {
  const formData = new FormData()
  formData.set("file", new File(["code,description,quantity,rate\n1.1,Excavation,10,500"], "boq.csv", { type: "text/csv" }))
  formData.set("projectId", "project-1")
  return {
    formData: async () => formData,
    nextUrl: { searchParams: new URLSearchParams() },
  } as any
}

describe("POST /api/v1/projexa/scope/import", () => {
  test("import attributes createdById to the REAL resolved acting user, not the shared API key", async () => {
    const resolveWriteActorId = mock(async () => ({ actorId: "real-person-5", error: null }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    mockImportService()
    const createBoq = mock(async () => ({ id: "boq-1" }))
    mockBoqService({ createBoq })

    const { POST } = await import("./route")
    const res = await POST(importRequest())

    expect(res.status).toBe(201)
    expect(createBoq).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "real-person-5" },
      expect.objectContaining({ projectId: "project-1" })
    )
  })

  test("import is refused, never silently mis-attributed, when the acting-user signal fails to resolve", async () => {
    const refusal = new Response(JSON.stringify({ error: "USER_NOT_LINKED" }), { status: 400 })
    const resolveWriteActorId = mock(async () => ({ actorId: null, error: refusal }))
    mockAuth({ orgId: "org-1", resolveWriteActorId })
    mockImportService()
    const createBoq = mock(async () => ({ id: "boq-1" }))
    mockBoqService({ createBoq })

    const { POST } = await import("./route")
    const res = await POST(importRequest())

    expect(res.status).toBe(400)
    expect(createBoq).not.toHaveBeenCalled()
  })

  test("import falls back to the unchanged legacy actor id when no acting-user signal is sent (backward-compatible default)", async () => {
    mockAuth({ orgId: "org-1" })
    mockImportService()
    const createBoq = mock(async () => ({ id: "boq-1" }))
    mockBoqService({ createBoq })

    const { POST } = await import("./route")
    const res = await POST(importRequest())

    expect(res.status).toBe(201)
    expect(createBoq).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "shared-api-key-1" },
      expect.objectContaining({ projectId: "project-1" })
    )
  })
})
