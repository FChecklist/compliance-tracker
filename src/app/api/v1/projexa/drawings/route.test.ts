/// <reference types="bun-types" />
// R-C02 acceptance test: a drawing or 3D walkthrough file can be uploaded via
// POST /api/v1/projexa/drawings, and GET lists all uploaded drawings/
// walkthroughs with their metadata.
//
// Same reuse pattern as ../permits/route.test.ts: the Supabase client module
// is mocked (so signDocumentUrl's real code path runs against a fake, never a
// live bucket) and document-service's create/list functions are replaced with
// an in-memory store, so this test drives the route's own POST -> GET wiring
// rather than asserting against a canned row.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

// Same rationale as ../permits/route.test.ts: the first dynamic import() of
// ./route pulls document-service.ts (and its transitive Supabase/drizzle
// graph) in cold, which can exceed bun's 5000 ms default on a slow disk.
setDefaultTimeout(20000)

const createSignedUrl = mock(async () => ({ data: { signedUrl: "https://storage.example/signed-drawing" } }))

mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({
    storage: { from: mock(() => ({ createSignedUrl })) },
  })),
}))

type StoredDoc = {
  id: string
  name: string
  category: string
  metadata: unknown
  fileUrl: string
  fileType: string | null
  createdAt: Date
}

async function mockCreateThenList(store: StoredDoc[]) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: "org-1",
      dbUser: null,
      apiKey: { id: "key-1", scopes: ["read", "write"] },
      response: null,
    })),
  }))

  let counter = 0
  const createDrawingRecord = mock(async (_ctx: unknown, input: Record<string, unknown>) => {
    const file = input.file as File | undefined
    const doc: StoredDoc = {
      id: `drw-${++counter}`,
      name: input.name as string,
      category: input.category as string,
      metadata: {
        discipline: input.discipline ?? null,
        isExternalLink: !file,
        drawingNo: input.drawingNo ?? null,
        rev: input.rev ?? null,
        status: input.status ?? "for_approval",
        supersedesId: null,
      },
      fileUrl: file ? `org-1/drawings/${file.name}` : (input.externalUrl as string),
      fileType: file ? (file.type || null) : null,
      createdAt: new Date(),
    }
    store.push(doc)
    return doc
  })
  const listDocuments = mock(async (_ctx: unknown, filters: { category?: string }) =>
    store.filter((d) => !filters.category || d.category === filters.category)
  )
  const docActual = await import("@/lib/services/document-service")
  mock.module("@/lib/services/document-service", () => ({ ...docActual, createDrawingRecord, listDocuments }))
  return { createDrawingRecord, listDocuments }
}

function postRequest(formData: FormData) {
  return new NextRequest("http://localhost/api/v1/projexa/drawings", {
    method: "POST",
    headers: { authorization: "Bearer vk_test" },
    body: formData,
  })
}

function getRequest(query: string) {
  return new NextRequest(`http://localhost/api/v1/projexa/drawings${query}`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("POST /api/v1/projexa/drawings -- upload, then GET lists it with its metadata", () => {
  test("an uploaded DWG drawing and an uploaded 3D-walkthrough file both persist and both come back via GET with their metadata", async () => {
    const store: StoredDoc[] = []
    await mockCreateThenList(store)
    const { POST, GET } = await import("./route")

    const dwgForm = new FormData()
    dwgForm.set("projectId", "proj-1")
    dwgForm.set("kind", "dwg")
    dwgForm.set("discipline", "MEP")
    dwgForm.set("drawingNo", "M-101")
    dwgForm.set("rev", "P1")
    dwgForm.set("status", "current")
    dwgForm.set("file", new File([new Uint8Array([1, 2, 3])], "M-101.dwg", { type: "application/acad" }))
    const dwgPostRes = await POST(postRequest(dwgForm))
    expect(dwgPostRes.status).toBe(201)
    const dwgCreated = await dwgPostRes.json()
    expect(dwgCreated.kind).toBe("dwg")
    expect(dwgCreated.drawingNo).toBe("M-101")

    const walkthroughForm = new FormData()
    walkthroughForm.set("projectId", "proj-1")
    walkthroughForm.set("kind", "3d_walkthrough")
    walkthroughForm.set("name", "Villa 21 Walkthrough")
    walkthroughForm.set("discipline", "Architectural")
    walkthroughForm.set(
      "file",
      new File([new Uint8Array([4, 5, 6])], "villa-21-walkthrough.glb", { type: "model/gltf-binary" })
    )
    const walkthroughPostRes = await POST(postRequest(walkthroughForm))
    expect(walkthroughPostRes.status).toBe(201)
    const walkthroughCreated = await walkthroughPostRes.json()
    expect(walkthroughCreated.kind).toBe("3d_walkthrough")
    expect(walkthroughCreated.name).toBe("Villa 21 Walkthrough")

    const listRes = await GET(getRequest("?projectId=proj-1"))
    const body = await listRes.json()

    expect(body.drawings).toHaveLength(2)

    const dwgRow = body.drawings.find((d: Record<string, unknown>) => d.kind === "dwg")
    expect(dwgRow.discipline).toBe("MEP")
    expect(dwgRow.drawingNo).toBe("M-101")
    expect(dwgRow.rev).toBe("P1")
    expect(dwgRow.status).toBe("current")
    expect(dwgRow.hasDocument).toBe(true)
    expect(dwgRow.isExternalLink).toBe(false)

    const walkthroughRow = body.drawings.find((d: Record<string, unknown>) => d.kind === "3d_walkthrough")
    expect(walkthroughRow.name).toBe("Villa 21 Walkthrough")
    expect(walkthroughRow.discipline).toBe("Architectural")
    expect(walkthroughRow.hasDocument).toBe(true)
    expect(walkthroughRow.isExternalLink).toBe(false)
  })
})
