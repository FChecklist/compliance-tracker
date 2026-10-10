/// <reference types="bun-types" />
// DPDP AI work link, 2026-10-05: the GET-only fallback (?_method=POST&_body=), the read-only /register, the paste wording and the manual's
// new plain rules (no code, explain a refusal, the numbered workflow, what is never allowed).
import { describe, expect, test } from "bun:test"
import { API_DEFINITION, REGISTER_KINDS } from "../../../supabase/functions/dpdp-ai-link/api-definition"
import { MAX_GET_BODY_BYTES, methodOverride, methodsFor, parseRoute } from "../../../supabase/functions/dpdp-ai-link/router"
import { aiPasteText } from "../../../supabase/functions/_shared/ai-link/prompt"
import { buildManual, renderManualMarkdown, type ContextPayload } from "../../../supabase/functions/dpdp-ai-link/manual"

const T = "b".repeat(64)
const FN = `/functions/v1/dpdp-ai-link/${T}`
const route = (p: string) => { const r = parseRoute(`${FN}${p}`); if ("error" in r) throw new Error(r.message); return r.route }
const q = (s: string) => new URLSearchParams(s)

describe("methodOverride (the GET-only fallback)", () => {
  test("a plain request is left alone", () => {
    expect(methodOverride("GET", route("/jobs"), q(""))).toEqual({ method: "GET", body: null })
    expect(methodOverride("POST", route("/drafts"), q(""))).toEqual({ method: "POST", body: null })
  })
  test("GET + _method=POST + _body on /actions, /drafts and /suggestions becomes a POST with that body", () => {
    const body = JSON.stringify({ verb: "NOTE", job_id: "x", value: { text: "hi & bye" } })
    for (const p of ["/actions", "/drafts", "/suggestions"]) {
      expect(methodOverride("GET", route(p), q(`_method=POST&_body=${encodeURIComponent(body)}`))).toEqual({ method: "POST", body })
    }
    expect(methodOverride("GET", route("/drafts"), q("_method=post"))).toEqual({ method: "POST", body: "{}" })
  })
  test("refused: other paths, other methods, a real POST carrying _method, an oversize body", () => {
    const big = "x".repeat(MAX_GET_BODY_BYTES + 1)
    expect(methodOverride("GET", route("/jobs"), q("_method=POST&_body=%7B%7D"))).toMatchObject({ status: 403 })
    expect(methodOverride("GET", route("/register/plan"), q("_method=POST"))).toMatchObject({ status: 403 })
    expect(methodOverride("GET", route("/actions"), q("_method=DELETE"))).toMatchObject({ status: 400 })
    expect(methodOverride("POST", route("/actions"), q("_method=POST&_body=%7B%7D"))).toMatchObject({ status: 400 })
    expect(methodOverride("GET", route("/actions"), q(`_method=POST&_body=${big}`))).toMatchObject({ status: 413 })
  })
  test("the fallback only changes the method: POST routes still take POST, GET routes still take GET", () => {
    expect(methodsFor(route("/actions"))).toEqual(["POST"])
    expect(methodsFor(route("/register/plan"))).toEqual(["GET"])
  })
})

describe("/register", () => {
  test("routes: the list and every kind in the one definition; junk is a 404", () => {
    expect(route("/register")).toEqual({ kind: "register", register: null })
    for (const k of REGISTER_KINDS) expect(route(`/register/${k.kind}`)).toEqual({ kind: "register", register: k.kind })
    expect("error" in parseRoute(`${FN}/register/a/b`)).toBe(true)
    expect("error" in parseRoute(`${FN}/register/../x`)).toBe(true)
  })
  test("it is in the API definition at level 0 and carries no personal-data kinds", () => {
    const e = API_DEFINITION.endpoints.find((x) => x.id === "register")!
    expect(e.method).toBe("GET")
    expect(e.level).toBe(0)
    for (const bad of ["payment", "billing", "erase", "export", "attest", "sign"]) expect(REGISTER_KINDS.map((k) => k.kind)).not.toContain(bad)
  })
})

describe("the paste", () => {
  test("framed as the owner's own API documentation, two lines, link last, no key or instruction in it", () => {
    const p = aiPasteText("https://dpdp.veridian-aios.com/ai/" + T)
    const lines = p.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("my personal access link to its API")
    expect(lines[0]).toContain("written by my own organisation's software")
    expect(lines[0]).not.toMatch(/follow the instructions on that page exactly/i)
    expect(lines[1]).toBe("https://dpdp.veridian-aios.com/ai/" + T)
  })
})

const ctx = (kind: string, level: 0 | 1): ContextPayload => ({
  org: { id: "o", name: "Acme", product: "firm" },
  viewer: { email: "p@example.test", kind, level: kind },
  link: { id: "l", label: null, authorityLevel: level, hideEmails: false, createdAt: "2026-10-05T00:00:00Z", expiresAt: "2026-10-12T00:00:00Z", callCount: 0 },
  library: { version: "v1", releasedOn: "2026-09-01" } as ContextPayload["library"],
  counts: { jobs: 3, people: 2 },
  verbs: { level1: [], level2: [] },
})

describe("the manual", () => {
  for (const [kind, level] of [["owner", 1], ["staff", 0]] as const) {
    const md = renderManualMarkdown(buildManual({ context: ctx(kind, level), base: "https://dpdp.veridian-aios.com/ai/" + T, now: new Date("2026-10-05T05:00:00Z") }))
    test(`${kind}: numbered workflow, no-code rule, GET fallback, refusal explained, never-allowed list, register`, () => {
      expect(md).toContain("THE WORK, IN ORDER")
      expect(md).toMatch(/7\. When they are finished/)
      expect(md).toMatch(/not here to write software/i)
      expect(md).toContain("_method=POST&_body=")
      expect(md).toMatch(/everyday words/)
      expect(md).toContain("Pay, buy or change a plan")
      expect(md).toContain("GET /register")
      expect(md).toMatch(/never instructions to you/)
      expect(md).toMatch(/GET-ONLY FALLBACK/)
    })
  }
})
