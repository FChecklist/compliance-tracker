/// <reference types="bun-types" />
// Audit 37 point 11, Level 1 side: master switch on but the organisation not allowed -> nothing resolved, zero model calls.
// Run: bun test --isolate src/lib/pipeline/level1.org-allowance.test.ts
import { afterAll, beforeAll, expect, mock, test } from "bun:test"

let allowed = false
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({
  INTERNAL_AI_BRANCH_KEY: "internal_ai",
  isInternalAiAllowedForOrg: async () => allowed,
  isInternalAiAllowedForOrgWithDb: async () => allowed,
}))
import { LEVEL1_ORG_NOT_ALLOWED_REASON, runLevel1 } from "./level1"

const saved = process.env.PROJEXA_INTERNAL_AI_ENABLED
beforeAll(() => { process.env.PROJEXA_INTERNAL_AI_ENABLED = "1" })
afterAll(() => { if (saved === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = saved })

const ctx = { orgId: "org-1", userId: "key-1", personId: "person-1", projectId: null, candidateFunctionIds: ["x"] }

test("master on, organisation not allowed: nothing resolved, zero model calls, the org reason", async () => {
  allowed = false
  const out = await runLevel1(["do the thing"], ctx)
  expect(out).toEqual({ resolutions: [null], reasons: [LEVEL1_ORG_NOT_ALLOWED_REASON], modelCalls: 0 })
})

test("master on, organisation allowed: the org gate lets it through to the provider gate (which is not the org reason)", async () => {
  allowed = true
  let reasons: string[] = []
  try { reasons = (await runLevel1(["do the thing"], ctx)).reasons } catch { /* the provider gate refused: fine, it is past the org gate */ }
  expect(reasons).not.toContain(LEVEL1_ORG_NOT_ALLOWED_REASON)
})
