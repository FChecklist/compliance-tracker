/// <reference types="bun-types" />
// Sumeet R-100 (profit and loss) / R-99: confirmBaseline() had no caller, so every project read "Not yet baselined" for ever. This runs the REAL route
// handler and the REAL confirmBaseline()/listBaselineVersions() over the repo's stateful BOQ store double (only auth and withTenantContext are doubled);
// every assertion RE-READS the boq_baseline table, not the response.
// Run: bun test --isolate "src/app/api/v1/projexa/scope/[id]/baseline/route.test.ts"
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { NextRequest } from "next/server"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"
import { ROLE_RANK } from "@/lib/supabase/role-rank"
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore } from "@/lib/pipeline/__test-helpers__/boq-store-double"

const ORG = "org_bl"
const PERSON = "person_1"
let store: BoqStore
let roleGate: "pass" | "deny" = "pass"

function fixtures(): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [{ id: "project_a", orgId: ORG, name: "A" }])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha", email: "asha@example.com" }])
  seedRows(s, "construction_boqs", [{ id: "boq_a", orgId: ORG, projectId: "project_a", version: 1, title: "Original", status: "approved", createdById: "x" }])
  seedRows(s, "construction_boq_line_items", [
    { id: "li_1", orgId: ORG, boqId: "boq_a", itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: "100", rate: "50", amount: "5000", qtyContract: "100", rateContract: "50", qtyProject: "100", rateProject: "40" },
    { id: "li_2", orgId: ORG, boqId: "boq_a", itemCode: "A2", description: "Plaster", unit: "sqm", quantity: "200", rate: "20", amount: "4000", qtyContract: "200", rateContract: "20", qtyProject: null, rateProject: null },
  ])
  return s
}

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))
mock.module("@/lib/supabase/auth-guard", () => ({
  ...actingPersonDouble(),
  ROLE_RANK,
  requireAuthOrApiKey: mock(async () => ({ response: null, orgId: ORG, dbUser: { id: PERSON }, apiKey: null })),
  requireRoleOrScope: mock(() => (roleGate === "deny" ? new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) : null)),
}))
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})
beforeEach(() => {
  store = fixtures()
  roleGate = "pass"
})

async function confirm(body: unknown) {
  const { POST } = await import("./route")
  const req = new NextRequest("http://localhost/api/v1/projexa/scope/boq_a/baseline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return POST(req as Parameters<typeof POST>[0], { params: Promise.resolve({ id: "boq_a" }) })
}
const baselines = () => rowsOf(store, "boq_baseline")

describe("R-100 POST /api/v1/projexa/scope/{id}/baseline", () => {
  test("with an evidence reference: a baseline row is stored (re-read), version 1, carrying every line", async () => {
    const res = await confirm({ evidenceArtefactRef: "PO-2026-114 signed by the client" })
    expect(res.status).toBe(201)
    expect(baselines()).toHaveLength(1)
    const row = baselines()[0]!
    expect(row.boqId).toBe("boq_a")
    expect(row.version).toBe(1)
    expect(row.evidenceArtefactRef).toBe("PO-2026-114 signed by the client")
    expect((row.lineSnapshot as unknown[]).length).toBe(2)
  })

  test("a second confirmation is version 2 and the first row is untouched", async () => {
    await confirm({ evidenceArtefactRef: "PO-1" })
    await confirm({ evidenceArtefactRef: "Variation agreed by email 12 Oct" })
    const rows = baselines()
    expect(rows.map((r) => r.version)).toEqual([1, 2])
    expect(rows[0]!.evidenceArtefactRef).toBe("PO-1")
  })

  test("no evidence reference: refused (400) and nothing is stored", async () => {
    const res = await confirm({ evidenceArtefactRef: "   " })
    expect(res.status).toBe(400)
    expect(baselines()).toHaveLength(0)
    const none = await confirm({})
    expect(none.status).toBe(400)
    expect(baselines()).toHaveLength(0)
  })

  test("a caller below manager is refused (403) and nothing is stored", async () => {
    roleGate = "deny"
    const res = await confirm({ evidenceArtefactRef: "PO-1" })
    expect(res.status).toBe(403)
    expect(baselines()).toHaveLength(0)
  })

  test("the answer carries metadata only: never the project-side (cost) rate or quantity", async () => {
    const res = await confirm({ evidenceArtefactRef: "PO-1" })
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain("rateProject")
    expect(text).not.toContain("qtyProject")
    expect(text).not.toContain("lineSnapshot")
  })

  test("GET lists the confirmed versions, again without cost figures", async () => {
    await confirm({ evidenceArtefactRef: "PO-1" })
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://localhost/api/v1/projexa/scope/boq_a/baseline") as Parameters<typeof GET>[0], { params: Promise.resolve({ id: "boq_a" }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { baselines: { version: number; lineCount: number }[] }
    expect(body.baselines.map((b) => b.version)).toEqual([1])
    expect(body.baselines[0]!.lineCount).toBe(2)
    expect(JSON.stringify(body)).not.toContain("rateProject")
  })
})
