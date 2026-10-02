/// <reference types="bun-types" />
// lf-b3-ai-off: the HTTP shape PROJEXA's screens already render, at the real exported handlers, with PROJEXA_INTERNAL_AI_ENABLED unset:
//   * POST /api/v1/projexa/discuss -> 200 {reply: USE_YOUR_OWN_AI}. PROJEXA's VeriComposer shows a 200's `reply` as VERI's message and
//     turns any non-2xx into "VERI AI didn't reply -- try again", so a refusal status here would send the person round a useless retry.
//   * POST /api/construction/ai/estimate-progress and /diff-drawings -> 403 {error: USE_YOUR_OWN_AI}, BEFORE the body is read or any
//     image is downloaded from storage (the tenant-scoped DB layer, which the download runs inside, is a spy that must stay untouched).
// With the switch at "1" each handler goes past the gate exactly as before.
//
// Run: bun test --isolate src/app/api/construction/ai/projexa-internal-ai-off.route.test.ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const member = { id: "user-1", role: "member", orgId: "org-1" }
const realAuth = await import("@/lib/supabase/auth-guard")
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuth,
  requireAuth: mock(async () => ({ response: null, dbUser: member, orgId: "org-1" })),
  requireRole: mock(() => null),
  requireAuthOrApiKey: mock(async () => ({ response: null, orgId: "org-1", dbUser: member })),
  requireRoleOrScope: mock(() => null),
  requireActingPerson: mock(async () => ({ acting: { person: { id: "user-1" } }, error: null })),
}))

const withTenantContext = mock(async () => {
  throw new Error("sentinel: reached the tenant-scoped DB layer")
})
const realTenant = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenant, withTenantContext }))

const resolveModelConfig = mock(async () => null)
const realResolver = await import("@/lib/orchestra-model-resolver")
mock.module("@/lib/orchestra-model-resolver", () => ({ ...realResolver, resolveModelConfig }))
const realPolicy = await import("@/lib/policy-enforcement-engine")
mock.module("@/lib/policy-enforcement-engine", () => ({ ...realPolicy, enforcePolicy: mock(() => ({ allowed: true })) }))

const discuss = await import("@/app/api/v1/projexa/discuss/route")
const estimate = await import("./estimate-progress/route")
const diff = await import("./diff-drawings/route")
const { USE_YOUR_OWN_AI } = await import("@/lib/projexa-internal-ai")

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED"
const saved = process.env[FLAG]
let errorSpy: ReturnType<typeof mock>
const realConsoleError = console.error
beforeEach(() => {
  delete process.env[FLAG]
  withTenantContext.mockClear()
  resolveModelConfig.mockClear()
  errorSpy = mock(() => {})
  console.error = errorSpy as unknown as typeof console.error
})
afterAll(async () => {
  console.error = realConsoleError
  if (saved === undefined) delete process.env[FLAG]
  else process.env[FLAG] = saved
  mock.restore()
  await mock.module("@/lib/supabase/auth-guard", () => realAuth)
  await mock.module("@/lib/db/tenant-scoped", () => realTenant)
  await mock.module("@/lib/orchestra-model-resolver", () => realResolver)
  await mock.module("@/lib/policy-enforcement-engine", () => realPolicy)
})

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never

describe("POST /api/v1/projexa/discuss", () => {
  test("off: 200 with the plain answer as the reply, no model resolved", async () => {
    const res = await discuss.POST(post("/api/v1/projexa/discuss", { message: "how is the site?" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reply: USE_YOUR_OWN_AI })
    expect(resolveModelConfig).not.toHaveBeenCalled()
  })

  test("on: past the switch to the model resolver, as before", async () => {
    process.env[FLAG] = "1"
    const res = await discuss.POST(post("/api/v1/projexa/discuss", { message: "how is the site?" }))
    expect(resolveModelConfig).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(400) // the old "No AI model is configured" answer for an org with none
  })
})

describe("POST /api/construction/ai/estimate-progress and /diff-drawings", () => {
  test("off: 403 {error: USE_YOUR_OWN_AI}, and storage (inside the DB layer) is never reached", async () => {
    for (const res of [
      await estimate.POST(post("/api/construction/ai/estimate-progress", { documentId: "d", activityName: "Slab" })),
      await diff.POST(post("/api/construction/ai/diff-drawings", { documentIdA: "a", documentIdB: "b" })),
    ]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: USE_YOUR_OWN_AI })
    }
    expect(withTenantContext).not.toHaveBeenCalled()
  })

  test("on: both handlers go on to the DB layer, as before", async () => {
    process.env[FLAG] = "1"
    await estimate.POST(post("/api/construction/ai/estimate-progress", { documentId: "d", activityName: "Slab" }))
    await diff.POST(post("/api/construction/ai/diff-drawings", { documentIdA: "a", documentIdB: "b" }))
    expect(withTenantContext).toHaveBeenCalledTimes(2)
  })
})
