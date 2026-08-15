import { describe, expect, test } from "bun:test"
import { detectLeakedSystemInstruction, scrubPii } from "./layer4-output-filtering"

describe("scrubPii", () => {
  test("detects and redacts an email address", () => {
    const { piiMatches, scrubbedText } = scrubPii("Contact john.smith@example.com for details.")
    expect(piiMatches).toHaveLength(1)
    expect(piiMatches[0].type).toBe("EMAIL")
    expect(scrubbedText).toBe("Contact [REDACTED:EMAIL] for details.")
  })

  test("detects and redacts a US SSN", () => {
    const { piiMatches, scrubbedText } = scrubPii("SSN on file: 123-45-6789.")
    expect(piiMatches.some((m) => m.type === "SSN")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:SSN]")
  })

  test("detects and redacts a US-format phone number", () => {
    const { piiMatches, scrubbedText } = scrubPii("Call me at 555-123-4567 tomorrow.")
    expect(piiMatches.some((m) => m.type === "PHONE")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:PHONE]")
  })

  test("detects and redacts an Indian mobile number (reused from pii-redaction.ts)", () => {
    const { piiMatches, scrubbedText } = scrubPii("Call me on +91 9876543210 tomorrow.")
    expect(piiMatches.some((m) => m.type === "PHONE")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:PHONE]")
  })

  // Phase_4 audit fix: the original version of this file had no GSTIN/PAN/
  // IFSC/Aadhaar coverage at all -- a regression versus pii-redaction.ts,
  // now closed by reusing that file's findPii()/redactPii() directly.
  test("detects and redacts a GSTIN", () => {
    const { piiMatches, scrubbedText } = scrubPii("Our GSTIN is 29ABCDE1234F1Z5 on the invoice.")
    expect(piiMatches.some((m) => m.type === "GSTIN")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:GSTIN]")
  })

  test("detects and redacts a PAN", () => {
    const { piiMatches, scrubbedText } = scrubPii("PAN number ABCDE1234F was verified.")
    expect(piiMatches.some((m) => m.type === "PAN")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:PAN]")
  })

  test("detects and redacts an IFSC code", () => {
    const { piiMatches, scrubbedText } = scrubPii("The IFSC code is HDFC0001234 for that branch.")
    expect(piiMatches.some((m) => m.type === "IFSC")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:IFSC]")
  })

  test("detects and redacts an Aadhaar number", () => {
    const { piiMatches, scrubbedText } = scrubPii("Aadhaar on file: 1234 5678 9012.")
    expect(piiMatches.some((m) => m.type === "AADHAAR")).toBe(true)
    expect(scrubbedText).toContain("[REDACTED:AADHAAR]")
  })

  test("handles multiple PII types in the same text", () => {
    const { piiMatches } = scrubPii("Email jane@example.org or call 555-987-6543, SSN 987-65-4321.")
    const types = new Set(piiMatches.map((m) => m.type))
    expect(types.has("EMAIL")).toBe(true)
    expect(types.has("PHONE")).toBe(true)
    expect(types.has("SSN")).toBe(true)
  })

  test("leaves ordinary text with no PII untouched", () => {
    const { piiMatches, scrubbedText } = scrubPii("The build passed all 42 tests.")
    expect(piiMatches).toHaveLength(0)
    expect(scrubbedText).toBe("The build passed all 42 tests.")
  })
})

describe("detectLeakedSystemInstruction", () => {
  test("detects a verbatim system_instructions delimiter leak", () => {
    expect(detectLeakedSystemInstruction("Sure, here it is: <system_instructions>secret rules</system_instructions>")).toBe(true)
  })

  test("does not flag ordinary output", () => {
    expect(detectLeakedSystemInstruction("The login bug was caused by an expired session token.")).toBe(false)
  })
})
