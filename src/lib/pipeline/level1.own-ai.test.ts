/// <reference types="bun-types" />
// "Connect your AI": an organisation that pasted its OWN key is served by that AI for typed requests, even when our master switch is
// off, the organisation was never "allowed" our AI, and the person is not the owner (the three gates that exist for OUR spend and OUR
// Claude subscription). Without an own AI nothing changes (level1.org-allowance.test.ts). Run: bun test --isolate src/lib/pipeline/level1.own-ai.test.ts
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"

let ownAi: { provider: string; model: string; apiKey: string } | null = null
const calls: Array<{ provider: string; model: string; apiKey: string; segments: string[]; ownKey: boolean }> = []
mock.module("@/lib/ai/org-own-ai", () => ({ resolveAiFor: async () => ownAi }))
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({
  INTERNAL_AI_BRANCH_KEY: "internal_ai",
  isInternalAiAllowedForOrg: async () => false,
  isInternalAiAllowedForOrgWithDb: async () => false,
}))
mock.module("@/lib/ai/providers/openrouter", () => ({
  openrouterProvider: {},
  classifyWithKey: async (provider: string, model: string, apiKey: string, segments: string[], _c: string[], _x: unknown, ownKey: boolean) => {
    calls.push({ provider, model, apiKey, segments, ownKey })
    return segments.map(() => ({ functionId: "create_project", params: { name: "Tower" }, missingParams: [], confidence: 0.95, unmappedIntent: null }))
  },
}))
import { LEVEL1_INTERNAL_AI_OFF_REASON, LEVEL1_ORG_NOT_ALLOWED_REASON, runLevel1 } from "./level1"

const saved = { master: process.env.PROJEXA_INTERNAL_AI_ENABLED, provider: process.env.AI_PROVIDER, rajat: process.env.RAJAT_USER_ID }
beforeAll(() => { process.env.AI_PROVIDER = "claude-cli"; process.env.RAJAT_USER_ID = "the-owner" })
afterAll(() => {
  for (const [k, v] of [["PROJEXA_INTERNAL_AI_ENABLED", saved.master], ["AI_PROVIDER", saved.provider], ["RAJAT_USER_ID", saved.rajat]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
})
beforeEach(() => { ownAi = null; calls.length = 0 })

const ctx = { orgId: "org-1", userId: "key-1", personId: "not-the-owner", projectId: null, candidateFunctionIds: ["create_project"] }

test("own AI connected, master switch OFF, org not allowed, person not the owner: the org's own key understands the request", async () => {
  delete process.env.PROJEXA_INTERNAL_AI_ENABLED
  ownAi = { provider: "openai", model: "gpt-4o-mini", apiKey: "fake-orgs-own-key-bbbb2222" }
  const out = await runLevel1(["create a new project called Tower"], ctx)
  expect(calls).toEqual([{ provider: "openai", model: "gpt-4o-mini", apiKey: "fake-orgs-own-key-bbbb2222", segments: ["create a new project called Tower"], ownKey: true }])
  expect(out.resolutions[0]?.functionId).toBe("create_project")
  expect(out.modelCalls).toBe(1)
})

test("no own AI, master switch OFF: nothing resolved, no model call (unchanged)", async () => {
  delete process.env.PROJEXA_INTERNAL_AI_ENABLED
  const out = await runLevel1(["create a new project called Tower"], ctx)
  expect(out).toEqual({ resolutions: [null], reasons: [LEVEL1_INTERNAL_AI_OFF_REASON], modelCalls: 0 })
  expect(calls).toHaveLength(0)
})

test("no own AI, master on, org not allowed: the org reason, no model call (unchanged)", async () => {
  process.env.PROJEXA_INTERNAL_AI_ENABLED = "1"
  const out = await runLevel1(["create a new project called Tower"], ctx)
  expect(out).toEqual({ resolutions: [null], reasons: [LEVEL1_ORG_NOT_ALLOWED_REASON], modelCalls: 0 })
  expect(calls).toHaveLength(0)
})
