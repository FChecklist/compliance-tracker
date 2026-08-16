// Priority 2 item 4 (D10 GAP-06, U-D10.B4.S1): communication-guardrails.ts
// is the deterministic send-time gate for AI-drafted communications --
// covering its decision points directly, matching this codebase's existing
// house style for deterministic gate modules (see
// high-impact-action-detector.test.ts, task-tightening.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { validateRecipients, validateContent, checkCommunicationGuardrails } from "./communication-guardrails"

describe("validateRecipients", () => {
  test("rejects an empty recipient list", () => {
    const result = validateRecipients([])
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("no_recipients")
  })

  test("rejects a non-array value", () => {
    const result = validateRecipients("not-an-array")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("no_recipients")
  })

  test("rejects a malformed email address", () => {
    const result = validateRecipients(["not-an-email", "real@example.com"])
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("malformed_recipient")
  })

  test("passes a list of valid email addresses", () => {
    const result = validateRecipients(["a@example.com", "b@example.co.in"])
    expect(result.passed).toBe(true)
  })
})

describe("validateContent", () => {
  test("rejects an empty subject", () => {
    const result = validateContent("", "Real body text")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("empty_content")
  })

  test("rejects an empty body", () => {
    const result = validateContent("Real subject", "   ")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("empty_content")
  })

  test("rejects a body claiming it was already sent (hallucinated completion)", () => {
    const result = validateContent("Update", "Hi, I have sent the report already.")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("false_completion_claim")
  })

  test("is case-insensitive when detecting false-completion phrases", () => {
    const result = validateContent("Update", "This HAS BEEN SUBMITTED for review.")
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("false_completion_claim")
  })

  test("passes real, non-completed-sounding content", () => {
    const result = validateContent("Weekly update", "Here is the status of the GST filing this week.")
    expect(result.passed).toBe(true)
  })
})

describe("checkCommunicationGuardrails", () => {
  test("recipient check runs before content check", () => {
    const result = checkCommunicationGuardrails({ recipientEmails: [], subject: "", body: "" })
    expect(result.passed).toBe(false)
    if (!result.passed) expect(result.reason).toBe("no_recipients")
  })

  test("passes a fully valid draft", () => {
    const result = checkCommunicationGuardrails({
      recipientEmails: ["client@example.com"],
      subject: "Your GST filing status",
      body: "Your filing for this period is on track. No action needed yet.",
    })
    expect(result.passed).toBe(true)
  })
})
