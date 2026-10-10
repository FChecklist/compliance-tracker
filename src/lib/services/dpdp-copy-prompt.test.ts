/// <reference types="bun-types" />
// GET /ai/<token>/prompt: the ready-to-paste prompt for the PERSON, served by the dpdp-ai-link Edge Function so the one-tap Copy
// page (dpdp-app /copy/) copies exactly what the Monday email shows (owner, 2026-09-30: "put a simple copy icon ... make user life
// easy"). The REAL index.ts is loaded under bun with a stubbed Deno global and a mocked supabase-js, then driven through its real
// handler, the same technique dpdp-mail-outbound.test.ts uses for the email functions.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { parseRoute } from "../../../supabase/functions/dpdp-ai-link/router"
import { aiPasteText } from "../../../supabase/functions/_shared/ai-link/prompt"
import { aiPasteText as aiPasteTextFromEmail } from "../../../supabase/functions/dpdp-monday-email/render"

const TOKEN = "ab".repeat(32) // 64 hex characters, low entropy on purpose (gitleaks)
const BASE = `https://dpdp.veridian-aios.com/ai/${TOKEN}`

type Call = { fn: string; args: Record<string, unknown> }
const calls: Call[] = []
let answers: Record<string, () => { data?: unknown; error?: { code?: string; message: string } | null }> = {}
let handler: ((req: Request) => Promise<Response>) | null = null

const context = (over: { kind?: string; level?: 0 | 1; name?: string; expiresAt?: string } = {}) => ({
  org: { id: "o1", name: over.name ?? "Acme & Co", product: "firm" },
  viewer: { email: "priya@acmeca.in", kind: over.kind ?? "staff", level: "staff" },
  link: { id: "L1", label: "Monday email", authorityLevel: over.level ?? 1, hideEmails: false, createdAt: "2026-10-05T00:30:00Z", expiresAt: over.expiresAt ?? "2026-10-12T00:30:00Z", callCount: 0 },
  library: { version: "v1", releasedOn: "2026-09-01" },
  counts: { jobs: 31, people: 4 },
  verbs: { level1: ["NOTE"], level2: ["MARK_DONE"] },
})

function wire(ctx: unknown = context(), ctxError?: { code?: string; message: string }) {
  answers = {
    dpdp_ai_link_log_call: () => ({ data: { callId: "c1", linkId: "L1", callsLastMinute: 1 } }),
    dpdp_ai_link_log_call_result: () => ({ data: null }),
    dpdp_ai_link_context: () => (ctxError ? { error: ctxError } : { data: ctx }),
  }
}

beforeAll(async () => {
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" } as Record<string, string>)[k] },
    serve: (h: (req: Request) => Promise<Response>) => { handler = h },
  }
  mock.module("npm:@supabase/supabase-js@2", () => ({
    createClient: () => ({
      rpc: async (fn: string, args: Record<string, unknown> = {}) => {
        calls.push({ fn, args })
        const a = answers[fn]
        const r = a ? a() : { data: null }
        return { data: r.data ?? null, error: r.error ?? null }
      },
    }),
  }))
  await import("../../../supabase/functions/dpdp-ai-link/index.ts")
})
afterAll(() => { delete (globalThis as any).Deno })

const get = (path: string, method = "GET") => handler!(new Request(`https://proj.supabase.co/functions/v1/dpdp-ai-link/${TOKEN}${path}`, { method }))

describe("the /prompt route", () => {
  test("parseRoute knows it, and only on a valid token", () => {
    expect(parseRoute(`/ai/${TOKEN}/prompt`)).toEqual({ token: TOKEN, route: { kind: "prompt" } })
    expect(parseRoute(`/functions/v1/dpdp-ai-link/${TOKEN}/prompt`)).toEqual({ token: TOKEN, route: { kind: "prompt" } })
    expect(parseRoute("/ai/short/prompt")).toMatchObject({ error: 404 })
    expect(parseRoute(`/ai/${TOKEN}/prompt/extra`)).toMatchObject({ error: 404 })
  })

  test("a live link: 200 text/plain, exactly the two lines the email shows (the same for every link: the personal part is the page), private headers", async () => {
    for (const ctx of [context({ kind: "owner", level: 1 }), context({ kind: "staff", level: 1 }), context({ kind: "owner", level: 0, name: "Other & Co" })]) {
      calls.length = 0; wire(ctx)
      const res = await get("/prompt")
      expect(res.status).toBe(200)
      expect(res.headers.get("x-dpdp-content-type")).toBe("text/plain; charset=utf-8")
      expect(res.headers.get("cache-control")).toBe("no-store")
      expect(res.headers.get("referrer-policy")).toBe("no-referrer")
      expect(res.headers.get("x-robots-tag")).toContain("noindex")
      const body = (await res.text()).slice(0, -1)
      expect(body).toBe(aiPasteText(BASE))
      expect(body).toBe(aiPasteTextFromEmail(BASE)) // one definition, two users
      expect(body.split(String.fromCharCode(10)).pop()).toBe(BASE)
      expect(body).not.toContain("Acme")
      expect(body).not.toContain("Other & Co")
      // it only checks that the link is live; nothing else is read
      // the link must be live (context), and the billing lookup only decides whether a "Payment pending" NOTICE line is added (none here)
      expect(calls.map((c) => c.fn)).toEqual(["dpdp_ai_link_log_call", "dpdp_ai_link_context", "dpdp_ai_link_billing_notice", "dpdp_ai_link_log_call_result"])
      expect(calls[1].args).toEqual({ p_token: TOKEN })
    }
  })

  test("an expired or revoked link is 410 with the link's own sentence, never a prompt", async () => {
    wire(undefined, { code: "42501", message: "This link has expired or was revoked" })
    const res = await get("/prompt")
    expect(res.status).toBe(410)
    expect(await res.text()).not.toContain("DPDP compliance assistant")
  })

  test("only GET: a POST is refused", async () => {
    wire()
    expect((await get("/prompt", "POST")).status).toBe(405)
  })
})
