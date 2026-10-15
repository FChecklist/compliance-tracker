/// <reference types="bun-types" />
// Defect D1: createTaxTemplate validation -- rate 0-100, at least one line,
// every tax account must be a real non-group account of the caller org.
import { describe, test, expect, mock } from "bun:test"

const inserted: { values: unknown }[] = []
let orgAccounts: { id: string; isGroup: boolean }[] = []

mock.module("./erp-enablement-service", () => ({
  requireErpEnabled: mock(async () => {}),
  isErpEnabledForOrgWithDb: mock(async () => true),
}))
mock.module("@/lib/audit", () => ({ logActivity: mock(async () => {}), auditActorOf: () => ({}) }))
mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (_c: unknown, fn: (db: unknown) => unknown) =>
    fn({
      query: { erpAccounts: { findMany: async () => orgAccounts } },
      insert: () => ({
        values: (v: unknown) => {
          inserted.push({ values: v })
          return { returning: async () => [{ id: "tpl-1" }] }
        },
      }),
    }),
}))

const ctx = { orgId: "org-1", userId: "u1", dbUser: { id: "u1" } } as never

async function create(input: Parameters<typeof import("./erp-invoicing-service").createTaxTemplate>[1]) {
  const { createTaxTemplate } = await import("./erp-invoicing-service")
  return createTaxTemplate(ctx, input)
}

describe("createTaxTemplate validation", () => {
  test("rejects a rate above 100", async () => {
    orgAccounts = [{ id: "a1", isGroup: false }]
    await expect(create({ name: "Bad", items: [{ taxAccountId: "a1", rate: 101 }] })).rejects.toThrow("between 0 and 100")
  })
  test("rejects a negative or NaN rate", async () => {
    orgAccounts = [{ id: "a1", isGroup: false }]
    await expect(create({ name: "Bad", items: [{ taxAccountId: "a1", rate: -1 }] })).rejects.toThrow("between 0 and 100")
    await expect(create({ name: "Bad", items: [{ taxAccountId: "a1", rate: Number.NaN }] })).rejects.toThrow("between 0 and 100")
  })
  test("rejects empty items", async () => {
    await expect(create({ name: "Bad", items: [] })).rejects.toThrow("At least one")
  })
  test("rejects a tax account that is not the org's, or is a group", async () => {
    orgAccounts = [{ id: "a1", isGroup: false }, { id: "g1", isGroup: true }]
    await expect(create({ name: "X", items: [{ taxAccountId: "foreign", rate: 9 }] })).rejects.toThrow("not found in your organisation")
    await expect(create({ name: "X", items: [{ taxAccountId: "g1", rate: 9 }] })).rejects.toThrow("not found in your organisation")
  })
  test("accepts CGST 9 + SGST 9 and stores both rates", async () => {
    orgAccounts = [{ id: "a1", isGroup: false }, { id: "a2", isGroup: false }]
    inserted.length = 0
    const t = await create({ name: "GST 18%", isSalesTax: true, items: [{ taxAccountId: "a1", rate: 9 }, { taxAccountId: "a2", rate: 9 }] })
    expect(t.id).toBe("tpl-1")
    const lines = inserted.find((i) => Array.isArray(i.values))!.values as { rate: string }[]
    expect(lines.map((l) => l.rate)).toEqual(["9", "9"])
  })
})
