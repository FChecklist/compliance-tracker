/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-15 (register row AW-606, way 5): POST /api/v1/projexa/scheduler-proposals/<id>/approve. The route, the role rule and
// the guard are real; the identity (requireAuthOrApiKey and the acting person) and the approval itself (approveFolderProposal, proven
// on real SQL in folder-watch-approve.test.ts) are replaced by recorders, so this file proves the TRANSPORT only.
//
// WHAT IS PROVEN: an unauthenticated call gets the guard's answer and approves nothing; a viewer is refused (403); a project key is
// refused (403); a body that is not a JSON object is a 400 and approves nothing; the approval is asked for the caller's own
// organisation and person, with the proposal id of the URL and only the fields the body gave; every outcome of the approval has its
// own status and stable code (201 created, 200 duplicate, 200 needs_answers, 404, 403 not_owner, 409 x4, 400, 502, the extraction's own
// status with Retry-After); a project that exists without its BOQ is a 500 that names the project; a fault is a 500 without its text.
//
// Run: bun test --isolate src/app/api/v1/projexa/scheduler-proposals/[id]/approve/route.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { ProjectCreatedWithoutBoqError } from "@/lib/services/document-extraction-schema"

const ORG = "org_1"
let identity: { dbUser: Record<string, unknown> | null; apiKey: Record<string, unknown> | null; response?: Response | null }
const approveCalls: unknown[] = []
let approveBehaviour: () => Promise<unknown> = async () => ({ ok: true })

const realAuthGuard = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => (identity.response ? { orgId: null, dbUser: null, apiKey: null, response: identity.response } : { orgId: ORG, response: null, ...identity })),
  requireActingPerson: mock(async () => ({ acting: { person: { id: "person_1", role: "member" }, actor: { dbUser: identity.dbUser } }, error: null })),
}))
const realApprove = await import("@/lib/services/folder-watch-approve")
mock.module("@/lib/services/folder-watch-approve", () => ({
  ...realApprove,
  approveFolderProposal: async (input: unknown) => {
    approveCalls.push(input)
    return approveBehaviour()
  },
}))

const { POST } = (await import("./route")) as unknown as { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }
const call = (body: string | undefined, id = "proposal_1") =>
  POST(new Request("https://app.example.test/api/v1/projexa/scheduler-proposals/x/approve", { method: "POST", body, headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id }) })
const user = (role: string) => ({ dbUser: { id: "person_1", orgId: ORG, name: "P", email: "p@example.test", role, isActive: true }, apiKey: null })
const json = async (res: Response) => (await res.json()) as Record<string, unknown>

beforeEach(() => {
  approveCalls.length = 0
  approveBehaviour = async () => ({ ok: true, duplicate: false, projectId: "project_1", project: { id: "project_1" }, boq: { id: "boq_1" } })
  identity = user("member")
})

describe("POST /api/v1/projexa/scheduler-proposals/[id]/approve", () => {
  test("an unauthenticated call gets the guard's answer and approves nothing", async () => {
    identity = { dbUser: null, apiKey: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) }
    expect((await call("{}")).status).toBe(401)
    expect(approveCalls).toEqual([])
  })

  test("a viewer is refused, and so is a project-scoped key", async () => {
    identity = user("viewer")
    expect((await call("{}")).status).toBe(403)
    identity = { dbUser: null, apiKey: { id: "k1", name: "k", keyKind: "project_ai", scopes: ["write"] } }
    const res = await call("{}")
    expect(res.status).toBe(403)
    expect(approveCalls).toEqual([])
  })

  test("a body that is not a JSON object is a 400 and approves nothing", async () => {
    for (const body of ["not json", "[]", "3"]) {
      const res = await call(body)
      expect(res.status).toBe(400)
      expect((await json(res)).code).toBe("invalid_body")
    }
    expect(approveCalls).toEqual([])
  })

  test("the approval is asked for the caller's own organisation and person, the URL's proposal, and only the fields given", async () => {
    await call(JSON.stringify({ productId: "product_9", projectName: "  Name  ", acknowledgeQuestions: true, acknowledgeShortfall: "true", ignored: "x" }), "proposal_7")
    expect(approveCalls).toEqual([
      { orgId: ORG, person: { id: "person_1" }, proposalId: "proposal_7", productId: "product_9", projectName: "  Name  ", acknowledgeQuestions: true, acknowledgeShortfall: true },
    ])
    approveCalls.length = 0
    await call(undefined)
    expect(approveCalls).toEqual([{ orgId: ORG, person: { id: "person_1" }, proposalId: "proposal_1", productId: undefined, projectName: undefined, acknowledgeQuestions: false, acknowledgeShortfall: false }])
  })

  test("a project was made: 201 with the project and the BOQ; the same file made one before: 200 with that project", async () => {
    const created = await call("{}")
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({ state: "created", duplicate: false, projectId: "project_1", boq: { id: "boq_1" } })
    approveBehaviour = async () => ({ ok: true, duplicate: true, projectId: "project_0", project: null, boq: null })
    const dup = await call("{}")
    expect(dup.status).toBe(200)
    expect(await json(dup)).toEqual({ state: "created", duplicate: true, projectId: "project_0" })
  })

  const refusals: Array<[string, unknown, number, string]> = [
    ["not_found", { ok: false, reason: "not_found" }, 404, "proposal_not_found"],
    ["not_owner", { ok: false, reason: "not_owner" }, 403, "not_owner"],
    ["already_decided", { ok: false, reason: "already_decided", status: "done" }, 409, "already_decided"],
    ["in_progress", { ok: false, reason: "in_progress" }, 409, "in_progress"],
    ["product_required", { ok: false, reason: "product_required" }, 400, "product_required"],
    ["not_connected", { ok: false, reason: "not_connected" }, 409, "source_not_connected"],
    ["source_unavailable", { ok: false, reason: "source_unavailable", code: "source_read_failed" }, 502, "source_unavailable"],
    ["file_changed", { ok: false, reason: "file_changed" }, 409, "file_changed"],
  ]
  for (const [name, outcome, status, code] of refusals) {
    test(`${name}: ${status} ${code}`, async () => {
      approveBehaviour = async () => outcome
      const res = await call("{}")
      expect(res.status).toBe(status)
      expect((await json(res)).code).toBe(code)
    })
  }

  test("open questions: 200 needs_answers with the questions, nothing made", async () => {
    approveBehaviour = async () => ({ ok: false, reason: "needs_answers", questions: [{ id: "q1" }] })
    const res = await call("{}")
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ state: "needs_answers", questions: [{ id: "q1" }] })
  })

  test("the extraction's own refusal keeps its status, its code and its Retry-After", async () => {
    approveBehaviour = async () => ({ ok: false, reason: "refused", code: "extraction_rate_limited", message: "too many", status: 429, issues: [], retryAfterSeconds: 90 })
    const res = await call("{}")
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("90")
    expect((await json(res)).code).toBe("extraction_rate_limited")
  })

  test("a project that exists without its BOQ is a 500 that names the project; any other fault is a 500 without its text", async () => {
    approveBehaviour = async () => {
      throw new ProjectCreatedWithoutBoqError("project_5", new Error("db down"))
    }
    const partial = await call("{}")
    expect(partial.status).toBe(500)
    expect(await json(partial)).toMatchObject({ code: "boq_create_failed", projectId: "project_5" })

    approveBehaviour = async () => {
      throw new Error("secret connection string")
    }
    const fault = await call("{}")
    expect(fault.status).toBe(500)
    expect(JSON.stringify(await json(fault))).not.toContain("secret")
  })
})
