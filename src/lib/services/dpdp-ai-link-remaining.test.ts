/// <reference types="bun-types" />
// The remaining AI-link fixes from the 2026-10-02 simulation (dpdp-app/AI-LINK-SIMULATION-REPORT.md, findings 3, 5, 6, 7) and the owner's
// "access never locks" rule: through the REAL handler (supabase/functions/dpdp-ai-link/index.ts) with the database answers faked.
//   * the 410 says where to make a new link;
//   * "Do not fetch anything yet" no longer clashes with the call list;
//   * ?brief=1 is a much shorter manual; the full one stays at the same address and points to it;
//   * a link whose organisation's free trial ended gets a clear "Payment pending" NOTICE (never a refusal), a failed lookup gives none;
//   * the page tells the AI to reply in the person's language without translating the law text.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"

const TOKEN = "cd".repeat(32)
const GONE = "This link has expired or was revoked"

type Answer = { data?: unknown; error?: { code?: string; message: string } | null }
const calls: Array<{ fn: string }> = []
let answers: Record<string, () => Answer> = {}
let handler: ((req: Request) => Promise<Response>) | null = null

const context = () => ({
  org: { id: "o1", name: "Acme & Co", product: "firm" },
  viewer: { email: "priya@acmeca.in", kind: "owner", level: "owner" },
  link: { id: "L1", label: "Monday email", authorityLevel: 1, hideEmails: false, createdAt: "2026-10-05T00:30:00Z", expiresAt: "2026-10-12T00:30:00Z", callCount: 0 },
  library: { version: "v1", releasedOn: "2026-09-01", reviewer: null, reviewedOn: null },
  counts: { jobs: 3, people: 2 },
  verbs: { level1: ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA"], level2: ["MARK_DONE"] },
})

beforeAll(async () => {
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" } as Record<string, string>)[k] },
    serve: (h: (req: Request) => Promise<Response>) => { handler = h },
  }
  mock.module("npm:@supabase/supabase-js@2", () => ({
    createClient: () => ({
      rpc: async (fn: string) => {
        calls.push({ fn })
        const a = answers[fn]
        const r = a ? a() : { data: null }
        return { data: r.data ?? null, error: r.error ?? null }
      },
    }),
  }))
  await import("../../../supabase/functions/dpdp-ai-link/index.ts")
})
afterAll(() => { delete (globalThis as any).Deno })

const rows = [
  { id: "j-late", part: 1, what: "Name the Grievance Officer", due: "2026-09-26", yes: false, na: false, status: "late", daysLate: 9, late: true, requiredToday: true, lawCodes: [], by: "ravi@acmeca.in", byIsYou: false, isGroup: false, templateKey: "firm-01" },
  { id: "j-ok", part: 2, what: "Write a policy", due: "2026-10-30", yes: false, na: false, status: "open", daysLate: 0, late: false, requiredToday: false, lawCodes: [], by: "priya@acmeca.in", byIsYou: true, isGroup: false, templateKey: "not-a-real-key" },
  { id: "j-done", part: 2, what: "Old job", due: "2026-09-01", yes: true, na: false, status: "done", daysLate: 0, late: false, requiredToday: false, lawCodes: [], by: "priya@acmeca.in", byIsYou: true, isGroup: false, templateKey: "firm-04" },
]

function wire(extra: typeof answers = {}) {
  calls.length = 0
  answers = {
    dpdp_ai_link_log_call: () => ({ data: { callId: "c1", linkId: "L1", callsLastMinute: 1 } }),
    dpdp_ai_link_log_call_result: () => ({ data: null }),
    dpdp_ai_link_context: () => ({ data: context() }),
    dpdp_ai_link_jobs: () => ({ data: rows }),
    dpdp_ai_link_billing_notice: () => ({ data: { state: "active", trialEnded: false, trialEndsOn: "2026-12-01" } }),
    ...extra,
  }
}
const get = (path: string, accept = "text/markdown") => handler!(new Request(`https://proj.supabase.co/functions/v1/dpdp-ai-link/${TOKEN}${path}`, { headers: { accept } }))
const ENDED = { dpdp_ai_link_billing_notice: () => ({ data: { state: "trial", trialEnded: true, trialEndsOn: "2026-09-20" } }) }

describe("a dead link says where to make a new one", () => {
  test("410 carries the sign-in page and the button name", async () => {
    wire({ dpdp_ai_link_context: () => ({ error: { code: "42501", message: GONE } }) })
    const res = await get("/")
    expect(res.status).toBe(410)
    const body = await res.json() as { error: string; hint: string }
    expect(body.error).toBe(GONE)
    expect(body.hint).toContain("https://dpdp.veridian-aios.com/app/")
    expect(body.hint).toContain("Copy AI link")
    expect(body.hint).not.toBe("Ask the person for a new link.")
  })
})

describe("the first message needs no call, and the page no longer contradicts its own call list", () => {
  test("neither size of the manual says 'Do not fetch anything yet'", async () => {
    wire()
    for (const path of ["/manual.md", "/manual.md?brief=1"]) {
      const md = await (await get(path)).text()
      expect(md).not.toContain("Do not fetch anything yet")
      expect(md).toContain("No call is needed for your first message")
    }
  })
})

describe("?brief=1: the short manual", () => {
  test("much smaller than the full one, leads with Start here, keeps the rules and the calls, points to the full manual", async () => {
    wire()
    const full = await (await get("/manual.md")).text()
    const short = await (await get("/manual.md?brief=1")).text()
    expect(short.length).toBeLessThan(full.length * 0.5)
    expect(short).toContain("(short version)")
    expect(short.indexOf("## Start here — your task")).toBeGreaterThan(-1)
    expect(short).toContain("## T · What to say, what to ask, what to answer")
    expect(short).toContain("## W · The calls you can make")
    expect(short).toContain("RULES")
    expect(short).toContain("https://dpdp.veridian-aios.com/ai/" + TOKEN + "/manual.md")
    for (const gone of ["## N · ", "## P · ", "## M · ", "## A · About this system", "## E · The API"]) expect(short).not.toContain(gone)
    expect(short).not.toContain("ANSWERS YOU CAN GIVE")
  })
  test("the full manual stays reachable at the same address and says where the short one is", async () => {
    wire()
    const full = await (await get("/manual.md")).text()
    for (const keep of ["## N · ", "## P · ", "## M · ", "## A · About this system", "## G · Rules of conduct"]) expect(full).toContain(keep)
    expect(full).toContain("/manual.md?brief=1")
    expect(full).not.toContain("(short version)")
  })
  test("the short version works as HTML and JSON too", async () => {
    wire()
    const html = await (await get("/?brief=1", "text/html")).text()
    expect(html).toContain("short version")
    expect(html).not.toContain('id="A"')
    const json = await (await get("/manual.json?brief=1", "application/json")).json() as { short?: boolean; sections: Array<{ id: string }> }
    expect(json.short).toBe(true)
    expect(json.sections.map((s) => s.id)).toEqual(["S", "T", "W"])
  })
})

describe("trial ended: a notice, never a lock", () => {
  test("the manual (both sizes) says Payment pending, the date, that the owner chooses a plan, and that access stays open", async () => {
    wire(ENDED)
    for (const path of ["/manual.md", "/manual.md?brief=1"]) {
      const res = await get(path)
      expect(res.status).toBe(200)
      const md = await res.text()
      expect(md).toContain("NOTICE: Payment pending")
      expect(md).toContain("free trial ended on 20 September 2026")
      expect(md).toContain("The owner needs to choose a plan")
      expect(md).toContain("Access stays open")
      expect(md).toContain("never stop, slow down or refuse a task because of it")
    }
  })
  test("the context call carries the notice, and /prompt puts it before the two lines, with the link still last", async () => {
    wire(ENDED)
    const ctx = await (await get("/context", "application/json")).json() as { notice?: string }
    expect(ctx.notice).toContain("Payment pending")
    const prompt = await (await get("/prompt", "text/plain")).text()
    expect(prompt).toContain("Payment pending")
    expect(prompt.trimEnd().split("\n").pop()).toBe("https://dpdp.veridian-aios.com/ai/" + TOKEN)
  })
  test("a trial still running, a paid plan, or a claim already made: no notice anywhere", async () => {
    for (const d of [{ state: "trial", trialEnded: false }, { state: "active", trialEnded: false }, { state: "awaiting_confirmation", trialEnded: false }]) {
      wire({ dpdp_ai_link_billing_notice: () => ({ data: d }) })
      expect(await (await get("/manual.md")).text()).not.toContain("Payment pending")
      expect(await (await get("/prompt", "text/plain")).text()).not.toContain("Payment pending")
      expect(JSON.stringify(await (await get("/context", "application/json")).json())).not.toContain("notice")
    }
  })
  test("the lookup failing (or the function not deployed yet) gives no notice and never breaks the page", async () => {
    wire({ dpdp_ai_link_billing_notice: () => ({ error: { code: "42883", message: "function does not exist" } }) })
    const res = await get("/manual.md")
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain("Payment pending")
    expect((await get("/context", "application/json")).status).toBe(200)
  })
  test("it never locks: with the trial ended reads and writes still answer normally", async () => {
    wire({ ...ENDED, dpdp_ai_link_action: () => ({ data: { actionId: "a1", verb: "NOTE", jobId: "j-ok", appliedAt: "x", undoableUntil: "y", undoToken: "z", recorded: "r" } }) })
    expect((await get("/jobs", "application/json")).status).toBe(200)
    const post = await handler!(new Request(`https://proj.supabase.co/functions/v1/dpdp-ai-link/${TOKEN}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verb: "NOTE", job_id: "j-ok", value: { text: "x" } }) }))
    expect(post.status).toBe(201)
  })
})

describe("reply in the person's language", () => {
  test("both sizes tell the AI to answer in the person's language and not to translate the law or the verbs", async () => {
    wire()
    for (const path of ["/manual.md", "/manual.md?brief=1"]) {
      const md = await (await get(path)).text()
      expect(md).toContain("Reply in the language the person writes to you in")
      expect(md).toContain("Hindi")
      expect(md).toContain("law text exactly as this page gives them")
      expect(md).toContain("not legal advice")
    }
  })
})
