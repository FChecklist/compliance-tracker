/// <reference types="bun-types" />
// projexa-api POST /uploads/sign (supabase/functions/projexa-api/upload-sign.ts): the contract cases of
// ai-os/audit37/UPLOAD_CONTRACT_2026-10-06.md. The handler runs for real with fake dependencies.
// Run: bun test --isolate src/lib/services/projexa-upload-sign.test.ts
import { describe, test, expect } from "bun:test"
import { handleUploadSign, isUploadSignRequest, publicObjectUrl, sanitizeFileName, type UploadSignDeps } from "../../../supabase/functions/projexa-api/upload-sign"
import type { SessionVerdict } from "../../../supabase/functions/ai-work-link/session"

const ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const SUB = "0d4b7c1e-1111-4222-8333-444455556666"
const ORG_A = "9a1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff"
const ORG_B = "1b2c3d4e-bbbb-4ccc-8ddd-eeeeffff0000"
const URL_ = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/uploads/sign"
const SB = "https://pcrjmlpuqsbocqfwoxod.supabase.co"

function deps(o: { verdict?: SessionVerdict; org?: string | null; role?: string; allowed?: boolean; reserveOk?: boolean; signOk?: boolean; signed?: string[]; reserved?: { org: string; limit: number }[] } = {}): UploadSignDeps {
  return {
    session: async () => o.verdict ?? { ok: true, sub: SUB, email: "a@px.test", issuer: ISSUER, iat: 1 },
    issuer: ISSUER,
    membership: async () => ({ ok: true, row: o.org === null ? null : { organization_id: o.org ?? ORG_A, role: o.role ?? "pm" } }),
    reserve: async (org, limit) => {
      o.reserved?.push({ org, limit })
      return o.reserveOk === false ? { ok: false } : { ok: true, allowed: o.allowed ?? true }
    },
    sign: async (p) => {
      o.signed?.push(p)
      return o.signOk === false ? { ok: false } : { ok: true, signedUrl: `${SB}/storage/v1/object/upload/sign/projexa-files/${p}?token=t` }
    },
    publicUrl: (p) => publicObjectUrl(SB, p),
    newId: () => "11111111-2222-4333-8444-555555555555",
    now: () => Date.parse("2026-10-06T10:00:00.000Z"),
    log: () => {},
  }
}
const good = { kind: "drawing", projectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", fileName: "Plan A.pdf", contentType: "application/pdf", size: 1234 }
const post = (body: unknown, headers: Record<string, string> = { authorization: "Bearer tok" }) => new Request(URL_, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) })

describe("POST /uploads/sign", () => {
  test("200: the exact contract shape, org-scoped unguessable path", async () => {
    const signed: string[] = []
    const res = await handleUploadSign(post(good), deps({ signed }))
    expect(res.status).toBe(200)
    const j = await res.json()
    const path = `${ORG_A}/drawing/11111111-2222-4333-8444-555555555555/Plan A.pdf`
    expect(signed).toEqual([path])
    expect(j).toEqual({
      uploadUrl: `${SB}/storage/v1/object/upload/sign/projexa-files/${path}?token=t`,
      method: "PUT",
      headers: { "content-type": "application/pdf", "x-upsert": "false" },
      externalUrl: `${SB}/storage/v1/object/public/projexa-files/${ORG_A}/drawing/11111111-2222-4333-8444-555555555555/Plan%20A.pdf`,
      expiresAt: "2026-10-06T12:00:00.000Z",
      maxBytes: 52428800,
    })
  })
  test("401 signed out / bad token / foreign issuer", async () => {
    expect((await handleUploadSign(post(good, {}), deps())).status).toBe(401)
    expect((await handleUploadSign(post(good), deps({ verdict: { ok: false, reason: "invalid" } as SessionVerdict }))).status).toBe(401)
    expect((await handleUploadSign(post(good), deps({ verdict: { ok: true, sub: SUB, email: "x@y.z", issuer: "https://evil/auth/v1", iat: 1 } }))).status).toBe(401)
  })
  test("no organisation -> 400; read-only role -> 403", async () => {
    expect((await handleUploadSign(post(good), deps({ org: null }))).status).toBe(400)
    expect((await handleUploadSign(post(good), deps({ role: "client_viewer" }))).status).toBe(403)
  })
  test("415 for a type outside the allow-list; parameters on an allowed type are fine", async () => {
    for (const ct of ["application/x-msdownload", "text/html", "image/svg+xml", "application/javascript"]) {
      expect((await handleUploadSign(post({ ...good, contentType: ct }), deps())).status).toBe(415)
    }
    expect((await handleUploadSign(post({ ...good, contentType: "Text/CSV; charset=utf-8" }), deps())).status).toBe(200)
  })
  test("413 above 50 MB, 200 at exactly 50 MB; 422 for 0, negative, fractional, non-number", async () => {
    expect((await handleUploadSign(post({ ...good, size: 52428801 }), deps())).status).toBe(413)
    expect((await handleUploadSign(post({ ...good, size: 52428800 }), deps())).status).toBe(200)
    for (const size of [0, -5, 1.5, "10", null]) expect((await handleUploadSign(post({ ...good, size }), deps())).status).toBe(422)
  })
  test("422 for a bad body, kind, projectId or missing names", async () => {
    expect((await handleUploadSign(post("not json"), deps())).status).toBe(422)
    expect((await handleUploadSign(post("[]"), deps())).status).toBe(422)
    expect((await handleUploadSign(post({ ...good, kind: "invoice" }), deps())).status).toBe(422)
    expect((await handleUploadSign(post({ ...good, projectId: "nope" }), deps())).status).toBe(422)
    expect((await handleUploadSign(post({ ...good, fileName: "  " }), deps())).status).toBe(422)
    expect((await handleUploadSign(post({ ...good, contentType: undefined }), deps())).status).toBe(422)
  })
  test("the file name is sanitised: no separators, no control chars, extension kept, max 120", async () => {
    for (const n of ["../../etc/passwd", "a\\b\\c.pdf", "x\u0000y\u001f.pdf", "..", "///", "a/../../b.pdf"]) {
      const s = sanitizeFileName(n)
      expect(s).not.toMatch(/[\\/\u0000-\u001f]/)
      expect(s.startsWith(".")).toBe(false)
      expect(s.length).toBeGreaterThan(0)
    }
    const long = sanitizeFileName("x".repeat(300) + ".pdf")
    expect(long.length).toBe(120)
    expect(long.endsWith(".pdf")).toBe(true)
    const signed: string[] = []
    await handleUploadSign(post({ ...good, fileName: "../../other-org/evil\u0000.pdf" }), deps({ signed }))
    expect(signed[0].split("/")).toHaveLength(4)
    expect(signed[0].startsWith(`${ORG_A}/drawing/`)).toBe(true)
  })
  test("org scoping: the path folder is the caller's membership org; a body naming another org changes nothing", async () => {
    const a: string[] = []
    const b: string[] = []
    await handleUploadSign(post({ ...good, orgId: ORG_B, organizationId: ORG_B, path: `${ORG_B}/x` }), deps({ org: ORG_A, signed: a }))
    await handleUploadSign(post(good), deps({ org: ORG_B, signed: b }))
    expect(a[0].startsWith(`${ORG_A}/`)).toBe(true)
    expect(a[0]).not.toContain(ORG_B)
    expect(b[0].startsWith(`${ORG_B}/`)).toBe(true)
    const q = new Request(`${URL_}?org=${ORG_B}`, { method: "POST", headers: { authorization: "Bearer tok", "x-org": ORG_B }, body: JSON.stringify(good) })
    const c: string[] = []
    await handleUploadSign(q, deps({ org: ORG_A, signed: c }))
    expect(c[0].startsWith(`${ORG_A}/`)).toBe(true)
  })
  test("rate limit: reserve is asked with the org and 200; refused -> 429 and nothing signed", async () => {
    const reserved: { org: string; limit: number }[] = []
    const signed: string[] = []
    const res = await handleUploadSign(post(good), deps({ allowed: false, reserved, signed }))
    expect(res.status).toBe(429)
    expect(reserved).toEqual([{ org: ORG_A, limit: 200 }])
    expect(signed).toEqual([])
  })
  test("5xx is retryable: reserve or sign failing -> 503 with Retry-After", async () => {
    const r1 = await handleUploadSign(post(good), deps({ reserveOk: false }))
    expect(r1.status).toBe(503)
    expect(r1.headers.get("retry-after")).toBeTruthy()
    expect((await handleUploadSign(post(good), deps({ signOk: false }))).status).toBe(503)
  })
  test("routing and methods", async () => {
    expect(isUploadSignRequest(new Request(URL_))).toBe(true)
    expect(isUploadSignRequest(new Request(`${SB}/functions/v1/projexa-api/api/documents`))).toBe(false)
    expect((await handleUploadSign(new Request(URL_, { method: "GET" }), deps())).status).toBe(405)
    expect((await handleUploadSign(new Request(URL_, { method: "OPTIONS", headers: { origin: "http://localhost:3100" } }), deps())).status).toBe(204)
  })
})

describe("per-organisation storage cap (100 MB)", () => {
  const withUsage = (bytes: number | "fail", o: Parameters<typeof deps>[0] = {}): UploadSignDeps => ({
    ...deps(o),
    orgUsage: async () => (bytes === "fail" ? { ok: false } : { ok: true, bytes }),
  })
  test("under the cap -> 200; exactly at the cap -> 200", async () => {
    expect((await handleUploadSign(post(good), withUsage(0))).status).toBe(200)
    expect((await handleUploadSign(post(good), withUsage(104857600 - 1234))).status).toBe(200)
  })
  test("over the cap -> 413 ORG_QUOTA with plain words; nothing signed, no rate slot used", async () => {
    const signed: string[] = []
    const reserved: { org: string; limit: number }[] = []
    const res = await handleUploadSign(post(good), withUsage(104857600 - 1233, { signed, reserved }))
    expect(res.status).toBe(413)
    const j = await res.json()
    expect(j.code).toBe("ORG_QUOTA")
    expect(j.error).toContain("100 MB")
    expect(j.orgQuotaBytes).toBe(104857600)
    expect(signed).toEqual([])
    expect(reserved).toEqual([])
  })
  test("usage lookup failing -> 503 retryable, never silently skipped", async () => {
    const res = await handleUploadSign(post(good), withUsage("fail"))
    expect(res.status).toBe(503)
    expect(res.headers.get("retry-after")).toBeTruthy()
  })
  test("the lookup is asked for the caller's membership org only", async () => {
    const asked: string[] = []
    await handleUploadSign(post({ ...good, orgId: ORG_B }), { ...deps({ org: ORG_A }), orgUsage: async (o) => (asked.push(o), { ok: true, bytes: 0 }) })
    expect(asked).toEqual([ORG_A])
  })
  test("existing refusals keep their order: 413 file too large and 415 come before the cap lookup", async () => {
    const asked: string[] = []
    const d = { ...deps(), orgUsage: async (o: string) => (asked.push(o), { ok: true as const, bytes: 0 }) }
    expect((await handleUploadSign(post({ ...good, size: 52428801 }), d)).status).toBe(413)
    expect((await handleUploadSign(post({ ...good, contentType: "text/html" }), d)).status).toBe(415)
    expect(asked).toEqual([])
  })
})
