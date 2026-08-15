/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchSecurityEngines } from "./dispatch-security-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchSecurityEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchSecurityEngines("purchase_cost_calculator", {})).toBe(NOT_HANDLED)
  })

  test("hash_generation_engine hashes by default, and HMACs instead when a secret is supplied", async () => {
    const hashed = await dispatchSecurityEngines("hash_generation_engine", { input: "hello" }) as Record<string, unknown>
    expect(hashed).toHaveProperty("hash")
    expect(hashed).not.toHaveProperty("hmac")
    const hmaced = await dispatchSecurityEngines("hash_generation_engine", { input: "hello", secret: "shh" }) as Record<string, unknown>
    expect(hmaced).toHaveProperty("hmac")
    expect(hmaced).not.toHaveProperty("hash")
  })

  test("hash_generation_engine rejects an algorithm outside sha256/sha512", async () => {
    expect(dispatchSecurityEngines("hash_generation_engine", { input: "x", algorithm: "md5" })).rejects.toThrow("algorithm must be sha256 or sha512")
  })

  test("access_control_evaluation_engine crosses into purpose-bound-ai.ts's isToolAllowedForDomain", async () => {
    const result = await dispatchSecurityEngines("access_control_evaluation_engine", { domain: null, codeReference: null }) as { allowed: boolean }
    expect(typeof result.allowed).toBe("boolean")
  })
})
