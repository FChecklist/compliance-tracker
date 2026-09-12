/// <reference types="bun-types" />
// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-06/7-09/7-10). Real
// route-handler proof for POST .../excel/diff: auth/role gate, the 400s
// (no file, oversized file, malformed file), and that cost-visibility
// redaction is applied to the response based on the caller's role.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function mockAuth(opts: { role?: string; roleErr?: unknown } = {}) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: "org-1",
      dbUser: { id: "user-1", role: opts.role ?? "member" },
      apiKey: null,
    })),
    requireRoleOrScope: mock(() => opts.roleErr ?? null),
  }))
}

function mockService(opts: { fileErrors?: string[]; diff?: Record<string, unknown> } = {}) {
  const diffUpload = mock(async () => opts.diff ?? { changes: [], countsByColumnClass: { structural: 0, cost: 0, contract: 0, computedIgnored: 0 } })
  mock.module("@/lib/services/boq-excel-roundtrip-service", () => ({
    parseUploadedBoq: mock(() => ({ rows: [{ sheetRow: 2, lineId: "line-a" }], headers: [], fileErrors: opts.fileErrors ?? [], contentHash: "hash-abc" })),
    diffUpload,
    redactUploadDiffForCostVisibility: mock((diff: unknown, canSeeCost: boolean) => (canSeeCost ? diff : { ...(diff as object), changes: [] })),
    ServiceError: FakeServiceError,
  }))
  mock.module("@/lib/services/cost-visibility-service", () => ({
    canRoleSeeCost: mock(async (_ctx: unknown, role: string | null) => role === "admin"),
  }))
  return { diffUpload }
}

function makeFile(name = "boq.xlsx", size?: number) {
  const bytes = size ? new Uint8Array(size) : new Uint8Array([1, 2, 3])
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

function postRequest(formData: FormData, id = "boq-1") {
  return new NextRequest(`http://localhost/api/v1/construction/boq/${id}/excel/diff`, { method: "POST", body: formData })
}

describe("POST /api/v1/construction/boq/[id]/excel/diff", () => {
  test("no file -> 400", async () => {
    await mockAuth()
    mockService()
    const { POST } = await import("./route")
    const res = await POST(postRequest(new FormData()), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
  })

  test("oversized file -> 400, service never called", async () => {
    await mockAuth()
    const { diffUpload } = mockService()
    const fd = new FormData()
    fd.set("file", makeFile("boq.xlsx", 11 * 1024 * 1024))
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
    expect(diffUpload).not.toHaveBeenCalled()
  })

  test("a malformed file -> 400 with fileErrors, diffUpload never called (7-10)", async () => {
    await mockAuth()
    const { diffUpload } = mockService({ fileErrors: ["Missing required column(s): Line ID"] })
    const fd = new FormData()
    fd.set("file", makeFile())
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fileErrors).toEqual(["Missing required column(s): Line ID"])
    expect(diffUpload).not.toHaveBeenCalled()
  })

  test("a valid upload for a cost-blind role (member) gets its diff redacted", async () => {
    await mockAuth({ role: "member" })
    mockService({ diff: { changes: [{ columnClass: "cost" }], countsByColumnClass: { structural: 0, cost: 1, contract: 0, computedIgnored: 0 } } })
    const fd = new FormData()
    fd.set("file", makeFile())
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.changes).toEqual([]) // redacted -- member is not cost-visible per the mock
  })

  test("a valid upload for a cost-visible role (admin) keeps cost changes in the diff", async () => {
    await mockAuth({ role: "admin" })
    mockService({ diff: { changes: [{ columnClass: "cost" }], countsByColumnClass: { structural: 0, cost: 1, contract: 0, computedIgnored: 0 } } })
    const fd = new FormData()
    fd.set("file", makeFile())
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.changes.length).toBe(1)
  })

  test("a role below the write floor is refused before any file is even read", async () => {
    await mockAuth({ roleErr: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) })
    const { diffUpload } = mockService()
    const { POST } = await import("./route")
    const res = await POST(postRequest(new FormData()), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(403)
    expect(diffUpload).not.toHaveBeenCalled()
  })
})
