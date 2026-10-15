/// <reference types="bun-types" />
// Audit 37 point 11: the per-organisation allow flag reads the product-branch entitlement, and fails closed.
// Run: bun test --isolate src/lib/ai/internal-ai-org-allowance.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test"

let behaviour: "enabled" | "disabled" | "throws" = "disabled"
const asked: Array<{ orgId: string; branchKey: string }> = []
const answer = async (orgId: string, branchKey: string) => {
  asked.push({ orgId, branchKey })
  if (behaviour === "throws") throw new Error("Product branch 'internal_ai' is not registered")
  return behaviour === "enabled"
}
mock.module("@/lib/services/product-branch-service", () => ({
  isBranchEnabledForOrgWithDb: async (_db: unknown, orgId: string, branchKey: string) => answer(orgId, branchKey),
  isBranchEnabledForOrg: async (orgId: string, branchKey: string) => answer(orgId, branchKey),
}))
import { INTERNAL_AI_BRANCH_KEY, isInternalAiAllowedForOrg, isInternalAiAllowedForOrgWithDb } from "./internal-ai-org-allowance"

beforeEach(() => {
  behaviour = "disabled"
  asked.length = 0
})

describe("isInternalAiAllowedForOrg", () => {
  test("only an enabled entitlement row allows; none or disabled is closed", async () => {
    expect(await isInternalAiAllowedForOrg("org-1")).toBe(false)
    behaviour = "enabled"
    expect(await isInternalAiAllowedForOrg("org-1")).toBe(true)
    expect(asked.every((a) => a.branchKey === INTERNAL_AI_BRANCH_KEY && a.orgId === "org-1")).toBe(true)
  })
  test("the branch not registered yet, or any lookup error: closed, never thrown", async () => {
    behaviour = "throws"
    expect(await isInternalAiAllowedForOrg("org-1")).toBe(false)
    expect(await isInternalAiAllowedForOrgWithDb({} as never, "org-1")).toBe(false)
  })
  test("no organisation id: closed without a lookup", async () => {
    behaviour = "enabled"
    expect(await isInternalAiAllowedForOrg("")).toBe(false)
    expect(await isInternalAiAllowedForOrgWithDb({} as never, "")).toBe(false)
    expect(asked.length).toBe(0)
  })
  test("the WithDb variant uses the handle it is given (no second transaction)", async () => {
    behaviour = "enabled"
    expect(await isInternalAiAllowedForOrgWithDb({} as never, "org-9")).toBe(true)
  })
})
