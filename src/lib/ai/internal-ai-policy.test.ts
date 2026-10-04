/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-11: the provider policy of the internal AI (internal-ai-policy.ts).
//
// WHAT IS PROVEN
//   1. The Claude subscription is refused unless the owner-only switch is exactly "1": unset, empty, "true", "yes", "0" and " 1" are all
//      off, and off is refused even for the owner, even when the deployment configured claude-cli for the level.
//   2. Switch on: the OWNER is allowed the subscription route (SUBSCRIPTION_ALLOCATED, never re-billable); any other person, a person
//      that did not resolve, and an owner id that is not configured are never served by it.
//   3. Everything else is the metered route (METERED_API, re-billable), and it carries its own gate: the provider must be on the
//      deployment's allowlist and its key must be present, else the answer is a refusal with a reason, never another provider.
//   4. A request with no acting person is refused before anything else.
//   5. The sentence a person is told names no environment variable, provider or key.
//
// Run: bun test --isolate src/lib/ai/internal-ai-policy.test.ts
import { afterEach, beforeEach, describe, expect, test, beforeAll, afterAll } from "bun:test"
// lf-b3-ai-off: these tests pin the behaviour with PROJEXA's internal AI switched ON (PROJEXA_INTERNAL_AI_ENABLED="1"); since
// that package the switch is default OFF, and src/lib/projexa-internal-ai*.test.ts pin the off side.
const savedInternalAiFlag = process.env.PROJEXA_INTERNAL_AI_ENABLED
beforeAll(() => { process.env.PROJEXA_INTERNAL_AI_ENABLED = "1" })
afterAll(() => { if (savedInternalAiFlag === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = savedInternalAiFlag })
import { CLAUDE_CLI_OWNER_FLAG, claudeCliOwnerFlagOn, claudeCliPermission, refusalSentence, resolveInternalAiRoute, type InternalAiRefusalReason } from "./internal-ai-policy"

const KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_ALLOWED_PROVIDERS", CLAUDE_CLI_OWNER_FLAG, "RAJAT_USER_ID", "OPENROUTER_API_KEY"] as const
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])) as Record<(typeof KEYS)[number], string | undefined>

const OWNER = "user-owner"
const CUSTOMER = "user-customer"
/** The organisation has been allowed our AI (Audit 37 point 11). */
const ALLOWED = { orgAllowed: true } as const

function env(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(values)) process.env[k] = v
}

beforeEach(() => env({}))
afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k]
    else process.env[k] = SAVED[k]
  }
})

describe("the owner-only switch", () => {
  test("only the exact value 1 turns it on", () => {
    expect(claudeCliOwnerFlagOn()).toBe(false)
    for (const value of ["", "0", "true", "yes", " 1", "1 ", "on", "TRUE"]) {
      process.env[CLAUDE_CLI_OWNER_FLAG] = value
      expect(claudeCliOwnerFlagOn()).toBe(false)
    }
    process.env[CLAUDE_CLI_OWNER_FLAG] = "1"
    expect(claudeCliOwnerFlagOn()).toBe(true)
  })

  test("flag off: the subscription is refused for everyone, the owner included", () => {
    env({ RAJAT_USER_ID: OWNER })
    expect(claudeCliPermission(OWNER)).toEqual({ ok: false, reason: "claude_cli_flag_off" })
    expect(claudeCliPermission(CUSTOMER)).toEqual({ ok: false, reason: "claude_cli_flag_off" })
    expect(claudeCliPermission(null)).toEqual({ ok: false, reason: "claude_cli_flag_off" })
  })

  test("flag on: only the configured owner is permitted; a stranger, no person and an unset owner id are refused", () => {
    env({ [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER })
    expect(claudeCliPermission(OWNER)).toEqual({ ok: true })
    expect(claudeCliPermission(CUSTOMER)).toEqual({ ok: false, reason: "not_owner" })
    expect(claudeCliPermission(null)).toEqual({ ok: false, reason: "actor_unresolved" })
    delete process.env.RAJAT_USER_ID
    expect(claudeCliPermission(OWNER)).toEqual({ ok: false, reason: "owner_not_configured" })
  })
})

describe("the route for one request", () => {
  test("configured for claude-cli, switch OFF: the owner is NOT served by the subscription, the metered route serves them", () => {
    env({ AI_PROVIDER: "claude-cli", RAJAT_USER_ID: OWNER, OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toEqual({ allowed: true, kind: "metered", provider: "openrouter", providerCostType: "METERED_API", rebillable: true })
  })

  test("the switch off and no metered key: a refusal with its reason, not the subscription and not a guess", () => {
    env({ AI_PROVIDER: "claude-cli", RAJAT_USER_ID: OWNER })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toEqual({ allowed: false, reason: "metered_provider_not_configured" })
    // The default provider of provider-config.ts is claude-cli: an empty environment is the same answer.
    env({ RAJAT_USER_ID: OWNER })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toEqual({ allowed: false, reason: "metered_provider_not_configured" })
  })

  test("configured for claude-cli, switch ON, the owner: the subscription route, recorded as SUBSCRIPTION_ALLOCATED and never re-billed", () => {
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER, OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toEqual({ allowed: true, kind: "owner_subscription", provider: "claude-cli", providerCostType: "SUBSCRIPTION_ALLOCATED", rebillable: false })
    env({ AI_PROVIDER_PIPELINE_L1: "claude-cli-remote", AI_PROVIDER: "openrouter", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toMatchObject({ allowed: true, kind: "owner_subscription", provider: "claude-cli-remote" })
  })

  test("switch ON but the person is not the owner: never the subscription (another person's request is not the owner's own use)", () => {
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER, OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered", provider: "openrouter" })
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "metered_provider_not_configured" })
  })

  test("switch ON and the owner id unset: fails closed, the subscription is not used", () => {
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered" })
  })

  test("configured for openrouter: metered whatever the switch says", () => {
    env({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered", providerCostType: "METERED_API", rebillable: true })
    env({ AI_PROVIDER: "openrouter", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER, OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered" })
  })

  test("the metered route has its own gate: the allowlist and the key", () => {
    env({ AI_PROVIDER: "openrouter" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "metered_provider_not_configured" })
    env({ AI_PROVIDER: "claude-cli", AI_ALLOWED_PROVIDERS: "claude-cli", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "metered_provider_not_allowed" })
    // A blank allowlist is a misconfiguration: refused, not "allow everything".
    env({ AI_ALLOWED_PROVIDERS: " ", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "provider_config_invalid" })
  })

  test("a deployment that allows only openrouter and names no provider is the metered route (the default claude-cli is not on its allowlist)", () => {
    env({ AI_ALLOWED_PROVIDERS: "openrouter", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered" })
  })

  test("no acting person: refused first, whatever the deployment says", () => {
    env({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(null, ALLOWED)).toEqual({ allowed: false, reason: "actor_unresolved" })
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER })
    expect(resolveInternalAiRoute(null, ALLOWED)).toEqual({ allowed: false, reason: "actor_unresolved" })
  })
})

// Audit 37 point 11: "our AI is used only if we allow" -- the per-organisation allow flag, default closed.
// Run for falsifiability: delete the `opts.orgAllowed !== true` line in resolveInternalAiRoute and the first two tests here fail.
describe("the per-organisation allow flag", () => {
  const configured = { AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "present" } as const

  test("master on, organisation NOT allowed (flag false, absent or not exactly true): refused with org_not_allowed", () => {
    env({ ...configured })
    expect(resolveInternalAiRoute(CUSTOMER, { orgAllowed: false })).toEqual({ allowed: false, reason: "org_not_allowed" })
    expect(resolveInternalAiRoute(CUSTOMER)).toEqual({ allowed: false, reason: "org_not_allowed" })
    expect(resolveInternalAiRoute(CUSTOMER, {})).toEqual({ allowed: false, reason: "org_not_allowed" })
    expect(resolveInternalAiRoute(CUSTOMER, { orgAllowed: "yes" as unknown as boolean })).toEqual({ allowed: false, reason: "org_not_allowed" })
  })

  test("the owner is not exempt: an organisation that is not allowed is refused for the owner too, subscription route included", () => {
    env({ AI_PROVIDER: "claude-cli", [CLAUDE_CLI_OWNER_FLAG]: "1", RAJAT_USER_ID: OWNER, OPENROUTER_API_KEY: "present" })
    expect(resolveInternalAiRoute(OWNER)).toEqual({ allowed: false, reason: "org_not_allowed" })
    expect(resolveInternalAiRoute(OWNER, ALLOWED)).toMatchObject({ allowed: true, kind: "owner_subscription" })
  })

  test("master on, organisation allowed: the request routes", () => {
    env({ ...configured })
    expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toMatchObject({ allowed: true, kind: "metered", provider: "openrouter" })
  })

  test("master OFF: refused even when the organisation is allowed (the deployment switch stays the master off)", () => {
    env({ ...configured })
    const saved = process.env.PROJEXA_INTERNAL_AI_ENABLED
    try {
      delete process.env.PROJEXA_INTERNAL_AI_ENABLED
      expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "projexa_internal_ai_off" })
      process.env.PROJEXA_INTERNAL_AI_ENABLED = "true"
      expect(resolveInternalAiRoute(CUSTOMER, ALLOWED)).toEqual({ allowed: false, reason: "projexa_internal_ai_off" })
    } finally {
      if (saved === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED
      else process.env.PROJEXA_INTERNAL_AI_ENABLED = saved
    }
  })
})

describe("what a person is told", () => {
  test("a fixed sentence per refusal that names no variable, provider, key or model", () => {
    const reasons: InternalAiRefusalReason[] = ["actor_unresolved", "org_not_allowed", "claude_cli_flag_off", "owner_not_configured", "not_owner", "provider_config_invalid", "metered_provider_not_allowed", "metered_provider_not_configured"]
    for (const reason of reasons) {
      const sentence = refusalSentence(reason)
      expect(sentence.length).toBeGreaterThan(20)
      expect(sentence).not.toMatch(/openrouter|claude|subscription|INTERNAL_AI|RAJAT|AI_PROVIDER|key|env/i)
    }
    // A subscription refusal does not tell a customer that an owner-only route exists.
    expect(refusalSentence("claude_cli_flag_off")).toBe(refusalSentence("not_owner"))
  })
})
