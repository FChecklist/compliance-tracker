// Prompt & Cache Management Framework, Phase 1 (2026-07-14): the one
// property this whole framework depends on is determinism (see the
// requirements doc's §6) -- this is the regression test for that property.
import { describe, expect, test } from "bun:test"
import { computeFingerprint } from "./fingerprint"

describe("computeFingerprint", () => {
  test("is deterministic -- identical input always produces identical output", () => {
    const input = "You are VERI. Follow the constitution. Never hallucinate."
    expect(computeFingerprint(input)).toBe(computeFingerprint(input))
  })

  test("produces different fingerprints for different input", () => {
    expect(computeFingerprint("version A")).not.toBe(computeFingerprint("version B"))
  })

  test("is sensitive to a single-character change (no accidental normalization)", () => {
    expect(computeFingerprint("Hello.")).not.toBe(computeFingerprint("Hello!"))
  })

  test("returns a 64-character lowercase hex string (SHA-256)", () => {
    const fp = computeFingerprint("any content")
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
  })
})
