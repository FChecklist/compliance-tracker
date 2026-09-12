/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY. Gates
// 6-01/6-02/6-04 (this file's own scope; the route-level client-boundary
// proofs, 6-03a/6-03b/6-03d, live beside the routes they test -- see
// src/app/api/v1/construction/boq/boq-route.client-boundary.test.ts and
// src/lib/services/report-share-service.client-boundary.test.ts). The DB
// CHECK constraint proof (the other half of 6-01's hard floor) was verified
// LIVE against pcrjmlpuqsbocqfwoxod via the Supabase MCP -- see this
// service's own header and drizzle/0596's migration header for the verbatim
// 23514 rejection; that is not re-asserted here because bun test has no live
// Postgres connection on this machine (CLAUDE.md's documented constraint).
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

function mountFakeDb(existingRows: Array<{ orgId: string; role: string; canSeeCost: boolean; changedById: string; changedAt: Date }>) {
  const rows = [...existingRows]
  const insertMock = mock((_table: unknown) => ({
    values: (values: { orgId: string; role: string; canSeeCost: boolean; changedById: string }) => ({
      onConflictDoUpdate: (_opts: unknown) => ({
        returning: async () => {
          const existingIdx = rows.findIndex((r) => r.orgId === values.orgId && r.role === values.role)
          const changedAt = new Date()
          if (existingIdx >= 0) {
            rows[existingIdx] = { ...rows[existingIdx], canSeeCost: values.canSeeCost, changedById: values.changedById, changedAt }
          } else {
            rows.push({ orgId: values.orgId, role: values.role, canSeeCost: values.canSeeCost, changedById: values.changedById, changedAt })
          }
          return [rows.find((r) => r.orgId === values.orgId && r.role === values.role)]
        },
      }),
    }),
  }))
  const fakeDb = {
    query: {
      costVisibilityConfig: {
        findFirst: mock(async (opts: { where: unknown }) => {
          // The real query filters by orgId+role via drizzle's `and(eq(...), eq(...))`
          // helper, which this fake cannot introspect -- tests instead call
          // canRoleSeeCostWithDb per-scenario with a single-org fixture, so a
          // simple "does any row exist for this exact orgId (there's only ever
          // one org in these fixtures)" is sufficient and honest.
          void opts
          return rows[0] ?? null
        }),
        findMany: mock(async () => rows),
      },
    },
    insert: insertMock,
  }
  return { fakeDb, rows, insertMock }
}

async function mountAndImport(existingRows: Array<{ orgId: string; role: string; canSeeCost: boolean; changedById: string; changedAt: Date }> = []) {
  const mounted = mountFakeDb(existingRows)
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => fn(mounted.fakeDb)),
  }))
  const svc = await import("./cost-visibility-service")
  return { ...mounted, svc }
}

describe("CONFIGURABLE_ROLES -- 6-01 layer 2: client_viewer is never even listed", () => {
  test("client_viewer is absent from the configurable-role list, every other real role is present", async () => {
    const { svc } = await mountAndImport()
    expect(svc.CONFIGURABLE_ROLES).not.toContain("client_viewer")
    expect(svc.CONFIGURABLE_ROLES).toContain("admin")
    expect(svc.CONFIGURABLE_ROLES).toContain("member")
    expect(svc.CONFIGURABLE_ROLES.length).toBeGreaterThan(5)
  })
})

describe("canRoleSeeCost -- 6-01 hard floor + fail-closed default", () => {
  test("client_viewer is ALWAYS false, even if a (impossible in production, but defensively checked) config row claims otherwise", async () => {
    // The DB CHECK constraint makes this row unreachable in the real
    // database -- this fixture proves the APPLICATION-layer check is a real,
    // independent line of defense that does not merely trust the config
    // table's own contents.
    const { svc } = await mountAndImport([{ orgId: "org-1", role: "client_viewer", canSeeCost: true, changedById: "u1", changedAt: new Date() }])
    expect(await svc.canRoleSeeCost({ orgId: "org-1" }, "client_viewer")).toBe(false)
  })

  test("no role at all (null/undefined -- an unresolvable API-key caller) is always false", async () => {
    const { svc } = await mountAndImport()
    expect(await svc.canRoleSeeCost({ orgId: "org-1" }, null)).toBe(false)
    expect(await svc.canRoleSeeCost({ orgId: "org-1" }, undefined)).toBe(false)
  })

  test("a role with no configured row for this org defaults to false (fail-closed, never an accidental true)", async () => {
    const { svc } = await mountAndImport([])
    expect(await svc.canRoleSeeCost({ orgId: "org-1" }, "admin")).toBe(false)
  })

  test("a role explicitly granted true in the config is true", async () => {
    const { svc } = await mountAndImport([{ orgId: "org-1", role: "admin", canSeeCost: true, changedById: "u1", changedAt: new Date() }])
    expect(await svc.canRoleSeeCost({ orgId: "org-1" }, "admin")).toBe(true)
  })
})

describe("setCostVisibilityForRole -- 6-01/6-02", () => {
  test("granting client_viewer cost visibility is refused with a 400 ServiceError, and nothing is written", async () => {
    const { svc, insertMock } = await mountAndImport()
    let thrown: unknown
    try {
      await svc.setCostVisibilityForRole({ orgId: "org-1", userId: "u1" }, "client_viewer", true)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(svc.ServiceError)
    expect((thrown as { status: number }).status).toBe(400)
    expect((thrown as Error).message).toContain("client_viewer can never be granted cost visibility")
    expect(insertMock).not.toHaveBeenCalled()
  })

  test("granting a real internal role (e.g. admin) succeeds and stamps changedById/changedAt (6-02)", async () => {
    const { svc, rows } = await mountAndImport()
    const before = Date.now()
    const result = await svc.setCostVisibilityForRole({ orgId: "org-1", userId: "user-42" }, "admin", true)
    expect(result.role).toBe("admin")
    expect(result.canSeeCost).toBe(true)
    expect(result.changedById).toBe("user-42")
    expect(result.changedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(rows.find((r) => r.role === "admin")?.canSeeCost).toBe(true)
  })

  test("revoking (canSeeCost: false) for client_viewer is allowed -- a no-op revoke is not a grant", async () => {
    const { svc } = await mountAndImport()
    const result = await svc.setCostVisibilityForRole({ orgId: "org-1", userId: "u1" }, "client_viewer", false)
    expect(result.canSeeCost).toBe(false)
  })
})

describe("listCostVisibilityConfig -- 6-01: defaults unconfigured roles to false, never includes client_viewer", () => {
  test("an org with one configured role sees every configurable role, unconfigured ones defaulted to false", async () => {
    const { svc } = await mountAndImport([{ orgId: "org-1", role: "admin", canSeeCost: true, changedById: "u1", changedAt: new Date() }])
    const rows = await svc.listCostVisibilityConfig({ orgId: "org-1" })
    expect(rows.some((r) => r.role === "client_viewer")).toBe(false)
    const adminRow = rows.find((r) => r.role === "admin")
    expect(adminRow?.canSeeCost).toBe(true)
    const memberRow = rows.find((r) => r.role === "member")
    expect(memberRow?.canSeeCost).toBe(false)
    expect(memberRow?.changedById).toBeNull()
  })
})

describe("redactProjectSideFields -- 6-03/6-04: the generic deep-strip", () => {
  test("strips project-side keys at any nesting depth, inside arrays, leaves everything else untouched", async () => {
    const { svc } = await mountAndImport()
    const input = {
      boqs: [
        {
          id: "boq-1",
          title: "Villa Phase 1",
          lineItems: [
            { id: "line-1", qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50", description: "Excavation" },
          ],
        },
      ],
      added: [{ id: "line-2", rateProject: "999", qtyContract: "10" }],
      changed: [{ before: { projectValue: 4000, variance: 1000 }, after: { projectValue: 4500, variance: 500 } }],
    }
    const redacted = svc.redactProjectSideFields(input) as typeof input
    expect(redacted.boqs[0]!.title).toBe("Villa Phase 1")
    expect(redacted.boqs[0]!.lineItems[0]!.description).toBe("Excavation")
    expect(redacted.boqs[0]!.lineItems[0]!.qtyContract).toBe("100")
    expect(redacted.boqs[0]!.lineItems[0]!.rateContract).toBe("50")
    expect("qtyProject" in redacted.boqs[0]!.lineItems[0]!).toBe(false)
    expect("rateProject" in redacted.boqs[0]!.lineItems[0]!).toBe(false)
    expect("rateProject" in redacted.added[0]!).toBe(false)
    expect(redacted.added[0]).toHaveProperty("qtyContract", "10")
    expect("projectValue" in (redacted.changed[0]!.before as object)).toBe(false)
    expect("variance" in (redacted.changed[0]!.before as object)).toBe(false)

    // Does not mutate the original.
    expect((input.boqs[0]!.lineItems[0] as unknown as { rateProject: string }).rateProject).toBe("40")
  })
})

describe("applyCostVisibility / redactForPublicShare -- the combined gate", () => {
  test("applyCostVisibility returns data unredacted when the role can see cost", async () => {
    const { svc } = await mountAndImport([{ orgId: "org-1", role: "admin", canSeeCost: true, changedById: "u1", changedAt: new Date() }])
    const data = { lineItems: [{ id: "l1", rateProject: "40" }] }
    const result = (await svc.applyCostVisibility({ orgId: "org-1" }, "admin", data)) as typeof data
    expect(result.lineItems[0]!.rateProject).toBe("40")
  })

  test("applyCostVisibility redacts when the role cannot see cost", async () => {
    const { svc } = await mountAndImport()
    const data = { lineItems: [{ id: "l1", rateProject: "40" }] }
    const result = (await svc.applyCostVisibility({ orgId: "org-1" }, "client_viewer", data)) as typeof data
    expect("rateProject" in result.lineItems[0]!).toBe(false)
  })

  test("redactForPublicShare always redacts, with no role/config lookup at all", async () => {
    const { svc } = await mountAndImport()
    const data = { lineItems: [{ id: "l1", rateProject: "999", qtyContract: "10" }] }
    const result = svc.redactForPublicShare(data) as typeof data
    expect("rateProject" in result.lineItems[0]!).toBe(false)
    expect(result.lineItems[0]!.qtyContract).toBe("10")
  })
})
