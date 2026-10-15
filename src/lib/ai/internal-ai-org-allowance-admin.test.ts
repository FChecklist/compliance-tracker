/// <reference types="bun-types" />
// P6: the service writes the existing per-org flag row, default closed, with who/when, and refuses a non-admin itself.
// Falsifiability: delete the hasRole line in setInternalAiAllowance and the member case fails.
import { beforeEach, describe, expect, mock, test } from "bun:test"

const ops: Array<{ kind: string; values?: Record<string, unknown> }> = []
let existing: { id: string } | null = null
const tx = {
  query: {
    productBranches: { findFirst: async () => ({ id: "b1" }) },
    orgProductBranchEnablements: { findFirst: async () => (existing ? { ...existing, isEnabled: false, enabledAt: null, disabledAt: null, enabledById: null } : undefined) },
  },
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { ops.push({ kind: "update", values }) } }) }),
  insert: () => ({ values: async (values: Record<string, unknown>) => { ops.push({ kind: "insert", values }) } }),
}
const realTenant = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenant, withTenantContext: async (_c: unknown, fn: (d: unknown) => unknown) => fn(tx) }))
const { getInternalAiAllowance, setInternalAiAllowance } = await import("./internal-ai-org-allowance-admin")

beforeEach(() => { ops.length = 0; existing = null })

describe("setInternalAiAllowance", () => {
  test("no row reads as OFF (default closed)", async () => {
    expect((await getInternalAiAllowance("org-1")).allowed).toBe(false)
  })
  test("admin on with no row inserts an enabled row stamped with who", async () => {
    await setInternalAiAllowance({ orgId: "org-1", userId: "u1", dbUser: { role: "admin" } }, true)
    expect(ops[0].kind).toBe("insert")
    expect(ops[0].values).toMatchObject({ orgId: "org-1", isEnabled: true, enabledById: "u1" })
  })
  test("admin off with an existing row updates it to disabled", async () => {
    existing = { id: "e1" }
    await setInternalAiAllowance({ orgId: "org-1", userId: "u1", dbUser: { role: "admin" } }, false)
    expect(ops[0].values).toMatchObject({ isEnabled: false })
  })
  test("off with no row writes nothing", async () => {
    await setInternalAiAllowance({ orgId: "org-1", userId: "u1", dbUser: { role: "admin" } }, false)
    expect(ops).toHaveLength(0)
  })
  test("a member is refused by the service itself", async () => {
    await expect(setInternalAiAllowance({ orgId: "org-1", userId: "u2", dbUser: { role: "member" } }, true)).rejects.toThrow()
    expect(ops).toHaveLength(0)
  })
})
