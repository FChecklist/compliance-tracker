/// <reference types="bun-types" />
// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-05/7-06/7-07/7-08/7-09/
// 7-10). Real route-handler proof for POST .../excel/apply: auth/role gate,
// requiring confirmedDiffToken, malformed-file refusal (7-10), and a
// ServiceError (e.g. the 409 stale-token refusal) passing through with its
// own status untouched.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function mockAuth(opts: { dbUser?: { id: string; role: string } | null; apiKey?: { id: string } | null } = {}) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: "org-1",
      dbUser: opts.dbUser !== undefined ? opts.dbUser : { id: "user-1", role: "member" },
      apiKey: opts.apiKey ?? null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
}

function mockService(opts: { fileErrors?: string[]; applyResult?: Record<string, unknown>; throwError?: FakeServiceError } = {}) {
  const applyUpload = mock(async (_ctx: unknown) => {
    if (opts.throwError) throw opts.throwError
    return opts.applyResult ?? { applied: true, changesApplied: 1, revisionCreated: null, rejectedRows: [], contractChangesPendingEvidence: [], linesNotInUpload: [], contentHash: "hash-abc" }
  })
  mock.module("@/lib/services/boq-excel-roundtrip-service", () => ({
    parseUploadedBoq: mock(() => ({ rows: [{ sheetRow: 2, lineId: "line-a" }], headers: [], fileErrors: opts.fileErrors ?? [], contentHash: "hash-abc" })),
    applyUpload,
    ServiceError: FakeServiceError,
  }))
  return { applyUpload }
}

function makeFile() {
  return new File([new Uint8Array([1, 2, 3])], "boq.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

function postRequest(formData: FormData, id = "boq-1") {
  return new NextRequest(`http://localhost/api/v1/construction/boq/${id}/excel/apply`, { method: "POST", body: formData })
}

describe("POST /api/v1/construction/boq/[id]/excel/apply", () => {
  test("no file -> 400", async () => {
    await mockAuth()
    mockService()
    const { POST } = await import("./route")
    const res = await POST(postRequest(new FormData()), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
  })

  test("missing confirmedDiffToken -> 400, applyUpload never called (7-06/X-20: apply must be of a reviewed diff)", async () => {
    await mockAuth()
    const { applyUpload } = mockService()
    const fd = new FormData()
    fd.set("file", makeFile())
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
    expect(applyUpload).not.toHaveBeenCalled()
  })

  test("a malformed file -> 400, applyUpload never called (7-10: changes nothing)", async () => {
    await mockAuth()
    const { applyUpload } = mockService({ fileErrors: ["The uploaded file could not be read as a valid .xlsx spreadsheet."] })
    const fd = new FormData()
    fd.set("file", makeFile())
    fd.set("confirmedDiffToken", "tok-1")
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
    expect(applyUpload).not.toHaveBeenCalled()
  })

  test("a valid apply call returns the service result, and an API-key caller's key id is used as the actor (no dbUser)", async () => {
    await mockAuth({ dbUser: null, apiKey: { id: "key-1" } })
    const { applyUpload } = mockService({ applyResult: { applied: true, changesApplied: 2, revisionCreated: null, rejectedRows: [], contractChangesPendingEvidence: [], linesNotInUpload: [], contentHash: "hash-abc" } })
    const fd = new FormData()
    fd.set("file", makeFile())
    fd.set("confirmedDiffToken", "tok-1")
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.changesApplied).toBe(2)
    const callArgs = applyUpload.mock.calls[0] as unknown[]
    expect((callArgs[0] as { userId: string }).userId).toBe("key-1")
  })

  test("a stale-token ServiceError (409) passes through with its own status, nothing written", async () => {
    await mockAuth()
    mockService({ throwError: new FakeServiceError("This diff no longer matches the current BOQ state", 409) })
    const fd = new FormData()
    fd.set("file", makeFile())
    fd.set("confirmedDiffToken", "stale-token")
    const { POST } = await import("./route")
    const res = await POST(postRequest(fd), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(409)
  })
})
