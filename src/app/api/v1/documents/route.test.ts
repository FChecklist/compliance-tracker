/// <reference types="bun-types" />
// R-C03 acceptance test: a document can be created via POST /api/v1/documents
// with any category, with or without an attached file, and retrieved via GET.
//
// "With or without an attached file" means the two legal shapes of
// createDocumentRecord()'s input union (document-service.ts): a real File
// upload, or a link-only record carrying `externalUrl` and no bytes at all --
// NOT "neither", which the route correctly refuses with 400 (see its own
// "Either a file or externalUrl is required" check). This test drives both
// legal shapes, across two different categories, through the route's real
// POST -> GET wiring against an in-memory store (document-service's
// create/list functions are replaced, same reuse pattern as
// ../projexa/permits/route.test.ts), so it proves what GET reports is what
// POST actually wrote, not a canned answer.
import { describe, test, expect, mock, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

// Same rationale as ../projexa/permits/route.test.ts: the first dynamic
// import() of ./route pulls document-service.ts (and its transitive
// Supabase/drizzle graph) in cold, which can exceed bun's 5000 ms default.
setDefaultTimeout(20000)

type StoredDoc = {
  id: string
  name: string
  category: string
  fileUrl: string
  fileType: string | null
  fileSize: number | null
  metadata: unknown
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
  const createDocumentRecord = mock(async (_ctx: unknown, input: Record<string, unknown>) => {
    const file = input.file as File | undefined
    const doc: StoredDoc = {
      id: `doc-${++counter}`,
      name: input.name as string,
      category: input.category as string,
      fileUrl: file ? `org-1/${file.name}` : (input.externalUrl as string),
      fileType: file ? (file.type || null) : null,
      fileSize: file ? file.size : null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    }
    store.push(doc)
    return doc
  })
  const listDocuments = mock(async () => store)
  const docActual = await import("@/lib/services/document-service")
  mock.module("@/lib/services/document-service", () => ({ ...docActual, createDocumentRecord, listDocuments }))
  return { createDocumentRecord, listDocuments }
}

function postRequest(formData: FormData) {
  return new NextRequest("http://localhost/api/v1/documents", {
    method: "POST",
    headers: { authorization: "Bearer vk_test" },
    body: formData,
  })
}

function getRequest() {
  return new NextRequest("http://localhost/api/v1/documents", {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("POST /api/v1/documents -- any category, with or without an attached file, then GET", () => {
  test("a file-attached document and a link-only (no file) document, in different categories, both persist and both come back via GET", async () => {
    const store: StoredDoc[] = []
    await mockCreateThenList(store)
    const { POST, GET } = await import("./route")

    // With an attached file, category 'survey'.
    const fileForm = new FormData()
    fileForm.set("name", "Site Survey Report")
    fileForm.set("category", "survey")
    fileForm.set("file", new File([new Uint8Array([1, 2, 3])], "survey.pdf", { type: "application/pdf" }))
    const filePostRes = await POST(postRequest(fileForm))
    expect(filePostRes.status).toBe(201)
    const fileDoc = await filePostRes.json()
    expect(fileDoc.category).toBe("survey")
    expect(fileDoc.fileUrl).toContain("survey.pdf")
    expect(fileDoc.fileType).toBe("application/pdf")

    // Without an attached file (link-only, externalUrl), category 'drawing_3d'.
    const linkForm = new FormData()
    linkForm.set("name", "Matterport Walkthrough Link")
    linkForm.set("category", "drawing_3d")
    linkForm.set("externalUrl", "https://my.matterport.com/show/?m=abc123")
    const linkPostRes = await POST(postRequest(linkForm))
    expect(linkPostRes.status).toBe(201)
    const linkDoc = await linkPostRes.json()
    expect(linkDoc.category).toBe("drawing_3d")
    expect(linkDoc.fileUrl).toBe("https://my.matterport.com/show/?m=abc123")
    expect(linkDoc.fileType).toBeNull()

    // Both are retrievable via GET, whatever their category or file shape.
    const listRes = await GET(getRequest())
    const body = await listRes.json()

    expect(body.documents).toHaveLength(2)
    const byName = Object.fromEntries(body.documents.map((d: StoredDoc) => [d.name, d]))
    expect(byName["Site Survey Report"].category).toBe("survey")
    expect(byName["Site Survey Report"].fileUrl).toContain("survey.pdf")
    expect(byName["Matterport Walkthrough Link"].category).toBe("drawing_3d")
    expect(byName["Matterport Walkthrough Link"].fileUrl).toBe("https://my.matterport.com/show/?m=abc123")
  })

  test("neither a file nor an externalUrl is refused with 400 -- a document needs one or the other", async () => {
    const store: StoredDoc[] = []
    await mockCreateThenList(store)
    const { POST } = await import("./route")

    const emptyForm = new FormData()
    emptyForm.set("name", "Nothing attached")
    emptyForm.set("category", "other")
    const res = await POST(postRequest(emptyForm))

    expect(res.status).toBe(400)
    expect(store).toHaveLength(0)
  })
})
