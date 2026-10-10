/// <reference types="bun-types" />
// R-97 "Change of scope of work ... end-to-end" (the change-order <-> BOQ-revision link) and R-C13 ("negative variation
// must be checked against the Work Progress Report") -- closure test through the real REST route.
//
// Existing proof of the link (src/lib/pipeline/executor.boq-revision.test.ts) goes through the AI-pipeline executor, and
// the R-C13 service test uses a fake DB; neither calls POST /api/v1/projexa/scope/{id}/revisions, which is what PROJEXA's
// "revise scope" screen calls. This runs the real route handler and the real createBoqRevision() (guard included) over
// the repo's stateful BOQ store double; only auth and withTenantContext are doubled, and every assertion RE-READS the store.
// Run: bun test --isolate "src/app/api/v1/projexa/scope/[id]/revisions/route.r97.test.ts"
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"
import { ROLE_RANK } from "@/lib/supabase/role-rank"
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "@/lib/pipeline/__test-helpers__/boq-store-double"

const ORG = "org_r97"
const PROJECT_A = "project_a"
const PROJECT_B = "project_b"
const PERSON = "person_1"

let store: BoqStore

function fixtures(): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [{ id: PROJECT_A, orgId: ORG, name: "A" }, { id: PROJECT_B, orgId: ORG, name: "B" }])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha", email: "asha@example.com" }])
  seedRows(s, "construction_boqs", [{ id: "boq_a", orgId: ORG, projectId: PROJECT_A, version: 1, title: "Original", status: "approved", createdById: "x" }])
  seedRows(s, "construction_boq_line_items", [
    { id: "li_a1", orgId: ORG, boqId: "boq_a", itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: "100", rate: "50", amount: "5000" },
    { id: "li_a2", orgId: ORG, boqId: "boq_a", itemCode: "A2", description: "Plaster", unit: "sqm", quantity: "200", rate: "20", amount: "4000" },
  ])
  seedRows(s, "construction_work_progress_entries", [
    { orgId: ORG, projectId: PROJECT_A, activityId: "act_a", boqLineItemId: "li_a1", entryDate: "2026-09-20", quantityDone: "40", percentComplete: "40" },
  ])
  seedRows(s, "construction_change_orders", [
    { id: "co_ok", orgId: ORG, projectId: PROJECT_A, number: 7, title: "Extra works", status: "approved", requestedById: PERSON },
    { id: "co_draft", orgId: ORG, projectId: PROJECT_A, number: 8, title: "Pending", status: "draft", requestedById: PERSON },
  ])
  return s
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))
mock.module("@/lib/supabase/auth-guard", () => ({
  ...actingPersonDouble(),
  ROLE_RANK,
  requireAuthOrApiKey: mock(async () => ({ response: null, orgId: ORG, dbUser: { id: PERSON }, apiKey: null })),
  requireRoleOrScope: mock(() => null),
}))
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})
beforeEach(() => {
  store = fixtures()
})

const GROWN: Row[] = [
  { itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 120, rate: 50 },
  { itemCode: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20 },
  { itemCode: "A3", description: "Waterproofing", unit: "sqm", quantity: 80, rate: 35 },
]
const REDUCED: Row[] = [
  { itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: 60, rate: 50 },
  { itemCode: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20 },
]

async function revise(body: Row) {
  const { POST } = await import("./route")
  const req = new NextRequest("http://localhost/api/v1/projexa/scope/boq_a/revisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: "boq_a" }) })
}
const boqs = () => rowsOf(store, "construction_boqs")
const co = (id: string) => rowsOf(store, "construction_change_orders").find((c) => c.id === id)!

describe("R-97 POST /api/v1/projexa/scope/{id}/revisions with sourceChangeOrderId", () => {
  test("approved change order: the revision is created and the change order's re-read boq_revision_id is that revision", async () => {
    const res = await revise({ title: "Rev 2", lineItems: GROWN, sourceChangeOrderId: "co_ok" })
    expect(res.status).toBe(201)
    const revision = boqs().find((b) => b.parentBoqId === "boq_a")!
    expect(revision.version).toBe(2)
    expect(co("co_ok").boqRevisionId).toBe(revision.id)
    expect(boqs().find((b) => b.id === "boq_a")!.status).toBe("superseded")
  })

  test("the same change order cannot be linked to a second revision (409), and nothing more is written", async () => {
    expect((await revise({ title: "Rev 2", lineItems: GROWN, sourceChangeOrderId: "co_ok" })).status).toBe(201)
    const linked = co("co_ok").boqRevisionId
    const before = JSON.stringify(store.tables)
    const rev2 = boqs().find((b) => b.parentBoqId === "boq_a")!
    const { POST } = await import("./route")
    const req = new NextRequest("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Rev 3", lineItems: GROWN, sourceChangeOrderId: "co_ok" }) })
    const res = await POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: rev2.id as string }) })
    expect(res.status).toBe(409)
    expect(JSON.stringify(store.tables)).toBe(before)
    expect(co("co_ok").boqRevisionId).toBe(linked)
  })

  test("a draft change order is refused (400) and nothing is written", async () => {
    const before = JSON.stringify(store.tables)
    const res = await revise({ title: "Rev 2", lineItems: GROWN, sourceChangeOrderId: "co_draft" })
    expect(res.status).toBe(400)
    expect(JSON.stringify(store.tables)).toBe(before)
    expect(co("co_draft").boqRevisionId ?? null).toBeNull()
  })
})

describe("R-C13 the same route: a negative variation on a line with recorded work is blocked", () => {
  test("reducing A1 (40% done) -> 409 with the violating line, nothing written, parent still approved", async () => {
    const before = JSON.stringify(store.tables)
    const res = await revise({ title: "Rev 2", lineItems: REDUCED })
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(JSON.stringify(body.conflicts)).toContain("A1")
    expect(JSON.stringify(store.tables)).toBe(before)
    expect(boqs().find((b) => b.id === "boq_a")!.status).toBe("approved")
  })

  test("with allowScopeReductionOverride: true the same reduction is written and re-read at 60", async () => {
    const res = await revise({ title: "Rev 2", lineItems: REDUCED, allowScopeReductionOverride: true })
    expect(res.status).toBe(201)
    const revision = boqs().find((b) => b.parentBoqId === "boq_a")!
    const a1 = rowsOf(store, "construction_boq_line_items").find((l) => l.boqId === revision.id && l.itemCode === "A1")!
    expect(Number(a1.quantity)).toBe(60)
  })
})
