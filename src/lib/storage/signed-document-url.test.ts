/// <reference types="bun-types" />
// R67 F-02. The behaviour worth pinning is the failure posture, not the happy
// path: a document link is an enrichment of a row, so every way Storage can
// fail must resolve to null and let the row survive. The injectable
// clientFactory exists for exactly this -- no Supabase credentials, no
// network, no mocking of the module graph.
import { describe, expect, test } from "bun:test"
import { signDocumentUrl, DOCUMENT_BUCKET, DOCUMENT_URL_TTL_SECONDS } from "./signed-document-url"

function fakeClient(impl: (path: string, ttl: number) => Promise<{ data: { signedUrl: string } | null }>) {
  const calls: { bucket: string; path: string; ttl: number }[] = []
  const client = {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, expiresIn: number) {
            calls.push({ bucket, path, ttl: expiresIn })
            return impl(path, expiresIn)
          },
        }
      },
    },
  }
  return { client, calls }
}

describe("signDocumentUrl", () => {
  test("returns the signed URL and asks the right bucket with the given TTL", async () => {
    const { client, calls } = fakeClient(async () => ({ data: { signedUrl: "https://storage/signed?token=abc" } }))
    const url = await signDocumentUrl("org/permits/a.pdf", "test", 300, () => client)

    expect(url).toBe("https://storage/signed?token=abc")
    expect(calls).toEqual([{ bucket: DOCUMENT_BUCKET, path: "org/permits/a.pdf", ttl: 300 }])
  })

  test("defaults to the one-hour click-time TTL", async () => {
    const { client, calls } = fakeClient(async () => ({ data: { signedUrl: "u" } }))
    await signDocumentUrl("p", "test", undefined, () => client)
    expect(calls[0].ttl).toBe(DOCUMENT_URL_TTL_SECONDS)
    expect(DOCUMENT_URL_TTL_SECONDS).toBe(3600)
  })

  test("an empty path never touches Storage at all", async () => {
    const { client, calls } = fakeClient(async () => ({ data: { signedUrl: "u" } }))
    expect(await signDocumentUrl("", "test", 300, () => client)).toBeNull()
    expect(await signDocumentUrl(null, "test", 300, () => client)).toBeNull()
    expect(await signDocumentUrl(undefined, "test", 300, () => client)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test("a rejected sign call resolves to null instead of throwing", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("Bucket not found")
    })
    expect(await signDocumentUrl("p", "test", 300, () => client)).toBeNull()
  })

  test("a client that cannot be constructed resolves to null instead of throwing", async () => {
    const url = await signDocumentUrl("p", "test", 300, () => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
    })
    expect(url).toBeNull()
  })

  test("a success response carrying no URL resolves to null", async () => {
    const { client } = fakeClient(async () => ({ data: null }))
    expect(await signDocumentUrl("p", "test", 300, () => client)).toBeNull()
  })
})
