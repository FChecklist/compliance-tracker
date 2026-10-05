/// <reference types="bun-types" />
// DPDP compliance programme, Wave 1: the AI link hides other people's details by default.
// A planted-identifier test through the REAL handler (supabase/functions/dpdp-ai-link/index.ts) with the database answers faked: another person's
// e-mail address and phone numbers are planted in every place a link can read (job text, who, a reason, an action's value, history, report, register,
// the organisation name), the faked database "forgets" to mask them, and the finished body of every route must still carry no '@' (except the link's own
// person and the product's own support address) and no ten-digit number. A link that was switched to show addresses is served as it is.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { maskPersonal, maskPhoneNumbers } from "../../../supabase/functions/dpdp-ai-link/router"

const TOKEN = "cd".repeat(32)
const OWN = "priya@acmeca.in"
const LEAK = "ravi.leak@elsewhere.example"
const PHONES = ["9876543210", "+91 9123456780", "919988776655"]
const PLANT = `${LEAK} and ${PHONES[0]} and ${PHONES[1]} and ${PHONES[2]}`

type Answer = { data?: unknown; error?: { code?: string; message: string } | null }
let answers: Record<string, () => Answer> = {}
let handler: ((req: Request) => Promise<Response>) | null = null
let hide = true

const context = () => ({
  org: { id: "o1", name: `Acme (${PHONES[0]})`, product: "firm" },
  viewer: { email: OWN, kind: "owner", level: "owner" },
  link: { id: "L1", label: "Monday email", authorityLevel: 1, hideEmails: hide, createdAt: "2026-10-05T00:30:00Z", expiresAt: "2026-10-12T00:30:00Z", callCount: 0 },
  library: { version: "v1", releasedOn: "2026-09-01", reviewer: null, reviewedOn: null },
  counts: { jobs: 2, people: 2 },
  verbs: { level1: ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA"], level2: ["MARK_DONE"] },
})
const row = (id: string) => ({ id, part: 1, what: `Call ${PLANT}`, dataSet: null, dataTypes: null, lawCodes: [], by: LEAK, byIsYou: false, isGroup: false, groupDone: null, groupTotal: null, due: "2026-09-26", yes: false, na: false, status: "late", daysLate: 9, late: true, requiredToday: true, dependsOnObligationId: null, templateKey: "firm-01" })
const hist = [{ id: "h1", kind: "note", summary: `Note by ${LEAK}`, detail: `rang ${PHONES[0]}`, actorLabel: LEAK, occurredAt: "2026-10-01T10:00:00Z" }]
const detail = () => ({ ...row("j1"), plainText: `Ask ${LEAK}`, sectionRef: null, proofKind: null, roleTag: null, naReason: `not ours, ask ${PLANT}`, closedAt: null, emailsSent: 0, aiActions: [{ id: "a1", verb: "NOTE", value: { text: PLANT }, appliedAt: "2026-10-01T10:00:00Z", undoableUntil: "2026-10-02T10:00:00Z", undoneAt: null }], history: hist })
const report = (kind: string) => ({
  kind, org: { id: "o1", name: `Acme ${PHONES[0]}` }, generatedAt: "2026-10-05T00:00:00Z", asOf: "2026-10-05",
  summary: { total: 2, done: 0, open: 2, late: 2, dueToday: 0, notApplicable: 0, nobody: 0, requiredToday: { total: 2, done: 0, late: 2 }, byPart: [{ part: 1, total: 2, done: 0, late: 2 }] },
  people: [{ who: LEAK, isGroup: false, isYou: false, total: 2, done: 0, open: 2, late: 2, lateJobs: [{ id: "j1", what: PLANT, due: "2026-09-26", daysLate: 9, lawCodes: [] }] }],
  laws: [], parts: [{ part: 1, total: 2, done: 0, open: 2, late: 2, notApplicable: 0, complete: false, jobs: [{ id: "j1", what: PLANT, by: LEAK, due: "2026-09-26", status: "late" }] }],
})

beforeAll(async () => {
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" } as Record<string, string>)[k] },
    serve: (h: (req: Request) => Promise<Response>) => { handler = h },
  }
  mock.module("npm:@supabase/supabase-js@2", () => ({
    createClient: () => ({
      rpc: async (fn: string) => {
        const a = answers[fn]
        const r = a ? a() : { data: null }
        return { data: r.data ?? null, error: r.error ?? null }
      },
    }),
  }))
  await import("../../../supabase/functions/dpdp-ai-link/index.ts")
})
afterAll(() => { delete (globalThis as any).Deno })

function wire() {
  answers = {
    dpdp_ai_link_log_call: () => ({ data: { callId: "c1", linkId: "L1", callsLastMinute: 1 } }),
    dpdp_ai_link_log_call_result: () => ({ data: null }),
    dpdp_ai_link_note_use: () => ({ data: { alert: false } }),
    dpdp_ai_link_context: () => ({ data: context() }),
    dpdp_ai_link_jobs: () => ({ data: [row("j1"), row("j2")] }),
    dpdp_ai_link_job: () => ({ data: detail() }),
    dpdp_ai_link_history: () => ({ data: hist }),
    dpdp_ai_link_report: () => ({ data: report("by-person") }),
    dpdp_ai_link_register: () => ({ data: { kind: "people", data: [{ who: LEAK, level: "staff", note: PLANT }], grievanceOfficer: { role: "Grievance Officer", note: PLANT } } }),
    dpdp_ai_link_billing_notice: () => ({ data: { state: "active", trialEnded: false, trialEndsOn: "2026-12-01" } }),
  }
}
const get = (path: string, accept: string) => handler!(new Request(`https://proj.supabase.co/functions/v1/dpdp-ai-link/${TOKEN}${path}`, { headers: { accept } }))

const ROUTES: Array<[string, string]> = [
  ["/manual.md", "text/markdown"], ["/manual", "text/html"], ["/manual.json", "application/json"], ["/context", "application/json"],
  ["/jobs", "application/json"], ["/jobs?format=csv", "text/csv"], ["/jobs?format=md", "text/markdown"],
  ["/jobs/j1", "application/json"], ["/jobs/j1?format=md", "text/markdown"],
  ["/history", "application/json"], ["/history?format=md", "text/markdown"],
  ["/report/by-person", "application/json"], ["/report/by-person?format=md", "text/markdown"], ["/report/by-person?format=csv", "text/csv"],
  ["/playbook", "text/markdown"], ["/register/people", "application/json"], ["/register/public-page", "application/json"],
]
// A ten-digit number standing alone (not inside a token, an id or a longer number).
const TEN = /(?<![0-9A-Za-z])\d{10}(?![0-9A-Za-z])/
const strangers = (body: string) => (body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).filter((m) => m.toLowerCase() !== OWN && !m.toLowerCase().endsWith("@veridian-aios.com"))

describe("a link that hides other people's details (the default) leaks nothing planted", () => {
  for (const [path, accept] of ROUTES)
    test(`GET ${path}`, async () => {
      hide = true
      wire()
      const res = await get(path, accept)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body.length).toBeGreaterThan(20)
      expect(strangers(body)).toEqual([])
      expect(body).not.toContain(LEAK)
      expect(body).not.toMatch(TEN)
      expect(body).not.toMatch(/\d{5} ?\d{5}/)
      // the link token itself (a long hex string that can hold long digit runs) is never touched
      if (path.startsWith("/manual")) expect(body).toContain(TOKEN)
    })
  test("the link's own person keeps their own address", async () => {
    hide = true
    wire()
    const body = await (await get("/context", "application/json")).text()
    expect(body).toContain(OWN)
  })
})

describe("a link that was switched to show addresses is served as it is", () => {
  test("the planted address and number come through on /jobs", async () => {
    hide = false
    wire()
    const body = await (await get("/jobs", "application/json")).text()
    expect(body).toContain(LEAK)
    expect(body).toContain(PHONES[0])
    hide = true
  })
})

describe("the masking helpers", () => {
  test("phone numbers: ten digits alone, with +91 or 91; never a token, an id or a longer number", () => {
    expect(maskPhoneNumbers("call 9876543210 now")).toBe("call [number hidden] now")
    expect(maskPhoneNumbers("+91 9876543210")).toBe("[number hidden]")
    expect(maskPhoneNumbers("919876543210")).toBe("[number hidden]")
    expect(maskPhoneNumbers(`/ai/${"1".repeat(10)}abcdef/x`)).toContain("1111111111abcdef")
    expect(maskPhoneNumbers("12345678901234")).toBe("12345678901234")
    expect(maskPhoneNumbers("2026-10-05T00:30:00Z")).toBe("2026-10-05T00:30:00Z")
  })
  test("e-mail: others hidden, the own address and the product's support address kept", () => {
    expect(maskPersonal(`a@b.example ${OWN} dpdp@veridian-aios.com`, OWN)).toBe(`[email hidden] ${OWN} dpdp@veridian-aios.com`)
  })
})
