// VERIDIAN_Architecture_v2.0 phase_3 (2026-07-26): tests the pure/
// filesystem-only helpers from prompt-governance-service.ts -- no live DB,
// same "no live DB from a .test.ts file" convention prompt-os-service.test.ts
// already establishes for this directory. The gate-orchestration function
// (runLifecycleTransitionGates) needs a real TenantDb and is exercised via
// prompt-os-service.ts's own integration path instead, not re-mocked here.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { scanPromptContentForPii, getPromptTemplateDependents } from "./prompt-governance-service"

describe("scanPromptContentForPii -- Compliance Engine (prompt-lifecycle sense)", () => {
  test("plain instructional prompt content is clean", () => {
    const result = scanPromptContentForPii("You are a helpful assistant. Answer the user's question concisely, citing sources where relevant.")
    expect(result).toEqual({ clean: true, findings: [] })
  })

  test("an email address in content is flagged", () => {
    const result = scanPromptContentForPii("Contact support at help@example.com for escalations.")
    expect(result.clean).toBe(false)
    expect(result.findings).toContain("email address")
  })

  test("an SSN-shaped number in content is flagged", () => {
    const result = scanPromptContentForPii("The customer's reference SSN is 123-45-6789.")
    expect(result.clean).toBe(false)
    expect(result.findings).toContain("US Social Security Number")
  })

  test("multiple distinct PII kinds are all reported, not just the first match", () => {
    const result = scanPromptContentForPii("Reach me at jane@company.com or 987-65-4321.")
    expect(result.clean).toBe(false)
    expect(result.findings).toContain("email address")
    expect(result.findings).toContain("US Social Security Number")
  })

  // PR #561 audit finding: the original credit-card pattern
  // (\b(?:\d[ -]?){13,16}\b) matched almost any 13-16 digit run, so it
  // would false-positive-block legitimate Production promotions whose
  // content happens to contain a long non-card digit run (order IDs,
  // hashes, concatenated dates). Fixed via a real Luhn checksum.
  test("a real, Luhn-valid card-number-shaped string is flagged as a credit card number", () => {
    // 4111 1111 1111 1111 is the standard publicly-documented Visa test
    // PAN (Luhn-valid by construction) -- a real card-number shape, not a
    // fabricated one.
    const result = scanPromptContentForPii("Test payment method on file: 4111 1111 1111 1111.")
    expect(result.clean).toBe(false)
    expect(result.findings).toContain("credit card number")
  })

  test("a Luhn-invalid long digit run (e.g. an internal reference ID) is NOT flagged as a credit card number -- the false-positive this fix removes", () => {
    // 1234567890123456 is 16 digits (inside the old regex's bare length
    // window) but fails the Luhn checksum -- never a real card number.
    const result = scanPromptContentForPii("Internal order reference: 1234567890123456 processed successfully.")
    expect(result.findings).not.toContain("credit card number")
  })
})

describe("getPromptTemplateDependents -- Dependency Engine (live-computed, not a static registry)", () => {
  test("finds a real, known resolvePromptTemplate('help.ai_assistant_system') call site", () => {
    const dependents = getPromptTemplateDependents("help.ai_assistant_system")
    expect(dependents.length).toBeGreaterThan(0)
    expect(dependents.some((d) => d.file.includes("app/api/help/ask/route.ts"))).toBe(true)
  })

  test("a templateKey with no real call site anywhere returns an empty list, not a fabricated one", () => {
    const dependents = getPromptTemplateDependents("this.template.key.does.not.exist.anywhere")
    expect(dependents).toEqual([])
  })
})
